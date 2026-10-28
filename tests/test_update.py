"""Tests für den Update-Hinweis: Versionsvergleich, Zwischenspeicher, Fehlerfall, Abschalten.

Kein Test nutzt das Netz: die Abfrage bei GitHub wird ersetzt.
Start: python3 -m unittest discover -s tests
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parent.parent / "plugins/fabrik"
WERKZEUG = PLUGIN / "bin/fabrik"


def lade_update():
    spec = importlib.util.spec_from_file_location("fabrik_update_test", PLUGIN / "halle/update.py")
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


u = lade_update()


class VersionsvergleichTest(unittest.TestCase):
    def test_hoehere_versionen(self):
        for neu, alt in [("0.3.0", "0.2.0"), ("1.0.0", "0.9.9"), ("0.10.0", "0.9.0"),
                         ("0.2.1", "0.2.0"), ("v0.3.0", "0.2.0"), ("1.0.0", "1.0.0-rc.1"),
                         ("1.0.0-rc.2", "1.0.0-rc.1"), ("1.0.0-beta", "1.0.0-alpha"),
                         ("1.0.0-alpha.beta", "1.0.0-alpha.1"), ("1.0.0-rc.10", "1.0.0-rc.9")]:
            with self.subTest(neu=neu, alt=alt):
                self.assertTrue(u.ist_neuer(neu, alt))

    def test_nicht_hoeher(self):
        for neu, alt in [("0.3.0", "0.3.0"), ("0.2.9", "0.3.0"), ("1.0.0-rc.1", "1.0.0"),
                         ("0.3.0+build.5", "0.3.0"), ("v0.3.0", "0.3.0")]:
            with self.subTest(neu=neu, alt=alt):
                self.assertFalse(u.ist_neuer(neu, alt))

    def test_ungueltiges_zaehlt_nie_als_neuer(self):
        for neu, alt in [("neu", "0.1.0"), ("", "0.1.0"), (None, "0.1.0"), ("1.0", "0.1.0"),
                         ("0.4.0", "kaputt"), ("0.4.0", None), (42, "0.1.0")]:
            with self.subTest(neu=neu, alt=alt):
                self.assertFalse(u.ist_neuer(neu, alt))


class StandTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.daten = Path(self.tmp.name) / "daten"
        self.plugin_json = Path(self.tmp.name) / "plugin.json"
        self.plugin_json.write_text(json.dumps({"name": "fabrik", "version": "0.3.0"}))
        self.abfragen = 0

    def tearDown(self):
        self.tmp.cleanup()

    def holen(self, antwort):
        def f():
            self.abfragen += 1
            if isinstance(antwort, Exception):
                raise antwort
            return antwort
        return f

    def stand(self, holen, jetzt=1_000_000.0, **kw):
        return u.stand(self.daten, holen=holen, jetzt=jetzt, plugin_json=self.plugin_json, **kw)

    def test_update_verfuegbar(self):
        s = self.stand(self.holen("0.4.0"))
        self.assertEqual((s["installiert"], s["neueste"], s["update_verfuegbar"]), ("0.3.0", "0.4.0", True))
        self.assertEqual(s["befehl"], "claude plugin marketplace update claude-fabrik && claude plugin update fabrik@claude-fabrik")

    def test_gleiche_version_kein_update(self):
        self.assertFalse(self.stand(self.holen("0.3.0"))["update_verfuegbar"])

    def test_cache_verhindert_neue_abfrage_innerhalb_6_stunden(self):
        self.stand(self.holen("0.4.0"), jetzt=1_000_000.0)
        s = self.stand(self.holen("9.9.9"), jetzt=1_000_000.0 + 6 * 3600 - 1)
        self.assertEqual(self.abfragen, 1)
        self.assertEqual(s["neueste"], "0.4.0")
        self.assertTrue((self.daten / "update.json").is_file())

    def test_cache_abgelaufen_fragt_neu(self):
        self.stand(self.holen("0.4.0"), jetzt=1_000_000.0)
        s = self.stand(self.holen("0.5.0"), jetzt=1_000_000.0 + 6 * 3600)
        self.assertEqual(self.abfragen, 2)
        self.assertEqual(s["neueste"], "0.5.0")

    def test_cache_aus_der_zukunft_gilt_nicht(self):
        self.stand(self.holen("0.4.0"), jetzt=2_000_000.0)
        self.stand(self.holen("0.4.0"), jetzt=1_000_000.0)
        self.assertEqual(self.abfragen, 2)

    def test_kaputter_cache_wird_ersetzt(self):
        self.daten.mkdir(parents=True)
        (self.daten / "update.json").write_text("{kein json")
        s = self.stand(self.holen("0.4.0"))
        self.assertTrue(s["update_verfuegbar"])
        self.assertEqual(json.loads((self.daten / "update.json").read_text())["neueste"], "0.4.0")

    def test_fehlschlag_wird_gemerkt_und_bricht_nicht_ab(self):
        s = self.stand(self.holen(None))
        self.assertFalse(s["update_verfuegbar"])
        self.assertIsNone(s["neueste"])
        self.stand(self.holen("0.4.0"), jetzt=1_000_000.0 + 60)
        self.assertEqual(self.abfragen, 1)

    def test_ausnahme_beim_holen_bricht_nicht_ab(self):
        s = self.stand(self.holen(RuntimeError("kaputt")))
        self.assertFalse(s["update_verfuegbar"])

    def test_nur_cache_fragt_nie(self):
        s = self.stand(self.holen("0.4.0"), nur_cache=True)
        self.assertEqual(self.abfragen, 0)
        self.assertFalse(s["update_verfuegbar"])

    def test_abgeschaltet(self):
        self.daten.mkdir(parents=True)
        (self.daten / "einstellungen.json").write_text(json.dumps({"update_hinweis": "aus"}))
        s = self.stand(self.holen("0.4.0"))
        self.assertEqual(self.abfragen, 0)
        self.assertTrue(s["abgeschaltet"])
        self.assertFalse(s["update_verfuegbar"])

    def test_ohne_lesbare_plugin_json_kein_update(self):
        self.plugin_json.unlink()
        s = self.stand(self.holen("0.4.0"))
        self.assertIsNone(s["installiert"])
        self.assertFalse(s["update_verfuegbar"])


class NeuesteHolenTest(unittest.TestCase):
    def test_ohne_netz_none(self):
        with mock.patch.object(u.urllib.request, "urlopen", side_effect=OSError("kein Netz")):
            self.assertIsNone(u.neueste_holen())

    def test_tag_ohne_v(self):
        antwort = mock.MagicMock()
        antwort.__enter__.return_value.read.return_value = json.dumps({"tag_name": "v0.4.0"}).encode()
        with mock.patch.object(u.urllib.request, "urlopen", return_value=antwort) as auf:
            self.assertEqual(u.neueste_holen(), "0.4.0")
        self.assertEqual(auf.call_args.kwargs["timeout"], 3)

    def test_ungueltige_antwort_none(self):
        for roh in (b"kein json", json.dumps({"tag_name": "neu"}).encode(), json.dumps([1]).encode()):
            antwort = mock.MagicMock()
            antwort.__enter__.return_value.read.return_value = roh
            with self.subTest(roh=roh), mock.patch.object(u.urllib.request, "urlopen", return_value=antwort):
                self.assertIsNone(u.neueste_holen())


class WerkzeugTest(unittest.TestCase):
    """`fabrik update` und die Einstellung `update_hinweis`, ohne Netz (Zwischenspeicher ist frisch)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.daten = Path(self.tmp.name)
        self.env = {**os.environ, "FABRIK_DATEN": str(self.daten), "FABRIK_LAGER": str(self.daten / "lager")}

    def tearDown(self):
        self.tmp.cleanup()

    def fabrik(self, *args):
        return subprocess.run([sys.executable, str(WERKZEUG), *args], env=self.env,
                              capture_output=True, text=True, timeout=30)

    def test_update_aus_frischem_cache(self):
        import time
        (self.daten / "update.json").write_text(json.dumps({"geprueft": time.time(), "neueste": "99.0.0"}))
        r = self.fabrik("update")
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.loads(r.stdout)
        installiert = json.loads((PLUGIN / ".claude-plugin/plugin.json").read_text())["version"]
        self.assertEqual(d["installiert"], installiert)
        self.assertEqual(d["neueste"], "99.0.0")
        self.assertTrue(d["update_verfuegbar"])
        self.assertIn("claude plugin update fabrik@claude-fabrik", d["befehl"])

    def test_einstellung_update_hinweis(self):
        self.assertEqual(self.fabrik("einstellung", "update_hinweis").stdout.strip(), "an")
        self.assertEqual(self.fabrik("einstellung", "update_hinweis", "aus").returncode, 0)
        self.assertEqual(json.loads(self.fabrik("einstellung").stdout)["update_hinweis"], "aus")
        d = json.loads(self.fabrik("update").stdout)
        self.assertFalse(d["update_verfuegbar"])
        self.assertTrue(d["abgeschaltet"])
        self.assertFalse((self.daten / "update.json").exists())
        r = self.fabrik("einstellung", "update_hinweis", "vielleicht")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("an oder aus", r.stderr)


if __name__ == "__main__":
    unittest.main()
