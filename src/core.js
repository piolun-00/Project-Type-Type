/* Rounder core — geometria zaokrąglania narożników (bez zależności) */
(function (root) {
  'use strict';
  const P = (x, y) => ({ x, y });
  const add = (a, b) => P(a.x + b.x, a.y + b.y);
  const sub = (a, b) => P(a.x - b.x, a.y - b.y);
  const mul = (a, s) => P(a.x * s, a.y * s);
  const len = (a) => Math.hypot(a.x, a.y);
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const lerp = (a, b, t) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  const norm = (a) => { const l = len(a); return l > 1e-12 ? P(a.x / l, a.y / l) : P(0, 0); };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* ---------- segmenty (wszystko jako krzywe 3. stopnia) ---------- */
  const lineSeg = (a, b) => ({ p0: a, p1: lerp(a, b, 1 / 3), p2: lerp(a, b, 2 / 3), p3: b, line: true });
  const quadSeg = (a, c, b) => ({ p0: a, p1: lerp(a, c, 2 / 3), p2: lerp(b, c, 2 / 3), p3: b, line: false });
  const cubicSeg = (a, c1, c2, b) => ({ p0: a, p1: c1, p2: c2, p3: b, line: false });

  function bez(s, t) {
    const u = 1 - t;
    return P(u * u * u * s.p0.x + 3 * u * u * t * s.p1.x + 3 * u * t * t * s.p2.x + t * t * t * s.p3.x,
             u * u * u * s.p0.y + 3 * u * u * t * s.p1.y + 3 * u * t * t * s.p2.y + t * t * t * s.p3.y);
  }
  function deriv(s, t) {
    const u = 1 - t;
    const d = P(3 * u * u * (s.p1.x - s.p0.x) + 6 * u * t * (s.p2.x - s.p1.x) + 3 * t * t * (s.p3.x - s.p2.x),
                3 * u * u * (s.p1.y - s.p0.y) + 6 * u * t * (s.p2.y - s.p1.y) + 3 * t * t * (s.p3.y - s.p2.y));
    if (len(d) > 1e-9) return d;
    // punkt osobliwy (uchwyt w węźle) — kierunek z sąsiednich punktów
    return t < 0.5 ? tanStart(s) : tanEnd(s);
  }
  function tanStart(s) {
    for (const q of [s.p1, s.p2, s.p3]) { const d = sub(q, s.p0); if (len(d) > 1e-9) return d; }
    return P(1, 0);
  }
  function tanEnd(s) {
    for (const q of [s.p2, s.p1, s.p0]) { const d = sub(s.p3, q); if (len(d) > 1e-9) return d; }
    return P(1, 0);
  }
  function split(s, t) {
    const a = lerp(s.p0, s.p1, t), b = lerp(s.p1, s.p2, t), c = lerp(s.p2, s.p3, t);
    const d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
    return [{ p0: s.p0, p1: a, p2: d, p3: f, line: s.line }, { p0: f, p1: e, p2: c, p3: s.p3, line: s.line }];
  }
  function subSeg(s, t0, t1) {
    if (s.line) { const a = bez(s, t0), b = bez(s, t1); return lineSeg(a, b); }
    let r = s;
    if (t1 < 1) r = split(r, t1)[0];
    if (t0 > 0) r = split(r, t0 / t1)[1];
    return r;
  }
  // tablica długości łuku
  function lut(s) {
    if (s.line) { const L = dist(s.p0, s.p3); return { L, ts: [0, 1], ls: [0, L] }; }
    const n = 32, ts = [0], ls = [0];
    let prev = s.p0, acc = 0;
    for (let i = 1; i <= n; i++) { const t = i / n, q = bez(s, t); acc += dist(prev, q); prev = q; ts.push(t); ls.push(acc); }
    return { L: acc, ts, ls };
  }
  function tAtLen(T, d) {
    if (d <= 0) return 0;
    if (d >= T.L) return 1;
    const ls = T.ls; let i = 1;
    while (i < ls.length && ls[i] < d) i++;
    const f = (d - ls[i - 1]) / Math.max(1e-12, ls[i] - ls[i - 1]);
    return T.ts[i - 1] + (T.ts[i] - T.ts[i - 1]) * f;
  }
  function isLineLike(s, tol) {
    const L = dist(s.p0, s.p3);
    if (L < 1e-9) return false;
    const dir = norm(sub(s.p3, s.p0));
    const dev = (q) => Math.abs(cross(dir, sub(q, s.p0)));
    const along = (q) => dot(dir, sub(q, s.p0));
    return dev(s.p1) < tol && dev(s.p2) < tol && along(s.p1) > -tol && along(s.p2) < L + tol;
  }

  /* ---------- komendy ścieżki → kontury ---------- */
  // cmds: [{type:'M'|'L'|'Q'|'C'|'Z', x,y,x1,y1,x2,y2}]
  function commandsToContours(cmds, ref) {
    const eps = Math.max(1e-6, ref * 1e-5);
    const contours = [];
    let cur = null, start = null, pt = null;
    const close = () => {
      if (cur && cur.length) {
        if (dist(pt, start) > eps) cur.push(lineSeg(pt, start));
        contours.push(cur);
      }
      cur = null;
    };
    for (const c of cmds) {
      if (c.type === 'M') { close(); cur = []; start = pt = P(c.x, c.y); }
      else if (c.type === 'L') { if (!cur) { cur = []; start = pt; } cur.push(lineSeg(pt, P(c.x, c.y))); pt = P(c.x, c.y); }
      else if (c.type === 'Q') { if (!cur) { cur = []; start = pt; } cur.push(quadSeg(pt, P(c.x1, c.y1), P(c.x, c.y))); pt = P(c.x, c.y); }
      else if (c.type === 'C') { if (!cur) { cur = []; start = pt; } cur.push(cubicSeg(pt, P(c.x1, c.y1), P(c.x2, c.y2), P(c.x, c.y))); pt = P(c.x, c.y); }
      else if (c.type === 'Z') { close(); pt = start; }
    }
    close();
    return contours.map((c) => cleanContour(c, ref)).filter((c) => c.length >= 2);
  }

  function cleanContour(segs, ref) {
    const eps = Math.max(1e-6, ref * 1e-4);
    // 1. usuń zdegenerowane segmenty (zerowa długość)
    let out = segs.filter((s) => !(dist(s.p0, s.p3) < eps && dist(s.p0, s.p1) < eps && dist(s.p0, s.p2) < eps));
    // 2. krzywe, które są w praktyce prostymi → linie
    out = out.map((s) => (!s.line && isLineLike(s, ref * 1e-4) ? lineSeg(s.p0, s.p3) : s));
    // 3. sklej współliniowe proste następujące po sobie
    let changed = true;
    while (changed && out.length > 2) {
      changed = false;
      for (let i = 0; i < out.length; i++) {
        const a = out[i], j = (i + 1) % out.length, b = out[j];
        if (a.line && b.line) {
          const da = norm(sub(a.p3, a.p0)), db = norm(sub(b.p3, b.p0));
          if (dot(da, db) > Math.cos((0.5 * Math.PI) / 180)) {
            const m = lineSeg(a.p0, b.p3);
            if (j === 0) { out[i] = m; out.shift(); } else { out.splice(i, 2, m); }
            changed = true; break;
          }
        }
      }
    }
    return out;
  }

  /* ---------- test wnętrza (dla klasyfikacji wypukły/wklęsły) ---------- */
  function flatten(contours) {
    return contours.map((c) => {
      const pts = [];
      for (const s of c) {
        const n = s.line ? 1 : 12;
        for (let i = 0; i < n; i++) pts.push(bez(s, i / n));
      }
      return pts;
    });
  }
  function windingAt(polys, p) {
    let w = 0;
    for (const poly of polys) {
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        if (a.y <= p.y) { if (b.y > p.y && cross(sub(b, a), sub(p, a)) > 0) w++; }
        else if (b.y <= p.y && cross(sub(b, a), sub(p, a)) < 0) w--;
      }
    }
    return w;
  }
  const inside = (polys, p, rule) => { const w = windingAt(polys, p); return rule === 'evenodd' ? (w & 1) !== 0 : w !== 0; };

  /* ---------- analiza: wykrycie i klasyfikacja narożników ---------- */
  // opts: {angleMin (deg), endTol (deg), endMax (jedn.), fillRule, mergeTol (jedn.)}
  // Mikro-odcinki (krótsze niż mergeTol) nie są traktowane jako osobne krawędzie:
  // zbijamy je razem z narożnikami po obu stronach w jeden „węzeł”. Jego położenie
  // to średnia punktów, a kąt to łączny obrót kierunku przez cały węzeł.
  function analyze(contours, opts, ref) {
    const polys = flatten(contours);
    const eps = Math.max(1e-4, ref * 1e-3);
    const angleMin = (opts.angleMin * Math.PI) / 180;
    const endTol = (opts.endTol * Math.PI) / 180;
    const mergeTol = opts.mergeTol || 0;
    return contours.map((segs) => {
      const n = segs.length;
      const luts = segs.map(lut);
      let micro = luts.map((T) => T.L < mergeTol);
      if (micro.filter((x) => !x).length < 2) micro = micro.map(() => false);
      const real = [];
      for (let i = 0; i < n; i++) if (!micro[i]) real.push(i);
      const m = real.length;
      // węzeł k leży między odcinkiem real[k] a real[k+1]
      const joints = real.map((ri, k) => {
        const nx = real[(k + 1) % m], mic = [];
        for (let j = (ri + 1) % n; j !== nx; j = (j + 1) % n) mic.push(j);
        return { from: ri, to: nx, micro: mic };
      });
      const corners = joints.map((J) => {
        const tin = norm(tanEnd(segs[J.from])), tout = norm(tanStart(segs[J.to]));
        const theta = Math.acos(Math.max(-1, Math.min(1, dot(tin, tout))));
        // średnie położenie węzła
        let v = segs[J.to].p0;
        if (J.micro.length) {
          let sx = segs[J.from].p3.x, sy = segs[J.from].p3.y;
          for (const j of J.micro) { sx += segs[j].p3.x; sy += segs[j].p3.y; }
          v = P(sx / (J.micro.length + 1), sy / (J.micro.length + 1));
        }
        J.v = v;
        let amin = angleMin, forced = false;
        if (opts.forcePts && opts.forcePts.length) {
          const tolF = Math.max(ref * 3e-3, mergeTol);
          for (const q of opts.forcePts) if (dist(q, v) <= tolF) {
            amin = Math.min(amin, ((q.a != null ? q.a : 2) * Math.PI) / 180);
            if (q.manual) forced = true;
          }
        }
        if (theta < amin) return null;
        let w = sub(tout, tin);
        if (len(w) < 1e-6) w = P(-tin.y, tin.x);
        w = norm(w);
        const convex = inside(polys, add(v, mul(w, eps)), opts.fillRule);
        return { v, theta, convex, type: convex ? 'out' : 'in', endLen: 0, merged: J.micro.length, forced };
      });
      // zakończenia kresek: prosty odcinek między dwoma wypukłymi węzłami,
      // które razem obracają kierunek o ~180° (boki kreski są równoległe)
      for (let k = 0; k < m; k++) {
        const s = segs[real[k]], a = corners[(k - 1 + m) % m], b = corners[k];
        if (!s.line || !a || !b || !a.convex || !b.convex) continue;
        const L = luts[real[k]].L;
        if (L > opts.endMax) continue;
        if (Math.abs(a.theta + b.theta - Math.PI) > endTol) continue;
        for (const c of [a, b]) {
          if (c.type === 'end') c.endLen = Math.min(c.endLen, L);
          else { c.type = 'end'; c.endLen = L; }
        }
      }
      return { segs, luts, real, joints, corners };
    });
  }

  /* ---------- zaokrąglanie ---------- */
  // params: {end, out, in} 0..1, rOut, rIn (jednostki), tension (1 = łuk koła), tanMax
  // fixed=true: stała struktura punktów niezależnie od wartości (potrzebne do fontu zmiennego).
  // decide: parametry, według których zapada decyzja o „pochłanianiu” zbyt krótkich odcinków
  // (w foncie zmiennym = maksimum osi, żeby struktura była wszędzie ta sama).
  // ovr: opcjonalne korekty ręczne — ovr[kontur][węzeł] = { type, g, absorb }
  //   type: 'end'|'out'|'in'|'off' (zamiast wykrytego), g: wartość suwaka 0..2 (zamiast globalnej),
  //   absorb: 'on'|'off' (wymuś / zablokuj wtapianie przy tym narożniku)
  function round(analysis, params, ref, fixed, decide, ovr) {
    const tiny = Math.max(1e-6, ref * 1e-5);
    const cmds = [];
    const tanHalfMax = params.tanMax || 4;
    const absorbOn = params.absorb !== false;
    decide = decide || params;
    const pushSeg = (s) => {
      if (s.line) cmds.push({ type: 'L', x: s.p3.x, y: s.p3.y });
      else cmds.push({ type: 'C', x1: s.p1.x, y1: s.p1.y, x2: s.p2.x, y2: s.p2.y, x: s.p3.x, y: s.p3.y });
    };
    // łuk narożnika z (możliwie) różnymi przycięciami po obu stronach
    const fillet = (P1, T1, P2, T2) => {
      if (dist(P1, P2) <= tiny) { cmds.push({ type: 'C', x1: P1.x, y1: P1.y, x2: P2.x, y2: P2.y, x: P2.x, y: P2.y }); return; }
      // uchwyty liczone z rzeczywistych stycznych w punktach przycięcia i cięciwy (łuk koła między P1 i P2),
      // a nie z kąta pierwotnego narożnika — przy krzywych bokach te kąty potrafią się mocno różnić
      const phi = Math.acos(Math.max(-1, Math.min(1, dot(T1, T2))));
      const chord = dist(P1, P2);
      const kk = phi < 1e-3 ? 1 / 3 : (4 / 3) * Math.tan(phi / 4) / (2 * Math.sin(phi / 2));
      let h1 = params.tension * chord * kk, h2 = h1;
      // nie wychodź poza punkt przecięcia stycznych (zapobiega pętlom)
      const den = cross(T1, T2);
      if (Math.abs(den) > 1e-9) {
        const dd = sub(P2, P1);
        const a = cross(dd, T2) / den, b = cross(dd, T1) / den;
        if (a > 0) h1 = Math.min(h1, a * 0.999);
        if (b > 0) h2 = Math.min(h2, b * 0.999);
      }
      const c1 = add(P1, mul(T1, h1)), c2 = sub(P2, mul(T2, h2));
      cmds.push({ type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: P2.x, y: P2.y });
    };
    analysis.forEach((C, ci) => {
      const { segs, luts, real, joints, corners } = C;
      const m = real.length;
      if (!m) return;
      const O = (ovr && ovr[ci]) || [];
      const Ls = real.map((i) => luts[i].L);
      const wantFor = (pp) => corners.map((c, k) => {
        if (!c) return 0;
        const o = O[k];
        let t = (o && o.type) || c.type;
        if (t === 'off') return 0;
        if (t === 'end' && !(c.endLen > 0)) t = 'out';
        const g = o && o.g != null ? o.g : pp[t];
        const th = Math.min(Math.tan(c.theta / 2), tanHalfMax);
        if (t === 'end') return g * c.endLen / 2;
        if (t === 'out') return g * pp.rOut * th;
        return g * pp.rIn * th;
      });
      const want = wantFor(params);
      const wantD = decide === params ? want : wantFor(decide);
      const prv = (k) => (k - 1 + m) % m;
      // odcinek k: węzeł k-1 na początku, węzeł k na końcu.
      // Zbyt krótki odcinek (łuki z obu stron się nie mieszczą) zostaje pochłonięty:
      // zamiast ściskać oba łuki, prowadzimy jedną krzywą przez cały fragment.
      let absorb = real.map((_, k) => {
        if (!absorbOn) return false;
        const a = corners[prv(k)], b = corners[k];
        if (!a || !b) return false;
        const oa = O[prv(k)] || {}, ob = O[k] || {};
        if (oa.absorb === 'off' || ob.absorb === 'off') return false;
        const both = wantD[prv(k)] > tiny && wantD[k] > tiny;
        if (oa.absorb === 'on' || ob.absorb === 'on') return both;
        if (a.type === 'end' && b.type === 'end') return false; // zakończenie kreski = zamierzone półkole
        if (!(Ls[k] < (params.absorbMax || 0))) return false; // tylko naprawdę krótkie „kikuty”
        return both && wantD[prv(k)] + wantD[k] > Ls[k];
      });
      if (absorb.every((x) => x)) absorb = absorb.map(() => false);
      // budżet długości na zwykłych odcinkach; łuk zostaje symetryczny (ta sama długość przycięcia po obu stronach)
      const f = Ls.map((L, k) => {
        if (absorb[k]) return 1;
        const sum = want[prv(k)] + want[k];
        return sum > L ? L / sum : 1;
      });
      const dSym = want.map((w, k) => w * Math.min(f[k], f[(k + 1) % m]));
      const dIn = dSym, dOut = dSym;
      const t0 = real.map((i, k) => tAtLen(luts[i], dOut[prv(k)]));
      const t1 = real.map((i, k) => Math.max(t0[k], tAtLen(luts[i], Ls[k] - dIn[k])));

      let s0 = absorb.indexOf(false);
      const prevKept = (k) => { let j = prv(k); while (absorb[j]) j = prv(j); return j; };
      const last = prevKept(s0);
      const start = bez(segs[real[last]], t1[last]);
      cmds.push({ type: 'M', x: start.x, y: start.y });
      for (let n = 0, k = s0; n < m; n++, k = (k + 1) % m) {
        if (absorb[k]) continue;
        const p = prevKept(k);
        const i = real[k];
        if (p !== prv(k) || (p === k && absorb.some((x) => x))) {
          // krzywa przez pochłonięte odcinki: punkty kontrolne celują w pierwotne wierzchołki
          const P1 = bez(segs[real[p]], t1[p]), P2 = bez(segs[i], t0[k]);
          const T1 = norm(deriv(segs[real[p]], t1[p])), T2 = norm(deriv(segs[i], t0[k]));
          const tau = Math.min(1, 0.9 * params.tension);
          const c1 = add(P1, mul(T1, dIn[p] * tau)), c2 = sub(P2, mul(T2, dOut[prv(k)] * tau));
          cmds.push({ type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: P2.x, y: P2.y });
        } else {
          const pk = p, J = joints[pk], c = corners[pk];
          const dd = Math.max(dIn[pk], dOut[pk]);
          const doFillet = fixed ? !!c : (c && dd > tiny);
          if (doFillet) {
            const P1 = bez(segs[J.from], t1[pk]), P2 = bez(segs[J.to], t0[k]);
            const T1 = norm(deriv(segs[J.from], t1[pk])), T2 = norm(deriv(segs[J.to], t0[k]));
            fillet(P1, T1, P2, T2);
          } else if (J.micro.length && !c) {
            // gładki węzeł z mikro-detalem: drobny „schodek” zastępujemy prostym połączeniem
            const q = segs[J.to].p0; cmds.push({ type: 'L', x: q.x, y: q.y });
          } else {
            // narożnik bez zaokrąglenia: oryginalne mikro-odcinki zostają bez zmian
            for (const j of J.micro) pushSeg(segs[j]);
          }
        }
        if (fixed) {
          if (t1[k] - t0[k] > 1e-9) pushSeg(subSeg(segs[i], t0[k], t1[k]));
          else { const q = bez(segs[i], t0[k]); pushSeg(segs[i].line ? lineSeg(q, q) : cubicSeg(q, q, q, q)); }
        } else if (t1[k] - t0[k] > 1e-7 && Ls[k] - dOut[prv(k)] - dIn[k] > tiny) pushSeg(subSeg(segs[i], t0[k], t1[k]));
      }
      cmds.push({ type: 'Z' });
    });
    return cmds;
  }

  function toPathData(cmds, tx, ty, sc, flipY, prec) {
    const p = prec == null ? 2 : prec;
    const X = (x) => +(tx + x * sc).toFixed(p);
    const Y = (y) => +(ty + (flipY ? -y : y) * sc).toFixed(p);
    let s = '';
    for (const c of cmds) {
      if (c.type === 'M') s += 'M' + X(c.x) + ' ' + Y(c.y);
      else if (c.type === 'L') s += 'L' + X(c.x) + ' ' + Y(c.y);
      else if (c.type === 'Q') s += 'Q' + X(c.x1) + ' ' + Y(c.y1) + ' ' + X(c.x) + ' ' + Y(c.y);
      else if (c.type === 'C') s += 'C' + X(c.x1) + ' ' + Y(c.y1) + ' ' + X(c.x2) + ' ' + Y(c.y2) + ' ' + X(c.x) + ' ' + Y(c.y);
      else if (c.type === 'Z') s += 'Z';
    }
    return s;
  }


  // grubość kreski z przekrojów: długości odcinków „w farbie” na liniach skanujących
  function inkRuns(polys, rule, horiz, c) {
    const xs = [];
    for (const poly of polys) for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const ac = horiz ? a.y : a.x, bc = horiz ? b.y : b.x;
      if ((ac <= c && bc > c) || (bc <= c && ac > c)) {
        const t = (c - ac) / (bc - ac);
        xs.push({ x: horiz ? a.x + t * (b.x - a.x) : a.y + t * (b.y - a.y), d: bc > ac ? 1 : -1 });
      }
    }
    xs.sort((p, q) => p.x - q.x);
    const runs = []; let w = 0, start = 0;
    const ins = (w) => (rule === 'evenodd' ? (w & 1) !== 0 : w !== 0);
    for (const e of xs) { const was = ins(w); w += e.d; const now = ins(w); if (!was && now) start = e.x; else if (was && !now) runs.push(e.x - start); }
    return runs;
  }
  // items: [{cmds, rule, axes:'h'|'hv'}]
  function estimateStrokeScan(items, ref, fallback) {
    const all = [];
    for (const it of items) {
      const contours = commandsToContours(it.cmds, ref);
      if (!contours.length) continue;
      const polys = flatten(contours);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of polys) for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      for (const f of [0.3, 0.41, 0.5, 0.63, 0.7]) {
        for (const r of inkRuns(polys, it.rule, true, y0 + (y1 - y0) * f)) all.push(r);
        if (it.axes === 'hv') for (const r of inkRuns(polys, it.rule, false, x0 + (x1 - x0) * f)) all.push(r);
      }
    }
    const v = all.filter((r) => r > ref * 0.004).sort((a, b) => a - b);
    if (!v.length) return fallback;
    return v[Math.floor(v.length * 0.4)];
  }

  const api = { commandsToContours, analyze, round, toPathData, estimateStrokeScan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RounderCore = api;
})(this);
