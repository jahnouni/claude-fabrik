# Änderungen

## 0.3.1 – 2026-10-30

- Neue Datei `changelog.md` in jedem Projekt im Projektwurzelordner: eine Historie, was in welcher Version hinzugefügt, geändert, behoben oder entfernt wurde. Neueste Version oben.
- Der Approver schreibt den Eintrag der Version vor dem Commit. `fabrik commit` ergänzt ihn aus der Commit-Nachricht, falls er fehlt, so bleibt die Datei wie die Commits und Releases aktuell.

## 0.3.0 – 2026-10-28

- Jedes Projekt hat zwei Dateien im Projektwurzelordner, die alle Arbeiter sehen: `todos.md` für alle Aufgaben aus Prüfungen und Gesprächen, `roadmap.md` für alle Phasen des Projekts mit den Features je Phase. `todos.md` wandert damit aus `.fabrik/` in den Projektordner. Der Spec-Arbeiter legt die Roadmap an, der Orchestrator hakt nach der Freigabe die fertigen Features ab.
- `fabrik neue-version` archiviert die `todos.md` und setzt sie zurück, die `roadmap.md` bleibt erhalten.
- Update-Hinweis: Neuer Befehl `fabrik update` vergleicht die installierte Version mit dem neuesten Release auf GitHub (`jahnouni/claude-fabrik`) und liefert `installiert`, `neueste`, `update_verfuegbar` und `befehl` als JSON. Abgefragt wird höchstens alle 6 Stunden, das Ergebnis liegt in `~/.claude/fabrik/update.json`. Ohne Netz oder bei Fehlern gibt es still keinen Hinweis.
- `/fabrik` meldet beim Start in einer Zeile „Update <Version> verfügbar“ mit dem Befehl zum Aktualisieren.
- Halle: dezentes, schließbares Banner oben rechts mit neuer Version und kopierbarem Befehl. Die Abfrage läuft im Hintergrund, die Halle wartet nie darauf.
- Neue Einstellung `update_hinweis` (Standard `an`), abschalten mit `fabrik einstellung update_hinweis aus`.

## 0.2.0 – 2026-10-28

- Halle: Sitzungen im Benutzerordner oder in Temp-Ordnern (`/tmp`, `/private/tmp`, `/var/folders`) zeigen den Namen des Projekts, an dem sie arbeiten. Maßgeblich ist die zuletzt geschriebene Datei: Titel des Fabrik-Auftrags, sonst Name des Git-Repos oder Projektordner unter `~/Documents/Projekte` bzw. `~/Documents`. Ohne solche Datei steht der Sitzungstitel da, nur ohne beides „~ (Benutzerordner)“, dezent dargestellt. Gilt für laufende und ruhende Plätze; das Ergebnis wird pro Transkript zwischengespeichert.
- Halle auf schmalen Bildschirmen (unter 900 px): die Halle wird in Mindestgröße gezeigt und lässt sich scrollen, statt auf ein Viertel zu schrumpfen; Pakete und die Werkstatt-Überschrift haben größere Trefferflächen.
- Infokarte: als Dialog ausgezeichnet, geschlossen nicht mehr per Tab erreichbar, Fokus springt beim Öffnen in die Karte und beim Schließen zurück auf das auslösende Element; die Halle dahinter ist solange gesperrt.

## 0.1.0 – 2026-10-28

Erste Version als Claude-Code-Plugin.

- `/fabrik` mit Spec, Bau, bis zu drei Prüfrunden und Freigabe
- Arbeiter: Spec, Builder, Sicherheit, Inspector, Bediener, Designer, Approver
- Fabrikhalle im Browser (nur lokal, 127.0.0.1:7333)
- Einrichtung beim ersten Start: Lagerordner, Git-Identität, Autorname, Autostart
- Einstellungen und Laufzeitdateien liegen außerhalb des Plugins und überstehen Updates
