"""Tests für die Projektnamen von Sitzungen im Benutzer- oder Temp-Ordner.

Start: python3 -m unittest discover -s tests
"""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SERVER = Path(__file__).resolve().parent.parent / "plugins/fabrik/halle/server.py"


def lade_server(home, lager):
    with mock.patch.dict(os.environ, {"HOME": str(home), "FABRIK_LAGER": str(lager),
                                      "FABRIK_DATEN": str(home / ".claude/fabrik")}):
        spec = importlib.util.spec_from_file_location("halle_server_test", SERVER)
        modul = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modul)
    return modul


def schreib_eintrag(pfad):
    return {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Write", "input": {"file_path": str(pfad), "content": "x"}}]}}


class ProjektnamenTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name).resolve() / "home"
        self.temp = Path(self.tmp.name).resolve() / "tmp"
        self.lager = self.home / "Documents/Projekte/Fabrik"
        for p in (self.home / ".claude/projects", self.temp, self.lager):
            p.mkdir(parents=True)
        self.env = mock.patch.dict(os.environ, {"HOME": str(self.home)})
        self.env.start()
        self.s = lade_server(self.home, self.lager)
        # Der Test selbst läuft in einem echten Temp-Ordner, deshalb eigene Temp-Liste.
        self.s.TEMP_ORDNER = [self.temp]
        self.s.NAMEN_CACHE.clear()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def transkript(self, eintraege, name="11111111-2222-3333-4444-555555555555"):
        ordner = self.home / ".claude/projects" / self.s.kodiert(self.home)
        ordner.mkdir(parents=True, exist_ok=True)
        datei = ordner / f"{name}.jsonl"
        datei.write_text("".join(json.dumps(e) + "\n" for e in eintraege))
        return datei

    def test_fabrik_auftrag_liefert_titel(self):
        auftrag = self.lager / "F-0007-haushalt"
        (auftrag / ".fabrik").mkdir(parents=True)
        (auftrag / ".fabrik/status.json").write_text(json.dumps({"id": "F-0007", "titel": "Haushaltsbuch"}))
        self.assertEqual(self.s.projekt_von_datei(auftrag / "src/app.py"), "Haushaltsbuch")

    def test_oberster_git_ordner(self):
        repo = self.home / "code/werk"
        (repo / ".git").mkdir(parents=True)
        (repo / "sub/.git").mkdir(parents=True)
        self.assertEqual(self.s.projekt_von_datei(repo / "sub/x/datei.txt"), "werk")

    def test_documents_ordner(self):
        self.assertEqual(self.s.projekt_von_datei(self.home / "Documents/Projekte/Tracko/a/b.php"), "Tracko")
        self.assertEqual(self.s.projekt_von_datei(self.home / "Documents/nerdi/c.md"), "nerdi")

    def test_ohne_projekt(self):
        self.assertIsNone(self.s.projekt_von_datei(self.home / ".zshrc"))
        self.assertIsNone(self.s.projekt_von_datei(self.home / ".claude/memory/x.md"))
        self.assertIsNone(self.s.projekt_von_datei(self.temp / "scratch/x.py"))
        self.assertIsNone(self.s.projekt_von_datei("relativ/pfad.py"))

    def test_zuletzt_geschriebene_datei_gewinnt(self):
        datei = self.transkript([
            {"type": "ai-title", "aiTitle": "Titel der Sitzung"},
            schreib_eintrag(self.home / "Documents/Projekte/Alt/a.py"),
            schreib_eintrag(self.home / "Documents/Projekte/Neu/b.py"),
            schreib_eintrag(self.temp / "notiz.txt"),
        ])
        self.assertEqual(self.s.anzeigename(str(self.home), datei), ("Neu", False))

    def test_titel_als_ersatz(self):
        datei = self.transkript([{"type": "ai-title", "aiTitle": "Logs aufräumen"},
                                 schreib_eintrag(self.home / ".claude/plan.md")])
        self.assertEqual(self.s.anzeigename(str(self.home), datei), ("Logs aufräumen", False))

    def test_platzhalter_nur_ohne_beides(self):
        datei = self.transkript([{"type": "user", "message": {"content": "hallo"}}])
        self.assertEqual(self.s.anzeigename(str(self.home), datei), (self.s.BENUTZERORDNER, True))
        self.assertEqual(self.s.anzeigename(str(self.temp / "claude-501/x")), (self.s.BENUTZERORDNER, True))

    def test_echter_projektordner_bleibt(self):
        self.assertEqual(self.s.anzeigename(str(self.home / "Documents/Projekte/Tracko")), ("Tracko", False))

    def test_zwischenspeicher_nach_groesse_und_mtime(self):
        datei = self.transkript([{"type": "ai-title", "aiTitle": "Erst"}])
        self.assertEqual(self.s.projekt_aus_transkript(datei), "Erst")
        with mock.patch.object(self.s, "transkript_ende", side_effect=AssertionError("neu gelesen")):
            self.assertEqual(self.s.projekt_aus_transkript(datei), "Erst")
        with open(datei, "a") as f:
            f.write(json.dumps({"type": "ai-title", "aiTitle": "Danach"}) + "\n")
        self.assertEqual(self.s.projekt_aus_transkript(datei), "Danach")

    def test_kodierte_sammelordner(self):
        self.assertTrue(self.s.ohne_projekt_kodiert(self.s.kodiert(self.home)))
        self.assertTrue(self.s.ohne_projekt_kodiert(self.s.kodiert(self.temp / "claude-501/abc")))
        self.assertFalse(self.s.ohne_projekt_kodiert(self.s.kodiert(self.home / "Documents/Projekte/X")))


if __name__ == "__main__":
    unittest.main()
