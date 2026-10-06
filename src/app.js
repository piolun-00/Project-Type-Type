/* Type Type — interfejs aplikacji */
(function(){
'use strict';
const R = window.RounderCore;
const $ = (id) => document.getElementById(id);

/* ================= stan ================= */
const DEF = { end:0, out:0, in:0, kOut:1, kIn:0.6, tanMax:4, tension:1, angleMin:15, endTol:15, endMax:30, merge:0.8, absorb:10 };
const state = {
  p: Object.assign({}, DEF),
  strokeOv: null,
  mode: 'svg',            // 'font' | 'svg'
  source: 'demo',
  font: null, fontFile: '',
  shapes: [], box: null, svgName: '',
  ref: 100, strokeAuto: 8,
  view: 'text',
  text: 'Zażółć gęślą jaźń\nĄĆĘŁŃÓŚŹŻ Hamburgefonstiv 0123',
  union: true,
  size: 110,
  zoom: 100,
  gzoom: 76,
  esize: 400,
  ezoom: 100,        // powiększenie w edycji glifu; 100 = dopasowany do okna
  spacePan: false,
  showG: true,
  vmode: 'corners',  // 'corners' | 'contour'
  vsel: [],          // zaznaczone elementy konturu: { ci, ni, part: 'node'|'in'|'out' }
  edit: 0,
  sel: [],
  ovr: {},          // klucz glifu → { scale, nodes:[{x,y,type,mode,amt,absorb}], force:[{x,y}] }
  base: {},         // indeks edytowanego glifu → indeks glifu bazowego
  hash: '',
  showC: true, showO: false,
  booting: true,     // zanim wczytamy domyślny font, nie rysujemy nic migotliwego
};
const GRID_BASE = 76;      // bazowa wielkość komórki, od której liczymy liczbę kolumn
const cache = new Map();   // klucz → analiza
const CACHE_MAX = 4000, CACHE_DROP = 1000;
let detKey = '';

/* ================= demo (oryginalne kształty) ================= */
const DEMO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 470 100">
<path d="M0 100V0h22l18 55 18-55h22v100H62V40L47 85H33L18 40v60z"/>
<path fill-rule="evenodd" d="M100 100L130 0h22l30 100h-19l-6-22h-32l-6 22zM130 62h22l-11-38z"/>
<path d="M200 0h18v42l32-42h22l-36 46 38 54h-22l-28-40-6 7v33h-18z"/>
<path d="M290 0h70v17h-52v24h44v17h-44v25h52v17h-70z"/>
<path d="M425 0l11.8 33.8 35.8.7-28.5 21.7 10.3 34.3L425 70.2 395.6 90.5l10.3-34.3-28.5-21.7 35.8-.7z"/>
</svg>`;

/* ================= parser SVG ================= */
function pathDToCmds(d){
  const out = []; let i = 0; const s = d || '';
  const isNumStart = (c) => /[0-9.+\-]/.test(c);
  const skip = () => { while (i < s.length && /[\s,]/.test(s[i])) i++; };
  const num = () => { skip(); const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i)); if(!m) throw new Error('Błędna ścieżka SVG'); i += m[0].length; return parseFloat(m[0]); };
  const flag = () => { skip(); const c = s[i]; if (c !== '0' && c !== '1') throw new Error('Błędna flaga łuku'); i++; return c === '1'; };
  let cx=0, cy=0, sx=0, sy=0, lc=null, lq=null, cmd='';
  while (true) {
    skip(); if (i >= s.length) break;
    if (/[a-zA-Z]/.test(s[i])) { cmd = s[i++]; } else if (!cmd) throw new Error('Błędna ścieżka SVG');
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'Z') { out.push({type:'Z'}); cx=sx; cy=sy; lc=lq=null; cmd=''; continue; }
    if (C === 'M') { cx = ox+num(); cy = oy+num(); sx=cx; sy=cy; out.push({type:'M',x:cx,y:cy}); cmd = rel?'l':'L'; lc=lq=null; }
    else if (C === 'L') { cx = ox+num(); cy = oy+num(); out.push({type:'L',x:cx,y:cy}); lc=lq=null; }
    else if (C === 'H') { cx = (rel?cx:0)+num(); out.push({type:'L',x:cx,y:cy}); lc=lq=null; }
    else if (C === 'V') { cy = (rel?cy:0)+num(); out.push({type:'L',x:cx,y:cy}); lc=lq=null; }
    else if (C === 'C') { const x1=ox+num(),y1=oy+num(),x2=ox+num(),y2=oy+num(); cx=ox+num(); cy=oy+num(); out.push({type:'C',x1,y1,x2,y2,x:cx,y:cy}); lc={x:x2,y:y2}; lq=null; }
    else if (C === 'S') { const x1=lc?2*cx-lc.x:cx, y1=lc?2*cy-lc.y:cy; const x2=ox+num(),y2=oy+num(); cx=ox+num(); cy=oy+num(); out.push({type:'C',x1,y1,x2,y2,x:cx,y:cy}); lc={x:x2,y:y2}; lq=null; }
    else if (C === 'Q') { const x1=ox+num(),y1=oy+num(); cx=ox+num(); cy=oy+num(); out.push({type:'Q',x1,y1,x:cx,y:cy}); lq={x:x1,y:y1}; lc=null; }
    else if (C === 'T') { const x1=lq?2*cx-lq.x:cx, y1=lq?2*cy-lq.y:cy; cx=ox+num(); cy=oy+num(); out.push({type:'Q',x1,y1,x:cx,y:cy}); lq={x:x1,y:y1}; lc=null; }
    else if (C === 'A') { const rx=num(),ry=num(),rot=num(),la=flag(),sw=flag(); const x=ox+num(),y=oy+num(); arcToCubics(cx,cy,rx,ry,rot,la,sw,x,y,out); cx=x; cy=y; lc=lq=null; }
    else throw new Error('Nieobsługiwana komenda ścieżki: '+cmd);
    skip(); if (i < s.length && !isNumStart(s[i]) && !/[a-zA-Z]/.test(s[i])) throw new Error('Błędna ścieżka SVG');
  }
  return out;
}
function arcToCubics(x1,y1,rx,ry,phiDeg,fa,fs,x2,y2,out){
  if (x1===x2 && y1===y2) return;
  rx=Math.abs(rx); ry=Math.abs(ry);
  if (!rx || !ry) { out.push({type:'L',x:x2,y:y2}); return; }
  const phi=phiDeg*Math.PI/180, cp=Math.cos(phi), sp=Math.sin(phi);
  const dx=(x1-x2)/2, dy=(y1-y2)/2, x1p=cp*dx+sp*dy, y1p=-sp*dx+cp*dy;
  let lam=(x1p*x1p)/(rx*rx)+(y1p*y1p)/(ry*ry); if (lam>1){ const s=Math.sqrt(lam); rx*=s; ry*=s; }
  const num=rx*rx*ry*ry-rx*rx*y1p*y1p-ry*ry*x1p*x1p, den=rx*rx*y1p*y1p+ry*ry*x1p*x1p;
  let co=Math.sqrt(Math.max(0,num/den)); if (fa===fs) co=-co;
  const cxp=co*rx*y1p/ry, cyp=-co*ry*x1p/rx;
  const cx=cp*cxp-sp*cyp+(x1+x2)/2, cy=sp*cxp+cp*cyp+(y1+y2)/2;
  const ang=(ux,uy,vx,vy)=>{ const a=Math.atan2(ux*vy-uy*vx, ux*vx+uy*vy); return a; };
  let t1=ang(1,0,(x1p-cxp)/rx,(y1p-cyp)/ry), dt=ang((x1p-cxp)/rx,(y1p-cyp)/ry,(-x1p-cxp)/rx,(-y1p-cyp)/ry);
  if (!fs && dt>0) dt-=2*Math.PI; else if (fs && dt<0) dt+=2*Math.PI;
  const n=Math.ceil(Math.abs(dt)/(Math.PI/2)), d=dt/n, k=4/3*Math.tan(d/4);
  const pt=(t)=>({x:cx+rx*Math.cos(t)*cp-ry*Math.sin(t)*sp, y:cy+rx*Math.cos(t)*sp+ry*Math.sin(t)*cp});
  const dv=(t)=>({x:-rx*Math.sin(t)*cp-ry*Math.cos(t)*sp, y:-rx*Math.sin(t)*sp+ry*Math.cos(t)*cp});
  for (let j=0;j<n;j++){
    const a=t1+j*d, b=a+d, p0=pt(a), p3=pt(b), d0=dv(a), d3=dv(b);
    out.push({type:'C', x1:p0.x+k*d0.x, y1:p0.y+k*d0.y, x2:p3.x-k*d3.x, y2:p3.y-k*d3.y, x:p3.x, y:p3.y});
  }
}
function ellipseCmds(cx,cy,rx,ry){
  const k=0.5522847498, o=[];
  o.push({type:'M',x:cx+rx,y:cy});
  o.push({type:'C',x1:cx+rx,y1:cy+k*ry,x2:cx+k*rx,y2:cy+ry,x:cx,y:cy+ry});
  o.push({type:'C',x1:cx-k*rx,y1:cy+ry,x2:cx-rx,y2:cy+k*ry,x:cx-rx,y:cy});
  o.push({type:'C',x1:cx-rx,y1:cy-k*ry,x2:cx-k*rx,y2:cy-ry,x:cx,y:cy-ry});
  o.push({type:'C',x1:cx+k*rx,y1:cy-ry,x2:cx+rx,y2:cy-k*ry,x:cx+rx,y:cy});
  o.push({type:'Z'}); return o;
}
function elementCmds(el){
  const n = el.tagName.toLowerCase(), A = (k, d=0) => { const v = parseFloat(el.getAttribute(k)); return isFinite(v) ? v : d; };
  if (n === 'path') return pathDToCmds(el.getAttribute('d'));
  if (n === 'rect') {
    const x=A('x'), y=A('y'), w=A('width'), h=A('height'); if (w<=0||h<=0) return [];
    let rx=parseFloat(el.getAttribute('rx')), ry=parseFloat(el.getAttribute('ry'));
    if (!isFinite(rx) && isFinite(ry)) rx=ry; if (!isFinite(ry) && isFinite(rx)) ry=rx; rx=Math.min(rx||0,w/2); ry=Math.min(ry||0,h/2);
    if (!rx || !ry) return [{type:'M',x,y},{type:'L',x:x+w,y},{type:'L',x:x+w,y:y+h},{type:'L',x,y:y+h},{type:'Z'}];
    const d=`M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z`;
    return pathDToCmds(d);
  }
  if (n === 'circle') return ellipseCmds(A('cx'),A('cy'),A('r'),A('r'));
  if (n === 'ellipse') return ellipseCmds(A('cx'),A('cy'),A('rx'),A('ry'));
  if (n === 'polygon' || n === 'polyline') {
    const v = (el.getAttribute('points')||'').trim().split(/[\s,]+/).map(parseFloat).filter(isFinite);
    const o=[]; for (let j=0;j+1<v.length;j+=2) o.push({type: j?'L':'M', x:v[j], y:v[j+1]}); if (o.length) o.push({type:'Z'}); return o;
  }
  return [];
}
function transformCmds(cmds, m){
  const T = (x,y)=>({x:m.a*x+m.c*y+m.e, y:m.b*x+m.d*y+m.f});
  return cmds.map(c=>{
    const o={type:c.type};
    if (c.x!=null){ const p=T(c.x,c.y); o.x=p.x; o.y=p.y; }
    if (c.x1!=null){ const p=T(c.x1,c.y1); o.x1=p.x; o.y1=p.y; }
    if (c.x2!=null){ const p=T(c.x2,c.y2); o.x2=p.x; o.y2=p.y; }
    return o;
  });
}
// Wgrany plik trafia na chwilę do żywego DOM-u (tylko tak policzymy getScreenCTM),
// więc najpierw wycinamy z niego wszystko, co mogłoby cokolwiek wykonać lub pobrać:
// skrypty, atrybuty zdarzeń, odnośniki, osadzone obrazy, style i animacje.
function sanitizeSvg(svg){
  svg.querySelectorAll('script,foreignObject,image,style,animate,animateTransform,animateMotion,set,a,iframe,audio,video').forEach(e=>e.remove());
  const walk = (el) => {
    for (const at of [...el.attributes]) {
      const n = at.name.toLowerCase();
      if (n.startsWith('on') || n === 'href' || n === 'xlink:href' || /javascript:/i.test(at.value)) el.removeAttribute(at.name);
    }
    for (const ch of el.children) walk(ch);
  };
  walk(svg);
  return svg;
}
function parseSvg(text){
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName.toLowerCase() !== 'svg') throw new Error('To nie jest poprawny plik SVG.');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none';
  // czyścimy jeszcze w dokumencie z DOMParsera — przeniesienie do głównego dokumentu
  // potrafi samo ruszyć pobieranie zasobów, więc musi być po sanityzacji
  const svg = document.importNode(sanitizeSvg(doc.documentElement), true);
  host.appendChild(svg); document.body.appendChild(host);
  const shapes = []; let skippedStroke = 0, skippedText = 0, skippedUse = 0, warnPaint = 0, skippedHidden = 0;
  try {
    const rootCTM = svg.getScreenCTM();
    if (!rootCTM) throw new Error('Nie udało się odczytać układu współrzędnych pliku SVG.');
    const rootInv = rootCTM.inverse();
    svg.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,text,use').forEach(el=>{
      if (el.closest('defs,clipPath,mask,symbol,pattern,marker')) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'text') { skippedText++; return; }
      if (tag === 'use') { skippedUse++; return; }
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      if (!cs.fill || cs.fill === 'none') { skippedStroke++; return; }
      let fill = cs.fill; if (/^url/.test(fill)) { fill = null; warnPaint++; }
      // element w grupie z display:none nie ma układu współrzędnych — pomijamy zamiast się wywalić
      const ctm = el.getScreenCTM(); if (!ctm) { skippedHidden++; return; }
      const m = rootInv.multiply(ctm);
      const cmds = transformCmds(elementCmds(el), m);
      if (cmds.length) shapes.push({ cmds, fill, rule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero' });
    });
  } finally { host.remove(); }
  if (!shapes.length) throw new Error('W pliku nie ma wypełnionych kształtów. Obrysy i tekst zamień na krzywe przed wgraniem.');
  const notes = [];
  if (skippedStroke) notes.push(`${skippedStroke} el. bez wypełnienia (obrysy) pominięto — zamień obrys na kształt`);
  if (skippedText) notes.push(`${skippedText} el. tekstowych pominięto — zamień na krzywe`);
  if (skippedUse) notes.push(`${skippedUse} el. <use> pominięto — rozbij symbole`);
  if (skippedHidden) notes.push(`${skippedHidden} el. ukrytych pominięto`);
  if (warnPaint) notes.push('gradienty zastąpiono jednolitym kolorem');
  return { shapes, notes };
}
function cmdsBox(list){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for (const cmds of list) for (const c of cmds) for (const [kx,ky] of [['x','y'],['x1','y1'],['x2','y2']]) if (c[kx]!=null){
    x0=Math.min(x0,c[kx]); x1=Math.max(x1,c[kx]); y0=Math.min(y0,c[ky]); y1=Math.max(y1,c[ky]);
  }
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}

/* ================= analiza i zaokrąglanie ================= */
function detOpts(){ return { angleMin: state.p.angleMin, endTol: state.p.endTol, endMax: state.p.endMax/100*state.ref, fillRule: 'nonzero', mergeTol: state.p.merge/100*state.ref }; }

/* --- łączenie nachodzących konturów (np. ogonek w ą/ę, kreska w Ł) przez paper.js --- */
let paperReady = false;
function initPaper(){
  if (paperReady || !window.paper) return paperReady;
  try { paper.setup(document.createElement('canvas')); paperReady = true; } catch(e) { paperReady = false; }
  return paperReady;
}
function contourBoxes(cmds){
  const boxes = []; let b = null;
  for (const c of cmds) {
    if (c.type === 'M') { b = { x0:c.x, y0:c.y, x1:c.x, y1:c.y }; boxes.push(b); continue; }
    if (!b) continue;
    for (const [kx,ky] of [['x','y'],['x1','y1'],['x2','y2']]) if (c[kx] != null) {
      b.x0 = Math.min(b.x0, c[kx]); b.x1 = Math.max(b.x1, c[kx]); b.y0 = Math.min(b.y0, c[ky]); b.y1 = Math.max(b.y1, c[ky]);
    }
  }
  return boxes;
}
function mayOverlap(cmds){
  const bx = contourBoxes(cmds);
  for (let i=0;i<bx.length;i++) for (let j=i+1;j<bx.length;j++) {
    const a = bx[i], b = bx[j];
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) return true;
  }
  return false;
}
function paperToCmds(item){
  const out = []; const paths = item.children ? item.children : [item];
  for (const p of paths) {
    const sg = p.segments; if (!sg || sg.length < 2) continue;
    out.push({ type:'M', x:sg[0].point.x, y:sg[0].point.y });
    const n = sg.length, cnt = p.closed ? n : n - 1;
    for (let i=0;i<cnt;i++) {
      const a = sg[i], b = sg[(i+1)%n];
      if (a.handleOut.isZero() && b.handleIn.isZero()) out.push({ type:'L', x:b.point.x, y:b.point.y });
      else out.push({ type:'C', x1:a.point.x+a.handleOut.x, y1:a.point.y+a.handleOut.y, x2:b.point.x+b.handleIn.x, y2:b.point.y+b.handleIn.y, x:b.point.x, y:b.point.y });
    }
    out.push({ type:'Z' });
  }
  return out;
}
function prepCmds(cmds, rule){
  if (!state.union || !mayOverlap(cmds) || !initPaper()) return cmds;
  try {
    const cp = new paper.CompoundPath({ pathData: R.toPathData(cmds, 0, 0, 1, false, 3), insert: false });
    cp.fillRule = rule || 'nonzero';
    const res = cp.resolveCrossings().reorient(rule !== 'evenodd', true);
    const out = paperToCmds(res);
    if (!out.length) return cmds;
    // punkty, których nie było w oryginale = przecięcia konturów → zawsze traktuj jako narożniki
    const orig = cmds.filter(c => c.x != null).map(c => ({ x: c.x, y: c.y }));
    const eps = state.ref * 1e-3;
    out.forcePts = out.filter(c => c.x != null && c.type !== 'Z').map(c => ({ x: c.x, y: c.y }))
      .filter(p => !orig.some(q => Math.abs(q.x - p.x) < eps && Math.abs(q.y - p.y) < eps));
    return out;
  } catch (e) { return cmds; }
}

function getAnalysis(key, cmds, rule){
  const E = state.ovr[key], force = E && E.force && E.force.length ? E.force : null;
  const k = state.loadId + ':' + key + '|' + detKey + (force ? '|' + JSON.stringify(force) : '') + (E && E.pk ? '|p' + E.pk : '');
  let a = cache.get(k);
  if (!a) {
    const o = detOpts(); o.fillRule = rule || 'nonzero';
    const pc = prepCmds(cmds, rule);
    o.forcePts = (pc.forcePts || []).concat(force ? force.map(q => ({ x:q.x, y:q.y, a:0.5, manual:true })) : []);
    a = R.analyze(R.commandsToContours(pc, state.ref), o, state.ref);
    // Map trzyma kolejność wstawiania, więc przy przepełnieniu wyrzucamy najstarsze wpisy.
    // Bez tego przeciąganie węzła w edytorze konturu dokłada nową analizę co klatkę.
    if (cache.size >= CACHE_MAX) { const it = cache.keys(); for (let i = 0; i < CACHE_DROP; i++) { const e = it.next(); if (e.done) break; cache.delete(e.value); } }
    cache.set(k, a);
  }
  return a;
}
function stroke(){ return state.strokeOv || state.strokeAuto; }

/* ================= ręczne korekty ================= */
const NODE_DEF = { type:'auto', mode:'rel', amt:100, absorb:'auto' };
function tolN(){ return Math.max(2, state.ref * 0.003); }
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= tolN();
function globalVal(t){ return t === 'off' ? 0 : state.p[t] / 100; }
function effType(n, c){ let t = n && n.type !== 'auto' ? n.type : c.type; if (t === 'end' && !(c.endLen > 0)) t = 'out'; return t; }
// dopasowanie zapisanych korekt do narożników bieżącej analizy
// gv: skąd brać wartość suwaka dla danego typu. Domyślnie z interfejsu; font zmienny
// podaje tu wartość osi, żeby korekty „względne” zmieniały się razem z osią.
function matchOvr(key, an, gv){
  const E = state.ovr[key]; if (!E) return null;
  const GV = gv || globalVal;
  const scale = (E.scale == null ? 100 : E.scale) / 100;
  const res = an.map(C => C.corners.map(() => null)), nodeAt = an.map(C => C.corners.map(() => null));
  // Każdy narożnik może dostać tylko jedną korektę: zbieramy wszystkie pary w zasięgu,
  // sortujemy po odległości i przydzielamy zachłannie. Reszta trafia na listę osieroconych,
  // dzięki czemu nic nie znika po cichu.
  const nodes = E.nodes || [], pairs = [];
  nodes.forEach((n, ni) => an.forEach((C, ci) => C.corners.forEach((c, k) => {
    if (!c) return;
    const d = Math.hypot(c.v.x - n.x, c.v.y - n.y);
    if (d <= tolN()) pairs.push({ ni, ci, k, d });
  })));
  pairs.sort((a, b) => a.d - b.d);
  const usedNode = new Set();
  for (const p of pairs) {
    if (usedNode.has(p.ni) || nodeAt[p.ci][p.k]) continue;
    usedNode.add(p.ni); nodeAt[p.ci][p.k] = nodes[p.ni];
  }
  const orphans = nodes.filter((n, ni) => !usedNode.has(ni));
  an.forEach((C, ci) => C.corners.forEach((c, k) => {
    if (!c) return;
    const n = nodeAt[ci][k];
    const t = effType(n, c);
    if (n) {
      const g = n.mode === 'abs' ? n.amt / 100 : GV(t) * n.amt / 100 * scale;
      res[ci][k] = { type: t, g, absorb: n.absorb !== 'auto' ? n.absorb : undefined };
    } else if (scale !== 1) res[ci][k] = { g: GV(t) * scale };
  }));
  return { res, orphans, nodeAt };
}
function roundShape(key, cmds, rule, rp){
  const an = getAnalysis(key, cmds, rule);
  const M = matchOvr(key, an);
  return { an, M, cm: R.round(an, rp, state.ref, false, null, M && M.res) };
}
function hasOvr(key){ const E = state.ovr[key]; return !!E && (!!E.path || (E.nodes && E.nodes.length) || (E.force && E.force.length) || (E.scale != null && E.scale !== 100)); }
function glyphCmds(g){ const E = state.ovr['g' + g.index]; return E && E.path ? E.path : (g.path ? g.path.commands : []); }
function cleanOvr(key){ if (!hasOvr(key)) delete state.ovr[key]; }

/* ================= historia (cofnij / ponów) ================= */
const hist = { undo: [], redo: [], t: 0 };
const snapshot = () => JSON.stringify({ p: state.p, ovr: state.ovr, strokeOv: state.strokeOv });
function checkpoint(){
  const now = Date.now(), coalesce = now - hist.t < 700; hist.t = now;
  if (coalesce) return;
  const s = snapshot();
  if (hist.undo[hist.undo.length - 1] !== s) { hist.undo.push(s); if (hist.undo.length > 300) hist.undo.shift(); }
  hist.redo.length = 0;
}
function restoreSnap(s){
  const o = JSON.parse(s); state.p = Object.assign({}, DEF, o.p); state.ovr = o.ovr || {}; state.vsel = [];
  state.strokeOv = o.strokeOv > 0 ? o.strokeOv : null; $('strokeOv').value = state.strokeOv || '';
  refreshDetection(); syncUI(); updatePanel(); schedule(); autosave();
}
function undo(){ if (!hist.undo.length) return; hist.redo.push(snapshot()); restoreSnap(hist.undo.pop()); hist.t = 0; toast('Cofnięto'); }
function redo(){ if (!hist.redo.length) return; hist.undo.push(snapshot()); restoreSnap(hist.redo.pop()); hist.t = 0; toast('Ponowiono'); }

/* ================= autozapis ================= */
function hashBytes(u8){ let h = 0x811c9dc5; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + '-' + u8.length; }
const LSKEY = () => 'type-type:' + state.hash;
const LSKEY_OLD = () => 'szlifiernia:' + state.hash;
function settingsObj(){
  return { app:'Type Type', version:1, source:{ name: state.mode === 'font' ? state.fontFile : (state.svgName || ''), hash: state.hash },
    p: state.p, ovr: state.ovr, base: state.base, union: state.union, strokeOv: state.strokeOv, famName: $('famName').value, text: state.text, saved: Date.now() };
}
function autosave(){
  if (!state.hash || state.source === 'demo') return;
  clearTimeout(autosave._t);
  autosave._t = setTimeout(() => { try { localStorage.setItem(LSKEY(), JSON.stringify(settingsObj())); } catch(e) {} }, 600);
}
function applySettings(o, fromFile){
  checkpoint(); hist.t = 0;
  state.p = Object.assign({}, DEF, o.p || {});
  state.ovr = o.ovr && typeof o.ovr === 'object' ? o.ovr : {};
  state.base = o.base && typeof o.base === 'object' ? o.base : {};
  if (typeof o.union === 'boolean') { state.union = o.union; $('union').checked = o.union; }
  state.strokeOv = o.strokeOv > 0 ? o.strokeOv : null; $('strokeOv').value = state.strokeOv || '';
  if (o.famName && state.mode === 'font') $('famName').value = o.famName;
  if (typeof o.text === 'string' && o.text) state.text = o.text;
  cache.clear(); refreshDetection(); syncUI(); updatePanel(); schedule(); autosave();
  if (fromFile && o.source && o.source.hash && o.source.hash !== state.hash) setMsg(`Ustawienia pochodzą z innego pliku (${o.source.name || 'nieznany'}). Korekty mogą nie trafić w narożniki — sprawdź listę w panelu glifu.`);
}
function offerRestore(){
  const box = $('restore'); box.hidden = true; box.innerHTML = '';
  if (!state.hash) return;
  let o = null; try { o = JSON.parse(localStorage.getItem(LSKEY()) || localStorage.getItem(LSKEY_OLD()) || 'null'); } catch(e) {}
  if (!o) return;
  const n = Object.keys(o.ovr || {}).length;
  const when = new Date(o.saved || Date.now()).toLocaleString('pl-PL', { dateStyle:'short', timeStyle:'short' });
  box.innerHTML = `<span></span><div class="btn-row"><button class="btn primary" id="rsYes">Przywróć</button><button class="btn" id="rsNo">Zacznij od zera</button></div>`;
  box.querySelector('span').textContent = `Masz zapisaną pracę nad tym plikiem (${when}${n ? `, korekty w ${n} ${n === 1 ? 'glifie' : 'glifach'}` : ''}).`;
  box.hidden = false;
  $('rsYes').onclick = () => { applySettings(o); box.hidden = true; toast('Przywrócono zapisaną pracę'); };
  $('rsNo').onclick = () => { box.hidden = true; };
}
function roundParams(){
  const S = stroke(), p = state.p;
  return { end:p.end/100, out:p.out/100, in:p.in/100, rOut:p.kOut*S, rIn:p.kIn*S, tension:p.tension, tanMax:p.tanMax, absorb: p.absorb > 0, absorbMax: p.absorb/100*state.ref };
}
function refreshDetection(){
  // grubość kreski z przekrojów (pionowe kreski liter / wszystkie kształty SVG)
  if (!refreshDetection.strokeFor || refreshDetection.strokeFor !== state.loadId) {
    let items = [];
    if (state.mode === 'font') {
      const f = state.font;
      for (const ch of 'lIHnimu') { const g = f.charToGlyph(ch); if (g && g.unicode != null && g.path.commands.length) items.push({ cmds: g.path.commands, rule: 'nonzero', axes: 'h' }); }
    } else items = state.shapes.map(s => ({ cmds: s.cmds, rule: s.rule, axes: 'hv' }));
    state.strokeAuto = Math.max(1, Math.round(R.estimateStrokeScan(items, state.ref, state.ref * 0.08)));
    refreshDetection.strokeFor = state.loadId;
  }
  $('strokeAuto').textContent = state.strokeAuto + ' j.';
  detKey = [state.p.angleMin, state.p.endTol, state.p.endMax, state.p.merge, state.union ? 1 : 0].join('|');
}

/* ================= render ================= */
let raf = 0;
function schedule(){ if (!raf) raf = requestAnimationFrame(()=>{ raf=0; render(); }); }

function glyphItems(){
  const f = state.font, upm = f.unitsPerEm, items = [];
  const asc = f.ascender, desc = f.descender, lh = (asc - desc) * 1.12;
  // Najwyższy i najniższy punkt całego fontu — akcenty (Å, Ă, Ồ) sięgają ponad ascender,
  // a ogonki poniżej descendera. Bez zapasu górny rząd siatki i pierwsza linia tekstu są obcinane.
  const hd = f.tables.head || {};
  const yMax = isFinite(hd.yMax) ? hd.yMax : asc, yMin = isFinite(hd.yMin) ? hd.yMin : desc;
  if (state.view === 'text') {
    const lines = state.text.split('\n'); let y = asc, maxW = 0; const missing = new Set();
    for (const line of lines) {
      for (const ch of line) if (!/\s/.test(ch) && f.charToGlyphIndex(ch) === 0) missing.add(ch);
      const gs = f.stringToGlyphs(line); let x = 0;
      for (let i=0;i<gs.length;i++) {
        const g = gs[i];
        items.push({ g, x, y });
        let adv = g.advanceWidth || 0;
        if (i+1 < gs.length) { try { adv += f.getKerningValue(g, gs[i+1]) || 0; } catch(e){} }
        x += adv;
      }
      maxW = Math.max(maxW, x); y += lh;
    }
    const pT = Math.max(0, yMax - asc), pB = Math.max(0, desc - yMin);
    return { items, missing: [...missing], box: { x: 0, y: -pT, w: Math.max(maxW, upm*0.5), h: lh*(lines.length-1) + (asc - desc) + pT + pB } };
  }
  // siatka glifów
  const max = Math.min(f.glyphs.length, 800);
  // kolumny liczone od bazowej wielkości komórki: powiększenie nie przestawia siatki, tylko ją skaluje
  const cellPx = state.gzoom, avail = Math.max(300, $('sheet').parentElement.clientWidth - 128);
  const cols = Math.max(4, Math.floor(avail / GRID_BASE));   // stała liczba kolumn: powiększenie tylko skaluje
  const cell = upm * 1.25;
  for (let i=0;i<max;i++){
    const g = f.glyphs.get(i); const c = i % cols, r = Math.floor(i / cols);
    const x = c*cell + (cell - (g.advanceWidth||0))/2;
    const y = r*cell + (cell - (asc - desc))/2 + asc;
    items.push({ g, x, y });
  }
  // w komórce glif jest wyśrodkowany, więc część nadmiaru mieści się w jej zapasie
  const slack = (cell - (asc - desc)) / 2;
  const pT = Math.max(0, (yMax - asc) - slack), pB = Math.max(0, (desc - yMin) - slack);
  return { items, box: { x:0, y:-pT, w: cols*cell, h: Math.ceil(max/cols)*cell + pT + pB }, cellPx, cols, cell, truncated: f.glyphs.length > max };
}

/* ================= widok edycji glifu ================= */
function editGlyph(){ return state.font.glyphs.get(state.edit) }
// Szerokość, od której liczymy stały kadr. Nie bierzemy najszerszego glifu w foncie,
// bo jeden wyjątek (w ABC Areal 1500 j. przy literze A równej 718) rozpycha ramkę
// wszystkim pozostałym. 95. percentyl pomija takie wyskoki.
function widthRef(){
  const f = state.font;
  if (widthRef.forId === state.loadId) return widthRef.v;
  const w = [];
  for (let i = 0; i < f.glyphs.length; i++) { const a = f.glyphs.get(i).advanceWidth; if (a > 0) w.push(a); }
  w.sort((a, b) => a - b);
  widthRef.v = Math.max(f.unitsPerEm, w.length ? w[Math.floor(w.length * 0.95)] : f.unitsPerEm);
  widthRef.forId = state.loadId;
  return widthRef.v;
}
const PANGRAMS = ['Pchnąć w tę łódź jeża lub ośm skrzyń fig', 'Zażółć gęślą jaźń', 'Mężny bądź, chroń pułk twój i sześć flag', 'The quick brown fox jumps over the lazy dog', 'Hamburgefonstiv 0123456789'];
function sampleLines(g){
  const c = g.unicode != null ? String.fromCodePoint(g.unicode) : null;
  if (!c) return ['Hamburgefonstiv'];
  const up = c !== c.toLowerCase();
  let line = null;
  for (const p of PANGRAMS) { const t = up ? p.toUpperCase() : p; if (t.includes(c)) { line = t; break; } }
  const ctrl = /[0-9]/.test(c) ? `0${c}0 1${c}1 H${c}H` : up ? `H${c}H O${c}O ${c}${c}${c}` : `n${c}n o${c}o ${c}${c}${c}`;
  return line ? [line, ctrl] : [ctrl];
}
function layoutLine(f, text, y){
  const gs = f.stringToGlyphs(text), items = []; let x = 0;
  for (let i = 0; i < gs.length; i++) {
    items.push({ g: gs[i], x, y });
    let adv = gs[i].advanceWidth || 0;
    if (i + 1 < gs.length) { try { adv += f.getKerningValue(gs[i], gs[i + 1]) || 0; } catch(e){} }
    x += adv;
  }
  return { items, w: x };
}
// siatka w jednostkach fontu: gęstość dobierana do powiększenia, linie główne co 5 lub 10 kroków
function fontMetrics(){
  const f = state.font, os2 = f.tables.os2 || {};
  const bbY = (ch, top) => { const g = f.charToGlyph(ch); if (!g || !g.index) return null; const b = g.getBoundingBox(); return top ? b.y2 : b.y1; };
  const xh = os2.sxHeight > 0 ? os2.sxHeight : bbY('x', true);
  const cap = os2.sCapHeight > 0 ? os2.sCapHeight : bbY('H', true);
  return { asc: f.ascender, desc: f.descender, xh, cap };
}
function renderGrid(box, px, asc, bezPodpisow){
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const minor = steps.find(s => s * px >= 9) || 1000;
  const major = minor * 5 * px >= 45 ? minor * 5 : minor * 10;
  const x0 = box.x, x1 = box.x + box.w, fy0 = asc - (box.y + box.h), fy1 = asc - box.y;   // zakres w jednostkach fontu
  let minorD = '', majorD = '';
  for (let x = Math.ceil(x0 / minor) * minor; x <= x1; x += minor) (x % major === 0 ? (majorD += `M${x} ${box.y}V${box.y + box.h}`) : (minorD += `M${x} ${box.y}V${box.y + box.h}`));
  for (let y = Math.ceil(fy0 / minor) * minor; y <= fy1; y += minor) { const sy = asc - y; (y % major === 0 ? (majorD += `M${x0} ${sy}H${x1}`) : (minorD += `M${x0} ${sy}H${x1}`)); }
  let s = `<path class="grid-minor" d="${minorD}"/><path class="grid-major" d="${majorD}"/>`;
  // linie metryczne z podpisami (na panelu bazy podpisy pomijamy, żeby się nie dublowały)
  const M = fontMetrics(), fs = 11 / px;
  const lines = [['wys. wersalików', M.cap], ['x-height', M.xh], ['ascender', M.asc], ['descender', M.desc]];
  const seen = new Set();
  for (const [name, v] of lines) {
    if (v == null || !isFinite(v) || seen.has(Math.round(v))) continue; seen.add(Math.round(v));
    const sy = asc - v;
    s += `<line class="metric" x1="${x0}" x2="${x1}" y1="${sy}" y2="${sy}"/>`;
    if (bezPodpisow) continue;
    s += `<text class="metric-label" x="${(x0 + 4 / px).toFixed(2)}" y="${(sy - 4 / px).toFixed(2)}" font-size="${fs.toFixed(2)}">${name} ${Math.round(v)}</text>`;
  }
  s += `<line class="metric baseline" x1="${x0}" x2="${x1}" y1="${asc}" y2="${asc}"/>`;
  if (bezPodpisow) return `<g aria-hidden="true">${s}</g>`;
  s += `<text class="metric-label" x="${(x0 + 4 / px).toFixed(2)}" y="${(asc - 4 / px).toFixed(2)}" font-size="${fs.toFixed(2)}">linia bazowa 0</text>`;
  s += `<text class="metric-label" x="${(x1 - 4 / px).toFixed(2)}" y="${(box.y + box.h - 4 / px).toFixed(2)}" font-size="${fs.toFixed(2)}" text-anchor="end">siatka ${minor} j., linie główne co ${major} j.</text>`;
  return `<g aria-hidden="true">${s}</g>`;
}
// zwraca gotowy HTML widoku edycji
function renderEdit(rp, counts){
  const f = state.font, upm = f.unitsPerEm, asc = f.ascender, desc = f.descender, g = editGlyph();
  const H = asc - desc, adv = g.advanceWidth || upm * 0.5, key = 'g' + g.index;
  const st = document.querySelector('.stage');
  const contour = state.vmode === 'contour';
  // przykładowe zdanie (na dole)
  const lines = sampleLines(g), sPx = 54 / upm, lh = H * 1.05;
  let sPaths = '', sW = 0;
  lines.forEach((t, li) => {
    const L = layoutLine(f, t, asc + li * lh); sW = Math.max(sW, L.w);
    for (const it of L.items) {
      const gg = it.g, gc = glyphCmds(gg); if (!gc.length) continue;
      sPaths += `<path data-gi="${gg.index}"${gg.index === g.index ? ' class="hl"' : ''} d="${R.toPathData(roundShape('g' + gg.index, gc, 'nonzero', rp).cm, it.x, it.y, 1, true, 1)}"/>`;
    }
  });
  const sH = lh * (lines.length - 1) + H;
  // Pasek ze zdaniem rezerwuje miejsce zawsze na dwie linie, nawet gdy rysujemy jedną.
  // Inaczej dla znaków bez pangramu (np. „.”) na glif zostawało więcej miejsca
  // i ten sam font pokazywał się w innej skali przy różnych znakach.
  const sHres = lh + H;
  const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(sW * sPx).toFixed(0)}" height="${(sH * sPx).toFixed(0)}" viewBox="0 0 ${sW.toFixed(1)} ${sH.toFixed(1)}"><g class="glyph">${sPaths}</g></svg>`;
  const sampleH = Math.ceil(sHres * sPx + 30);   // bez belki z podpowiedzią pasek jest niższy
  // glif: wyśrodkowany i dopasowany do wolnego miejsca
  // Kadr ma STAŁY rozmiar dla całego fontu, żeby każdy glif był w tej samej skali
  // i przełączanie znaków niczym nie szarpało. Liczymy go z metryk całego fontu
  // (yMax/yMin, najszersza szerokość), więc obejmuje też akcenty w Ă, Å, Ồ i ogonki
  // poniżej descendera. Ruchomy jest tylko środek: kadr centrujemy na szerokości
  // bieżącego glifu, dzięki czemu glif zawsze stoi na środku.
  const hd = f.tables.head || {}, hh = f.tables.hhea || {};
  const yMax = isFinite(hd.yMax) ? hd.yMax : asc, yMin = isFinite(hd.yMin) ? hd.yMin : desc;
  const xMin = isFinite(hd.xMin) ? hd.xMin : 0, xMax = isFinite(hd.xMax) ? hd.xMax : upm;
  const advMax = isFinite(hh.advanceWidthMax) ? hh.advanceWidthMax : upm;
  const top = Math.max(asc, yMax), bot = Math.min(desc, yMin);
  const m = upm * 0.18;
  const gw = widthRef() + 2 * m, gh = (top - bot) + 1.4 * m;
  // Podgląd bazy obok edytowanego glifu. Obie połowy mają tę samą skalę i ten sam
  // kadr, a że baza i glif pochodny mają identyczne współrzędne, jedno zaznaczenie
  // podświetla się samo po obu stronach — nic nie trzeba dopasowywać.
  const baseIdx = state.base[state.edit];
  const bg = (baseIdx != null && baseIdx !== g.index && f.glyphs.get(baseIdx)) || null;
  const split = !!bg && !contour;              // w trybie Kontur edytujesz jeden glif, podział tylko myli
  const areaW = Math.max(200, st.clientWidth - 56), areaH = Math.max(160, st.clientHeight - 56 - sampleH);
  const paneW = split ? (areaW - 14) / 2 : areaW;
  const px = Math.min((paneW - 48) / gw, (areaH - 48) / gh) * state.ezoom / 100;
  const hitR = 13 / Math.max(px, 1e-6), mR = 5.5 / Math.max(px, 1e-6);
  // Pionowy zakres jest WSPÓLNY dla obu paneli — liczony z sumy obu glifów.
  // Inaczej każdy panel rozsuwałby kadr pod swój własny kształt i litery
  // stałyby na różnych wysokościach, czyli nie dałoby się ich porównać.
  const vExt = (() => {
    const fh0 = Math.max(gh, areaH / px);
    let T = ((asc - top) - m * 0.5) + gh / 2 - fh0 / 2, B = T + fh0;
    for (const gl of (split ? [bg, g] : [g])) {
      const c = glyphCmds(gl); if (!c.length) continue;
      const b = cmdsBox([c]); if (!isFinite(b.x)) continue;
      T = Math.min(T, (asc - (b.y + b.h)) - m * 0.5);
      B = Math.max(B, (asc - b.y) + m * 0.5);
    }
    return { y: T, h: B - T };
  })();

  const pane = (gl, isBase) => {
    const a = gl.advanceWidth || upm * 0.5, k = 'g' + gl.index, cmds = glyphCmds(gl);
    const gbox = { x: a / 2 - gw / 2, y: (asc - top) - m * 0.5, w: gw, h: gh };
    const fw = Math.max(gbox.w, paneW / px);
    const box = { x: gbox.x + gbox.w / 2 - fw / 2, y: vExt.y, w: fw, h: vExt.h };
    const cb = cmds.length ? cmdsBox([cmds]) : null;
    if (cb && isFinite(cb.x)) {   // w poziomie każdy panel może urosnąć pod swój glif
      const L = Math.min(box.x, cb.x - m * 0.5), R = Math.max(box.x + box.w, cb.x + cb.w + m * 0.5);
      box.x = L; box.w = R - L;
    }
    const vec = contour && !isBase;
    let paths = '', origs = '', marks = '', an = null, M = null;
    if (cmds.length) {
      const r = roundShape(k, cmds, 'nonzero', rp);
      an = vec ? null : r.an; M = r.M;
      paths += `<path${vec ? ' class="v-ghost"' : ''} d="${R.toPathData(r.cm, 0, asc, 1, true, 2)}"/>`;
      if (state.showO) origs += `<path d="${R.toPathData(gl.path.commands, 0, asc, 1, true, 2)}"/>`;
    }
    if (!state.showG) marks += `<line class="guide" x1="${box.x}" x2="${box.x + box.w}" y1="${asc}" y2="${asc}"/>`;
    marks += `<line class="guide" x1="0" x2="0" y1="${box.y}" y2="${box.y + box.h}"/><line class="guide" x1="${a}" x2="${a}" y1="${box.y}" y2="${box.y + box.h}"/>`;
    if (an) an.forEach((C, ci) => C.joints.forEach((J, k2) => {
      const c = C.corners[k2], v = J.v; if (!v) return;
      const cx = v.x.toFixed(2), cy = (asc - v.y).toFixed(2);
      const n = M && M.nodeAt[ci][k2];
      if (c && !isBase) { const t = effType(n, c); counts[t] = (counts[t] || 0) + 1; }
      if (!state.showC) return;
      if (c) {
        const t = effType(n, c);
        marks += `<circle class="m-${t}" cx="${cx}" cy="${cy}" r="${mR.toFixed(2)}"/>`;
        if (n || c.forced) marks += `<circle class="m-halo" cx="${cx}" cy="${cy}" r="${(mR*1.9).toFixed(2)}"/><circle class="m-ovr" cx="${cx}" cy="${cy}" r="${(mR*1.9).toFixed(2)}"/>`;
      } else if (!isBase) {
        marks += `<circle class="m-pt" cx="${cx}" cy="${cy}" r="${(mR*0.7).toFixed(2)}"/>`;
      }
      if (state.sel.some(q => near(q, v))) marks += `<circle class="m-halo" cx="${cx}" cy="${cy}" r="${(mR*2.6).toFixed(2)}"/><circle class="m-sel" cx="${cx}" cy="${cy}" r="${(mR*2.6).toFixed(2)}"/>`;
      marks += `<circle class="m-hit" data-node="${v.x.toFixed(2)},${v.y.toFixed(2)}" cx="${cx}" cy="${cy}" r="${hitR.toFixed(2)}"/>`;
    }));
    if (vec) marks += renderContourMarks(curCons(), asc, px);
    const gridSvg = state.showG ? renderGrid(box, px, asc, isBase) : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.floor(box.w * px)}" height="${Math.floor(box.h * px)}" viewBox="${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}" role="img" aria-label="${isBase ? 'Glif bazowy' : 'Edytowany glif'}">`
      + gridSvg + `<g class="glyph">${paths}</g>` + (state.showO ? `<g class="orig">${origs}</g>` : '') + `<g>${marks}</g></svg>`;
  };
  const etyk = (gl) => (gl.unicode != null ? String.fromCodePoint(gl.unicode) : (gl.name || '#' + gl.index));
  const glyphSvg = split
    ? `<div class="pane base"><span class="pane-lbl">Baza — ${etyk(bg)}</span><div class="pane-box">${pane(bg, true)}</div></div>`
      + `<div class="pane"><span class="pane-lbl">Edytujesz — ${etyk(g)}</span><div class="pane-box">${pane(g, false)}</div></div>`
    : pane(g, false);
  $('note').textContent = `${g.name || 'glif ' + g.index}, szerokość ${adv} j.`;
  return `<div class="edit-wrap"><div class="edit-main">${glyphSvg}</div><div class="edit-sample" style="height:${sampleH}px">${sampleSvg}</div></div>`;
}

function render(){
  if (state.booting) return;
  const sheet = $('sheet'); sheet.classList.remove('boot-screen');
  const rp = roundParams();
  const showC = state.showC, showO = state.showO;
  let paths = '', origs = '', marks = '', box, pxPerUnit;
  const counts = { end:0, out:0, in:0, off:0 };
  const markR = 4;
  // typ po korekcie, nie surowy wynik wykrywania — inaczej narożnik ustawiony ręcznie
  // na „ostry” dalej świeciłby kolorem i liczył się do statystyki
  const addMarks = (an, M, tx, ty, flip, r) => {
    an.forEach((C, ci) => C.corners.forEach((c, k) => {
      if (!c) return;
      const t = effType(M && M.nodeAt[ci][k], c);
      counts[t] = (counts[t] || 0) + 1;
      if (showC) marks += `<circle class="m-${t}" cx="${(tx + c.v.x).toFixed(1)}" cy="${(flip ? ty - c.v.y : ty + c.v.y).toFixed(1)}" r="${r.toFixed(2)}"/>`;
    }));
  };
  const editing = state.mode === 'font' && state.view === 'edit';
  sheet.classList.toggle('editing', editing); sheet.parentElement.classList.toggle('edit-mode', editing);
  if (editing) {
    const em0 = sheet.querySelector('.edit-main'), keep = em0 ? [em0.scrollLeft, em0.scrollTop] : null;
    sheet.innerHTML = renderEdit(rp, counts);
    const em1 = sheet.querySelector('.edit-main'); if (em1 && keep) { em1.scrollLeft = keep[0]; em1.scrollTop = keep[1]; }
    renderCount(counts); return;
  }
  if (state.mode === 'font') {
    const L = glyphItems(); box = L.box;
    pxPerUnit = state.view === 'text' ? state.size / state.font.unitsPerEm : L.cellPx / L.cell;
    const r = markR / pxPerUnit * (state.view === 'text' ? 1 : 0.8);
    const grid = state.view === 'glyphs';
    if (grid) L.items.forEach((it, i) => {
      const c = i % L.cols, rr = Math.floor(i / L.cols);
      marks += `<rect class="cell-hit" data-gi="${it.g.index}" x="${c*L.cell}" y="${rr*L.cell}" width="${L.cell}" height="${L.cell}"/>`;
      if (hasOvr('g'+it.g.index)) marks += `<circle class="badge" cx="${c*L.cell + L.cell*0.9}" cy="${rr*L.cell + L.cell*0.1}" r="${(4/pxPerUnit).toFixed(2)}"/>`;
    });
    for (const it of L.items) {
      const g = it.g, gc = glyphCmds(g); if (!gc.length) continue;
      const { an, M, cm } = roundShape('g'+g.index, gc, 'nonzero', rp);
      paths += `<path data-gi="${g.index}" d="${R.toPathData(cm, it.x, it.y, 1, true, 1)}"/>`;
      if (showO) origs += `<path d="${R.toPathData(g.path.commands, it.x, it.y, 1, true, 1)}"/>`;
      addMarks(an, M, it.x, it.y, true, r);
    }
    $('note').textContent = state.view === 'glyphs' ? (L.truncated ? `Pokazuję pierwsze 800 z ${state.font.glyphs.length} glifów` : `${state.font.glyphs.length} glifów`)
      : (L.missing && L.missing.length ? `Tych znaków nie ma w foncie: ${L.missing.join(' ')}` : (state.font.tables.fvar ? 'Font zmienny — pracuję na instancji domyślnej' : ''));
  } else {
    const b = state.box; const pad = Math.max(b.w, b.h) * 0.03;
    box = { x: b.x - pad, y: b.y - pad, w: b.w + 2*pad, h: b.h + 2*pad };
    const sheetEl = $('sheet'), stageEl = sheetEl.parentElement;
    const fitW = Math.max(200, stageEl.clientWidth - 128), fitH = Math.max(200, stageEl.clientHeight - 128);
    pxPerUnit = Math.min(fitW / box.w, fitH / box.h) * state.zoom / 100;
    const r = markR / pxPerUnit;
    state.shapes.forEach((s, i) => {
      const { an, M, cm } = roundShape('s'+i, s.cmds, s.rule, rp);
      const fill = s.fill ? ` style="fill:${s.fill}"` : '';
      paths += `<path${fill} fill-rule="${s.rule}" d="${R.toPathData(cm, 0, 0, 1, false, 2)}"/>`;
      if (showO) origs += `<path d="${R.toPathData(s.cmds, 0, 0, 1, false, 2)}"/>`;
      addMarks(an, M, 0, 0, false, r);
    });
    $('note').textContent = state.source === 'demo' ? 'Kształty demo — wgraj własny font lub SVG' : '';
  }
  const W = Math.max(1, box.w * pxPerUnit), H = Math.max(1, box.h * pxPerUnit);
  sheet.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}" role="img" aria-label="Podgląd zaokrąglonych kształtów">`
    + `<g class="glyph">${paths}</g>` + (showO ? `<g class="orig">${origs}</g>` : '') + `<g>${marks}</g>` + `</svg>`;
  renderCount(counts);
}
function renderCount(counts){
  const nO = Object.keys(state.ovr).filter(hasOvr).length;
  $('count').innerHTML = `Wykryte narożniki: <b class="c-end">${counts.end}</b> zakończeń, <b class="c-out">${counts.out}</b> zewnętrznych, <b class="c-in">${counts.in}</b> wewnętrznych`
    + (counts.off ? `, <b>${counts.off}</b> ostrych` : '') + (nO ? `. Korekty w ${nO} ${nO === 1 ? 'glifie' : 'glifach'}` : '');
}

/* ================= wejście: pliki ================= */
function setMsg(t, err){ const m=$('msg'); m.textContent=t||''; m.className='msg'+(err?' err':''); }
function loadDemo(){
  const { shapes } = parseSvg(DEMO);
  useShapes(shapes, 'demo', 'kształty demo');
}
function useShapes(shapes, source, name){
  state.mode='svg'; state.source=source; state.shapes=shapes; state.font=null; state.view='text'; state.srcTables=null;
  if (source === 'demo') state.hash = '';
  state.ovr = {}; state.sel = []; hist.undo.length = 0; hist.redo.length = 0;
  state.box = cmdsBox(shapes.map(s=>s.cmds)); state.ref = Math.sqrt(Math.max(1,state.box.w)*Math.max(1,state.box.h));
  state.loadId = (state.loadId||0)+1; cache.clear(); refreshDetection(); syncUI();
  $('fileInfo').innerHTML = `Teraz: <b></b>`; $('fileInfo').querySelector('b').textContent = name;
  schedule();
}
function useFont(font, name, boot){
  state.mode='font'; state.source = boot ? 'boot' : 'font'; state.font=font; state.fontFile=name; state.shapes=[];
  state.ovr = {}; state.base = {}; state.sel = []; hist.undo.length = 0; hist.redo.length = 0; state.edit = firstGlyph();
  if (state.view === 'edit') state.view = 'text';
  state.ref = font.unitsPerEm; state.loadId = (state.loadId||0)+1; cache.clear(); refreshDetection(); syncUI();
  const fam = (font.names.fontFamily && (font.names.fontFamily.en || Object.values(font.names.fontFamily)[0])) || name.replace(/\.\w+$/,'');
  $('famName').value = fam + ' Rounded';
  const info = $('fileInfo'); info.innerHTML = 'Teraz: <b></b> <span></span>';
  info.querySelector('b').textContent = fam; info.querySelector('span').textContent = `— ${font.glyphs.length} glifów` + (font.tables.fvar ? ', font zmienny (instancja domyślna)' : '');
  schedule();
}
async function handleFile(file){
  if (!$('lic').checked) { setMsg('Zaznacz najpierw potwierdzenie licencji.', true); return; }
  setMsg('');
  const name = file.name || 'plik'; const ext = (name.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'svg' || file.type === 'image/svg+xml') {
      const txt = await file.text();
      const { shapes, notes } = parseSvg(txt);
      state.hash = 'svg-' + hashBytes(new TextEncoder().encode(txt));
      useShapes(shapes, 'svg', name); state.svgName = name.replace(/\.svg$/i,'');
      offerRestore();
      if (notes.length) setMsg('Uwaga: ' + notes.join('; ') + '.');
    } else if (['ttf','otf','woff'].includes(ext)) {
      if (!window.opentype) throw new Error('Nie udało się wczytać biblioteki do fontów (vendor/opentype.min.js). Odśwież stronę.');
      const buf = await file.arrayBuffer();
      const font = opentype.parse(buf);
      state.srcTables = (() => { try { return RounderVF.readTables(new Uint8Array(buf)); } catch(e) { return null; } })();
      state.hash = 'font-' + hashBytes(new Uint8Array(buf));
      useFont(font, name);
      offerRestore();
    } else if (ext === 'woff2') {
      throw new Error('WOFF2 nie jest jeszcze obsługiwany. Wgraj wersję TTF lub OTF.');
    } else throw new Error('Obsługiwane pliki: TTF, OTF, WOFF i SVG.');
  } catch (e) {
    const m = String(e && e.message || e);
    setMsg(/signature|wOF2/i.test(m) ? 'Nie rozpoznaję formatu fontu. Wgraj TTF, OTF lub WOFF.' : m, true);
  }
}

/* ================= eksport ================= */
async function saveFile(filename, blob){
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Pobrano ' + filename);
}
function paramsNote(){
  const p = state.p;
  return `Zakończenia ${p.end}, zewnętrzne ${p.out}, wewnętrzne ${p.in}; promień zewn. ${p.kOut}× i wewn. ${p.kIn}× kreski (${stroke()} j.); rozlanie ${p.tanMax}; napięcie ${p.tension}; próg ${p.angleMin}°; scalanie bliskich punktów ${p.merge}% em; wtapianie kikutów ${p.absorb}% em; łączenie konturów ${state.union ? 'tak' : 'nie'}; tolerancja zakończeń ${p.endTol}°; maks. zakończenie ${p.endMax}% em.`;
}
function exportSvg(){
  const rp = roundParams(); let body = '', box;
  if (state.mode === 'font' && state.view === 'edit') {
    const g = editGlyph(), f = state.font;
    box = { x: 0, y: 0, w: g.advanceWidth || f.unitsPerEm * 0.5, h: f.ascender - f.descender };
    if (glyphCmds(g).length) body += `<path d="${R.toPathData(roundShape('g'+g.index, glyphCmds(g), 'nonzero', rp).cm, 0, f.ascender, 1, true, 2)}"/>\n`;
  } else if (state.mode === 'font') {
    const L = glyphItems(); box = L.box;
    for (const it of L.items) { const g = it.g; if (!glyphCmds(g).length) continue;
      body += `<path d="${R.toPathData(roundShape('g'+g.index, glyphCmds(g),'nonzero', rp).cm, it.x, it.y, 1, true, 2)}"/>\n`; }
  } else {
    box = state.box;
    state.shapes.forEach((s,i)=>{ body += `<path fill="${s.fill||'#000'}" fill-rule="${s.rule}" d="${R.toPathData(roundShape('s'+i,s.cmds,s.rule, rp).cm,0,0,1,false,3)}"/>\n`; });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">\n<!-- Type Type: ${paramsNote().replace(/--/g,'–')} -->\n${body}</svg>\n`;
  const base = state.mode === 'font' ? (slug($('famName').value || 'font') || 'font') : (state.source === 'demo' ? 'demo' : state.svgName || 'ksztalty');
  saveFile(base + '-rounded.svg', new Blob([svg], { type: 'image/svg+xml' }));
}
// prosty ZIP (bez kompresji)
const CRC = (() => { const t = new Uint32Array(256); for (let n=0;n<256;n++){ let c=n; for (let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
function crc32(u8){ let c=0xFFFFFFFF; for (let i=0;i<u8.length;i++) c = CRC[(c^u8[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function makeZip(files){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), time = (d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1), date = ((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x0800,true); h.setUint16(8,0,true);
    h.setUint16(10,time,true); h.setUint16(12,date,true); h.setUint32(14,crc,true); h.setUint32(18,data.length,true); h.setUint32(22,data.length,true);
    h.setUint16(26,name.length,true); h.setUint16(28,0,true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x0800,true); c.setUint16(10,0,true);
    c.setUint16(12,time,true); c.setUint16(14,date,true); c.setUint32(16,crc,true); c.setUint32(20,data.length,true); c.setUint32(24,data.length,true);
    c.setUint16(28,name.length,true); c.setUint32(42,off,true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s,a)=>s+a.length,0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,cdSize,true); e.setUint32(16,off,true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
async function exportFont(){
  const btn = $('expFont'); if (!state.font) return;
  if (state.source === 'boot') { setMsg('Domyślnego fontu nie da się stąd pobrać. Wgraj własny plik.', true); return; }
  const src = state.font, rp = roundParams(), upm = src.unitsPerEm;
  const family = ($('famName').value || 'Rounded').trim();
  btn.disabled = true; const label = btn.textContent;
  try {
    const glyphs = [];
    for (let i=0;i<src.glyphs.length;i++){
      const g = src.glyphs.get(i);
      const path = new opentype.Path();
      if (glyphCmds(g).length) {
        const cm = roundShape('g'+g.index, glyphCmds(g), 'nonzero', rp).cm;
        path.commands = cm.map(c => { const o = { type: c.type }; for (const k of ['x','y','x1','y1','x2','y2']) if (c[k] != null) o[k] = Math.round(c[k]) /* liczby całkowite — zapis CFF nie kumuluje wtedy błędu */; return o; });
      }
      glyphs.push(new opentype.Glyph({ name: g.name || ('glyph'+i), unicode: g.unicode, unicodes: g.unicodes || (g.unicode!=null?[g.unicode]:[]), advanceWidth: g.advanceWidth || 0, path }));
      if (i % 60 === 59) { btn.textContent = `Zaokrąglam ${i+1}/${src.glyphs.length}…`; await new Promise(r=>setTimeout(r,0)); }
    }
    const nm = (k) => src.names[k] && (src.names[k].en || Object.values(src.names[k])[0]) || undefined;
    const os2 = src.tables.os2 || {};
    const out = new opentype.Font({
      familyName: family, styleName: nm('fontSubfamily') || 'Regular', unitsPerEm: upm,
      postScriptName: (slug(family).replace(/-/g,'') || 'Rounded') + '-' + (slug(nm('fontSubfamily') || 'Regular').replace(/-/g,'') || 'Regular'),
      ascender: src.ascender, descender: src.descender, glyphs,
      copyright: nm('copyright'), trademark: nm('trademark'), designer: nm('designer'), designerURL: nm('designerURL'),
      manufacturer: nm('manufacturer'), manufacturerURL: nm('manufacturerURL'), license: nm('license'), licenseURL: nm('licenseURL'),
      version: nm('version'), description: `Zmodyfikowano w Type Type na bazie: ${nm('fullName') || state.fontFile}.`,
      weightClass: os2.usWeightClass, widthClass: os2.usWidthClass, fsSelection: os2.fsSelection
    });
    let bin = new Uint8Array(out.toArrayBuffer());
    const layout = RounderVF.layoutTables(state.srcTables, !!src.tables.fvar);
    if (state.srcTables && state.srcTables.cmap) layout.cmap = state.srcTables.cmap;  // numeracja glifów zachowana
    if (Object.keys(layout).length) { try { bin = RounderVF.injectTables(bin, layout); } catch(e) {} }
    const fname = slug(family) || 'Rounded';
    const readme = `${family}\n\nŹródło: ${nm('fullName') || state.fontFile}\nUstawienia: ${paramsNote()}\n\nKopia notki licencyjnej oryginału:\n${nm('copyright') || '—'}\n${nm('license') || ''}\n\nPamiętaj: prawo do modyfikacji i dystrybucji wynika z licencji oryginalnego fontu.\n`;
    await saveFile(fname + '.zip', makeZip([{ name: fname + '.otf', data: bin }, { name: 'README.txt', data: new TextEncoder().encode(readme) }]));
  } catch (e) {
    setMsg('Eksport fontu się nie udał: ' + (e && e.message || e), true);
  } finally { btn.disabled = false; btn.textContent = label; }
}

function slug(s){
  return String(s).replace(/[łŁ]/g, c => c === 'ł' ? 'l' : 'L').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Za-z0-9\- ]+/g,'').trim().replace(/\s+/g,'-');
}
async function exportVF(){
  const btn = $('expVF'); if (!state.font) return;
  if (state.source === 'boot') { setMsg('Domyślnego fontu nie da się stąd pobrać. Wgraj własny plik.', true); return; }
  const src = state.font, upm = src.unitsPerEm, S = stroke(), p = state.p;
  const family = ($('famName').value || 'Rounded').trim();
  const ps = slug(family).replace(/-/g,'') || 'Rounded';
  btn.disabled = true; const label = btn.textContent;
  try {
    const glyphs = [];
    for (let i=0;i<src.glyphs.length;i++){
      const g = src.glyphs.get(i);
      const key = 'g' + g.index;
      const an = glyphCmds(g).length ? getAnalysis(key, glyphCmds(g), 'nonzero') : null;
      const withOvr = an && hasOvr(key);
      glyphs.push({ advance: g.advanceWidth || 0,
        master: (m) => {
          if (!an) return null;
          const base = { rOut:p.kOut*S, rIn:p.kIn*S, tension:p.tension, tanMax:p.tanMax, absorb: p.absorb > 0, absorbMax: p.absorb/100*state.ref };
          // korekty liczone dla wartości osi tego mistrza, nie dla suwaków z interfejsu
          const axis = { end: m[0], out: m[1], in: m[2] };
          const M = withOvr ? matchOvr(key, an, (t) => t === 'off' ? 0 : (axis[t] || 0)) : null;
          return R.round(an, Object.assign({}, base, axis), state.ref, true, Object.assign({ end:1, out:1, in:1 }, base), M && M.res);
        } });
    }
    const nm = (k) => src.names[k] && (src.names[k].en || Object.values(src.names[k])[0]) || undefined;
    let fallback = {};
    if (!state.srcTables) {
      // WOFF: cmap/OS2/post bierzemy z pomocniczego pliku zbudowanego przez opentype.js
      const gl = []; for (let i=0;i<src.glyphs.length;i++){ const g=src.glyphs.get(i); gl.push(new opentype.Glyph({ name:g.name||('glyph'+i), unicode:g.unicode, unicodes:g.unicodes||[], advanceWidth:g.advanceWidth||0, path:new opentype.Path() })); }
      const tmp = RounderVF.readTables(new Uint8Array(new opentype.Font({ familyName: family, styleName:'Regular', unitsPerEm: upm, ascender: src.ascender, descender: src.descender, glyphs: gl }).toArrayBuffer()));
      fallback = { cmapFallback: tmp.cmap, os2Fallback: tmp['OS/2'], postFallback: tmp.post };
    }
    const inst = [['Sharp',[0,0,0]],['Ends',[100,0,0]],['Outer',[0,100,0]],['Inner',[0,0,100]],['Ends Outer',[100,100,0]],['Ends Inner',[100,0,100]],['Outer Inner',[0,100,100]],['Round',[100,100,100]]];
    const cur = [p.end, p.out, p.in];
    if (!inst.some(x => x[1].every((v,i) => v === cur[i]))) inst.push(['Custom', cur]);
    const res = await RounderVF.buildVariableFont(Object.assign({
      glyphs, upm, ascender: src.ascender, descender: src.descender,
      axes: [{ tag:'RNDE', name:'Rounded Ends' }, { tag:'RNDO', name:'Rounded Outer' }, { tag:'RNDI', name:'Rounded Inner' }],
      instances: inst.map(x => ({ name: x[0], coords: x[1] })),
      names: { 0: nm('copyright'), 1: family, 2: 'Regular', 3: `${ps};TypeType`, 4: family, 5: 'Version 1.000', 6: ps + '-Regular',
        7: nm('trademark'), 8: nm('manufacturer'), 9: nm('designer'),
        10: `Zmodyfikowano w Type Type na bazie: ${nm('fullName') || state.fontFile}. ${paramsNote()}`,
        11: nm('manufacturerURL'), 12: nm('designerURL'), 13: nm('license'), 14: nm('licenseURL'), 25: ps },
      srcTables: state.srcTables, srcIsVariable: !!src.tables.fvar,
      onProgress: async (n, t) => { btn.textContent = `Buduję mistrzów ${n}/${t}…`; await new Promise(r => setTimeout(r, 0)); }
    }, fallback));
    await saveFile((slug(family) || 'Rounded') + '-VF.ttf', new Blob([res.bytes], { type: 'font/ttf' }));
    if (res.warn) setMsg(`${res.warn} glif(ów) nie dało się zinterpolować — zostały bez zmienności.`);
  } catch (e) {
    setMsg('Eksport fontu zmiennego się nie udał: ' + (e && e.message || e), true);
  } finally { btn.disabled = false; btn.textContent = label; }
}

/* ================= panel korekt ================= */
function firstGlyph(){
  const f = state.font; const i = f.charToGlyphIndex('A');
  if (i > 0) return i;
  for (let k = 1; k < f.glyphs.length; k++) { const g = f.glyphs.get(k); if (g.path && g.path.commands.length) return k; }
  return 0;
}
function editInfo(){
  const g = editGlyph(), key = 'g' + g.index, joints = [];
  if (!glyphCmds(g).length) return { key, joints, M: null };
  const an = getAnalysis(key, glyphCmds(g), 'nonzero'), M = matchOvr(key, an);
  an.forEach((C, ci) => C.joints.forEach((J, k) => { if (J.v) joints.push({ ci, k, v: J.v, c: C.corners[k], n: M && M.nodeAt[ci][k] }); }));
  return { key, joints, M };
}
function selectNode(v, add){
  if (add) { const i = state.sel.findIndex(q => near(q, v)); if (i >= 0) state.sel.splice(i, 1); else state.sel.push(v); }
  else state.sel = [v];
  updatePanel(); schedule();
}
function enterEdit(i){
  state.edit = i; state.view = 'edit'; state.sel = []; state.vsel = [];
  syncUI(); updatePanel(); render();
  const st = document.querySelector('.stage'); st.scrollLeft = 0; st.scrollTop = 0;
}
function setEdit(i){ state.edit = i; state.sel = []; state.vsel = []; syncUI(); updatePanel(); schedule(); }
function stepGlyph(d){
  const f = state.font, N = f.glyphs.length; let i = state.edit;
  for (let n = 0; n < N; n++) { i = (i + d + N) % N; const g = f.glyphs.get(i); if (g.path && g.path.commands.length) break; }
  setEdit(i);
}
function entry(key){ return state.ovr[key] || (state.ovr[key] = { scale: 100, nodes: [], force: [] }); }
const isDefaultNode = (n) => Object.keys(NODE_DEF).every(k => n[k] === NODE_DEF[k]);
function selectedJoints(info){ return info.joints.filter(j => state.sel.some(q => near(q, j.v))); }
function setNodes(fn){
  const info = editInfo(), sel = selectedJoints(info).filter(j => j.c); if (!sel.length) return;
  checkpoint();
  const E = entry(info.key);
  for (const j of sel) {
    let n = E.nodes.find(q => near(q, j.v));
    if (!n) { n = Object.assign({ x: +j.v.x.toFixed(2), y: +j.v.y.toFixed(2) }, NODE_DEF); E.nodes.push(n); }
    fn(n, j);
  }
  E.nodes = E.nodes.filter(n => !isDefaultNode(n));
  cleanOvr(info.key); updatePanel(); schedule(); autosave();
}
function pressSeg(id, v, disabled){
  $(id).querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.v === v); if (disabled) b.disabled = !!disabled(b.dataset.v); });
}
function glyphLabel(g){ return g.unicode != null ? String.fromCodePoint(g.unicode) : (g.name || '#' + g.index); }
function updatePanel(){
  const P = $('nodePanel'), on = state.mode === 'font' && state.view === 'edit';
  P.hidden = !on; if (!on) return;
  const g = editGlyph(), info = editInfo(), E = state.ovr[info.key];
  const contour = state.vmode === 'contour';
  $('vPanel').hidden = !contour; $('cPanel').hidden = false;
  if (contour) {
    const nodes = state.vsel.filter(s => s.part === 'node');
    $('vHint').textContent = !state.vsel.length
      ? 'Edytujesz kontur źródłowy, przed zaokrągleniem. Kliknij węzeł na glifie; dwuklik na linii dodaje nowy.'
      : `Zaznaczone: ${nodes.length ? nodes.length + (nodes.length === 1 ? ' węzeł' : ' węzły') : ''}${nodes.length && state.vsel.length > nodes.length ? ' i ' : ''}${state.vsel.length > nodes.length ? (state.vsel.length - nodes.length) + ' uchwyt' : ''}.`;
    $('vBtns').hidden = !nodes.length;
    $('vCoords').hidden = nodes.length !== 1;
    if (nodes.length === 1) {
      const n = curCons()[nodes[0].ci]?.nodes[nodes[0].ni];
      if (n) { if (document.activeElement !== $('vX')) $('vX').value = Math.round(n.x); if (document.activeElement !== $('vY')) $('vY').value = Math.round(n.y); }
    }
    $('vReset').hidden = !(E && E.path);
  }
  $('npTitle').textContent = `Glif ${g.unicode != null ? '„' + String.fromCodePoint(g.unicode) + '”' : (g.name || '')}`;
  const gs = E && E.scale != null ? E.scale : 100;
  $('s-gscale').value = gs; $('n-gscale').value = gs; paint($('s-gscale'));
  const sel = selectedJoints(info), corners = sel.filter(j => j.c), points = sel.filter(j => !j.c);
  $('npHint').textContent = !sel.length
    ? (contour
       ? 'Zaznacz węzeł na konturze, żeby ustawić jego zaokrąglenie.'
       : 'Nic nie zaznaczono. Puste kółka na glifie to punkty, których algorytm nie uznał za narożniki — po kliknięciu możesz je wymusić. Strzałki przeskakują między narożnikami.')
    : `Zaznaczone: ${corners.length ? corners.length + ' ' + (corners.length === 1 ? 'narożnik' : 'narożniki') : ''}${corners.length && points.length ? ' i ' : ''}${points.length ? points.length + ' ' + (points.length === 1 ? 'punkt bez narożnika' : 'punkty bez narożnika') : ''}.`;
  $('npCtrls').hidden = !corners.length;
  if (corners.length) {
    const n = corners[0].n || NODE_DEF, c = corners[0].c;
    pressSeg('npType', n.type, v => v === 'end' && !corners.every(j => j.c.endLen > 0));
    pressSeg('npMode', n.mode);
    pressSeg('npAbsorb', n.absorb);
    const off = corners.every(j => effType(j.n || NODE_DEF, j.c) === 'off');
    $('s-namt').value = n.amt; $('n-namt').value = n.amt; paint($('s-namt'));
    $('s-namt').disabled = $('n-namt').disabled = off;
    $('npMode').querySelectorAll('button').forEach(b => b.disabled = off);
    $('npAmtLabel').textContent = n.mode === 'abs' ? 'Wartość (skala suwaka, niezależna)' : '% suwaka globalnego';
  }
  const forcedSel = corners.filter(j => j.c.forced);
  const fb = $('npForce');
  if (points.length) { fb.hidden = false; fb.textContent = 'Wymuś narożnik'; fb.dataset.act = 'add'; }
  else if (forcedSel.length) { fb.hidden = false; fb.textContent = 'Usuń wymuszenie'; fb.dataset.act = 'remove'; }
  else fb.hidden = true;
  $('npReset').hidden = !sel.some(j => j.n || (j.c && j.c.forced));
  const orph = info.M ? info.M.orphans : [];
  const ob = $('npOrphans');
  if (orph.length) {
    ob.className = 'msg err';
    ob.innerHTML = `<span></span> <button class="linkbtn" id="npOrph">Usuń je</button>`;
    ob.querySelector('span').textContent = `${orph.length} ${orph.length === 1 ? 'korekta nie trafia' : 'korekt nie trafia'} w żaden narożnik — prawdopodobnie zmieniły się progi wykrywania.`;
    $('npOrph').onclick = () => { checkpoint(); const Ee = state.ovr[info.key]; Ee.nodes = Ee.nodes.filter(n => !orph.includes(n)); cleanOvr(info.key); updatePanel(); schedule(); autosave(); };
  } else { ob.textContent = ''; ob.className = 'msg'; }
  renderBase();
  const keys = Object.keys(state.ovr).filter(k => k[0] === 'g' && hasOvr(k));
  $('npListWrap').hidden = !keys.length;
  $('npList').innerHTML = '';
  for (const k of keys) {
    const gg = state.font.glyphs.get(+k.slice(1)); if (!gg) continue;
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = glyphLabel(gg); b.title = gg.name || '';
    b.setAttribute('aria-current', +k.slice(1) === state.edit); b.onclick = () => setEdit(+k.slice(1));
    $('npList').appendChild(b);
  }
}
function cycleNode(d){
  const info = editInfo(), cs = info.joints.filter(j => j.c); if (!cs.length) return;
  let i = state.sel.length ? cs.findIndex(j => near(j.v, state.sel[0])) : -1;
  i = (i + d + cs.length) % cs.length; if (i < 0) i = 0;
  state.sel = [cs[i].v]; updatePanel(); schedule();
}

/* ================= baza glifu (źródło korekt do przeniesienia) ================= */
const TYPE_PL = { end: 'zakończenie', out: 'zewnętrzny', in: 'wewnętrzny', off: 'ostry' };
// litera bazowa z rozkładu Unicode: Ă → A, ó → o. Nie zadziała dla Ł czy ø — tam wybierasz ręcznie.
function suggestBase(g){
  if (g.unicode == null) return null;
  const ch = String.fromCodePoint(g.unicode), d = ch.normalize('NFD');
  if (d.length < 2 || d === ch) return null;
  const i = state.font.charToGlyphIndex(d[0]);
  return i > 0 && i !== g.index ? { i, ch: d[0] } : null;
}
// narożniki glifu bazowego wraz z ewentualną ręczną korektą przy każdym z nich
function baseData(){
  const bi = state.base[state.edit];
  if (bi == null) return null;
  const f = state.font, bg = f.glyphs.get(bi);
  if (!bg) return null;
  const key = 'g' + bi, cmds = glyphCmds(bg);
  const E = state.ovr[key] || {};
  const res = { bg, key, rows: [], scale: E.scale == null ? 100 : E.scale, forced: (E.force || []).length, orphans: 0 };
  if (!cmds.length) return res;
  const an = getAnalysis(key, cmds, 'nonzero'), M = matchOvr(key, an);
  if (M) res.orphans = M.orphans.length;
  an.forEach((C, ci) => C.corners.forEach((c, k) => {
    if (!c) return;
    const n = M && M.nodeAt[ci][k];
    res.rows.push({ v: c.v, n: n || null, t: effType(n, c), forced: !!c.forced });
  }));
  return res;
}
// narożnik bazy leżący w tym samym miejscu co podany punkt
function baseAt(v){
  const D = baseData(); if (!D) return null;
  return D.rows.find((r) => near(r.v, v)) || null;
}
const amtLabel = (n) => (n.mode === 'abs' ? 'zamrożona ' + n.amt : n.amt + '% suwaka');
function renderBase(){
  const on = state.mode === 'font' && state.view === 'edit';
  $('baseWrap').hidden = !on;
  if (!on) return;
  const g = editGlyph(), bi = state.base[state.edit];
  const sug = suggestBase(g);
  const sb = $('baseSuggest');
  if (sug && bi == null) { sb.hidden = false; sb.textContent = 'Użyj „' + sug.ch + '”'; sb.dataset.i = sug.i; }
  else sb.hidden = true;
  if (document.activeElement !== $('baseChar')) {
    const bg0 = bi != null && state.font.glyphs.get(bi);
    $('baseChar').value = bg0 && bg0.unicode != null ? String.fromCodePoint(bg0.unicode) : '';
  }
  $('baseClear').hidden = bi == null;
  const msg = $('baseMsg'), box = $('baseNodeWrap');
  const D = baseData();
  if (bi == null || !D) {
    msg.textContent = bi == null ? '' : 'Nie znalazłem takiego glifu.';
    msg.className = bi == null ? 'msg' : 'msg err';
    box.hidden = true; return;
  }
  const nazwa = D.bg.unicode != null ? '„' + String.fromCodePoint(D.bg.unicode) + '”' : (D.bg.name || '#' + D.bg.index);
  msg.className = 'msg';
  // kontekstowo: pokazujemy wyłącznie to, co baza ma w miejscu zaznaczonego węzła
  const sel = state.sel;
  if (sel.length !== 1) {
    msg.textContent = 'Baza: glif ' + nazwa + '. Zaznacz węzeł, żeby zobaczyć, co baza ma w tym miejscu.';
    box.hidden = true; return;
  }
  const r = baseAt(sel[0]);
  const row = $('baseNode'), btn = $('baseApply');
  if (!r) {
    msg.textContent = 'Baza: glif ' + nazwa + '. W tym miejscu baza nie ma narożnika.';
    box.hidden = true; return;
  }
  msg.textContent = 'Baza: glif ' + nazwa + '.';
  row.className = 'base-row m-' + r.t;
  row.innerHTML = '<span class="dot"></span>';
  const pos = document.createElement('span'); pos.className = 'pos';
  pos.textContent = Math.round(r.v.x) + ', ' + Math.round(r.v.y);
  const typ = document.createElement('span'); typ.textContent = TYPE_PL[r.t] || r.t;
  const val = document.createElement('span'); val.className = 'val';
  val.textContent = r.n ? (r.t === 'off' ? 'ostry' : amtLabel(r.n)) : 'bez korekty (wykryty automatem)';
  row.append(pos, typ, val);
  btn.disabled = !r.n;
  btn.title = r.n ? '' : 'Baza nie ma tu ręcznej korekty — nie ma czego przenosić';
  box.hidden = false;
}
function setBase(i){
  if (i == null) delete state.base[state.edit]; else state.base[state.edit] = i;
  renderBase(); schedule(); autosave();
}

/* ================= edytor konturu ================= */
// kontur glifu jako lista węzłów: { x, y, in, out } (uchwyty krzywych 3. stopnia albo null)
function toNodes(cmds){
  const cons = []; let cur = null;
  const P = (x, y) => ({ x, y });
  for (const c of cmds) {
    if (c.type === 'M') { cur = { nodes: [{ x: c.x, y: c.y, in: null, out: null }] }; cons.push(cur); }
    else if (!cur) continue;
    else if (c.type === 'L') cur.nodes.push({ x: c.x, y: c.y, in: null, out: null });
    else if (c.type === 'Q') {
      const p = cur.nodes[cur.nodes.length - 1];
      p.out = P(p.x + (c.x1 - p.x) * 2 / 3, p.y + (c.y1 - p.y) * 2 / 3);
      cur.nodes.push({ x: c.x, y: c.y, in: P(c.x + (c.x1 - c.x) * 2 / 3, c.y + (c.y1 - c.y) * 2 / 3), out: null });
    } else if (c.type === 'C') {
      cur.nodes[cur.nodes.length - 1].out = P(c.x1, c.y1);
      cur.nodes.push({ x: c.x, y: c.y, in: P(c.x2, c.y2), out: null });
    }
  }
  const same = (p, q) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  for (const C of cons) {
    const N = C.nodes;
    // domknięcie: ostatni węzeł w miejscu pierwszego
    if (N.length > 1 && same(N[N.length - 1], N[0])) { const l = N.pop(); if (l.in) N[0].in = l.in; }
    // uchwyty w miejscu węzła = brak uchwytu
    for (const n of N) { if (n.in && same(n.in, n)) n.in = null; if (n.out && same(n.out, n)) n.out = null; }
    // podwójne węzły (zdegenerowane odcinki) scalamy
    for (let i = N.length - 1; i > 0 && N.length > 2; i--) if (same(N[i], N[i - 1])) { const q = N.splice(i, 1)[0]; N[i - 1].out = q.out || N[i - 1].out; }
    if (N.length > 2 && same(N[N.length - 1], N[0])) { const l = N.pop(); N[0].in = l.in || N[0].in; }
  }
  return cons.filter(C => C.nodes.length >= 2);
}
function fromNodes(cons){
  // dwa miejsca po przecinku: edycja nie przesuwa konturu źródeł CFF, a zapis .otf
  // i tak zaokrągla do liczb całkowitych tuż przed opentype.Path (patrz exportFont)
  const r = (v) => Math.round(v * 100) / 100, out = [];
  for (const C of cons) {
    const N = C.nodes; if (N.length < 2) continue;
    out.push({ type: 'M', x: r(N[0].x), y: r(N[0].y) });
    for (let i = 0; i < N.length; i++) {
      const a = N[i], b = N[(i + 1) % N.length];
      if (a.out || b.in) { const c1 = a.out || a, c2 = b.in || b; out.push({ type: 'C', x1: r(c1.x), y1: r(c1.y), x2: r(c2.x), y2: r(c2.y), x: r(b.x), y: r(b.y) }); }
      else out.push({ type: 'L', x: r(b.x), y: r(b.y) });
    }
    out.push({ type: 'Z' });
  }
  return out;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
function hashStr(s){ let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function isSmooth(n){
  if (!n.in || !n.out) return false;
  const ax = n.x - n.in.x, ay = n.y - n.in.y, bx = n.out.x - n.x, by = n.out.y - n.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by); if (la < 0.5 || lb < 0.5) return false;
  return (ax * bx + ay * by) / (la * lb) > Math.cos(3 * Math.PI / 180);
}
function curCons(){ return toNodes(glyphCmds(editGlyph())); }
function writeCons(cons){
  const key = 'g' + state.edit, E = entry(key);
  E.path = fromNodes(cons); E.pk = hashStr(JSON.stringify(E.path));
}
function syncSelFromVsel(){
  const cons = curCons();
  state.sel = state.vsel.filter((s) => s.part === 'node')
    .map((s) => cons[s.ci] && cons[s.ci].nodes[s.ni])
    .filter(Boolean).map((n) => ({ x: n.x, y: n.y }));
}
const vkey = (s) => s.ci + ',' + s.ni + ',' + s.part;
const vSelected = (ci, ni, part) => state.vsel.some(s => s.ci === ci && s.ni === ni && s.part === part);
// korekty narożników leżące w miejscu przesuwanych węzłów jadą razem z nimi
function collectCorr(cons){
  const E = state.ovr['g' + state.edit]; if (!E) return [];
  const pts = state.vsel.filter(s => s.part === 'node').map(s => cons[s.ci] && cons[s.ci].nodes[s.ni]).filter(Boolean);
  const list = [];
  for (const arr of [E.nodes || [], E.force || []]) for (const q of arr) if (pts.some(p => near(q, p))) list.push({ q, x: q.x, y: q.y });
  return list;
}
function applyMove(cons, base, dx, dy, alt){
  const nodeSel = new Set(state.vsel.filter(s => s.part === 'node').map(s => s.ci + ',' + s.ni));
  for (const s of state.vsel) {
    const C = cons[s.ci], B = base[s.ci]; if (!C || !C.nodes[s.ni]) continue;
    const n = C.nodes[s.ni], n0 = B.nodes[s.ni];
    if (s.part === 'node') {
      n.x = n0.x + dx; n.y = n0.y + dy;
      if (n0.in) n.in = { x: n0.in.x + dx, y: n0.in.y + dy };
      if (n0.out) n.out = { x: n0.out.x + dx, y: n0.out.y + dy };
    } else if (!nodeSel.has(s.ci + ',' + s.ni) && n0[s.part]) {
      n[s.part] = { x: n0[s.part].x + dx, y: n0[s.part].y + dy };
      const other = s.part === 'in' ? 'out' : 'in';
      // węzeł gładki: przeciwny uchwyt zostaje w linii (Alt rozrywa)
      if (!alt && isSmooth(n0) && n0[other]) {
        const len = Math.hypot(n0[other].x - n0.x, n0[other].y - n0.y);
        const vx = n.x - n[s.part].x, vy = n.y - n[s.part].y, l = Math.hypot(vx, vy) || 1;
        n[other] = { x: n.x + vx / l * len, y: n.y + vy / l * len };
      }
    }
  }
}
let vdrag = null;
// Shift przy przeciąganiu: trzymaj ruch w poziomie, w pionie albo dokładnie pod 45°.
// Próg to tan(67,5°) — granica między „bliżej osi” a „bliżej przekątnej”.
function constrain45(dx, dy){
  const ax = Math.abs(dx), ay = Math.abs(dy), T = 2.4142;
  if (ax > ay * T) return [dx, 0];
  if (ay > ax * T) return [0, dy];
  const m = Math.round((ax + ay) / 2);
  return [Math.sign(dx) * m, Math.sign(dy) * m];
}
function toFont(e){
  const svg = document.querySelector('.edit-main svg'); if (!svg) return null;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: state.font.ascender - p.y };
}
function vectorDown(e, key){
  const [ci, ni, part] = key.split(','); const s = { ci: +ci, ni: +ni, part };
  if (e.shiftKey) { const i = state.vsel.findIndex(q => vkey(q) === key); if (i >= 0) state.vsel.splice(i, 1); else state.vsel.push(s); }
  else if (!state.vsel.some(q => vkey(q) === key)) state.vsel = [s];
  const cons = curCons();
  vdrag = { id: e.pointerId, start: toFont(e), base: clone(cons), moved: false, corr: collectCorr(cons) };
  try { document.querySelector('.stage').setPointerCapture(e.pointerId); } catch (err) {}
  syncSelFromVsel(); updatePanel(); schedule();
}
function vectorMove(e){
  if (!vdrag || e.pointerId !== vdrag.id) return false;
  const p = toFont(e); if (!p || !vdrag.start) return true;
  let dx = Math.round(p.x - vdrag.start.x), dy = Math.round(p.y - vdrag.start.y);
  if (e.shiftKey) [dx, dy] = constrain45(dx, dy);
  if (!vdrag.moved) { if (Math.abs(dx) + Math.abs(dy) < 1) return true; hist.t = 0; checkpoint(); vdrag.moved = true; }
  const cons = clone(vdrag.base); applyMove(cons, vdrag.base, dx, dy, e.altKey); writeCons(cons);
  for (const c of vdrag.corr) { c.q.x = c.x + dx; c.q.y = c.y + dy; }
  schedule(); return true;
}
function vectorUp(e){
  if (!vdrag || e.pointerId !== vdrag.id) return false;
  const moved = vdrag.moved; vdrag = null;
  if (moved) { syncSelFromVsel(); autosave(); updatePanel(); }
  return true;
}
function vectorNudge(dx, dy){
  const cons = curCons(); if (!state.vsel.length) return;
  hist.t = Date.now() - 1000; checkpoint();
  const base = clone(cons), corr = collectCorr(cons);
  applyMove(cons, base, dx, dy, false); writeCons(cons);
  for (const c of corr) { c.q.x += dx; c.q.y += dy; }
  syncSelFromVsel(); updatePanel(); schedule(); autosave();
}
function vectorDelete(){
  const cons = curCons(), del = state.vsel.filter(s => s.part === 'node'); if (!del.length) return;
  checkpoint(); hist.t = 0;
  const E = state.ovr['g' + state.edit];
  for (const s of del) { const n = cons[s.ci] && cons[s.ci].nodes[s.ni]; if (n && E) { E.nodes = (E.nodes || []).filter(q => !near(q, n)); E.force = (E.force || []).filter(q => !near(q, n)); } }
  const byC = {}; for (const s of del) (byC[s.ci] = byC[s.ci] || []).push(s.ni);
  for (const ci in byC) byC[ci].sort((x, y) => y - x).forEach(ni => cons[ci].nodes.splice(ni, 1));
  writeCons(cons.filter(C => C.nodes.length >= 2));
  state.vsel = []; state.sel = []; updatePanel(); schedule(); autosave();
}
function vectorInsert(ci, si, pt){
  const cons = curCons(), C = cons[ci]; if (!C) return;
  const N = C.nodes, a = N[si], b = N[(si + 1) % N.length];
  const p0 = a, p1 = a.out || a, p2 = b.in || b, p3 = b;
  const B = (t) => { const u = 1 - t; return { x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x, y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y }; };
  let bt = 0.5, bd = Infinity;
  for (let i = 1; i < 200; i++) { const t = i / 200, q = B(t), d = Math.hypot(q.x - pt.x, q.y - pt.y); if (d < bd) { bd = d; bt = t; } }
  checkpoint(); hist.t = 0;
  const L = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  let nn;
  if (!a.out && !b.in) nn = Object.assign(L(a, b, bt), { in: null, out: null });
  else {
    const q1 = L(p0, p1, bt), q2 = L(p1, p2, bt), q3 = L(p2, p3, bt), r1 = L(q1, q2, bt), r2 = L(q2, q3, bt), s = L(r1, r2, bt);
    a.out = q1; b.in = q3; nn = { x: s.x, y: s.y, in: r1, out: r2 };
  }
  N.splice(si + 1, 0, nn); writeCons(cons);
  state.vsel = [{ ci, ni: si + 1, part: 'node' }]; syncSelFromVsel(); updatePanel(); schedule(); autosave();
}
function vectorSmooth(make){
  const cons = curCons(), sel = state.vsel.filter(s => s.part === 'node'); if (!sel.length) return;
  checkpoint(); hist.t = 0;
  for (const s of sel) {
    const N = cons[s.ci].nodes, n = N[s.ni], p = N[(s.ni - 1 + N.length) % N.length], q = N[(s.ni + 1) % N.length];
    if (!make) { n.in = null; n.out = null; continue; }
    let dx = q.x - p.x, dy = q.y - p.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const li = n.in ? Math.hypot(n.in.x - n.x, n.in.y - n.y) : Math.hypot(n.x - p.x, n.y - p.y) / 3;
    const lo = n.out ? Math.hypot(n.out.x - n.x, n.out.y - n.y) : Math.hypot(q.x - n.x, q.y - n.y) / 3;
    n.in = { x: n.x - dx * li, y: n.y - dy * li }; n.out = { x: n.x + dx * lo, y: n.y + dy * lo };
  }
  writeCons(cons); updatePanel(); schedule(); autosave();
}
function vectorSetXY(axis, v){
  const sel = state.vsel.filter(s => s.part === 'node'); if (sel.length !== 1 || !isFinite(v)) return;
  const cons = curCons(), n = cons[sel[0].ci].nodes[sel[0].ni];
  const d = Math.round(v) - Math.round(n[axis]); if (!d) return;
  vectorNudge(axis === 'x' ? d : 0, axis === 'y' ? d : 0);
}
function renderContourMarks(cons, asc, px){
  let s = '';
  const r = 4.5 / px, hr = 3.6 / px, hit = 10 / px;
  const segD = (a, b) => (a.out || b.in)
    ? `M${a.x} ${asc - a.y}C${(a.out || a).x} ${asc - (a.out || a).y} ${(b.in || b).x} ${asc - (b.in || b).y} ${b.x} ${asc - b.y}`
    : `M${a.x} ${asc - a.y}L${b.x} ${asc - b.y}`;
  let outline = '';
  cons.forEach((C, ci) => C.nodes.forEach((a, i) => {
    const b = C.nodes[(i + 1) % C.nodes.length]; const d = segD(a, b);
    outline += d; s += `<path class="v-seg" data-vs="${ci},${i}" d="${d}"/>`;
  }));
  s = `<path class="v-outline" d="${outline}"/>` + s;
  cons.forEach((C, ci) => C.nodes.forEach((n, ni) => {
    const nodeOn = vSelected(ci, ni, 'node');
    const showH = nodeOn || vSelected(ci, ni, 'in') || vSelected(ci, ni, 'out');
    if (showH) for (const part of ['in', 'out']) if (n[part]) {
      const h = n[part];
      s += `<line class="v-hline" x1="${n.x}" y1="${asc - n.y}" x2="${h.x}" y2="${asc - h.y}"/>`;
      s += `<circle class="v-handle${vSelected(ci, ni, part) ? ' on' : ''}" cx="${h.x}" cy="${asc - h.y}" r="${hr.toFixed(2)}"/>`;
      s += `<circle class="v-hit" data-vp="${ci},${ni},${part}" cx="${h.x}" cy="${asc - h.y}" r="${hit.toFixed(2)}"/>`;
    }
    const cls = `v-node${nodeOn ? ' on' : ''}`;
    s += isSmooth(n) ? `<circle class="${cls}" cx="${n.x}" cy="${asc - n.y}" r="${r.toFixed(2)}"/>`
                     : `<rect class="${cls}" x="${(n.x - r).toFixed(2)}" y="${(asc - n.y - r).toFixed(2)}" width="${(2*r).toFixed(2)}" height="${(2*r).toFixed(2)}"/>`;
    s += `<circle class="v-hit" data-vp="${ci},${ni},node" cx="${n.x}" cy="${asc - n.y}" r="${hit.toFixed(2)}"/>`;
  }));
  return s;
}

/* ================= UI ================= */
function toast(t){ const el=$('toast'); el.textContent=t; el.classList.add('on'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('on'), 2400); }
const SL = ['end','out','in','kOut','kIn','tanMax','tension','angleMin','endTol','endMax','merge','absorb'];
const DET = new Set(['angleMin','endTol','endMax','merge']);
function paint(el){ const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }
function syncUI(){
  for (const k of SL) { const s=$('s-'+k), n=$('n-'+k); s.value=state.p[k]; n.value=state.p[k]; paint(s); }
  const sz = $('size');
  const z = zoomCfg(); sz.min = z.min; sz.max = z.max; sz.step = z.step; sz.value = z.get(); sz.setAttribute('aria-label', z.label);
  $('text').value = state.text;
  $('fontExport').hidden = state.mode !== 'font';
  // ABC Areal służy tylko za materiał do pracy — nie pozwalamy go stąd wynieść jako font
  const locked = state.source === 'boot';
  $('expLocked').hidden = !locked; $('expNote').hidden = locked;
  $('expFont').disabled = locked; $('expVF').disabled = locked;
  $('famName').disabled = locked;
  $('text').style.display = state.mode === 'font' && state.view === 'text' ? '' : 'none';
  $('viewSeg').style.display = state.mode === 'font' ? '' : 'none';
  $('viewSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === state.view));
  $('editBar').hidden = !(state.mode === 'font' && state.view === 'edit');
  $('vmodeSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === state.vmode));
  $('showGWrap').hidden = !(state.mode === 'font' && state.view === 'edit');
  if (state.mode === 'font' && state.view === 'edit') {
    const g = editGlyph();
    if (document.activeElement !== $('gChar')) $('gChar').value = g.unicode != null ? String.fromCodePoint(g.unicode) : '';
    $('gName').textContent = g.name || ('glif ' + g.index);
  }
  fitText();
}
function setParam(k, v, fromNum){
  const s = $('s-'+k); v = Math.min(+s.max, Math.max(+s.min, +v)); if (!isFinite(v)) return;
  if (state.p[k] !== v) checkpoint();
  state.p[k] = v; s.value = v; paint(s); if (!fromNum) $('n-'+k).value = v;
  if (DET.has(k)) refreshDetection();
  schedule(); updatePanel(); autosave();
}
for (const k of SL) {
  $('s-'+k).addEventListener('input', e => setParam(k, e.target.value));
  $('n-'+k).addEventListener('input', e => { if (e.target.value !== '') setParam(k, e.target.value, true); });
  $('n-'+k).addEventListener('change', e => { $('n-'+k).value = state.p[k]; });
}
$('reset').addEventListener('click', () => { for (const k of ['end','out','in']) setParam(k, 0); });
$('union').addEventListener('change', e => { state.union = e.target.checked; refreshDetection(); schedule(); updatePanel(); autosave(); });
$('strokeOv').addEventListener('input', e => {
  const v = parseFloat(e.target.value), nv = v > 0 ? v : null;
  if (state.strokeOv !== nv) checkpoint();
  state.strokeOv = nv; refreshDetection(); schedule(); autosave();
});
function zoomCfg(){
  if (state.mode === 'font' && state.view === 'edit') return { min: 50, max: 2000, step: 5, get: () => state.ezoom, set: v => state.ezoom = v, label: 'Powiększenie glifu w procentach, 100 = dopasowany' };
  if (state.mode === 'font' && state.view === 'glyphs') return { min: 30, max: 900, step: 2, get: () => state.gzoom, set: v => state.gzoom = v, label: 'Wielkość komórki glifu w pikselach' };
  if (state.mode === 'font') return { min: 40, max: 1600, step: 2, get: () => state.size, set: v => state.size = v, label: 'Rozmiar stopnia w pikselach' };
  return { min: 20, max: 1500, step: 5, get: () => state.zoom, set: v => state.zoom = v, label: 'Powiększenie w procentach' };
}
// powiększenie z zachowaniem punktu pod kursorem (cx, cy względem obszaru podglądu)
function scroller(){ return (state.mode === 'font' && state.view === 'edit' && document.querySelector('.edit-main')) || document.querySelector('.stage'); }
// Przybliżanie idzie zawsze przez suwak Skala: szczypanie na gładziku, Ctrl + kółko,
// klawisze +/− i sam suwak robią dokładnie to samo. Dzięki temu suwak zawsze pokazuje
// aktualny stan, a gest nie walczy z własnym kotwiczeniem na kursorze.
let zq = null, zoomF = null, zoomFKey = '';
// Powiększenie trzymamy dodatkowo jako liczbę ułamkową. Bez tego drobne ruchy gładzika
// (ułamek procenta na zdarzenie) ginęły przy zaokrąglaniu do kroku suwaka i gest
// nie robił nic, dopóki nie szarpnęło się mocno — najgorzej przy małych wartościach skali.
const curZoom = () => {
  const k = state.mode + '|' + state.view;
  if (zoomF == null || zoomFKey !== k) { zoomF = zoomCfg().get(); zoomFKey = k; }
  return zoomF;
};
const zoomStep = () => +$('size').step || 1;
function zoomTo(v){
  const z = zoomCfg();
  curZoom();                                 // dociągnij akumulator do bieżącego widoku
  zoomF = Math.max(z.min, Math.min(z.max, v));
  // Do stanu idzie wartość CIĄGŁA. Zaokrąglanie do kroku suwaka dotyczy wyłącznie tego,
  // co suwak pokazuje — inaczej gest na gładziku mógłby zmieniać powiększenie tylko
  // skokami co 5% (tyle ma krok w edycji glifu) i wychodziło to szarpane.
  $('size').value = Math.round(zoomF / zoomStep()) * zoomStep();
  if (zq) { zq.v = zoomF; return; }
  if (Math.abs(zoomF - z.get()) < 1e-3) return;
  const sc = scroller();
  zq = { v: zoomF, old: z.get(), sl: sc.scrollLeft, stp: sc.scrollTop };
  requestAnimationFrame(applyZoom);
}
function applyZoom(){
  const q = zq; zq = null; if (!q) return;
  const z = zoomCfg(), sc0 = scroller();
  const cx = sc0.clientWidth / 2, cy = sc0.clientHeight / 2, r = q.v / q.old;
  z.set(q.v); $('size').value = Math.round(q.v / zoomStep()) * zoomStep(); render();
  // środek widoku zostaje na swoim miejscu; gdy zawartość mieści się w oknie,
  // przewijanie i tak jest zerowe i wyśrodkowuje ją margin:auto
  const sc = scroller();
  sc.scrollLeft = Math.max(0, (q.sl + cx) * r - cx);
  sc.scrollTop = Math.max(0, (q.stp + cy) * r - cy);
}
$('size').addEventListener('input', e => zoomTo(+e.target.value));
(() => {
  const st = document.querySelector('.stage');
  let drag = null;
  // --- dwa palce: szczypanie przybliża, przesuwanie dwoma palcami przewija ---
  // Działa w każdym widoku, także w edycji glifu, gdzie jeden palec celowo nic nie robi.
  const touches = new Map();
  let pinch = null;
  const pinchState = () => {
    const p = [...touches.values()];
    return { mid: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 },
             dist: Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)) };
  };
  const startPinch = () => {
    drag = null; vdrag = null;                 // dwa palce mają pierwszeństwo nad przeciąganiem
    st.classList.remove('dragging');
    pinch = pinchState();
  };
  const movePinch = () => {
    const now = pinchState(), sc = scroller();
    sc.scrollLeft -= now.mid.x - pinch.mid.x;  // przesuwanie dwoma palcami
    sc.scrollTop -= now.mid.y - pinch.mid.y;
    zoomTo(curZoom() * now.dist / pinch.dist);
    pinch = pinchState();                      // odczyt po zmianie powiększenia
  };
  st.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) { startPinch(); return; }
      if (touches.size > 2) return;
    }
    if (e.button !== 0 || e.target.closest('input,textarea,button,select,a')) return;
    const vp = e.target.closest('[data-vp]');
    if (vp && !state.spacePan) { vectorDown(e, vp.dataset.vp); return; }
    if (state.mode === 'font' && state.view === 'edit' && state.vmode === 'contour' && !state.spacePan) {
      if (!e.shiftKey && !e.target.closest('[data-vs]') && state.vsel.length) { state.vsel = []; state.sel = []; updatePanel(); schedule(); }
      return;
    }
    const hit = e.target.closest('[data-node]');
    if (hit) { const [x, y] = hit.dataset.node.split(',').map(Number); selectNode({ x, y }, e.shiftKey); return; }
    // klik obok narożnika odznacza — bez tego zaznaczenie wisiało aż do Escape
    if (state.mode === 'font' && state.view === 'edit' && state.vmode === 'corners'
        && !state.spacePan && !e.shiftKey && state.sel.length) { state.sel = []; updatePanel(); schedule(); }
    let el = st;
    if (state.mode === 'font' && state.view === 'edit') {             // w edycji przesuwanie tylko ze spacją
      if (!state.spacePan) return;
      el = document.querySelector('.edit-main'); if (!el) return;
    }
    drag = { el, x: e.clientX, y: e.clientY, sl: el.scrollLeft, stp: el.scrollTop, id: e.pointerId, on: false };
  });
  st.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size >= 2) { e.preventDefault(); movePinch(); return; }
    }
    if (pinch) return;
    if (vectorMove(e)) return;
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    // przechwycenie dopiero po ruchu — zwykły klik i dwuklik trafiają w glif
    if (!drag.on) { if (Math.hypot(dx, dy) < 4) return; drag.on = true; st.setPointerCapture(e.pointerId); st.classList.add('dragging'); }
    drag.el.scrollLeft = drag.sl - dx; drag.el.scrollTop = drag.stp - dy;
  });
  const end = e => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (touches.size < 2 && pinch) { pinch = null; st.dataset.dragged = '1'; setTimeout(() => { delete st.dataset.dragged; }, 0); return; }
    }
    if (vectorUp(e)) return;
    if (drag && e.pointerId === drag.id) {
      // po przeciągnięciu kliknięcie nie otwiera glifu
      if (drag.on) { st.dataset.dragged = '1'; setTimeout(() => { delete st.dataset.dragged; }, 0); }
      drag = null; st.classList.remove('dragging');
    }
  };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  // Ctrl/Cmd + kółko albo szczypanie na gładziku = powiększenie wokół kursora
  st.addEventListener('wheel', e => {
    const sc = scroller();
    if (!(e.ctrlKey || e.metaKey)) {
      // przesuwanie dwoma palcami po gładziku: w edycji glifu przewijamy pole rysunku,
      // bo scena ma wtedy overflow:hidden i sama by się nie przewinęła
      if (sc !== st && !e.target.closest('.edit-sample')) {
        e.preventDefault(); sc.scrollLeft += e.deltaX; sc.scrollTop += e.deltaY;
      }
      return;
    }
    e.preventDefault();
    // Gładzik sypie drobnymi wartościami, mysz jedną dużą na ząbek — przycinamy,
    // żeby jedno kliknięcie kółka nie przeskakiwało przez pół zakresu.
    const d = Math.max(-25, Math.min(25, e.deltaY));
    zoomTo(curZoom() * Math.exp(-d * 0.007));
  }, { passive: false });
})();
function fitText(){ const t = $('text'); t.style.height = 'auto'; t.style.height = Math.min(120, Math.max(36, t.scrollHeight)) + 'px'; }
$('text').addEventListener('input', e => { state.text = e.target.value; fitText(); schedule(); autosave(); });
$('showC').addEventListener('change', e => {
  state.showC = e.target.checked;
  if (!state.showC) state.sel = [];          // nie zostawiamy zaznaczenia, którego nie widać
  updatePanel(); schedule();
});
$('showG').addEventListener('change', e => { state.showG = e.target.checked; schedule(); });
$('showO').addEventListener('change', e => { state.showO = e.target.checked; schedule(); });
$('viewSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.v === 'edit' && state.view !== 'edit' && !glyphCmds(editGlyph()).length) state.edit = firstGlyph();
  state.view = b.dataset.v; state.sel = []; syncUI(); updatePanel(); schedule(); });
window.addEventListener('resize', () => { if (state.view === 'glyphs' || state.view === 'edit' || state.mode === 'svg') schedule(); });

const drop = $('drop'), lic = $('lic');
function setLic(){
  const on = lic.checked; drop.classList.toggle('ready', on); drop.classList.toggle('locked', !on); drop.setAttribute('aria-disabled', !on);
  $('dropHint').textContent = on ? 'Przeciągnij tutaj albo kliknij. TTF, OTF, WOFF, SVG.' : 'Najpierw zaznacz potwierdzenie licencji.';
}
lic.addEventListener('change', setLic);
drop.addEventListener('click', () => { if (lic.checked) $('file').click(); else { setMsg('Zaznacz najpierw potwierdzenie licencji.', true); lic.focus(); } });
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop.click(); } });
$('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });
['dragenter','dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); if (lic.checked) drop.classList.add('over'); }));
['dragleave','drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
$('expSvg').addEventListener('click', exportSvg);
$('expFont').addEventListener('click', exportFont);
$('expVF').addEventListener('click', exportVF);

// panel korekt
$('npType').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; setNodes(n => { n.type = b.dataset.v; }); });
$('npAbsorb').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; setNodes(n => { n.absorb = b.dataset.v; }); });
$('npMode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const sc = ((state.ovr['g' + state.edit] || {}).scale ?? 100) / 100;
  setNodes((n, j) => {
    if (n.mode === b.dataset.v) return;
    const base = globalVal(effType(n, j.c)) * sc;   // przeliczenie tak, żeby kształt się nie zmienił
    if (b.dataset.v === 'abs') n.amt = Math.round(Math.min(200, base * n.amt));
    else n.amt = base > 0 ? Math.round(Math.min(200, n.amt / base)) : 100;
    n.mode = b.dataset.v;
  });
});
const setAmt = (v) => { v = Math.max(0, Math.min(200, +v)); if (!isFinite(v)) return; setNodes(n => { n.amt = v; }); };
$('s-namt').addEventListener('input', e => setAmt(e.target.value));
$('n-namt').addEventListener('input', e => { if (e.target.value !== '') setAmt(e.target.value); });
const setGScale = (v) => {
  v = Math.max(0, Math.min(200, +v)); if (!isFinite(v)) return;
  const key = 'g' + state.edit; checkpoint(); entry(key).scale = v; cleanOvr(key); updatePanel(); schedule(); autosave();
};
$('s-gscale').addEventListener('input', e => setGScale(e.target.value));
$('n-gscale').addEventListener('input', e => { if (e.target.value !== '') setGScale(e.target.value); });
$('npForce').addEventListener('click', () => {
  const info = editInfo(), sel = selectedJoints(info); checkpoint(); const E = entry(info.key);
  if ($('npForce').dataset.act === 'add') {
    for (const j of sel.filter(j => !j.c)) if (!E.force.some(q => near(q, j.v))) E.force.push({ x: +j.v.x.toFixed(2), y: +j.v.y.toFixed(2) });
  } else E.force = E.force.filter(q => !sel.some(j => near(q, j.v)));
  cleanOvr(info.key); updatePanel(); render(); autosave();
  if ($('npForce').dataset.act === 'add' && selectedJoints(editInfo()).some(j => !j.c)) toast('Ten punkt jest gładki — nie ma tu załamania do zaokrąglenia');
});
$('npReset').addEventListener('click', () => {
  const info = editInfo(), E = state.ovr[info.key]; if (!E) return; checkpoint();
  E.nodes = E.nodes.filter(n => !state.sel.some(q => near(q, n)));
  E.force = (E.force || []).filter(q => !state.sel.some(s => near(q, s)));
  cleanOvr(info.key); updatePanel(); schedule(); autosave();
});
$('npResetGlyph').addEventListener('click', () => { const key = 'g' + state.edit; if (!state.ovr[key]) return; checkpoint(); delete state.ovr[key]; updatePanel(); schedule(); autosave(); });
$('vmodeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.dataset.v === state.vmode) return; state.vmode = b.dataset.v; state.vsel = []; state.sel = []; syncUI(); updatePanel(); schedule(); });
$('vSmooth').addEventListener('click', () => vectorSmooth(true));
$('vSharp').addEventListener('click', () => vectorSmooth(false));
$('vDel').addEventListener('click', vectorDelete);
$('vReset').addEventListener('click', () => { const key = 'g' + state.edit, E = state.ovr[key]; if (!E || !E.path) return; checkpoint(); hist.t = 0; delete E.path; delete E.pk; cleanOvr(key); state.vsel = []; updatePanel(); schedule(); autosave(); });
$('vX').addEventListener('change', e => vectorSetXY('x', +e.target.value));
$('vY').addEventListener('change', e => vectorSetXY('y', +e.target.value));
$('baseChar').addEventListener('input', e => {
  const ch = [...e.target.value].pop();
  if (!ch) { setBase(null); return; }
  const i = state.font.charToGlyphIndex(ch);
  if (i > 0) { e.target.value = ch; setBase(i); } else toast('Tego znaku nie ma w foncie');
});
$('baseSuggest').addEventListener('click', e => setBase(+e.currentTarget.dataset.i));
$('baseApply').addEventListener('click', () => {
  if (state.sel.length !== 1) return;
  const r = baseAt(state.sel[0]);
  if (!r || !r.n) return;
  // przenosimy same wartości; położenie węzła docelowego zostaje nietknięte
  setNodes((n) => { n.type = r.n.type; n.mode = r.n.mode; n.amt = r.n.amt; n.absorb = r.n.absorb; });
  toast('Przeniesiono wartości z bazy');
});
$('baseClear').addEventListener('click', () => setBase(null));
$('gPrev').addEventListener('click', () => stepGlyph(-1));
$('gNext').addEventListener('click', () => stepGlyph(1));
$('gChar').addEventListener('input', e => {
  const ch = [...e.target.value].pop(); if (!ch) return;
  const i = state.font.charToGlyphIndex(ch);
  if (i > 0) { e.target.value = ch; setEdit(i); } else toast('Tego znaku nie ma w foncie');
});
$('sheet').addEventListener('dblclick', e => {
  if (!(state.mode === 'font' && state.view === 'edit' && state.vmode === 'contour')) return;
  const t = e.target.closest('[data-vs]'); if (!t) return;
  const [ci, si] = t.dataset.vs.split(',').map(Number), p = toFont(e); if (p) vectorInsert(ci, si, p);
});
$('sheet').addEventListener('click', e => {
  if (document.querySelector('.stage').dataset.dragged) return;
  const sg = e.target.closest('.edit-sample [data-gi]');
  if (sg && state.mode === 'font' && state.view === 'edit') { const i = +sg.dataset.gi; if (i !== state.edit) setEdit(i); return; }
  const t = e.target.closest('[data-gi]'); if (t && state.mode === 'font' && state.view !== 'edit') enterEdit(+t.dataset.gi);
});
document.addEventListener('keyup', e => { if (e.key === ' ') { state.spacePan = false; document.querySelector('.stage').classList.remove('space'); } });
window.addEventListener('blur', () => { state.spacePan = false; document.querySelector('.stage').classList.remove('space'); });
document.addEventListener('keydown', e => {
  const el = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !['range', 'checkbox'].includes(el.type);
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y' && !typing) { e.preventDefault(); redo(); return; }
  if (state.mode !== 'font' || state.view !== 'edit' || typing) return;
  if (e.key === ' ' && !e.repeat) { e.preventDefault(); state.spacePan = true; document.querySelector('.stage').classList.add('space'); return; }
  if (e.key === ' ') { e.preventDefault(); return; }
  if (!mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomTo(curZoom() * 1.25); return; }
  if (!mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomTo(curZoom() / 1.25); return; }
  if (!mod && e.key === '0') { e.preventDefault(); zoomTo(100); return; }
  if (state.vmode === 'contour') {
    const step = e.shiftKey ? 10 : 1;
    const dirs = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (dirs[e.key] && state.vsel.length) { e.preventDefault(); vectorNudge(...dirs[e.key]); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.vsel.length) { e.preventDefault(); vectorDelete(); return; }
    if (e.key === 'Escape') { state.vsel = []; state.sel = []; updatePanel(); schedule(); return; }
  }
  if (e.key === 'Escape') { state.sel = []; updatePanel(); schedule(); }
  // strzałki lewo/prawo przeskakują narożniki; Tab zostaje wolny, żeby dało się wyjść klawiaturą
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); cycleNode(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); cycleNode(-1); }
});
// ustawienia JSON
$('expJson').addEventListener('click', () => {
  const base = state.mode === 'font' ? (slug($('famName').value || 'font') || 'font') : (state.source === 'demo' ? 'demo' : slug(state.svgName || 'ksztalty'));
  saveFile(base + '-ustawienia.json', new Blob([JSON.stringify(settingsObj(), null, 2)], { type: 'application/json' }));
});
$('impJson').addEventListener('click', () => $('jsonFile').click());
$('jsonFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    if (!o || typeof o !== 'object' || !o.p) throw new Error('To nie jest plik ustawień Type Type.');
    applySettings(o, true); toast('Wczytano ustawienia');
  } catch (err) { setMsg('Nie udało się wczytać ustawień: ' + (err.message || err), true); }
});
$('famName').addEventListener('input', autosave);

/* Domyślny podgląd: ABC Areal z katalogu fonts/ (pliki licencjonowane, nie ma ich w repozytorium).
   Gdy fontu nie ma — np. na opublikowanej stronie — wracamy do kształtów demo. */
const BOOT_FONT = 'fonts/ABCAreal-Bold.ttf';
async function loadBootFont(){
  if (!window.opentype) return false;
  try {
    const res = await fetch(BOOT_FONT, { cache: 'force-cache' });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    const font = opentype.parse(buf);
    state.srcTables = (() => { try { return RounderVF.readTables(new Uint8Array(buf)); } catch(e) { return null; } })();
    state.hash = 'font-' + hashBytes(new Uint8Array(buf));
    useFont(font, 'ABCAreal-Bold.ttf', true);   // render nic nie rysuje, dopóki state.booting
    return true;
  } catch (e) { return false; }
}
const BOOT_LINES = ['Wczytywanie', 'glifów…'];
const BOOT_MS = 3000;        // ekran startowy trwa co najmniej tyle
const MORPH_MS = 1150;       // z czego tyle zajmuje zaokrąglanie napisu
function bootMsg(){
  const sh = $('sheet');
  sh.classList.add('boot-screen');           // plansza na całą szerokość, inaczej napis się nie mieści
  sh.innerHTML = `<div class="boot"><span>${BOOT_LINES[0]}</span><span>${BOOT_LINES[1]}</span></div>`;
}
// Napis startowy rysowany konturami wczytanego fontu i przepuszczony przez ten sam
// silnik, co cała aplikacja — g to wartość wszystkich trzech suwaków naraz (0..1).
function bootFrame(g){
  const f = state.font, asc = f.ascender, H = asc - f.descender, lh = H * 0.92, p = state.p;
  const rp = { end: g, out: g, in: g, rOut: p.kOut * state.strokeAuto, rIn: p.kIn * state.strokeAuto,
               tension: p.tension, tanMax: p.tanMax, absorb: p.absorb > 0, absorbMax: p.absorb / 100 * state.ref };
  const lines = BOOT_LINES.map((t) => (t === 'glifów…' && !f.charToGlyphIndex('…') ? 'glifów...' : t));
  let d = '', w = 0;
  lines.forEach((t, i) => {
    const L = layoutLine(f, t, asc + i * lh);
    w = Math.max(w, L.w);
    for (const it of L.items) {
      const gc = glyphCmds(it.g); if (!gc.length) continue;
      d += `<path d="${R.toPathData(roundShape('g' + it.g.index, gc, 'nonzero', rp).cm, it.x, it.y, 1, true, 1)}"/>`;
    }
  });
  const h = lh * (lines.length - 1) + H;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="boot-svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" aria-label="Wczytywanie glifów"><g class="glyph">${d}</g></svg>`;
}
function bootMorph(t0){
  return new Promise((done) => {
    const sh = $('sheet');
    sh.innerHTML = bootFrame(0);             // ten sam napis, już konturami fontu
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hold = Math.max(0, BOOT_MS - MORPH_MS - (performance.now() - t0));
    setTimeout(() => {
      if (reduce) { sh.innerHTML = bootFrame(1); setTimeout(done, MORPH_MS); return; }
      const start = performance.now();
      const step = () => {
        const u = Math.min(1, (performance.now() - start) / MORPH_MS);
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;   // łagodny start i koniec
        sh.innerHTML = bootFrame(e);
        // w karcie w tle przeglądarka wstrzymuje klatki animacji — wtedy jedziemy na zegarze,
        // żeby ekran startowy nie został na zawsze
        if (u < 1) (document.hidden ? setTimeout(step, 120) : requestAnimationFrame(step));
        else setTimeout(done, 280);
      };
      step();
    }, hold);
  });
}
async function boot(){
  const t0 = performance.now();
  setLic(); syncUI();
  bootMsg();
  $('note').textContent = '';
  if (!(await loadBootFont())) {
    state.booting = false;
    loadDemo();                              // font niedostępny (np. otwarcie przez file://)
    return;
  }
  // ostatnia linia obrony: cokolwiek by się stało z animacją, aplikacja ma wstać
  await Promise.race([bootMorph(t0), new Promise((r) => setTimeout(r, BOOT_MS + MORPH_MS + 2000))]);
  state.booting = false;
  state.view = 'glyphs';                     // start na siatce wszystkich glifów
  syncUI(); render();
  offerRestore();
}
boot();
})();
