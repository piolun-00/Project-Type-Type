/* Testy silnika Type Type: uruchamiane lokalnie (npm test) i automatycznie na GitHubie przy każdej zmianie.
   Nie używają żadnych licencjonowanych fontów — font testowy jest budowany z prostych kształtów. */
const fs = require('fs');
const path = require('path');
const ot = require('opentype.js');
const R = require('../src/core.js');
const V = require('../src/vf.js');

let failed = 0, passed = 0;
function check(name, cond, info) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('  BŁĄD ' + name + (info ? ' — ' + info : '')); }
}

// --- kształty testowe (te same co demo w aplikacji), w układzie fontu: y w górę, wysokość 700 ---
const S = 7; // skala z demo (100 j.) do 700 j.
const poly = (pts) => pts.map((p, i) => ({ type: i ? 'L' : 'M', x: p[0] * S, y: (100 - p[1]) * S })).concat([{ type: 'Z' }]);
const SHAPES = {
  M: poly([[0,100],[0,0],[22,0],[40,55],[58,0],[80,0],[80,100],[62,100],[62,40],[47,85],[33,85],[18,40],[18,100]]),
  A: poly([[0,100],[30,0],[52,0],[82,100],[63,100],[57,78],[25,78],[19,100]]).concat(poly([[30,62],[41,24],[52,62]])),
  K: poly([[0,0],[18,0],[18,42],[50,0],[72,0],[36,46],[74,100],[52,100],[24,60],[18,67],[18,100],[0,100]]),
  E: poly([[0,0],[70,0],[70,17],[18,17],[18,41],[62,41],[62,58],[18,58],[18,83],[70,83],[70,100],[0,100]]),
};
const REF = 1000;
const OPTS = { angleMin: 15, endTol: 15, endMax: 300, fillRule: 'nonzero', mergeTol: 8 };
const PARAMS = (e, o, i) => ({ end: e, out: o, in: i, rOut: 126, rIn: 76, tension: 1, tanMax: 4, absorb: true, absorbMax: 100 });

function contoursClosed(cmds, tol) {
  let start = null, last = null, ok = true;
  for (const c of cmds) {
    if (c.type === 'M') { start = c; last = c; }
    else if (c.type === 'Z') { if (Math.hypot(last.x - start.x, last.y - start.y) > tol) ok = false; }
    else last = c;
  }
  return ok;
}
const finite = (cmds) => cmds.every(c => ['x','y','x1','y1','x2','y2'].every(k => c[k] == null || Number.isFinite(c[k])));

console.log('Silnik zaokrąglania');
for (const [name, cmds] of Object.entries(SHAPES)) {
  const an = R.analyze(R.commandsToContours(cmds, REF), OPTS, REF);
  for (const p of [[0,0,0], [1,0,0], [0,1,0], [0,0,1], [1,1,1], [0.4,0.7,0.2]]) {
    const out = R.round(an, PARAMS(...p), REF);
    check(`${name} ${p.join('/')}: liczby skończone i domknięte kontury`, finite(out) && contoursClosed(out, 0.01));
  }
  const zero = R.round(an, PARAMS(0, 0, 0), REF);
  const pts = new Set(cmds.filter(c => c.x != null).map(c => c.x + ',' + c.y));
  check(`${name}: przy 0 kształt bez zmian`, zero.filter(c => c.x != null).every(c => pts.has(Math.round(c.x) + ',' + Math.round(c.y))));
}
{
  const an = R.analyze(R.commandsToContours(SHAPES.E, REF), OPTS, REF);
  const types = an.flatMap(C => C.corners.filter(Boolean).map(c => c.type));
  check('E: wykryte zakończenia ramion', types.filter(t => t === 'end').length >= 6, JSON.stringify(types));
  check('E: wykryte narożniki wewnętrzne', types.filter(t => t === 'in').length >= 4);
  // korekta: narożnik ustawiony jako ostry zostaje w pierwotnym miejscu
  const ovr = an.map(C => C.corners.map(() => null));
  const k = an[0].corners.findIndex(c => c && c.type === 'out');
  ovr[0][k] = { type: 'off' };
  const v = an[0].corners[k].v;
  const out = R.round(an, PARAMS(1, 1, 1), REF, false, null, ovr);
  check('korekta „ostry” zachowuje wierzchołek', out.some(c => c.x != null && Math.hypot(c.x - v.x, c.y - v.y) < 0.01));
  // tryb stałej struktury (font zmienny): ta sama sekwencja komend dla różnych wartości
  const sig = (p) => R.round(an, PARAMS(...p), REF, true, PARAMS(1, 1, 1)).map(c => c.type).join('');
  check('stała struktura punktów dla fontu zmiennego', sig([0,0,0]) === sig([1,1,1]) && sig([0.5,0.2,0.9]) === sig([0,0,0]));
}

console.log('Eksport fontu');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const glyphs = [new ot.Glyph({ name: '.notdef', advanceWidth: 600, path: new ot.Path() }),
  new ot.Glyph({ name: 'space', unicode: 32, unicodes: [32], advanceWidth: 250, path: new ot.Path() })];
const shapes = Object.entries(SHAPES);
for (const [ch, cmds] of shapes) {
  const p = new ot.Path(); p.commands = cmds;
  glyphs.push(new ot.Glyph({ name: ch, unicode: ch.charCodeAt(0), unicodes: [ch.charCodeAt(0)], advanceWidth: 640, path: p }));
}
const src = new ot.Font({ familyName: 'Type Type Test', styleName: 'Regular', unitsPerEm: REF, ascender: 800, descender: -200, glyphs });
const srcBuf = Buffer.from(src.toArrayBuffer());
const font = ot.parse(srcBuf.buffer.slice(srcBuf.byteOffset, srcBuf.byteOffset + srcBuf.length));

// statyczny .otf — współrzędne całkowite (bez kumulacji błędu w CFF)
const rounded = [];
for (let i = 0; i < font.glyphs.length; i++) {
  const g = font.glyphs.get(i), p = new ot.Path();
  if (g.path.commands.length) {
    const an = R.analyze(R.commandsToContours(g.path.commands, REF), OPTS, REF);
    p.commands = R.round(an, PARAMS(1, 0.8, 0.8), REF).map(c => { const o = { type: c.type }; for (const k of ['x','y','x1','y1','x2','y2']) if (c[k] != null) o[k] = Math.round(c[k]); return o; });
  }
  rounded.push(new ot.Glyph({ name: g.name, unicode: g.unicode, unicodes: g.unicodes || [], advanceWidth: g.advanceWidth, path: p }));
}
const outFont = new ot.Font({ familyName: 'Type Type Test Rounded', styleName: 'Regular', postScriptName: 'TypeTypeTestRounded-Regular', unitsPerEm: REF, ascender: 800, descender: -200, glyphs: rounded });
const otfBytes = Buffer.from(outFont.toArrayBuffer());
fs.writeFileSync(path.join(outDir, 'test-rounded.otf'), otfBytes);
const back = ot.parse(otfBytes.buffer.slice(otfBytes.byteOffset, otfBytes.byteOffset + otfBytes.length));
let closedAll = true;
for (let i = 0; i < back.glyphs.length; i++) if (!contoursClosed(back.glyphs.get(i).path.commands, 1.5)) closedAll = false;
check('statyczny .otf: wszystkie kontury domknięte po zapisie i odczycie', closedAll);
check('statyczny .otf: liczba glifów zachowana', back.numGlyphs === font.numGlyphs);

// font zmienny .ttf
(async () => {
  const items = [];
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    const an = g.path.commands.length ? R.analyze(R.commandsToContours(g.path.commands, REF), OPTS, REF) : null;
    items.push({ advance: g.advanceWidth, master: (m) => an ? R.round(an, Object.assign(PARAMS(...m)), REF, true, PARAMS(1, 1, 1)) : null });
  }
  const res = await V.buildVariableFont({
    glyphs: items, upm: REF, ascender: 800, descender: -200,
    axes: [{ tag: 'RNDE', name: 'Rounded Ends' }, { tag: 'RNDO', name: 'Rounded Outer' }, { tag: 'RNDI', name: 'Rounded Inner' }],
    instances: [{ name: 'Sharp', coords: [0, 0, 0] }, { name: 'Round', coords: [100, 100, 100] }],
    names: { 1: 'Type Type Test VF', 2: 'Regular', 4: 'Type Type Test VF', 6: 'TypeTypeTestVF-Regular' },
    srcTables: V.readTables(new Uint8Array(srcBuf)), srcIsVariable: false,
  });
  fs.writeFileSync(path.join(outDir, 'test-vf.ttf'), Buffer.from(res.bytes));
  check('font zmienny: wszystkie glify interpolowalne', res.warn === 0, 'nieinterpolowalne: ' + res.warn);

  console.log(`\n${passed} testów zaliczonych, ${failed} niezaliczonych.`);
  console.log('Pliki do walidacji OTS: tests/out/test-rounded.otf, tests/out/test-vf.ttf');
  process.exit(failed ? 1 : 0);
})();
