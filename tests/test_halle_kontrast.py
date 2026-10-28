"""Kontrast des dezenten Platzhalter-Namens in der Halle (WCAG AA mit Reserve).

Start: python -m unittest discover -s tests -p test_halle_kontrast.py
"""
import re
import unittest
from pathlib import Path

HALLE = Path(__file__).resolve().parent.parent / "plugins/fabrik/halle/halle.js"
MINDESTKONTRAST = 4.5


def luminanz(hexfarbe):
    kanaele = [int(hexfarbe[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [k / 12.92 if k <= 0.03928 else ((k + 0.055) / 1.055) ** 2.4 for k in kanaele]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def kontrast(vordergrund, hintergrund):
    hell, dunkel = sorted([luminanz(vordergrund), luminanz(hintergrund)], reverse=True)
    return (hell + 0.05) / (dunkel + 0.05)


class DezenterPlatzhalterTest(unittest.TestCase):
    def setUp(self):
        self.quelle = HALLE.read_text(encoding="utf-8")
        # Bodenverlauf aus halle.js: g-boden (hellster und dunkelster Stop)
        self.boden = re.findall(r'id="g-boden".*?</linearGradient>', self.quelle, re.S)
        self.bodenfarben = re.findall(r'stop-color="(#[0-9a-fA-F]{6})"', self.boden[0]) if self.boden else []

    def test_dezenter_name_hat_genug_kontrast_auf_dem_boden(self):
        m = re.search(r'fill: s\.dezent \? "(#[0-9a-fA-F]{6})" : "#[0-9a-fA-F]{6}",\s*class: s\.dezent \? "bank-name dezent"',
                      self.quelle)
        self.assertIsNotNone(m, "Farbe des dezenten Platzhalters nicht gefunden")
        farbe = m.group(1)
        self.assertTrue(self.bodenfarben, "Bodenfarben nicht gefunden")
        for boden in self.bodenfarben:
            verhaeltnis = kontrast(farbe, boden)
            self.assertGreaterEqual(
                verhaeltnis, MINDESTKONTRAST,
                f"Kontrast {farbe} auf {boden} ist {verhaeltnis:.2f}:1, mindestens {MINDESTKONTRAST}:1 nötig")


if __name__ == "__main__":
    unittest.main()
