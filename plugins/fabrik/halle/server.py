#!/usr/bin/env python3
"""Lokaler Server der Fabrikhalle: liefert die Seite und den Stand aus dem Lager.

Bindet nur an 127.0.0.1 und liest ausschließlich: Lager, Sitzungsdateien
und unter ~/.claude/projects die Projektordner sowie das Ende einzelner
Transkripte (für die Infokarte einer Sitzung). Einzige schreibende Aktion: Prüfer in den Einstellungen (einstellungen.json)
an- oder abschalten (POST /api/rolle, nur vom eigenen Ursprung).
"""
import argparse
import json
import os
import re
import signal
import socketserver
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HIER = Path(__file__).resolve().parent
# Lager und Datenordner gibt das Werkzeug fabrik beim Start mit.
LAGER = Path(os.environ.get("FABRIK_LAGER", Path.home() / "Claude-Fabrik"))
DATEN = Path(os.environ.get("FABRIK_DATEN", Path.home() / ".claude/fabrik"))
CLAUDE = Path.home() / ".claude"
ID_MUSTER = re.compile(r"^F-\d{4}$")
SITZUNG_MUSTER = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SCHREIB_WERKZEUGE = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
EINSTELLUNGEN = DATEN / "einstellungen.json"
# Nur Prüfer lassen sich abschalten (gleiche Liste wie im Werkzeug fabrik).
SCHALTBAR = ["sicherheit", "designer", "inspector", "bediener"]
DATEIEN = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/halle.css": ("halle.css", "text/css; charset=utf-8"),
    "/halle.js": ("halle.js", "text/javascript; charset=utf-8"),
}
RUHT_AB_MIN = 60
ZULETZT_TAGE = 7


def lies(pfad, standard=""):
    try:
        return pfad.read_text()
    except (OSError, UnicodeDecodeError):
        return standard


def minuten_seit(iso):
    try:
        return int((datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds() // 60)
    except (TypeError, ValueError):
        return None


def zaehle_haken(text):
    offen = len(re.findall(r"^\s*[-*]\s*\[ \]", text, re.M))
    erledigt = len(re.findall(r"^\s*[-*]\s*\[[xX~]\]", text, re.M))
    return offen, erledigt


def auftraege():
    liste = []
    for datei in sorted(LAGER.glob("F-[0-9][0-9][0-9][0-9]-*/.fabrik/status.json")):
        try:
            s = json.loads(datei.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        fab = datei.parent
        todos_offen, todos_erledigt = zaehle_haken(lies(fab / "todos.md"))
        backlog_offen, _ = zaehle_haken(lies(fab / "backlog.md"))
        kriterien = s.get("kriterien", [])
        ruht = minuten_seit(s.get("aktualisiert"))
        liste.append({
            "id": s["id"],
            "titel": s.get("titel", ""),
            "status": s.get("status"),
            "station": s.get("station"),
            "runde": s.get("runde", 0),
            "max_runden": s.get("max_runden", 3),
            "version": s.get("version", 0),
            "hat_ui": s.get("hat_ui"),
            "sensibel": s.get("sensibel", []),
            "aktive_arbeiter": s.get("aktive_arbeiter", []),
            "erstellt": s.get("erstellt"),
            "aktualisiert": s.get("aktualisiert"),
            "ruht": s.get("status") == "aktiv" and ruht is not None and ruht >= RUHT_AB_MIN,
            "kriterien_ok": sum(1 for k in kriterien if k.get("erfuellt") is True),
            "kriterien_gesamt": len(kriterien),
            "todos_offen": todos_offen,
            "todos_erledigt": todos_erledigt,
            "backlog_offen": backlog_offen,
            "eskalation": s.get("eskalation"),
        })
    return liste


def lebt(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def anzeigename(cwd):
    p = Path(cwd)
    if p == Path.home():
        return "~ (Benutzerordner)"
    return p.name


def sitzungen():
    """Laufende Claude-Sitzungen und zuletzt genutzte Projektordner."""
    laufend, gesehen = [], set()
    for datei in (CLAUDE / "sessions").glob("*.json"):
        try:
            s = json.loads(datei.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        pid = s.get("pid")
        if not isinstance(pid, int) or not lebt(pid):
            continue
        cwd = s.get("cwd", "")
        gesehen.add(cwd)
        laufend.append({
            "id": s.get("sessionId") or "",
            "projekt": anzeigename(cwd),
            "name": s.get("name") or "",
            "cwd": cwd,
            "zustand": "wartet" if s.get("status") == "idle" else "arbeitet",
            "fabrik": cwd.startswith(str(LAGER)),
            "seit": s.get("statusUpdatedAt") or s.get("updatedAt"),
        })
    laufend.sort(key=lambda x: (x["zustand"] != "arbeitet", x["projekt"].lower()))

    ruhend = []
    grenze = time.time() - ZULETZT_TAGE * 86400
    for ordner in (CLAUDE / "projects").iterdir() if (CLAUDE / "projects").is_dir() else []:
        try:
            neueste = max(ordner.glob("*.jsonl"), key=lambda f: f.stat().st_mtime, default=None)
            mtime = neueste.stat().st_mtime if neueste else 0
        except OSError:
            continue
        if mtime < grenze:
            continue
        # Ordnernamen sind kodierte Pfade (/ → -); nur für die Anzeige zurückübersetzen.
        name = ordner.name
        for praefix in (f"{str(Path.home()).replace('/', '-')}-Documents-Projekte-",
                        f"{str(Path.home()).replace('/', '-')}-Documents-",
                        f"{str(Path.home()).replace('/', '-')}-"):
            if name.startswith(praefix):
                name = name[len(praefix):]
                break
        else:
            if name == str(Path.home()).replace("/", "-"):
                name = "~ (Benutzerordner)"
        if any(anzeigename(c) == name for c in gesehen):
            continue
        ruhend.append({"id": neueste.stem if SITZUNG_MUSTER.match(neueste.stem) else "",
                       "projekt": name, "name": "", "cwd": "", "zustand": "ruht",
                       "fabrik": False, "seit": int(mtime * 1000)})
    ruhend.sort(key=lambda x: -x["seit"])
    return laufend + ruhend


def transkript_ende(datei, groesse=1_500_000):
    """Liest die letzten Zeilen eines Transkripts, ohne die ganze Datei zu laden."""
    try:
        with open(datei, "rb") as f:
            f.seek(0, os.SEEK_END)
            laenge = f.tell()
            f.seek(max(0, laenge - groesse))
            roh = f.read()
    except OSError:
        return []
    zeilen = roh.decode("utf-8", "replace").splitlines()
    if laenge > groesse:
        zeilen = zeilen[1:]  # erste Zeile ist angeschnitten
    eintraege = []
    for z in zeilen:
        try:
            eintraege.append(json.loads(z))
        except json.JSONDecodeError:
            pass
    return eintraege


def text_aus(inhalt):
    if isinstance(inhalt, str):
        return inhalt
    if isinstance(inhalt, list):
        return "\n".join(b.get("text", "") for b in inhalt if isinstance(b, dict) and b.get("type") == "text")
    return ""


def sitzung_details(sid):
    treffer = [f for f in (CLAUDE / "projects").glob(f"*/{sid}.jsonl") if f.is_file()]
    laufend = None
    for datei in (CLAUDE / "sessions").glob("*.json"):
        try:
            s = json.loads(datei.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if s.get("sessionId") == sid and isinstance(s.get("pid"), int) and lebt(s["pid"]):
            laufend = s
            break
    if not treffer and not laufend:
        return None
    titel = letzte_eingabe = letzte_antwort = cwd = ""
    frage, dateien, zuletzt = None, [], None
    if treffer:
        for e in transkript_ende(treffer[0]):
            typ = e.get("type")
            cwd = e.get("cwd") or cwd
            zuletzt = e.get("timestamp") or zuletzt
            if typ == "ai-title":
                titel = e.get("aiTitle") or titel
            elif typ == "last-prompt":
                letzte_eingabe = e.get("lastPrompt") or letzte_eingabe
            elif typ == "user" and not e.get("isSidechain"):
                t = text_aus((e.get("message") or {}).get("content"))
                if t.strip() and not t.lstrip().startswith("<"):
                    letzte_eingabe = t
            elif typ == "assistant" and not e.get("isSidechain"):
                inhalt = (e.get("message") or {}).get("content") or []
                t = text_aus(inhalt)
                if t.strip():
                    letzte_antwort, frage = t, None
                for b in inhalt if isinstance(inhalt, list) else []:
                    if not isinstance(b, dict) or b.get("type") != "tool_use":
                        continue
                    eingabe = b.get("input") or {}
                    if b.get("name") in SCHREIB_WERKZEUGE and eingabe.get("file_path"):
                        pfad = eingabe["file_path"]
                        if pfad in dateien:
                            dateien.remove(pfad)
                        dateien.append(pfad)
                    if b.get("name") == "AskUserQuestion":
                        frage = "\n".join(q.get("question", "") for q in eingabe.get("questions", []) if isinstance(q, dict))
    if laufend:
        cwd = laufend.get("cwd") or cwd
    zustand = "ruht" if not laufend else ("wartet" if laufend.get("status") == "idle" else "arbeitet")
    return {
        "id": sid,
        "projekt": anzeigename(cwd) if cwd else "",
        "name": (laufend or {}).get("name") or "",
        "titel": titel,
        "cwd": cwd,
        "zustand": zustand,
        "seit": (laufend or {}).get("statusUpdatedAt") or zuletzt,
        "gestartet": (laufend or {}).get("startedAt"),
        "letzte_eingabe": letzte_eingabe[-1200:],
        # Worauf die Sitzung wartet: eine offene Rückfrage oder die letzte Antwort.
        "frage": (frage or letzte_antwort)[-1500:] if zustand == "wartet" else "",
        "letzte_antwort": letzte_antwort[-1500:] if zustand != "wartet" else "",
        "dateien": dateien[-8:][::-1],
    }


def rollen_aus():
    try:
        d = json.loads(EINSTELLUNGEN.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    return [r for r in d.get("deaktiviert", []) if r in SCHALTBAR]


def setze_rolle(rolle, aktiv):
    try:
        d = json.loads(EINSTELLUNGEN.read_text())
    except (OSError, json.JSONDecodeError):
        d = {}
    aus = [r for r in d.get("deaktiviert", []) if r in SCHALTBAR and r != rolle]
    if not aktiv:
        aus.append(rolle)
    d["deaktiviert"] = [r for r in SCHALTBAR if r in aus]
    tmp = EINSTELLUNGEN.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, EINSTELLUNGEN)
    return d["deaktiviert"]


def wach_aktiv():
    try:
        pid = int((DATEN / "wach.pid").read_text().strip())
    except (OSError, ValueError):
        return False
    return lebt(pid)


def auftrag_details(aid):
    treffer = sorted(LAGER.glob(f"{aid}-*/.fabrik/status.json"))
    if not treffer:
        return None
    fab = treffer[0].parent
    status = json.loads(treffer[0].read_text())
    befunde = {}
    for f in sorted((fab / "befunde").glob("runde-*.md")):
        befunde[f.stem] = lies(f)
    verlauf = []
    for zeile in lies(fab / "verlauf.jsonl").splitlines()[-80:]:
        try:
            verlauf.append(json.loads(zeile))
        except json.JSONDecodeError:
            pass
    return {
        "status": status,
        "spec": lies(fab / "spec.md"),
        "todos": lies(fab / "todos.md"),
        "backlog": lies(fab / "backlog.md"),
        "freigabe": lies(fab / "freigabe.md"),
        "befunde": befunde,
        "verlauf": verlauf,
    }


class Halle(BaseHTTPRequestHandler):
    server_version = "Fabrikhalle"

    def log_message(self, *args):
        pass

    def senden(self, code, inhalt, typ):
        daten = inhalt.encode() if isinstance(inhalt, str) else inhalt
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(daten)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(daten)

    def json(self, daten, code=200):
        self.senden(code, json.dumps(daten, ensure_ascii=False), "application/json; charset=utf-8")

    def do_GET(self):
        # Schutz vor DNS-Rebinding: nur Aufrufe über die lokale Adresse annehmen.
        host = self.headers.get("Host", "")
        if host.split(":")[0] not in ("127.0.0.1", "localhost"):
            return self.senden(403, "Nur lokal", "text/plain; charset=utf-8")
        pfad = self.path.split("?")[0]
        if pfad in DATEIEN:
            name, typ = DATEIEN[pfad]
            return self.senden(200, (HIER / name).read_bytes(), typ)
        if pfad == "/api/stand":
            return self.json({"auftraege": auftraege(), "sitzungen": sitzungen(), "wach": wach_aktiv(),
                              "rollen_aus": rollen_aus(), "schaltbar": SCHALTBAR,
                              "lager": str(LAGER), "zeit": datetime.now(timezone.utc).isoformat()})
        m = re.match(r"^/api/auftrag/([^/]+)$", pfad)
        if m and ID_MUSTER.match(m.group(1)):
            d = auftrag_details(m.group(1))
            return self.json(d) if d else self.json({"fehler": "unbekannt"}, 404)
        m = re.match(r"^/api/sitzung/([^/]+)$", pfad)
        if m and SITZUNG_MUSTER.match(m.group(1)):
            d = sitzung_details(m.group(1))
            return self.json(d) if d else self.json({"fehler": "unbekannt"}, 404)
        self.senden(404, "Nicht gefunden", "text/plain; charset=utf-8")


    def do_POST(self):
        # Einzige schreibende Aktion: einen Prüfer an- oder abschalten.
        # Schutz vor fremden Webseiten: lokale Adresse, gleicher Ursprung, eigener Header und JSON.
        host = self.headers.get("Host", "")
        if host.split(":")[0] not in ("127.0.0.1", "localhost"):
            return self.senden(403, "Nur lokal", "text/plain; charset=utf-8")
        erlaubt = {f"http://{host}"}
        if self.headers.get("Origin") not in erlaubt or self.headers.get("X-Fabrik-Halle") != "1" \
                or not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return self.senden(403, "Nicht erlaubt", "text/plain; charset=utf-8")
        if self.path.split("?")[0] != "/api/rolle":
            return self.senden(404, "Nicht gefunden", "text/plain; charset=utf-8")
        try:
            laenge = min(int(self.headers.get("Content-Length") or 0), 1024)
            daten = json.loads(self.rfile.read(laenge) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self.json({"fehler": "ungültig"}, 400)
        rolle, aktiv = daten.get("rolle"), daten.get("aktiv")
        if rolle not in SCHALTBAR or not isinstance(aktiv, bool):
            return self.json({"fehler": "ungültig"}, 400)
        return self.json({"rollen_aus": setze_rolle(rolle, aktiv)})


class LokalerServer(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        # HTTPServer.server_bind fragt per Reverse-DNS den Hostnamen ab; das kann
        # je nach Netzwerk hängen. Für 127.0.0.1 brauchen wir den Namen nicht.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def beenden(*_):
    # SIGTERM wie Strg+C behandeln, damit die PID-Datei aufgeräumt wird.
    raise KeyboardInterrupt


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=7333)
    p.add_argument("--pid", help="Datei, in die die Prozessnummer geschrieben wird")
    a = p.parse_args()
    server = LokalerServer(("127.0.0.1", a.port), Halle)
    if a.pid:
        Path(a.pid).write_text(str(os.getpid()))
    signal.signal(signal.SIGTERM, beenden)
    print(f"Fabrikhalle läuft auf http://127.0.0.1:{a.port}/ (Lager: {LAGER})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if a.pid and Path(a.pid).exists() and Path(a.pid).read_text().strip() == str(os.getpid()):
            Path(a.pid).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
