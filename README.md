# Claude Fabrik

Eine Software-Fabrik als Plugin für [Claude Code](https://code.claude.com). Du beschreibst, was du haben willst, und die Fabrik schickt den Wunsch durch feste Stationen:

```
Wunsch → Spec → Bau → Prüfrunden (bis zu 3) → Freigabe → Commit
                         │
                         ├─ Sicherheit   (Lücken, Zugangsdaten)
                         ├─ Inspector    (Code, Aufbau, Robustheit)
                         ├─ Bediener     (startet die App, prüft die Abnahmekriterien)
                         └─ Designer     (nur bei Oberflächen)
```

- Nur **Blocker** gehen zurück an den Builder, Kleinigkeiten landen im Backlog.
- Der **Approver** gibt frei oder eskaliert an dich, wenn es um Zahlungen, Sicherheit, Zugangsdaten oder offene Blocker geht. Ein eskalierter Auftrag steht rot in der Halle und wartet auf deine Entscheidung.
- Commits gibt es erst nach der Freigabe. Gepusht wird nie automatisch.
- Die **Fabrikhalle** zeigt im Browser, was gerade gebaut wird: Stationen, Arbeiter, Runden, Befunde und laufende Claude-Sitzungen. Sie läuft nur lokal auf `127.0.0.1:7333`.

## Voraussetzungen

- Claude Code
- macOS oder Linux (Windows wird nicht unterstützt)
- Python 3.9 oder neuer, Git
- optional: [GitHub CLI](https://cli.github.com) `gh`. Hat ein Auftrag ein GitHub-Repo, legt die Fabrik zu jedem Befund ein Issue an.

## Installation

In Claude Code:

```
/plugin marketplace add jahnouni/claude-fabrik
/plugin install fabrik@claude-fabrik
```

Danach `/reload-plugins` oder Claude Code neu starten.

Ohne SSH-Schlüssel für GitHub vorher im Terminal `export CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` setzen.

## Benutzung

| Befehl | Was passiert |
|---|---|
| `/fabrik "Ein Haushaltsbuch als Web-App"` | neuer Auftrag, läuft durch alle Stationen |
| `/fabrik F-0001` | Auftrag fortsetzen, z. B. nach einer Eskalation |
| `/fabrik` | alle Aufträge anzeigen |
| `/fabrik halle` | Fabrikhalle im Browser öffnen |
| `/fabrik halle stopp` | Halle beenden |
| `/fabrik einrichten` | Einstellungen neu festlegen |

Falls `/fabrik` nicht gefunden wird, heißt der Befehl mit Plugin-Präfix `/fabrik:fabrik`.

Beim ersten Start fragt die Fabrik einmal nach:

- **Lager:** Ordner für die Aufträge (Standard `~/Claude-Fabrik`). Jeder Auftrag bekommt dort einen eigenen Ordner mit Git-Repo, z. B. `F-0001-haushaltsbuch`.
- **Git-Identität** für die Commits der Aufträge (Standard: deine globale Git-Einstellung)
- **Autor**, der eingetragen wird, wenn ein Projekt einen braucht
- **Autostart** (macOS): Die Halle startet beim Anmelden, aber nur, wenn noch Aufträge offen sind.

## Einstellungen

Alles lässt sich auch direkt setzen. Das Werkzeug `fabrik` liegt im Plugin unter `bin/` und steht Claude im Terminal zur Verfügung:

```
fabrik einstellung                     # alle Einstellungen anzeigen
fabrik einstellung lager ~/Projekte/Fabrik
fabrik einstellung git_name "Max Muster"
fabrik einstellung git_email "max@example.org"
fabrik einstellung autor "Max Muster"
fabrik rolle designer aus              # Prüfer ab- oder anschalten (auch per Klick in der Halle)
fabrik autostart an|aus                # Anmeldedienst (macOS)
```

Einstellungen und Laufzeitdateien liegen in `~/.claude/fabrik/` (änderbar über die Umgebungsvariable `FABRIK_DATEN`), also außerhalb des Plugins. Updates lassen sie unberührt. Das Lager lässt sich auch mit `FABRIK_LAGER` überschreiben.

Die Arbeiter laufen mit diesen Modellen: Spec, Builder, Sicherheit und Approver mit Opus; Inspector, Bediener und Designer mit Sonnet.

## Updates

Neue Versionen holen:

```
/plugin marketplace update claude-fabrik
```

Automatisch geht es so: `/plugin` öffnen, unter **Marketplaces** `claude-fabrik` wählen und die automatische Aktualisierung einschalten. Claude Code prüft dann beim Start auf neue Versionen.

Was sich geändert hat, steht im [CHANGELOG](CHANGELOG.md).

## Deinstallieren

```
fabrik autostart aus
/plugin uninstall fabrik@claude-fabrik
```

Deine Aufträge im Lager und die Einstellungen in `~/.claude/fabrik/` bleiben erhalten. Lösch sie bei Bedarf von Hand.

## Neue Version veröffentlichen

1. Änderungen unter `plugins/fabrik/` machen
2. `version` in `plugins/fabrik/.claude-plugin/plugin.json` erhöhen. Ohne neue Versionsnummer sehen andere das Update nicht.
3. Eintrag im `CHANGELOG.md`
4. `claude plugin validate ./plugins/fabrik` und `claude plugin validate ./`
5. Committen und pushen

Zum Ausprobieren ohne Installation: `claude --plugin-dir ./plugins/fabrik`

## Tests

```
python3 -m unittest discover -s tests
```

Die Tests prüfen, wie die Halle Sitzungen im Benutzer- oder Temp-Ordner benennt. Sie brauchen nur Python 3.9 oder neuer.

## Lizenz

MIT
