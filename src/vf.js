/* Szlifiernia — budowa fontu zmiennego TrueType (glyf + gvar + fvar + STAT) bez zależności */
(function (root) {
  'use strict';

  /* ---------- zapis binarny ---------- */
  class W {
    constructor() { this.a = []; }
    u8(v) { this.a.push(v & 255); return this; }
    i8(v) { return this.u8(v < 0 ? v + 256 : v); }
    u16(v) { this.a.push((v >> 8) & 255, v & 255); return this; }
    i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
    u32(v) { this.a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; }
    i32(v) { return this.u32(v >>> 0); }
    fixed(v) { return this.i32(Math.round(v * 65536)); }
    f2dot14(v) { return this.i16(Math.round(v * 16384)); }
    tag(t) { for (let i = 0; i < 4; i++) this.u8(t.charCodeAt(i)); return this; }
    bytes(b) { for (let i = 0; i < b.length; i++) this.a.push(b[i]); return this; }
    pad(n) { while (this.a.length % n) this.a.push(0); return this; }
    get length() { return this.a.length; }
    out() { return Uint8Array.from(this.a); }
  }

  /* ---------- czytanie / składanie sfnt ---------- */
  function readTables(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const sig = dv.getUint32(0);
    if (sig === 0x774F4646) return null; // WOFF — tabele są skompresowane, pomijamy
    const n = dv.getUint16(4), t = {};
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      const tag = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
      const off = dv.getUint32(o + 8), len = dv.getUint32(o + 12);
      t[tag] = u8.slice(off, off + len);
    }
    return t;
  }
  function checksum(b) {
    let s = 0;
    for (let i = 0; i < b.length; i += 4) s = (s + ((b[i] << 24) | ((b[i + 1] || 0) << 16) | ((b[i + 2] || 0) << 8) | (b[i + 3] || 0))) >>> 0;
    return s;
  }
  function buildSfnt(tables, flavor) {
    const tags = Object.keys(tables).sort();
    const n = tags.length;
    let es = 0; while ((1 << (es + 1)) <= n) es++;
    const sr = (1 << es) * 16;
    const w = new W();
    w.u32(flavor).u16(n).u16(sr).u16(es).u16(n * 16 - sr);
    let off = 12 + n * 16;
    const recs = [];
    for (const tag of tags) {
      const data = tables[tag];
      if (tag === 'head') { data[8] = data[9] = data[10] = data[11] = 0; }
      recs.push({ tag, off, len: data.length, sum: checksum(data) });
      off += (data.length + 3) & ~3;
    }
    for (const r of recs) w.tag(r.tag).u32(r.sum).u32(r.off).u32(r.len);
    for (const tag of tags) { w.bytes(tables[tag]); w.pad(4); }
    const out = w.out();
    const adj = (0xB1B0AFBA - checksum(out)) >>> 0;
    const headRec = recs.find((r) => r.tag === 'head');
    if (headRec) new DataView(out.buffer).setUint32(headRec.off + 8, adj);
    return out;
  }
  // podmienia / dodaje tabele w istniejącym pliku (np. GSUB/GPOS z oryginału)
  function injectTables(fontBytes, extra) {
    const t = readTables(fontBytes);
    const flavor = new DataView(fontBytes.buffer, fontBytes.byteOffset).getUint32(0);
    Object.assign(t, extra);
    return buildSfnt(t, flavor);
  }
  // tabele układu z oryginału (kerning, ligatury…); numeracja glifów jest zachowana
  function layoutTables(srcTables, srcIsVariable) {
    const out = {};
    if (!srcTables) return out;
    for (const tag of ['GSUB', 'GPOS', 'GDEF']) {
      const b = srcTables[tag]; if (!b) continue;
      const c = b.slice();
      if (tag === 'GDEF') { if (srcIsVariable && c[3] > 0) c[3] = 0; }   // bez magazynu wariacji źródła
      else if (c[3] > 0) c[3] = 0;                                      // bez FeatureVariations źródła
      out[tag] = c;
    }
    return out;
  }

  /* ---------- tabela name ---------- */
  function nameTable(entries) {
    const recs = Object.keys(entries).map(Number).filter((id) => entries[id] != null && entries[id] !== '').sort((a, b) => a - b);
    const strs = recs.map((id) => {
      const s = String(entries[id]), b = [];
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b.push(c >> 8, c & 255); }
      return b;
    });
    const w = new W();
    w.u16(0).u16(recs.length).u16(6 + recs.length * 12);
    let off = 0;
    recs.forEach((id, i) => { w.u16(3).u16(1).u16(0x409).u16(id).u16(strs[i].length).u16(off); off += strs[i].length; });
    strs.forEach((b) => w.bytes(b));
    return w.out();
  }

  /* ---------- krzywe 3. stopnia → 2. stopnia ---------- */
  function cubicPieces(p0, c1, c2, p3, tol) {
    const dx = p3.x - 3 * c2.x + 3 * c1.x - p0.x, dy = p3.y - 3 * c2.y + 3 * c1.y - p0.y;
    const err = Math.hypot(dx, dy) * Math.sqrt(3) / 36;
    return Math.max(1, Math.min(8, Math.ceil(Math.cbrt(err / tol))));
  }
  function cubicToQuads(p0, c1, c2, p3, n, outPts) {
    const B = (t) => { const u = 1 - t; return { x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y }; };
    const D = (t) => { const u = 1 - t; return { x: 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p3.x - c2.x), y: 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p3.y - c2.y) }; };
    for (let k = 0; k < n; k++) {
      const a = k / n, b = (k + 1) / n, h = (b - a) / 3;
      const q0 = B(a), q3 = B(b), da = D(a), db = D(b);
      const s1 = { x: q0.x + da.x * h, y: q0.y + da.y * h }, s2 = { x: q3.x - db.x * h, y: q3.y - db.y * h };
      outPts.push({ x: (3 * (s1.x + s2.x) - (q0.x + q3.x)) / 4, y: (3 * (s1.y + s2.y) - (q0.y + q3.y)) / 4, on: false });
      outPts.push({ x: q3.x, y: q3.y, on: true });
    }
  }
  const sig = (cmds) => cmds.map((c) => c.type).join('');

  // komendy (M/L/C/Z) wszystkich mistrzów → kontury TrueType o identycznej strukturze
  function toTTContours(masterCmds, tol) {
    const M = masterCmds.length, base = masterCmds[0];
    // liczba kawałków dla każdej krzywej: maksimum po mistrzach
    const nq = base.map((c, i) => {
      if (c.type !== 'C') return 0;
      let n = 1;
      for (const cmds of masterCmds) {
        let prev = null;
        for (let j = i - 1; j >= 0; j--) if (cmds[j].type !== 'Z') { prev = cmds[j]; break; }
        const cc = cmds[i];
        n = Math.max(n, cubicPieces({ x: prev.x, y: prev.y }, { x: cc.x1, y: cc.y1 }, { x: cc.x2, y: cc.y2 }, { x: cc.x, y: cc.y }, tol));
      }
      return n;
    });
    return masterCmds.map((cmds) => {
      const contours = []; let cur = null, pt = null;
      cmds.forEach((c, i) => {
        if (c.type === 'M') { cur = [{ x: c.x, y: c.y, on: true }]; contours.push(cur); pt = c; }
        else if (c.type === 'L') { cur.push({ x: c.x, y: c.y, on: true }); pt = c; }
        else if (c.type === 'C') { cubicToQuads({ x: pt.x, y: pt.y }, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }, nq[i], cur); pt = c; }
        else if (c.type === 'Z') {
          // ostatni punkt kontur zawsze pokrywa się ze startem — usuwamy go we wszystkich mistrzach
          if (cur && cur.length > 1 && cur[cur.length - 1].on) cur.pop();
        }
      });
      return contours.filter((ct) => ct.length >= 2);
    });
  }

  /* ---------- glyf ---------- */
  function encodeGlyph(contours) {
    const pts = [].concat(...contours);
    if (!pts.length) return { bytes: new Uint8Array(0), xMin: 0, yMin: 0, xMax: 0, yMax: 0, n: 0 };
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    for (const p of pts) { xMin = Math.min(xMin, p.x); yMin = Math.min(yMin, p.y); xMax = Math.max(xMax, p.x); yMax = Math.max(yMax, p.y); }
    const w = new W();
    w.i16(contours.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
    let e = -1; for (const c of contours) { e += c.length; w.u16(e); }
    w.u16(0);
    const flags = [], xs = new W(), ys = new W();
    let px = 0, py = 0;
    for (const p of pts) {
      let f = p.on ? 1 : 0; const dx = p.x - px, dy = p.y - py;
      if (dx === 0) f |= 0x10; else if (Math.abs(dx) < 256) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xs.u8(Math.abs(dx)); } else xs.i16(dx);
      if (dy === 0) f |= 0x20; else if (Math.abs(dy) < 256) { f |= 0x04 | (dy > 0 ? 0x20 : 0); ys.u8(Math.abs(dy)); } else ys.i16(dy);
      flags.push(f); px = p.x; py = p.y;
    }
    w.bytes(flags).bytes(xs.a).bytes(ys.a).pad(4);
    return { bytes: w.out(), xMin, yMin, xMax, yMax, n: pts.length };
  }

  /* ---------- gvar: spakowane delty ---------- */
  function packDeltas(arr, w) {
    let i = 0;
    while (i < arr.length) {
      if (arr[i] === 0) {
        let j = i; while (j < arr.length && arr[j] === 0 && j - i < 64) j++;
        w.u8(0x80 | (j - i - 1)); i = j;
      } else if (arr[i] >= -128 && arr[i] <= 127) {
        let j = i; while (j < arr.length && arr[j] !== 0 && arr[j] >= -128 && arr[j] <= 127 && j - i < 64) j++;
        w.u8(j - i - 1); for (let k = i; k < j; k++) w.i8(arr[k]); i = j;
      } else {
        let j = i; while (j < arr.length && arr[j] !== 0 && (arr[j] < -128 || arr[j] > 127) && j - i < 64) j++;
        w.u8(0x40 | (j - i - 1)); for (let k = i; k < j; k++) w.i16(arr[k]); i = j;
      }
    }
  }
  // tuples: [{peak:[..], start:[..], end:[..], dx:[], dy:[]}] — delty dla wszystkich punktów
  function glyphVariationData(tuples, axisCount) {
    if (!tuples.length) return new Uint8Array(0);
    const ser = new W(); ser.u8(0); // wspólne numery punktów: wszystkie
    const sizes = [];
    for (const t of tuples) { const s = ser.length; packDeltas(t.dx, ser); packDeltas(t.dy, ser); sizes.push(ser.length - s); }
    const headerLen = 4 + tuples.reduce((acc, t) => acc + 4 + 2 * axisCount * (t.inter ? 3 : 1), 0);
    const w = new W();
    w.u16(0x8000 | tuples.length).u16(headerLen);
    tuples.forEach((t, i) => {
      w.u16(sizes[i]).u16(0x8000 | (t.inter ? 0x4000 : 0));
      t.peak.forEach((v) => w.f2dot14(v));
      if (t.inter) { t.start.forEach((v) => w.f2dot14(v)); t.end.forEach((v) => w.f2dot14(v)); }
    });
    w.bytes(ser.a).pad(2);
    return w.out();
  }

  /* ---------- główna funkcja ---------- */
  // opts: { glyphs:[{advance, unicode, master:(m)=>cmds|null}], upm, axes:[{tag,name}], instances:[{name, coords:[..]}],
  //         names:{...}, srcTables, srcIsVariable, onProgress }
  async function buildVariableFont(opts) {
    const AX = opts.axes.length;
    // siatka mistrzów: poziomy 0, ½, 1 na każdej osi (3^AX). Środkowy poziom
    // łapie nieliniowość (np. gdy łuki zaczynają się ograniczać nawzajem).
    const LV = opts.levels || [0, 0.5, 1];
    const masters = [];
    const total = Math.pow(LV.length, AX);
    for (let k = 0; k < total; k++) { const m = []; let r = k; for (let a = 0; a < AX; a++) { m.push(LV[r % LV.length]); r = Math.floor(r / LV.length); } masters.push(m); }
    const idx = (m) => m.reduce((acc, v, a) => acc + LV.indexOf(v) * Math.pow(LV.length, a), 0);
    // obszar „namiotu” dla poziomu (funkcje kapeluszowe)
    const tent = (v) => { const i = LV.indexOf(v); return [LV[i - 1], v, i === LV.length - 1 ? v : LV[i + 1]]; };
    const tol = Math.max(0.5, opts.upm / 1000);
    const glyf = [], hm = [], gv = [];
    let maxPoints = 0, maxContours = 0, warn = 0;
    let gxMin = Infinity, gyMin = Infinity, gxMax = -Infinity, gyMax = -Infinity;
    for (let gi = 0; gi < opts.glyphs.length; gi++) {
      const G = opts.glyphs[gi];
      let mc = masters.map((m) => G.master(m) || []);
      if (mc.some((c) => sig(c) !== sig(mc[0]))) { warn++; mc = mc.map(() => mc[0]); }
      const tt = toTTContours(mc, tol).map((cts) => cts.map((ct) => ct.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), on: p.on }))));
      const enc = encodeGlyph(tt[0]);
      glyf.push(enc.bytes);
      hm.push({ adv: G.advance, lsb: enc.n ? enc.xMin : 0, xMax: enc.xMax, n: enc.n });
      if (enc.n) { gxMin = Math.min(gxMin, enc.xMin); gyMin = Math.min(gyMin, enc.yMin); gxMax = Math.max(gxMax, enc.xMax); gyMax = Math.max(gyMax, enc.yMax); }
      maxPoints = Math.max(maxPoints, enc.n); maxContours = Math.max(maxContours, tt[0].length);
      // delty: odwrócenie Möbiusa po bazie funkcji kapeluszowych —
      // delta(r) = Σ (−1)^(|supp r|−|supp s|) · M(s), s powstaje z r przez wyzerowanie części osi
      const flat = tt.map((cts) => [].concat(...cts));
      const tuples = [];
      if (enc.n) {
        for (let k = 1; k < total; k++) {
          const r = masters[k], supp = []; r.forEach((v, a) => { if (v !== 0) supp.push(a); });
          const dx = new Array(enc.n + 4).fill(0), dy = new Array(enc.n + 4).fill(0);
          const S = supp.length;
          for (let mask = 0; mask < (1 << S); mask++) {
            const s = r.slice(); let kept = 0;
            for (let j = 0; j < S; j++) { if (mask & (1 << j)) kept++; else s[supp[j]] = 0; }
            const sign = (S - kept) % 2 ? -1 : 1, P = flat[idx(s)];
            for (let p = 0; p < enc.n; p++) { dx[p] += sign * P[p].x; dy[p] += sign * P[p].y; }
          }
          if (dx.some((v) => v !== 0) || dy.some((v) => v !== 0)) {
            const peak = r.slice(), start = r.map((v) => (v ? tent(v)[0] : 0)), end = r.map((v) => (v ? tent(v)[2] : 0));
            const inter = r.some((v, a) => v && !(start[a] === 0 && end[a] === v) && !(start[a] === Math.min(0, v) && end[a] === Math.max(0, v)));
            tuples.push({ peak, start, end, inter, dx, dy });
          }
        }
      }
      gv.push(glyphVariationData(tuples, AX));
      if (opts.onProgress && gi % 40 === 39) await opts.onProgress(gi + 1, opts.glyphs.length);
    }
    if (!isFinite(gxMin)) { gxMin = gyMin = gxMax = gyMax = 0; }
    const N = opts.glyphs.length;

    // glyf + loca (długie)
    const glyfW = new W(), loca = new W();
    for (const g of glyf) { loca.u32(glyfW.length); glyfW.bytes(g); }
    loca.u32(glyfW.length);

    // gvar
    const gvW = new W(); const offs = []; let acc = 0;
    for (const d of gv) { offs.push(acc); acc += d.length; }
    offs.push(acc);
    const hdr = 20, offsetsLen = (N + 1) * 4;
    gvW.u16(1).u16(0).u16(AX).u16(0).u32(hdr + offsetsLen).u16(N).u16(1).u32(hdr + offsetsLen);
    for (const o of offs) gvW.u32(o);
    for (const d of gv) gvW.bytes(d);

    // name
    const names = Object.assign({}, opts.names);
    let nid = 256;
    const axisNameIds = opts.axes.map((a) => { names[nid] = a.name; return nid++; });
    const instNameIds = opts.instances.map((it) => { names[nid] = it.name; return nid++; });

    // fvar
    const fv = new W();
    fv.u16(1).u16(0).u16(16).u16(2).u16(AX).u16(20).u16(opts.instances.length).u16(4 + 4 * AX);
    opts.axes.forEach((a, i) => fv.tag(a.tag).fixed(0).fixed(0).fixed(100).u16(0).u16(axisNameIds[i]));
    opts.instances.forEach((it, i) => { fv.u16(instNameIds[i]).u16(0); it.coords.forEach((c) => fv.fixed(c)); });

    // STAT 1.1 (tylko osie)
    const st = new W();
    st.u16(1).u16(1).u16(8).u16(AX).u32(20).u16(0).u32(0).u16(2);
    opts.axes.forEach((a, i) => st.tag(a.tag).u16(axisNameIds[i]).u16(i));

    // maxp 1.0
    const mp = new W();
    mp.u32(0x00010000).u16(N).u16(maxPoints).u16(maxContours).u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

    // hmtx + hhea
    const hx = new W(); let advMax = 0, minL = 0x7fff, minR = 0x7fff, xMaxExt = -0x7fff;
    for (const h of hm) {
      hx.u16(h.adv).i16(h.lsb); advMax = Math.max(advMax, h.adv);
      if (h.n) { minL = Math.min(minL, h.lsb); minR = Math.min(minR, h.adv - h.xMax); xMaxExt = Math.max(xMaxExt, h.xMax); }
    }
    const S = opts.srcTables || {};
    const hh = new W();
    const srcHhea = S.hhea ? new DataView(S.hhea.buffer, S.hhea.byteOffset) : null;
    hh.u32(0x00010000).i16(opts.ascender).i16(opts.descender).i16(srcHhea ? srcHhea.getInt16(8) : 0)
      .u16(advMax).i16(minL === 0x7fff ? 0 : minL).i16(minR === 0x7fff ? 0 : minR).i16(xMaxExt === -0x7fff ? 0 : xMaxExt)
      .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(N);

    // head (z oryginału, z poprawkami)
    let head;
    if (S.head && S.head.length >= 54) head = S.head.slice();
    else {
      const h = new W(); h.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5F0F3CF5).u16(3).u16(opts.upm).u32(0).u32(0).u32(0).u32(0)
        .i16(0).i16(0).i16(0).i16(0).u16(0).u16(8).i16(2).i16(1).i16(0); head = h.out();
    }
    const hd = new DataView(head.buffer, head.byteOffset);
    hd.setUint16(18, opts.upm); hd.setInt16(36, gxMin); hd.setInt16(38, gyMin); hd.setInt16(40, gxMax); hd.setInt16(42, gyMax);
    hd.setInt16(50, 1); hd.setInt16(52, 0);
    const secs = Math.floor(Date.now() / 1000) + 2082844800; hd.setUint32(28, Math.floor(secs / 4294967296)); hd.setUint32(32, secs >>> 0);

    const tables = {
      head, hhea: hh.out(), maxp: mp.out(), hmtx: hx.out(), loca: loca.out(), glyf: glyfW.out(),
      gvar: gvW.out(), fvar: fv.out(), STAT: st.out(), name: nameTable(names),
    };
    for (const tag of ['OS/2', 'cmap', 'post']) if (S[tag]) tables[tag] = S[tag];
    if (opts.cmapFallback && !tables.cmap) tables.cmap = opts.cmapFallback;
    if (opts.os2Fallback && !tables['OS/2']) tables['OS/2'] = opts.os2Fallback;
    if (opts.postFallback && !tables.post) tables.post = opts.postFallback;
    Object.assign(tables, layoutTables(S, opts.srcIsVariable));
    return { bytes: buildSfnt(tables, 0x00010000), warn };
  }

  const api = { buildVariableFont, readTables, injectTables, layoutTables, buildSfnt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RounderVF = api;
})(this);
