"""Update-Hinweis: vergleicht die installierte Version mit dem neuesten GitHub-Release.

Wird vom Werkzeug fabrik (`fabrik update`) und von der Halle genutzt. Nur
Standardbibliothek. Fehler (kein Netz, ungültige Antwort, kaputter
Zwischenspeicher) bleiben still: dann gibt es einfach keinen Hinweis.
"""
import json
import os
import re
import time
import urllib.request
from pathlib import Path

# Plugin-Ordner: halle/ liegt direkt darunter, plugin.json unter .claude-plugin/.
WERK = Path(__file__).resolve().parent.parent
PLUGIN_JSON = WERK / ".claude-plugin" / "plugin.json"
RELEASE_URL = "https://api.github.com/repos/jahnouni/claude-fabrik/releases/latest"
BEFEHL = "claude plugin marketplace update claude-fabrik && claude plugin update fabrik@claude-fabrik"
HINWEIS_NEUSTART = "danach Claude Code neu starten"
ZEITLIMIT_S = 3
PRUEF_ABSTAND_S = 6 * 3600
MAX_ANTWORT = 512 * 1024
SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")


def daten_ordner():
    return Path(os.environ.get("FABRIK_DATEN", Path.home() / ".claude/fabrik"))


def version_lesen(text):
    """Zerlegt eine SemVer-Angabe (führendes v erlaubt) oder liefert None."""
    if not isinstance(text, str):
        return None
    m = SEMVER.match(text.strip())
    if not m:
        return None
    kern = tuple(int(m.group(i)) for i in (1, 2, 3))
    vor = tuple(m.group(4).split(".")) if m.group(4) else ()
    return kern, vor


def _vor_schluessel(teil):
    # SemVer: numerische Kennungen sind kleiner als alphanumerische und werden als Zahl verglichen.
    return (0, int(teil), "") if teil.isdigit() else (1, 0, teil)


def ist_neuer(neueste, installiert):
    """True, wenn `neueste` nach SemVer höher ist als `installiert`. Ungültiges zählt nie als neuer."""
    a, b = version_lesen(neueste), version_lesen(installiert)
    if a is None or b is None:
        return False
    if a[0] != b[0]:
        return a[0] > b[0]
    # Gleicher Kern: eine Vorabversion ist kleiner als die fertige Version.
    if not a[1] or not b[1]:
        return not a[1] and bool(b[1])
    return [_vor_schluessel(t) for t in a[1]] > [_vor_schluessel(t) for t in b[1]]


def installierte_version(plugin_json=None):
    try:
        v = json.loads(Path(plugin_json or PLUGIN_JSON).read_text()).get("version")
    except (OSError, ValueError, AttributeError):
        return None
    return v.strip() if isinstance(v, str) and version_lesen(v) else None


def neueste_holen(url=RELEASE_URL, zeitlimit=ZEITLIMIT_S):
    """Fragt das neueste Release bei GitHub ab. Liefert die Version ohne führendes v oder None."""
    anfrage = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "claude-fabrik-update",
    })
    try:
        with urllib.request.urlopen(anfrage, timeout=zeitlimit) as r:
            daten = json.loads(r.read(MAX_ANTWORT).decode("utf-8"))
        tag = daten.get("tag_name")
    except Exception:  # noqa: BLE001 - jeder Fehler heißt nur: kein Hinweis
        return None
    if not version_lesen(tag):
        return None
    return tag.strip().lstrip("v")


def cache_lesen(datei):
    try:
        d = json.loads(Path(datei).read_text())
        geprueft = float(d["geprueft"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    neueste = d.get("neueste")
    return {"geprueft": geprueft, "neueste": neueste if isinstance(neueste, str) else None}


def cache_schreiben(datei, neueste, zeit):
    try:
        datei = Path(datei)
        datei.parent.mkdir(parents=True, exist_ok=True)
        tmp = datei.with_name(f"{datei.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps({"geprueft": zeit, "neueste": neueste}) + "\n")
        os.replace(tmp, datei)
    except OSError:
        pass


def hinweis_an(einstellungen_datei=None):
    """Einstellung `update_hinweis`: Standard an, nur `aus` schaltet ab."""
    datei = Path(einstellungen_datei or daten_ordner() / "einstellungen.json")
    try:
        wert = json.loads(datei.read_text()).get("update_hinweis", "an")
    except (OSError, ValueError, AttributeError):
        return True
    return str(wert).strip().lower() != "aus"


def stand(daten=None, holen=neueste_holen, jetzt=None, plugin_json=None, nur_cache=False):
    """Update-Stand als dict für `fabrik update` und die Halle. Wirft nie.

    Abgefragt wird höchstens alle 6 Stunden; dazwischen gilt der Zwischenspeicher
    `update.json` im Datenordner. Auch ein Fehlschlag wird gemerkt, damit ohne Netz
    nicht bei jedem Aufruf neu gewartet wird. `nur_cache` fragt nie im Netz nach.
    """
    daten = Path(daten or daten_ordner())
    jetzt = time.time() if jetzt is None else jetzt
    installiert = installierte_version(plugin_json)
    ergebnis = {"installiert": installiert, "neueste": None, "update_verfuegbar": False,
                "befehl": BEFEHL, "hinweis": HINWEIS_NEUSTART, "abgeschaltet": False}
    try:
        if not hinweis_an(daten / "einstellungen.json"):
            ergebnis["abgeschaltet"] = True
            return ergebnis
        cache_datei = daten / "update.json"
        cache = cache_lesen(cache_datei)
        frisch = cache is not None and 0 <= jetzt - cache["geprueft"] < PRUEF_ABSTAND_S
        if frisch or nur_cache:
            neueste = cache["neueste"] if cache else None
        else:
            neueste = holen()
            cache_schreiben(cache_datei, neueste, jetzt)
        ergebnis["neueste"] = neueste
        ergebnis["update_verfuegbar"] = bool(installiert and neueste and ist_neuer(neueste, installiert))
    except Exception:  # noqa: BLE001 - der Hinweis darf nie etwas abbrechen
        ergebnis["update_verfuegbar"] = False
    return ergebnis
