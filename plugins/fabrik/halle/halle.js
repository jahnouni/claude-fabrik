"use strict";

// Fabrikhalle: zeichnet die Halle einmal und bewegt danach nur Werkstücke,
// Arbeiter und Werkbänke anhand von /api/stand.

const SVG = "http://www.w3.org/2000/svg";
const BAND_Y = 620;
const FUSS_Y = 625;

const OPUS = "#f2b632";
const SONNET = "#4fa8e0";

const ROLLEN = {
  spec:       { name: "Spec",       modell: "Opus",   helm: OPUS,   x: 250,  werkzeug: "stift",   ruhig: true },
  builder:    { name: "Builder",    modell: "Opus",   helm: OPUS,   x: 530,  werkzeug: "hammer" },
  sicherheit: { name: "Sicherheit", modell: "Opus",   helm: OPUS,   x: 760,  werkzeug: "schild",  ruhig: true },
  designer:   { name: "Designer",   modell: "Sonnet", helm: SONNET, x: 860,  werkzeug: "pinsel" },
  inspector:  { name: "Code",       modell: "Sonnet", helm: SONNET, x: 960,  werkzeug: "lupe",    ruhig: true },
  bediener:   { name: "Bediener",   modell: "Sonnet", helm: SONNET, x: 1060, werkzeug: "brett" },
  approver:   { name: "Approver",   modell: "Opus",   helm: OPUS,   x: 1150, werkzeug: "stempel", ruhig: true },
};

const STATIONEN = {
  eingang:  { name: "Eingang",      slots: [95] },
  spec:     { name: "Konstruktion", slots: [320] },
  bau:      { name: "Werkbank",     slots: [610, 668] },
  pruefung: { name: "Prüfstraße",   slots: [810, 910, 1010] },
  freigabe: { name: "Freigabe",     slots: [1235] },
};
const REIHENFOLGE = ["eingang", "spec", "bau", "pruefung", "freigabe", "fertig"];
const STATUS_TEXT = { aktiv: "aktiv", pausiert: "pausiert", eskaliert: "eskaliert", fertig: "fertig", abgebrochen: "abgebrochen" };

const zustand = {
  pakete: new Map(),      // id → { g, ziel, station }
  erstesMal: true,
  filter: null,
  auftraege: [],
  offeneKarte: null,
  ausloeser: null,       // Element, das die Infokarte geöffnet hat
  rollenAus: [],
};

const $ = (id) => document.getElementById(id);
const halle = $("halle");

function el(tag, attrs = {}, eltern) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
  if (eltern) eltern.appendChild(e);
  return e;
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[z]));
}

function kurz(text, n) {
  text = String(text ?? "");
  return text.length > n ? text.slice(0, n - 1) + "…" : text;
}

// --- Szene -------------------------------------------------------------------

function zeichneSzene() {
  halle.innerHTML = `
  <defs>
    <linearGradient id="g-wand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a3142"/><stop offset="1" stop-color="#3b4458"/>
    </linearGradient>
    <linearGradient id="g-boden" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a3f4b"/><stop offset="1" stop-color="#262a33"/>
    </linearGradient>
    <linearGradient id="g-licht" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe9a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/>
    </linearGradient>
    <pattern id="p-ziegel" width="60" height="30" patternUnits="userSpaceOnUse">
      <rect width="60" height="30" fill="none"/>
      <path d="M0 15H60M30 0V15M0 15V30M60 15V30" stroke="#ffffff" stroke-opacity=".035" stroke-width="2"/>
    </pattern>
    <pattern id="p-sperre" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="28" height="28" fill="#2a2a2a"/><rect width="14" height="28" fill="#f2c94c"/>
    </pattern>
    <filter id="f-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Wand und Dach -->
  <rect width="1600" height="510" fill="url(#g-wand)"/>
  <rect width="1600" height="510" fill="url(#p-ziegel)"/>
  <g id="dach"></g>
  <text x="60" y="140" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="38" font-weight="900" letter-spacing="4" fill="#ffffff" fill-opacity=".1">SOFTWARE-FABRIK</text>
  <text x="62" y="172" class="leise-text" fill-opacity=".6">Made by R3DA</text>

  <!-- Boden -->
  <rect y="505" width="1600" height="455" fill="url(#g-boden)"/>
  <rect y="505" width="1600" height="6" fill="#1b1f27"/>
  <g stroke="#ffffff" stroke-opacity=".035" stroke-width="2" id="fugen"></g>

  <!-- Tafel -->
  <g id="tafel" transform="translate(560 70)"></g>

  <!-- Eingang: Rutsche aus der Wand -->
  <g>
    <rect x="40" y="420" width="110" height="90" rx="6" fill="#1b1f27" stroke="#59627a" stroke-width="3"/>
    <rect x="50" y="430" width="90" height="70" fill="#11141b"/>
    <path d="M40 510 L150 510 L150 560 L40 600 Z" fill="#59627a"/>
    <path d="M150 560 L40 600" stroke="#7a849c" stroke-width="3"/>
  </g>

  <!-- Ausschuss -->
  <g transform="translate(40 690)">
    <path d="M0 0 H120 L110 62 H10 Z" fill="#3d4352" stroke="#59627a" stroke-width="3"/>
    <text x="60" y="52" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-weight="800" font-size="10" letter-spacing="1" fill="#9aa3b6">AUSSCHUSS</text>
  </g>

  <!-- Konstruktionstisch hinter dem Spec-Arbeiter -->
  <g transform="translate(180 548)">
    <path d="M0 0 L120 -24 L124 -14 L4 10 Z" fill="#e8e2d0" stroke="#9c9480" stroke-width="2"/>
    <path d="M18 -2 L60 -11 M24 4 L90 -10 M30 -6 L46 -9" stroke="#4fa8e0" stroke-width="2"/>
  </g>

  <!-- Prüfstraße: Rahmen -->
  <rect x="720" y="440" width="390" height="10" rx="3" fill="#59627a"/>
  <rect x="722" y="450" width="8" height="170" fill="#59627a"/><rect x="1100" y="450" width="8" height="170" fill="#59627a"/>

  <!-- Freigabe-Tor -->
  <g id="tor">
    <rect x="1186" y="450" width="14" height="172" fill="#59627a"/>
    <rect x="1272" y="450" width="14" height="172" fill="#59627a"/>
    <rect x="1178" y="436" width="116" height="18" rx="4" fill="#6c7690"/>
    <rect x="1216" y="392" width="40" height="46" rx="8" fill="#1b1f27" stroke="#6c7690" stroke-width="2"/>
    <circle id="ampel-rot" class="ampel-rot" cx="1236" cy="405" r="8" fill="#e5484d" color="#e5484d"/>
    <circle id="ampel-gruen" class="ampel-gruen" cx="1236" cy="425" r="8" fill="#3fb950" color="#3fb950"/>
  </g>

  <!-- Sperrzone -->
  <g transform="translate(1150 684)">
    <rect width="200" height="86" fill="url(#p-sperre)" opacity=".9"/>
    <rect x="8" y="8" width="184" height="70" fill="#2b303c"/>
    <text x="100" y="72" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-weight="800" font-size="10" letter-spacing="1" fill="#f2c94c" fill-opacity=".8">SPERRZONE · MENSCH GEFRAGT</text>
  </g>

  <!-- Lager / Versand -->
  <g id="regal">
    <rect x="1362" y="330" width="10" height="300" fill="#6b4f3a"/>
    <rect x="1572" y="330" width="10" height="300" fill="#6b4f3a"/>
    <rect x="1362" y="430" width="220" height="8" fill="#8a6a4a"/>
    <rect x="1362" y="520" width="220" height="8" fill="#8a6a4a"/>
    <rect x="1362" y="610" width="220" height="10" fill="#8a6a4a"/>
    <text id="regal-mehr" x="1472" y="350" text-anchor="middle" class="leise-text"></text>
  </g>

  <!-- Kranschiene mit Schildern -->
  <rect x="0" y="336" width="1600" height="8" fill="#4b5366"/>
  <rect x="0" y="344" width="1600" height="2" fill="#1b1f27" opacity=".6"/>
  <g id="schilder"></g>

  <!-- Arbeiter stehen hinter dem Band -->
  <g id="arbeiter"></g>

  <!-- Förderband -->
  <g id="band">
    <rect x="30" y="${BAND_Y}" width="1320" height="24" rx="6" fill="#1b1f27"/>
    <line class="band-streifen" x1="40" y1="${BAND_Y + 4}" x2="1340" y2="${BAND_Y + 4}" stroke="#4b5366" stroke-width="4"/>
    <g id="rollen"></g>
    <g id="band-beine"></g>
    <g id="band-schilder"></g>
  </g>

  <!-- Werkstücke -->
  <g id="pakete"></g>

  <!-- Werkstatt -->
  <g id="werkstatt-kopf" class="werkstatt-kopf" tabindex="0" role="button" aria-controls="werkbaenke" aria-expanded="true">
    <rect x="30" y="764" width="620" height="58" fill="transparent"/>
    <rect x="30" y="782" width="620" height="28" rx="6" class="werkstatt-flaeche"/>
    <text id="werkstatt-titel" x="40" y="800" font-family="-apple-system, Helvetica, Arial, sans-serif" font-weight="800" fill="#aab1c2" font-size="12" letter-spacing="3">▾ WERKSTATT · ALLE CLAUDE-SITZUNGEN AUF DIESEM RECHNER</text>
  </g>
  <g id="werkbaenke"></g>
  `;

  const dach = $("dach");
  for (let x = 0; x < 1600; x += 160) {
    el("path", { d: `M${x} 60 L${x + 120} 0 L${x + 160} 0 L${x + 160} 60 Z`, fill: "#232937" }, dach);
    el("path", { d: `M${x + 12} 56 L${x + 118} 8 L${x + 118} 56 Z`, fill: "#7fa6c9", "fill-opacity": ".22" }, dach);
  }
  el("rect", { y: 60, width: 1600, height: 8, fill: "#1b1f27" }, dach);

  const fugen = $("fugen");
  for (let x = 0; x <= 1600; x += 100) el("line", { x1: x, y1: 511, x2: x, y2: 900 }, fugen);
  for (const y of [600, 700, 800]) el("line", { x1: 0, y1: y, x2: 1600, y2: y }, fugen);

  const rollen = $("rollen");
  for (let x = 50; x < 1340; x += 46) {
    const g = el("g", {}, rollen);
    el("circle", { cx: x, cy: BAND_Y + 15, r: 7, fill: "#2f3544", stroke: "#59627a", "stroke-width": 2 }, g);
    el("line", { class: "rolle-dreht", x1: x - 5, y1: BAND_Y + 15, x2: x + 5, y2: BAND_Y + 15, stroke: "#7a849c", "stroke-width": 2 }, g);
  }
  const beine = $("band-beine");
  for (const x of [60, 400, 720, 1040, 1320]) {
    el("rect", { x, y: BAND_Y + 24, width: 10, height: 50, fill: "#3d4352" }, beine);
    el("rect", { x: x - 8, y: BAND_Y + 72, width: 26, height: 6, rx: 2, fill: "#3d4352" }, beine);
  }

  const schilder = $("schilder");
  const schild = (x, text, breite) => {
    el("line", { x1: x - breite / 2 + 12, y1: 344, x2: x - breite / 2 + 12, y2: 364, stroke: "#8b93a7", "stroke-width": 2 }, schilder);
    el("line", { x1: x + breite / 2 - 12, y1: 344, x2: x + breite / 2 - 12, y2: 364, stroke: "#8b93a7", "stroke-width": 2 }, schilder);
    el("rect", { x: x - breite / 2, y: 362, width: breite, height: 34, rx: 5, fill: "#f2c94c", stroke: "#2a2a2a", "stroke-width": 2 }, schilder);
    const t = el("text", { x, y: 385, "text-anchor": "middle", class: "schild-text" }, schilder);
    t.textContent = text;
  };
  schild(285, "KONSTRUKTION", 170);
  schild(575, "WERKBANK", 140);
  schild(915, "PRÜFSTRASSE", 170);
  schild(1236, "FREIGABE", 130);
  schild(1472, "VERSAND", 130);

  const bandSchilder = $("band-schilder");
  for (const [rolle, r] of Object.entries(ROLLEN)) {
    el("text", { x: r.x, y: BAND_Y + 44, "text-anchor": "middle", "font-size": 10, "font-weight": 800, "letter-spacing": 1,
      fill: "#c3c9d6", "font-family": "-apple-system, Helvetica, Arial, sans-serif" }, bandSchilder).textContent = r.name.toUpperCase();
    el("text", { x: r.x, y: BAND_Y + 57, "text-anchor": "middle", "font-size": 10,
      fill: r.helm, "font-family": "-apple-system, Helvetica, Arial, sans-serif" }, bandSchilder).textContent = r.modell;
  }

  zeichneTafel();
  const gruppe = $("arbeiter");
  for (const [rolle, r] of Object.entries(ROLLEN)) zeichneArbeiter(gruppe, rolle, r);
}

function zeichneTafel() {
  const t = $("tafel");
  el("rect", { x: -12, y: -12, width: 684, height: 264, rx: 8, fill: "#7a5a3a" }, t);
  el("rect", { width: 660, height: 240, rx: 4, fill: "#2c4637" }, t);
  el("rect", { width: 660, height: 240, rx: 4, fill: "#ffffff", "fill-opacity": ".03" }, t);
  const titel = el("text", { x: 24, y: 40, class: "kreide", "font-size": 26 }, t);
  titel.textContent = "Schichttafel";
  el("text", { id: "tafel-uhr", x: 636, y: 40, class: "kreide", "font-size": 18, "text-anchor": "end", "fill-opacity": ".8" }, t);
  el("path", { d: "M24 52 Q 120 48 220 54", stroke: "#f1efe6", "stroke-opacity": ".5", "stroke-width": 2, fill: "none" }, t);

  const felder = [["aktiv", "Aktiv", 24], ["fertig", "Fertig", 176], ["eskaliert", "Eskaliert", 328]];
  for (const [schluessel, name, x] of felder) {
    const g = el("g", { class: "tafel-zahl", "data-filter": schluessel, tabindex: 0, role: "button", "aria-label": `${name} filtern` }, t);
    el("rect", { class: "tafel-feld", x, y: 66, width: 128, height: 118, rx: 10 }, g);
    const label = el("text", { x: x + 64, y: 92, class: "kreide", "font-size": 18, "text-anchor": "middle" }, g);
    label.textContent = name;
    el("text", { id: `zahl-${schluessel}`, x: x + 64, y: 160, class: "kreide", "font-size": 58, "text-anchor": "middle",
      fill: schluessel === "eskaliert" ? "#ff9b9e" : "#f1efe6" }, g).textContent = "0";
    g.addEventListener("click", () => setzeFilter(schluessel));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setzeFilter(schluessel); } });
  }
  el("text", { id: "tafel-zeile", x: 24, y: 212, class: "kreide", "font-size": 16, "fill-opacity": ".85" }, t);
  el("circle", { cx: 540, cy: 228, r: 6, fill: OPUS }, t);
  el("text", { x: 550, y: 233, class: "kreide", "font-size": 13 }, t).textContent = "Opus";
  el("circle", { cx: 592, cy: 228, r: 6, fill: SONNET }, t);
  el("text", { x: 602, y: 233, class: "kreide", "font-size": 13 }, t).textContent = "Sonnet";
  // Spalte mit den laufenden Paketen und ihrer Gesamtlaufzeit
  el("rect", { x: 480, y: 66, width: 156, height: 118, rx: 10, fill: "none", stroke: "#f1efe6", "stroke-opacity": ".18" }, t);
  el("text", { x: 558, y: 92, class: "kreide", "font-size": 18, "text-anchor": "middle" }, t).textContent = "Laufzeit";
  el("g", { id: "tafel-laufzeit" }, t);
}

function werkzeug(g, art) {
  // Gezeichnet relativ zur Schulter (0,0); die Hand liegt bei (0,34).
  switch (art) {
    case "hammer":
      el("rect", { x: -2, y: 30, width: 5, height: 30, rx: 2, fill: "#8a5a2b" }, g);
      el("rect", { x: -10, y: 52, width: 22, height: 12, rx: 2, fill: "#9aa3b6", stroke: "#5f6778", "stroke-width": 1.5 }, g);
      break;
    case "stift":
      el("rect", { x: -2, y: 30, width: 5, height: 26, fill: "#f2c94c" }, g);
      el("path", { d: "M-2 56 L3 56 L0.5 64 Z", fill: "#2a2a2a" }, g);
      break;
    case "schild":
      el("path", { d: "M-14 30 H14 V44 Q14 58 0 64 Q-14 58 -14 44 Z", fill: "#4fa8e0", stroke: "#1e4f73", "stroke-width": 2 }, g);
      el("path", { d: "M-6 44 L-1 50 L8 38", stroke: "#fff", "stroke-width": 3, fill: "none", "stroke-linecap": "round" }, g);
      break;
    case "pinsel":
      el("rect", { x: -2, y: 30, width: 4, height: 24, fill: "#8a5a2b" }, g);
      el("rect", { x: -4, y: 52, width: 8, height: 6, fill: "#bfc6d4" }, g);
      el("path", { d: "M-4 58 Q0 70 4 58 Z", fill: "#e5484d" }, g);
      break;
    case "lupe":
      el("rect", { x: -2, y: 32, width: 5, height: 16, rx: 2, fill: "#2a2a2a" }, g);
      el("circle", { cx: 0.5, cy: 58, r: 10, fill: "#cfe8ff", "fill-opacity": ".45", stroke: "#2a2a2a", "stroke-width": 3 }, g);
      break;
    case "brett":
      el("rect", { x: -12, y: 30, width: 24, height: 30, rx: 2, fill: "#c8955c", stroke: "#7a5a3a", "stroke-width": 1.5 }, g);
      el("rect", { x: -9, y: 36, width: 18, height: 21, fill: "#fdfaf2" }, g);
      el("path", { d: "M-6 42 H6 M-6 47 H6 M-6 52 H2", stroke: "#9aa3b6", "stroke-width": 1.5 }, g);
      break;
    case "stempel":
      el("rect", { x: -3, y: 30, width: 6, height: 14, rx: 2, fill: "#5a3d2b" }, g);
      el("circle", { cx: 0, cy: 30, r: 5, fill: "#5a3d2b" }, g);
      el("rect", { x: -10, y: 44, width: 20, height: 8, rx: 2, fill: "#e5484d" }, g);
      break;
  }
}

function zeichneArbeiter(eltern, rolle, r) {
  const g = el("g", { class: `arbeiter${r.ruhig ? " ruhig" : ""}`, id: `w-${rolle}`, transform: `translate(${r.x} ${FUSS_Y})` }, eltern);
  const k = el("g", { class: "koerper" }, g);
  const anzug = r.modell === "Opus" ? "#3c5a86" : "#365f5a";
  el("rect", { x: -13, y: -44, width: 11, height: 44, rx: 3, fill: "#26324a" }, k);
  el("rect", { x: 2, y: -44, width: 11, height: 44, rx: 3, fill: "#26324a" }, k);
  el("rect", { x: -26, y: -84, width: 9, height: 34, rx: 4, fill: anzug }, k);
  el("rect", { x: -18, y: -88, width: 36, height: 50, rx: 9, fill: anzug }, k);
  el("rect", { x: -10, y: -80, width: 20, height: 16, rx: 3, fill: "#ffffff", "fill-opacity": ".18" }, k);
  el("text", { x: 0, y: -68, "text-anchor": "middle", "font-size": 10, "font-weight": 800, fill: "#fff", "font-family": "-apple-system, Helvetica, Arial, sans-serif" }, k)
    .textContent = r.modell[0];
  el("circle", { cx: 0, cy: -101, r: 13, fill: "#f0c9a0" }, k);
  el("circle", { cx: -4, cy: -101, r: 1.6, fill: "#2a2a2a" }, k);
  el("circle", { cx: 5, cy: -101, r: 1.6, fill: "#2a2a2a" }, k);
  el("path", { d: "M-3 -95 Q1 -92 5 -95", stroke: "#2a2a2a", "stroke-width": 1.4, fill: "none" }, k);
  el("path", { class: "helm", d: "M-15 -104 A15 14 0 0 1 15 -104 Z", fill: r.helm }, k);
  el("rect", { class: "helm", x: -18, y: -106, width: 36, height: 5, rx: 2.5, fill: r.helm }, k);
  el("rect", { x: -2, y: -117, width: 4, height: 12, rx: 2, fill: "#ffffff", "fill-opacity": ".35" }, k);
  const schulter = el("g", { transform: "translate(20 -84)" }, k);
  const arm = el("g", { class: "arm" }, schulter);
  el("rect", { x: -4.5, y: 0, width: 9, height: 34, rx: 4.5, fill: anzug }, arm);
  werkzeug(arm, r.werkzeug);
  el("circle", { cx: 0, cy: 34, r: 5, fill: "#f0c9a0" }, arm);

  const blase = el("g", { class: "blase", transform: "translate(0 -150)" }, g);
  el("rect", { x: -40, y: -16, width: 80, height: 24, rx: 12, fill: "#fdfaf2" }, blase);
  el("path", { d: "M-6 8 L0 16 L6 8 Z", fill: "#fdfaf2" }, blase);
  el("text", { class: "blase-text", x: 0, y: 1, "text-anchor": "middle", "font-size": 12, "font-weight": 700,
    "font-family": "ui-monospace, SF Mono, Menlo, monospace", fill: "#23262e" }, blase);

  const pause = el("g", { class: "pause-schild", transform: "translate(0 -150)" }, g);
  el("rect", { x: -38, y: -14, width: 76, height: 22, rx: 4, fill: "#59627a" }, pause);
  el("text", { x: 0, y: 2, "text-anchor": "middle", "font-size": 11, fill: "#fff", "font-family": "-apple-system, Helvetica, Arial, sans-serif" }, pause)
    .textContent = "Pause · ohne UI";

  const aus = el("g", { class: "aus-schild", transform: "translate(0 -150)" }, g);
  el("rect", { x: -34, y: -14, width: 68, height: 22, rx: 4, fill: "#111318", stroke: "#59627a" }, aus);
  el("text", { x: 0, y: 2, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#d9deea", "font-family": "-apple-system, Helvetica, Arial, sans-serif" }, aus)
    .textContent = "abgeschaltet";

  if (SCHALTBAR.includes(rolle)) {
    // Unsichtbare Fläche, damit der ganze Arbeiter anklickbar ist.
    el("rect", { class: "arbeiter-flaeche", x: -32, y: -125, width: 64, height: 128, rx: 8, fill: "transparent" }, g);
    g.classList.add("schaltbar");
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "switch");
    g.addEventListener("click", () => schalteRolle(rolle));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); schalteRolle(rolle); } });
    g.addEventListener("mouseenter", (e) => zeigeTooltipText(e, rollenInfo(rolle)));
    g.addEventListener("mousemove", bewegeTooltip);
    g.addEventListener("mouseleave", versteckeTooltip);
    g.addEventListener("focus", (e) => zeigeTooltipText(e, rollenInfo(rolle)));
    g.addEventListener("blur", versteckeTooltip);
  }
}

const SCHALTBAR = ["sicherheit", "designer", "inspector", "bediener"];

function rollenInfo(rolle) {
  const aus = zustand.rollenAus.includes(rolle);
  return { titel: `${ROLLEN[rolle].name} · ${aus ? "abgeschaltet" : "aktiv"}`,
    zeilen: [aus ? "Wird in Prüfrunden übersprungen." : "Prüft in jeder Runde mit.", `Klicken zum ${aus ? "Einschalten" : "Abschalten"}`] };
}

function zeigeRollen() {
  for (const rolle of SCHALTBAR) {
    const g = $(`w-${rolle}`);
    if (!g) continue;
    const aus = zustand.rollenAus.includes(rolle);
    g.classList.toggle("aus", aus);
    g.setAttribute("aria-checked", String(!aus));
    g.setAttribute("aria-label", `${ROLLEN[rolle].name}: ${aus ? "abgeschaltet" : "aktiv"}. Umschalten`);
  }
}

async function schalteRolle(rolle) {
  const aktiv = zustand.rollenAus.includes(rolle);
  try {
    const r = await fetch("/api/rolle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Fabrik-Halle": "1" },
      body: JSON.stringify({ rolle, aktiv }),
    });
    if (!r.ok) throw new Error(r.status);
    zustand.rollenAus = (await r.json()).rollen_aus;
    zeigeRollen();
    const g = $(`w-${rolle}`);
    if (g && g.matches(":hover, :focus")) zeigeTooltipText({ target: g, type: "focus" }, rollenInfo(rolle));
  } catch {
    $("verbindung").hidden = false;
  }
}

// --- Werkstücke --------------------------------------------------------------

function baueGruppe(a) {
  const g = el("g", { class: "paket", tabindex: 0, role: "button" });
  // Unsichtbare Trefferfläche, damit das Paket auch auf kleinen Bildschirmen gut antippbar ist.
  el("rect", { x: -29, y: -58, width: 58, height: 60, fill: "transparent" }, g);
  const innen = el("g", { class: "paket-innen" }, g);
  el("rect", { class: "paket-kiste", x: -26, y: -50, width: 52, height: 50, rx: 3, fill: "#c8955c", stroke: "#8a5f33", "stroke-width": 1.5 }, innen);
  el("rect", { class: "paket-band", x: -5, y: -50, width: 10, height: 50, fill: "#a87a45" }, innen);
  el("rect", { x: -22, y: -31, width: 44, height: 16, rx: 2, fill: "#fdfaf2" }, innen);
  el("text", { class: "paket-id", x: 0, y: -19, "text-anchor": "middle", "font-size": 11, "font-weight": 800, "font-family": "ui-monospace, SF Mono, Menlo, monospace", fill: "#23262e" }, innen);
  const runde = el("g", { class: "paket-runde" }, innen);
  el("circle", { cx: 24, cy: -48, r: 11, fill: "#23262e", stroke: "#fdfaf2", "stroke-width": 1.5 }, runde);
  el("text", { x: 24, y: -44.5, "text-anchor": "middle", "font-size": 9, "font-weight": 800, fill: "#fff", "font-family": "-apple-system, Helvetica, Arial, sans-serif" }, runde);
  const leuchte = el("g", { class: "leuchte" }, innen);
  el("rect", { x: -7, y: -56, width: 14, height: 6, rx: 1, fill: "#2a2a2a" }, leuchte);
  el("circle", { cx: 0, cy: -62, r: 7, fill: "#ff3b3b", filter: "url(#f-glow)" }, leuchte);
  el("text", { class: "schlaf", x: -30, y: -56, "font-size": 15, "font-weight": 700, fill: "#cfd5e2", "font-family": "Chalkboard SE, Comic Sans MS, cursive" }, innen)
    .textContent = "z z";
  el("text", { class: "hinweis", x: 0, y: -70, "text-anchor": "middle", "font-size": 13, "font-weight": 800, fill: "#f2c94c", "font-family": "-apple-system, Helvetica, Arial, sans-serif" }, innen);

  g.addEventListener("mouseenter", (e) => zeigeTooltip(e, a.id));
  g.addEventListener("mousemove", bewegeTooltip);
  g.addEventListener("mouseleave", versteckeTooltip);
  g.addEventListener("focus", (e) => zeigeTooltip(e, a.id));
  g.addEventListener("blur", versteckeTooltip);
  g.addEventListener("click", () => oeffneKarte(a.id));
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); oeffneKarte(a.id); } });
  return g;
}

function berechneZiele(auftraege) {
  const ziele = new Map();
  const proStation = {};
  const fertig = [];
  const eskaliert = [];
  const abgebrochen = [];
  for (const a of [...auftraege].sort((x, y) => x.id.localeCompare(y.id))) {
    if (a.status === "fertig") fertig.push(a);
    else if (a.status === "eskaliert") eskaliert.push(a);
    else if (a.status === "abgebrochen") abgebrochen.push(a);
    else (proStation[a.station] ??= []).push(a);
  }
  for (const [station, liste] of Object.entries(proStation)) {
    const slots = (STATIONEN[station] || STATIONEN.eingang).slots;
    liste.forEach((a, i) => {
      const x = slots[i % slots.length] + Math.floor(i / slots.length / 3) * 14;
      const y = BAND_Y - (Math.floor(i / slots.length) % 3) * 52;
      ziele.set(a.id, { x, y, s: 1 });
    });
  }
  eskaliert.forEach((a, i) => ziele.set(a.id, { x: 1192 + (i % 3) * 58, y: 744 - Math.floor(i / 3) * 52, s: 1 }));
  abgebrochen.slice(-4).forEach((a, i) => ziele.set(a.id, { x: 76 + (i % 2) * 48, y: 730 - Math.floor(i / 2) * 32, s: 0.62 }));
  fertig.sort((x, y) => String(y.aktualisiert).localeCompare(String(x.aktualisiert)));
  fertig.slice(0, 12).forEach((a, i) => {
    const reihe = Math.floor(i / 4);
    ziele.set(a.id, { x: 1398 + (i % 4) * 48, y: [610, 520, 430][reihe], s: 0.78 });
  });
  $("regal-mehr").textContent = fertig.length > 12 ? `+ ${fertig.length - 12} weitere` : "";
  return ziele;
}

function passtZumFilter(a) {
  if (!zustand.filter) return true;
  if (zustand.filter === "aktiv") return a.status === "aktiv" || a.status === "pausiert";
  return a.status === zustand.filter;
}

function aktualisierePakete(auftraege) {
  const ziele = berechneZiele(auftraege);
  const ebene = $("pakete");
  const vorhanden = new Set();

  for (const a of auftraege) {
    vorhanden.add(a.id);
    const ziel = ziele.get(a.id);
    let p = zustand.pakete.get(a.id);
    if (!p) {
      const g = baueGruppe(a);
      ebene.appendChild(g);
      p = { g, station: a.station, runde: a.runde };
      zustand.pakete.set(a.id, p);
      if (zustand.erstesMal) {
        g.classList.add("neu");
        g.style.transition = "none";
      } else {
        g.style.transform = "translate(95px, 560px) scale(.6)";
        g.getBoundingClientRect();
      }
    }
    const g = p.g;
    if (!ziel) { g.style.display = "none"; continue; }
    g.style.display = "";

    const zurueck = REIHENFOLGE.indexOf(a.station) < REIHENFOLGE.indexOf(p.station);
    if (p.station !== a.station || p.status !== a.status) {
      g.classList.add("unterwegs");
      setTimeout(() => g.classList.remove("unterwegs"), 1500);
    }
    if (zurueck) {
      g.querySelector(".hinweis").textContent = a.runde > p.runde ? `↩ Runde ${a.runde}` : "↩ Nachbessern";
      g.classList.add("zurueck");
      setTimeout(() => g.classList.remove("zurueck"), 3500);
    }
    p.station = a.station; p.status = a.status; p.runde = a.runde;

    g.style.transform = `translate(${ziel.x}px, ${ziel.y}px) scale(${ziel.s})`;
    if (g.style.transition === "none") { g.getBoundingClientRect(); requestAnimationFrame(() => { g.style.transition = ""; }); }
    g.querySelector(".paket-id").textContent = a.id;
    const runde = g.querySelector(".paket-runde");
    runde.style.display = a.runde > 0 || a.status === "fertig" ? "" : "none";
    runde.querySelector("text").textContent = a.status === "fertig" ? "✓" : `${a.runde}/${a.max_runden}`;
    runde.querySelector("circle").setAttribute("fill", a.status === "fertig" ? "#3fb950" : "#23262e");
    g.classList.toggle("eskaliert", a.status === "eskaliert");
    g.classList.toggle("ruht", Boolean(a.ruht));
    g.classList.toggle("abgebrochen", a.status === "abgebrochen");
    g.classList.toggle("gedimmt", !passtZumFilter(a));
    g.setAttribute("aria-label", `${a.id}: ${a.titel}, ${stationsName(a)}, Details öffnen`);
  }
  for (const [id, p] of zustand.pakete) {
    if (!vorhanden.has(id)) { p.g.remove(); zustand.pakete.delete(id); }
  }
}

function stationsName(a) {
  if (a.status === "fertig") return "Versand (fertig)";
  if (a.status === "eskaliert") return "Sperrzone (eskaliert)";
  if (a.status === "abgebrochen") return "Ausschuss";
  return (STATIONEN[a.station] || { name: a.station }).name;
}

// --- Arbeiter, Tafel, Werkstatt ------------------------------------------------

function aktualisiereArbeiter(auftraege) {
  const aktiveFuer = {};
  for (const a of auftraege) {
    if (a.status !== "aktiv") continue;
    for (const rolle of a.aktive_arbeiter || []) (aktiveFuer[rolle] ??= []).push(a.id);
  }
  const inPruefung = auftraege.filter((a) => a.status === "aktiv" && a.station === "pruefung");
  for (const rolle of Object.keys(ROLLEN)) {
    const g = $(`w-${rolle}`);
    const ids = aktiveFuer[rolle] || [];
    g.classList.toggle("aktiv", ids.length > 0);
    g.querySelector(".blase-text").textContent = ids.length > 1 ? `${ids[0]} +${ids.length - 1}` : ids[0] || "";
    const pause = rolle === "designer" && !ids.length && inPruefung.length > 0 && inPruefung.every((a) => a.hat_ui === false);
    g.classList.toggle("pause", pause);
  }
  const laeuft = auftraege.some((a) => a.status === "aktiv" && !a.ruht);
  halle.classList.toggle("halle-laeuft", laeuft);
  const esk = auftraege.some((a) => a.status === "eskaliert");
  $("ampel-rot").classList.toggle("ampel-an", esk);
  $("ampel-gruen").classList.toggle("ampel-an", !esk);
}

function laufzeit(iso) {
  // Gesamtlaufzeit seit Auftragsannahme als Std:Min, Stunden auch über 24.
  const ms = Date.now() - new Date(iso).getTime();
  if (!iso || !(ms >= 0)) return "–";
  const min = Math.floor(ms / 60000);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

const LAUFEND = new Set(["aktiv", "pausiert", "eskaliert"]);

function aktualisiereLaufzeiten(auftraege) {
  const ebene = $("tafel-laufzeit");
  const laufend = auftraege.filter((a) => LAUFEND.has(a.status)).sort((a, b) => a.id.localeCompare(b.id));
  const signatur = JSON.stringify(laufend.map((a) => [a.id, a.status, laufzeit(a.erstellt)]));
  if (signatur === zustand.laufzeitSignatur) return;
  zustand.laufzeitSignatur = signatur;
  const fokus = document.activeElement?.closest?.(".tafel-paket")?.dataset.id;
  ebene.replaceChildren();
  const max = 3;
  if (!laufend.length) {
    el("text", { x: 558, y: 140, class: "kreide", "font-size": 15, "text-anchor": "middle", "fill-opacity": ".55" }, ebene).textContent = "–";
    return;
  }
  const zeigen = laufend.length > max + 1 ? laufend.slice(0, max) : laufend.slice(0, max + 1);
  zeigen.forEach((a, i) => {
    const y = 122 + i * 20;
    const g = el("g", { class: "tafel-paket", "data-id": a.id, tabindex: 0, role: "button", "aria-label": `${a.id} öffnen, Laufzeit ${laufzeit(a.erstellt)}` }, ebene);
    el("rect", { x: 486, y: y - 15, width: 144, height: 20, rx: 4, class: "tafel-paket-feld" }, g);
    el("text", { x: 494, y, class: "kreide", "font-size": 15, fill: a.status === "eskaliert" ? "#ff9b9e" : "#f1efe6" }, g).textContent = a.id;
    el("text", { x: 622, y, class: "kreide", "font-size": 15, "text-anchor": "end", "fill-opacity": ".9" }, g).textContent = laufzeit(a.erstellt);
    g.addEventListener("click", () => oeffneKarte(a.id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); oeffneKarte(a.id); } });
  });
  if (fokus) ebene.querySelector(`.tafel-paket[data-id="${fokus}"]`)?.focus();
  if (zeigen.length < laufend.length) {
    el("text", { x: 558, y: 122 + zeigen.length * 20, class: "kreide", "font-size": 13, "text-anchor": "middle", "fill-opacity": ".7" }, ebene)
      .textContent = `+ ${laufend.length - zeigen.length} weitere`;
  }
}

function aktualisiereTafel(auftraege, sitzungen, wach) {
  const zahl = (f) => auftraege.filter(f).length;
  $("zahl-aktiv").textContent = zahl((a) => a.status === "aktiv" || a.status === "pausiert");
  $("zahl-fertig").textContent = zahl((a) => a.status === "fertig");
  $("zahl-eskaliert").textContent = zahl((a) => a.status === "eskaliert");
  const arbeiten = sitzungen.filter((s) => s.zustand === "arbeitet").length;
  const warten = sitzungen.filter((s) => s.zustand === "wartet").length;
  $("tafel-zeile").textContent = auftraege.length
    ? `Werkstatt: ${arbeiten} arbeiten · ${warten} warten${wach ? " · ☕ Rechner bleibt wach" : ""}`
    : `Noch leer – starte mit /fabrik "…"`;
  $("tafel-uhr").textContent = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  aktualisiereLaufzeiten(auftraege);
  for (const g of document.querySelectorAll(".tafel-zahl")) g.classList.toggle("gewaehlt", g.dataset.filter === zustand.filter);
}

function aktualisiereWerkbaenke(sitzungen) {
  const ebene = $("werkbaenke");
  // Nur neu zeichnen, wenn sich etwas geändert hat, sonst gehen Fokus und Hover verloren.
  const signatur = JSON.stringify(sitzungen.slice(0, 10).map((s) => [s.id, s.projekt, s.name, s.zustand, s.fabrik, s.dezent, s.zustand === "ruht" ? s.seit : 0]));
  if (signatur === zustand.werkbankSignatur) return;
  zustand.werkbankSignatur = signatur;
  ebene.replaceChildren();
  const max = 10;
  const breite = 152;
  sitzungen.slice(0, max).forEach((s, i) => {
    const g = el("g", { class: `bank ${s.zustand}${s.id ? " klickbar" : ""}`, transform: `translate(${40 + i * breite} 908)`, tabindex: 0, "data-sid": s.id || null,
      role: s.id ? "button" : null, "aria-label": `${s.projekt}, ${s.zustand}${s.id ? ", Details öffnen" : ""}` }, ebene);
    el("rect", { x: 0, y: -96, width: 144, height: 132, fill: "transparent", class: "bank-flaeche" }, g);
    el("path", { class: "lampe-licht", d: "M112 -84 L80 -40 L140 -40 Z", fill: "url(#g-licht)" }, g);
    el("rect", { x: 6, y: -42, width: 132, height: 8, rx: 2, fill: "#6b4f3a" }, g);
    el("rect", { x: 12, y: -34, width: 6, height: 34, fill: "#4d3828" }, g);
    el("rect", { x: 126, y: -34, width: 6, height: 34, fill: "#4d3828" }, g);
    el("rect", { x: 52, y: -78, width: 46, height: 32, rx: 3, fill: "#1b1f2a", stroke: "#59627a", "stroke-width": 2 }, g);
    el("rect", { x: 56, y: -74, width: 38, height: 24, rx: 1, fill: s.zustand === "arbeitet" ? "#2e7bd6" : s.zustand === "wartet" ? "#2a4766" : "#20242e" }, g);
    el("rect", { x: 72, y: -46, width: 6, height: 4, fill: "#59627a" }, g);
    el("path", { d: "M128 -42 L128 -78 L112 -88", stroke: "#8b93a7", "stroke-width": 3, fill: "none" }, g);
    el("path", { d: "M102 -92 L120 -84 L114 -78 L98 -86 Z", fill: s.zustand === "ruht" ? "#59627a" : "#f2c94c" }, g);
    if (s.zustand !== "ruht") {
      el("circle", { cx: 32, cy: -66, r: 9, fill: "#f0c9a0" }, g);
      el("path", { d: "M22 -68 A10 9 0 0 1 42 -68 Z", fill: s.fabrik ? OPUS : "#8b93a7" }, g);
      el("rect", { x: 22, y: -56, width: 20, height: 16, rx: 5, fill: "#3c5a86" }, g);
      const tippen = el("g", { class: "tippen" }, g);
      el("rect", { x: 46, y: -46, width: 7, height: 4, rx: 2, fill: "#f0c9a0" }, tippen);
      el("rect", { x: 56, y: -46, width: 7, height: 4, rx: 2, fill: "#f0c9a0" }, tippen);
    }
    // Ohne erkennbares Projekt steht nur ein Platzhalter da, der tritt dezent zurück.
    el("text", { x: 72, y: 16, "text-anchor": "middle", "font-size": s.dezent ? 11 : 13, "font-weight": s.dezent ? 400 : 600,
      fill: s.dezent ? "#8b93a7" : "#d9deea", class: s.dezent ? "bank-name dezent" : "bank-name",
      "font-family": "-apple-system, Helvetica, Arial, sans-serif" }, g)
      .textContent = kurz(s.projekt, 18);
    const zust = { arbeitet: "arbeitet", wartet: "wartet", ruht: "zuletzt " + new Date(s.seit).toLocaleDateString("de-DE") }[s.zustand];
    el("text", { x: 72, y: 30, "text-anchor": "middle", "font-size": 11, fill: "#8b93a7", "font-family": "-apple-system, Helvetica, Arial, sans-serif" }, g)
      .textContent = kurz(s.name ? `${s.name} · ${zust}` : zust, 24);
    const info = { titel: s.projekt, zeilen: [s.name, s.cwd, zust, s.id ? "Klicken für Details" : ""].filter(Boolean) };
    if (s.id) {
      g.addEventListener("click", () => oeffneSitzung(s.id));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); oeffneSitzung(s.id); } });
    }
    g.addEventListener("mouseenter", (e) => zeigeTooltipText(e, info));
    g.addEventListener("mousemove", bewegeTooltip);
    g.addEventListener("mouseleave", versteckeTooltip);
    g.addEventListener("focus", (e) => zeigeTooltipText(e, info));
    g.addEventListener("blur", versteckeTooltip);
  });
  if (sitzungen.length > max) {
    el("text", { x: 1560, y: 800, "text-anchor": "end", class: "leise-text" }, ebene).textContent = `+ ${sitzungen.length - max} weitere`;
  }
}

function setzeFilter(f) {
  zustand.filter = zustand.filter === f ? null : f;
  aktualisierePakete(zustand.auftraege);
  for (const g of document.querySelectorAll(".tafel-zahl")) g.classList.toggle("gewaehlt", g.dataset.filter === zustand.filter);
}

// --- Tooltip -----------------------------------------------------------------

const tooltip = $("tooltip");

function zeigeTooltip(e, id) {
  const a = zustand.auftraege.find((x) => x.id === id);
  if (!a) return;
  const zeilen = [stationsName(a), a.runde ? `Runde ${a.runde}/${a.max_runden}` : "", a.ruht ? "ruht – vermutlich unterbrochen" : ""].filter(Boolean);
  tooltip.innerHTML = `<div class="tt-id">${esc(a.id)}</div><div>${esc(a.titel)}</div>` +
    `<div class="tt-leise">${esc(zeilen.join(" · "))}</div><div class="tt-leise">Klicken für Details</div>`;
  tooltip.hidden = false;
  bewegeTooltip(e);
}

function zeigeTooltipText(e, info) {
  tooltip.innerHTML = `<div><b>${esc(info.titel)}</b></div>` + info.zeilen.map((z) => `<div class="tt-leise">${esc(z)}</div>`).join("");
  tooltip.hidden = false;
  bewegeTooltip(e);
}

function bewegeTooltip(e) {
  let x, y;
  if (e.clientX !== undefined && e.type !== "focus") { x = e.clientX; y = e.clientY; }
  else { const r = e.target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
  const b = tooltip.offsetWidth, h = tooltip.offsetHeight;
  tooltip.style.left = `${Math.min(window.innerWidth - b - 8, Math.max(8, x + 14))}px`;
  tooltip.style.top = `${Math.max(8, y - h - 12)}px`;
}

function versteckeTooltip() { tooltip.hidden = true; }

// --- Infokarte ---------------------------------------------------------------

function md(text) {
  const zeilen = String(text || "").split("\n");
  let html = "", inListe = false, inCode = false;
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const listeZu = () => { if (inListe) { html += "</ul>"; inListe = false; } };
  for (const z of zeilen) {
    if (z.trim().startsWith("```")) {
      listeZu();
      html += inCode ? "</pre>" : "<pre>";
      inCode = !inCode;
      continue;
    }
    if (inCode) { html += esc(z) + "\n"; continue; }
    let m;
    if ((m = z.match(/^(#{1,3})\s+(.*)$/))) { listeZu(); html += `<h${m[1].length + 3}>${inline(m[2])}</h${m[1].length + 3}>`; continue; }
    if ((m = z.match(/^\s*[-*]\s+\[([ xX~])\]\s+(.*)$/))) {
      if (!inListe) { html += "<ul>"; inListe = true; }
      const zeichen = { " ": "☐", x: "☑", X: "☑", "~": "⊘" }[m[1]];
      html += `<li class="cb">${zeichen} ${inline(m[2])}</li>`;
      continue;
    }
    if ((m = z.match(/^\s*[-*]\s+(.*)$/))) {
      if (!inListe) { html += "<ul>"; inListe = true; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    listeZu();
    if (z.trim()) html += `<p>${inline(z)}</p>`;
  }
  listeZu();
  if (inCode) html += "</pre>";
  return html;
}

function abschnitt(text, ueberschrift) {
  // Liefert den Inhalt unter "## <ueberschrift>" bis zur nächsten gleichrangigen Überschrift.
  const m = String(text || "").match(new RegExp(`^##\\s*${ueberschrift}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "m"));
  return m ? m[1].trim() : "";
}

function zeit(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const ROLLEN_SPALTEN = [["sicherheit", "Sicherheit"], ["designer", "Design"], ["inspector", "Code"], ["bediener", "Bedienung"]];

function rendereKarte(d) {
  const s = d.status;
  $("karte-id").textContent = s.id;
  $("karte-titel").textContent = s.titel;
  const knopf = $("karte-kopieren");
  knopf.textContent = `/fabrik ${s.id}   ⧉ kopieren`;
  knopf.dataset.befehl = `/fabrik ${s.id}`;
  knopf.classList.remove("ok");

  const idx = REIHENFOLGE.indexOf(s.station);
  const schritte = [["spec", "Spec"], ["bau", "Bau"], ["pruefung", "Prüfung"], ["freigabe", "Freigabe"], ["fertig", "Fertig"]]
    .map(([k, n]) => {
      const i = REIHENFOLGE.indexOf(k);
      let cls = i < idx || s.status === "fertig" ? "erledigt" : i === idx ? "jetzt" : "";
      if (s.status === "eskaliert" && k === "freigabe") cls = "jetzt rot";
      return `<div class="schritt ${cls}">${n}</div>`;
    }).join("");

  const kOk = s.kriterien.filter((k) => k.erfuellt === true).length;
  const todosOffen = (d.todos.match(/^\s*[-*]\s*\[ \]/gm) || []).length;
  const backlogOffen = (d.backlog.match(/^\s*[-*]\s*\[ \]/gm) || []).length;

  let h = `<div><span class="chip ${esc(s.status)}">${esc(STATUS_TEXT[s.status] || s.status)}</span>
    <span class="leer"> · Version ${s.version} · seit ${esc(zeit(s.erstellt))}</span></div>
    <div class="schritte">${schritte}</div>
    <div class="eckdaten">
      <div><b>${s.runde}/${s.max_runden}</b><span>Runde</span></div>
      <div><b>${kOk}/${s.kriterien.length}</b><span>Kriterien erfüllt</span></div>
      <div><b>${todosOffen}</b><span>Todos offen</span></div>
    </div>`;

  if (s.status === "eskaliert" && s.eskalation) {
    const pruefen = abschnitt(d.freigabe, "Was ein Mensch prüfen sollte");
    h += `<div class="alarm"><strong>⛔ Halt – ein Mensch muss drüberschauen</strong>
      <p>${esc(s.eskalation.grund)}</p>
      ${s.eskalation.bereiche?.length ? `<p>Bereiche: <b>${s.eskalation.bereiche.map(esc).join(", ")}</b></p>` : ""}
      ${pruefen ? `<div class="md">${md(pruefen)}</div>` : ""}
      <p>Danach weiter mit <code>/fabrik ${esc(s.id)}</code>.</p></div>`;
  }
  if (s.status === "aktiv" && s.aktive_arbeiter.length) {
    h += `<p>Gerade am Werk: <b>${s.aktive_arbeiter.map((r) => esc(ROLLEN[r]?.name || r)).join(", ")}</b></p>`;
  }

  h += `<h3>Ziel</h3>${s.ziel ? `<p>${esc(s.ziel)}</p>` : `<p class="leer">Noch nicht festgelegt</p>`}`;
  h += `<p class="leer">Auftrag: „${esc(kurz(s.auftrag, 240))}“</p>`;
  h += `<p class="leer">Oberfläche: ${s.hat_ui === null ? "offen" : s.hat_ui ? "ja" : "nein"} · Sensibel: ${s.sensibel?.length ? s.sensibel.map(esc).join(", ") : "nein"}</p>`;

  h += `<h3>Abnahmekriterien</h3>`;
  h += s.kriterien.length ? `<ul class="liste">${s.kriterien.map((k) => {
    const [cls, z] = k.erfuellt === true ? ["ja", "✓"] : k.erfuellt === false ? ["nein", "✗"] : ["offen", "○"];
    return `<li><span class="haken ${cls}">${z}</span><span><b>${esc(k.id)}</b> ${esc(k.text)}</span></li>`;
  }).join("")}</ul>` : `<p class="leer">Noch keine</p>`;

  h += `<h3>Todos</h3>`;
  h += d.todos.replace(/^# Todos\s*/, "").trim() ? `<div class="md">${md(d.todos.replace(/^# Todos\s*/, ""))}</div>` : `<p class="leer">Keine</p>`;

  h += `<h3>Befunde</h3>`;
  const runden = Object.keys(s.befunde).sort((a, b) => a - b);
  if (runden.length) {
    h += `<table class="befunde"><tr><th>Runde</th>${ROLLEN_SPALTEN.map(([, n]) => `<th>${n}</th>`).join("")}</tr>`;
    for (const r of runden) {
      h += `<tr><td>${esc(r)}</td>${ROLLEN_SPALTEN.map(([k]) => {
        const b = s.befunde[r][k];
        return `<td>${b ? `<span class="b-zahl">${b.blocker} B</span> <span class="k-zahl">${b.klein} K</span>` : "–"}</td>`;
      }).join("")}</tr>`;
    }
    h += `</table>`;
    for (const [name, text] of Object.entries(d.befunde).reverse()) {
      h += `<details><summary>${esc(name.replace("runde-", "Runde ").replace(/-(\w+)$/, " · $1"))}</summary><div class="md">${md(text)}</div></details>`;
    }
  } else h += `<p class="leer">Noch keine Prüfung</p>`;

  h += `<h3>Backlog (${backlogOffen})</h3>`;
  h += d.backlog.replace(/^# Backlog\s*/, "").trim()
    ? `<details ${backlogOffen <= 6 ? "open" : ""}><summary>Kleinigkeiten für spätere Versionen</summary><div class="md">${md(d.backlog.replace(/^# Backlog\s*/, ""))}</div></details>`
    : `<p class="leer">Leer</p>`;

  if (d.freigabe && s.status !== "eskaliert") h += `<h3>Freigabe</h3><details><summary>Bericht des Approvers</summary><div class="md">${md(d.freigabe)}</div></details>`;
  if (s.commits?.length) {
    h += `<h3>Commits</h3><ul class="liste">${s.commits.map((c) => `<li><code>${esc(c.sha)}</code><span>${esc(c.nachricht)}<br><span class="leer">${esc(zeit(c.zeit))}</span></span></li>`).join("")}</ul>`;
  }
  if (d.spec) h += `<h3>Spezifikation</h3><details><summary>spec.md</summary><div class="md">${md(d.spec)}</div></details>`;

  h += `<h3>Verlauf</h3><ul class="verlauf">${d.verlauf.slice(-40).reverse().map((v) =>
    `<li class="${esc(v.typ)}"><time>${esc(zeit(v.zeit))}</time>${esc(v.text)}</li>`).join("")}</ul>`;
  h += `<h3>Ordner</h3><p class="pfad">${esc(s.pfad)}</p>`;

  const inhalt = $("karte-inhalt");
  const offen = [...inhalt.querySelectorAll("details")].map((x) => x.open);
  const scroll = inhalt.scrollTop;
  inhalt.innerHTML = h;
  // Beim Aktualisieren aufgeklappte Abschnitte und Scrollposition behalten.
  if (zustand.karteGerendert === s.id) {
    inhalt.querySelectorAll("details").forEach((x, i) => { if (i < offen.length) x.open = offen[i]; });
    inhalt.scrollTop = scroll;
  }
  zustand.karteGerendert = s.id;
}

function shellPfad(p) {
  return `'${String(p).replace(/'/g, "'\\''")}'`;
}

function befehlsKnopf(befehl, beschriftung) {
  return `<button class="kopieren klein" type="button" data-befehl="${esc(befehl)}" data-beschriftung="${esc(beschriftung)}">${esc(beschriftung)}   ⧉ kopieren</button>`;
}

const SITZUNG_ZUSTAND = { arbeitet: "arbeitet", wartet: "wartet auf dich", ruht: "beendet" };

function rendereSitzung(d) {
  $("karte-id").textContent = d.name || "Sitzung";
  $("karte-titel").textContent = d.titel || d.projekt || "Claude-Sitzung";
  $("karte-kopieren").hidden = true;
  const seit = d.seit ? zeit(typeof d.seit === "string" && /^\d+$/.test(d.seit) ? Number(d.seit) : d.seit) : "";
  let h = `<div><span class="chip ${d.zustand === "arbeitet" ? "aktiv" : d.zustand === "wartet" ? "pausiert" : "fertig"}">${esc(SITZUNG_ZUSTAND[d.zustand] || d.zustand)}</span>
    <span class="leer"> · ${esc(d.projekt)}${seit ? ` · seit ${esc(seit)}` : ""}</span></div>`;
  if (d.zustand === "wartet" && d.frage) h += `<h3>Wartet auf</h3><div class="md zitat">${md(d.frage)}</div>`;
  if (d.letzte_eingabe) h += `<h3>Letzte Anweisung</h3><div class="md zitat">${md(d.letzte_eingabe)}</div>`;
  if (d.zustand !== "wartet" && d.letzte_antwort) h += `<details><summary>Letzte Antwort</summary><div class="md">${md(d.letzte_antwort)}</div></details>`;
  h += `<h3>Zuletzt bearbeitete Dateien</h3>`;
  h += d.dateien?.length ? `<ul class="liste">${d.dateien.map((f) => `<li><span class="pfad">${esc(f)}</span></li>`).join("")}</ul>` : `<p class="leer">Keine im letzten Abschnitt</p>`;
  h += `<h3>Weitermachen</h3>`;
  if (d.cwd) h += befehlsKnopf(`cd ${shellPfad(d.cwd)}`, `cd ${d.cwd}`);
  if (d.zustand === "ruht") {
    h += befehlsKnopf(`${d.cwd ? `cd ${shellPfad(d.cwd)} && ` : ""}claude --resume ${d.id}`, `claude --resume ${d.id}`);
  } else {
    h += `<p class="leer">Die Sitzung läuft noch${d.name ? ` im Terminal „${esc(d.name)}“` : ""}. Bitte dort weiterarbeiten, ein zweites Fortsetzen würde dieselbe Sitzung doppelt öffnen.</p>`;
  }
  h += `<h3>Ordner</h3><p class="pfad">${esc(d.cwd || "unbekannt")}</p><p class="pfad">Sitzung ${esc(d.id)}</p>`;
  const inhalt = $("karte-inhalt");
  const scroll = inhalt.scrollTop;
  inhalt.innerHTML = h;
  if (zustand.karteGerendert === "S:" + d.id) inhalt.scrollTop = scroll;
  zustand.karteGerendert = "S:" + d.id;
}

async function ladeKarte(id) {
  if (id.startsWith("S:")) {
    const r = await fetch(`/api/sitzung/${encodeURIComponent(id.slice(2))}`);
    if (!r.ok) throw new Error("Sitzung nicht gefunden");
    return rendereSitzung(await r.json());
  }
  const r = await fetch(`/api/auftrag/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error("Auftrag nicht gefunden");
  $("karte-kopieren").hidden = false;
  rendereKarte(await r.json());
}

function oeffneSitzung(sid) { return oeffneKarte("S:" + sid); }

// Merkt sich, von wo die Karte geöffnet wurde, damit der Fokus beim Schließen dorthin zurückgeht.
function merkeAusloeser() {
  const el = document.activeElement;
  if (!el || el === document.body || $("karte").contains(el)) return null;
  return {
    el,
    paket: el.classList?.contains("tafel-paket") ? el.dataset.id : null,
    sitzung: el.dataset?.sid || null,
  };
}

function findeAusloeser(a) {
  if (!a) return null;
  if (a.el.isConnected) return a.el;
  // Tafel und Werkbänke werden neu gezeichnet; dann das gleichwertige neue Element suchen.
  if (a.paket) return document.querySelector(`.tafel-paket[data-id="${CSS.escape(a.paket)}"]`) || zustand.pakete.get(a.paket)?.g || null;
  if (a.sitzung) return document.querySelector(`.bank[data-sid="${CSS.escape(a.sitzung)}"]`);
  return null;
}

async function oeffneKarte(id) {
  versteckeTooltip();
  const warOffen = Boolean(zustand.offeneKarte);
  const ausloeser = warOffen ? zustand.ausloeser : merkeAusloeser();
  zustand.offeneKarte = id;
  zustand.karteGerendert = null;
  try { await ladeKarte(id); } catch { if (!warOffen) zustand.offeneKarte = null; return; }
  zustand.ausloeser = ausloeser;
  const karte = $("karte");
  karte.inert = false;
  karte.classList.add("offen");
  $("halle-rahmen").inert = true;
  $("schleier").hidden = false;
  $("karte-zu").focus();
}

function schliesseKarte() {
  if (!zustand.offeneKarte) return;
  zustand.offeneKarte = null;
  const karte = $("karte");
  karte.classList.remove("offen");
  karte.inert = true;
  $("halle-rahmen").inert = false;
  $("schleier").hidden = true;
  const ziel = findeAusloeser(zustand.ausloeser);
  zustand.ausloeser = null;
  if (ziel) ziel.focus({ preventScroll: false });
}

async function kopiere(e) {
  const knopf = e?.currentTarget instanceof HTMLElement && e.currentTarget.dataset.befehl ? e.currentTarget : $("karte-kopieren");
  const text = knopf.dataset.befehl;
  const anzeige = knopf.dataset.beschriftung || text;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text; document.body.appendChild(t); t.select();
    document.execCommand("copy"); t.remove();
  }
  knopf.textContent = `${anzeige}   ✓ kopiert`;
  knopf.classList.add("ok");
  setTimeout(() => { knopf.textContent = `${anzeige}   ⧉ kopieren`; knopf.classList.remove("ok"); }, 1800);
}

// --- Abfrage -----------------------------------------------------------------

async function abfragen() {
  try {
    const r = await fetch("/api/stand", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    $("verbindung").hidden = true;
    zustand.auftraege = d.auftraege;
    aktualisierePakete(d.auftraege);
    aktualisiereArbeiter(d.auftraege);
    zustand.rollenAus = d.rollen_aus || [];
    zeigeRollen();
    aktualisiereTafel(d.auftraege, d.sitzungen, d.wach);
    aktualisiereWerkbaenke(d.sitzungen);
    zustand.erstesMal = false;
    if (zustand.offeneKarte) ladeKarte(zustand.offeneKarte).catch(() => {});
  } catch {
    $("verbindung").hidden = false;
  }
}

function setzeWerkstatt(zu) {
  $("werkbaenke").style.display = zu ? "none" : "";
  $("werkstatt-kopf").setAttribute("aria-expanded", String(!zu));
  $("werkstatt-titel").textContent = `${zu ? "▸" : "▾"} WERKSTATT · ALLE CLAUDE-SITZUNGEN AUF DIESEM RECHNER`;
  // Eingeklappt endet die Halle direkt unter der Überschrift.
  halle.setAttribute("viewBox", zu ? "0 0 1600 820" : "0 0 1600 960");
  try { localStorage.setItem("halle-werkstatt-zu", zu ? "1" : ""); } catch {}
}

function werkstattUmschalten() { setzeWerkstatt($("werkstatt-kopf").getAttribute("aria-expanded") === "true"); }

zeichneSzene();
{
  let zu = false;
  try { zu = localStorage.getItem("halle-werkstatt-zu") === "1"; } catch {}
  setzeWerkstatt(zu);
}
$("werkstatt-kopf").addEventListener("click", werkstattUmschalten);
$("werkstatt-kopf").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); werkstattUmschalten(); } });
$("karte-inhalt").addEventListener("click", (e) => {
  const knopf = e.target.closest("button[data-befehl]");
  if (knopf) kopiere({ currentTarget: knopf });
});
$("karte-zu").addEventListener("click", schliesseKarte);
$("schleier").addEventListener("click", schliesseKarte);
$("karte-kopieren").addEventListener("click", kopiere);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") schliesseKarte(); });
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (/^F-\d{4}$/.test(id)) oeffneKarte(id);
});
abfragen().then(() => {
  const id = location.hash.slice(1);
  if (/^F-\d{4}$/.test(id)) oeffneKarte(id);
});
setInterval(abfragen, 2000);
