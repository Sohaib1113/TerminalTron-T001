/**
 * HoloEmblem engine — reusable port of the TERMINAL-TRON holographic logo
 * (originally terminal-tron-t002.html) into a fixed-size square canvas.
 *
 * The original ran full-screen (innerWidth/innerHeight). Here we render into a
 * fixed square of `size` CSS px with a devicePixelRatio-aware backing store so
 * the same drawing code scales cleanly from a 20px title-bar glyph up to the
 * 70px chat orb.
 *
 * Adaptations from the standalone HTML:
 *  - Forced dark mode: the app UI is a dark HUD, and the bloom/glow compositing
 *    only runs in dark mode. Keeps the logo glowing regardless of OS theme.
 *  - Pointer / keyboard / resize listeners are omitted (decorative logo).
 *  - Per-instance mutable state so several logos can coexist (2 static + 1
 *    animated) without sharing animation clocks.
 *
 * `startHolo(canvas, size, animate)` draws either a single settled frame
 * (animate=false) or runs the full mood/intro loop (animate=true). It returns a
 * destroy() that cancels the loop and frees the offscreen buffers.
 */

const TAU = Math.PI * 2;
const F = 4;
const { sin, cos, exp, acos, min, max, abs, random, hypot } = Math;

// rotate (x then y axis) + perspective project into preallocated [x,y,z,scale]
function PJ(v: number[], cx: number, sx: number, cy: number, sy: number, r: number, o: number[]): void {
  const b = v[1] * cx - v[2] * sx;
  const c = v[1] * sx + v[2] * cx;
  const a2 = v[0] * cy + c * sy;
  const c2 = -v[0] * sy + c * cy;
  const s = F / (F - c2);
  o[0] = a2 * r * s;
  o[1] = b * r * s;
  o[2] = c2;
  o[3] = s;
}

interface Ico {
  v: number[][];
  f: number[][];
  e: number[][];
}

// geodesic icosphere (holographic globe)
function ico(sub: number): Ico {
  const q = (1 + Math.sqrt(5)) / 2;
  const nm = (p: number[]): number[] => {
    const l = hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l];
  };
  let v: number[][] = [
    [-1, q, 0], [1, q, 0], [-1, -q, 0], [1, -q, 0],
    [0, -1, q], [0, 1, q], [0, -1, -q], [0, 1, -q],
    [q, 0, -1], [q, 0, 1], [-q, 0, -1], [-q, 0, 1],
  ].map(nm);
  let f: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < sub; s++) {
    const c: Record<string, number> = {};
    const nf: number[][] = [];
    const mid = (a: number, b: number): number => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (c[k] === undefined) {
        c[k] = v.length;
        v.push(nm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]));
      }
      return c[k];
    };
    for (const [a, b, d] of f) {
      const ab = mid(a, b), bd = mid(b, d), da = mid(d, a);
      nf.push([a, ab, da], [b, bd, ab], [d, da, bd], [ab, bd, da]);
    }
    f = nf;
  }
  const es = new Set<string>();
  const e: number[][] = [];
  for (const [a, b, d] of f)
    for (const [i, j] of [[a, b], [b, d], [d, a]]) {
      const k = i < j ? i + '_' + j : j + '_' + i;
      if (!es.has(k)) { es.add(k); e.push([i, j]); }
    }
  return { v, f, e };
}

// Immutable shared geometry (recomputed every frame, safe to share).
const G = ico(2);
const G2 = ico(1);
const edges = G.e;
const EQ: number[][] = Array.from({ length: 73 }, (_, i) => {
  const a = (i / 72) * TAU;
  return [cos(a), 0, sin(a)];
});

// optimistic moods (no red/alert, no dark "dead" state)
type Mood = { spin: number; think: number; bright: number; hue: number; speak: number; joy: number; act: number };
const M: Record<string, Mood> = {
  idle: { spin: 1, think: 0, bright: 1, hue: 192, speak: 0, joy: 0, act: 0.12 },
  thinking: { spin: 2.4, think: 1, bright: 1, hue: 200, speak: 0, joy: 0, act: 0.22 },
  speaking: { spin: 1.3, think: 0.2, bright: 1.05, hue: 190, speak: 1, joy: 0, act: 0.15 },
  joy: { spin: 1.6, think: 0.2, bright: 1.15, hue: 46, speak: 0.5, joy: 1, act: 0.25 },
  rest: { spin: 0.4, think: 0, bright: 0.7, hue: 205, speak: 0, joy: 0, act: 0.05 },
};
const SEQ: Array<[string, number]> = [
  ['idle', 4], ['thinking', 4], ['speaking', 5], ['idle', 3], ['joy', 3], ['idle', 3], ['rest', 5],
];

export interface HoloHandle {
  destroy: () => void;
}

/**
 * Start a HoloEmblem on `canvas` (a square canvas already sized to `size` CSS
 * px). When `animate` is true, runs the full intro + mood loop; otherwise draws
 * a single settled frame and returns immediately.
 */
export function startHolo(canvas: HTMLCanvasElement, size: number, animate: boolean): HoloHandle {
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return { destroy: () => undefined };

  const mk = () => document.createElement('canvas');
  const off = mk();
  const bl = mk();
  const bb = mk();
  const x = off.getContext('2d')!;
  const bc = bl.getContext('2d')!; // downscaled copy for bloom
  const bbc = bb.getContext('2d')!; // pre-blurred bloom (blurred once, drawn twice)
  if (!x || !bc || !bbc) return { destroy: () => undefined };

  const W = size;
  const H = size;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const c of [canvas, off]) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  bl.width = bb.width = Math.max(1, Math.ceil((W * dpr) / 3));
  bl.height = bb.height = Math.max(1, Math.ceil((H * dpr) / 3));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.setTransform(dpr, 0, 0, dpr, 0, 0);

  // The app is a dark HUD; force dark so the glow/bloom compositing is active.
  const dark = true;

  // Per-instance buffers + animation state.
  const pn: number[][] = G.v.map(() => [0, 0, 0, 0]);
  const pi2: number[][] = G2.v.map(() => [0, 0, 0, 0]);
  const tmp: number[] = [0, 0, 0, 0];
  const vi = new Float32Array(G.v.length);
  const vg = new Float32Array(G.v.length);
  const packets = Array.from({ length: 30 }, () => ({ e: edges[(random() * edges.length) | 0], p: random(), v: 0.5 + random() * 0.9 }));
  const waves = [{ c: [0, 1, 0], t0: 0 }, { c: [1, 0, 0], t0: -1.6 }];
  const parts = Array.from({ length: 80 }, () => ({ a: random() * TAU, r: 0.4 + random() * 2.2, v: 0.3 + random() * 0.5, am: random() < 0.5 }));
  const shocks: Array<{ r: number; a: number; gold?: number; soft?: number }> = [];

  const P: Mood = { ...M.idle };
  let mi = -1;
  let mt = 0;
  let cur = 'idle';
  let t = 0;
  let last = performance.now();
  let amp = 0;
  let joyT = 0;
  let sa = 0;
  let flash = 0;
  let hello = false;
  let B = (!animate && size <= 80) ? 2.2 : 1;
  let hue = 192;
  // gx/gy parallax is dropped (no pointer); keep referenced vars at zero.
  const gx = 0;
  const gy = 0;

  const E = (a: number, d: number): number => {
    const u2 = min(1, max(0, (t - a) / d));
    return u2 * u2 * (3 - 2 * u2);
  };
  const col = (a: number, l = 62, h = hue): string =>
    `hsla(${h},100%,${dark ? l : l * 0.62}%,${min(1, a * B)})`;
  const acc = (a: number, l = 62): string => col(a, l, 42);

  function frame(now: number): void {
    const dt = min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    if (t > 5) {
      mt -= dt;
      if (mt <= 0) {
        mi = (mi + 1) % SEQ.length;
        mt = SEQ[mi][1];
        cur = SEQ[mi][0];
        if (cur === 'speaking') shocks.push({ r: 1, a: 1 });
      }
    }
    const T = M[cur];
    const Pt = P as unknown as Record<string, number>;
    const Tt = T as unknown as Record<string, number>;
    for (const k in T) Pt[k] += (Tt[k] - Pt[k]) * min(1, dt * 2.2);
    B = 0.3 + 0.7 * P.bright;
    if (P.joy > 0.5) {
      joyT -= dt;
      if (joyT < 0) { joyT = 0.9; shocks.push({ r: 1, a: 0.8, gold: 1 }); }
    }
    if (!hello && t > 4.2) { hello = true; flash = 1; shocks.push({ r: 0.9, a: 1, gold: 1 }, { r: 0.7, a: 0.5, soft: 1 }); }
    flash *= 0.97;

    // intro stages: spark -> sun -> glass globe -> rings unwind -> hud
    const coreIn = E(0.2, 1.8);
    const globeIn = E(1.5, 1.5);
    const hudIn = E(2.6, 1.3);
    hue = size <= 80 && !animate ? 42 : 42 + (P.hue - 42) * E(1.4, 2.6) + sin(t * 0.25) * 8;
    const syll = abs(sin(t * 9) * sin(t * 3.3));
    const tgt = P.act + sin(t * 1.1) * 0.03 + P.speak * (0.3 + 0.45 * syll + 0.1 * random()) + flash * 0.5;
    amp += (tgt - amp) * 0.18;

    const R = 150;
    const u = (min(W, H) * 0.165) / 150;
    const ay = t * 0.3 * (0.5 + P.spin * 0.5) + gx * 0.9;
    const ax = 0.38 + gy * 0.5;
    const S = 1 + amp * 0.05 + sin(t * 1.1) * 0.01;
    x.clearRect(0, 0, W, H);
    x.save();
    x.translate(W / 2, H / 2);
    x.scale(u, u);
    x.lineCap = 'round';
    const GL = (): string => (x.globalCompositeOperation = dark ? 'lighter' : 'source-over');
    const SO = (): string => (x.globalCompositeOperation = 'source-over');
    const stroke = (w: number, c: string): void => { x.strokeStyle = c; const raw = w * u; const minLocal = size <= 80 ? 1.8 / (dpr * u) : 0; x.lineWidth = Math.max(raw, minLocal); x.stroke(); };
    const disc = (r: number): void => { x.beginPath(); x.arc(0, 0, r, 0, TAU); x.fill(); };
    let g: CanvasGradient;

    // sunrise aura + soft god rays
    GL();
    g = x.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 2.8);
    g.addColorStop(0, col((0.22 + amp * 0.3) * coreIn, 60, 42));
    g.addColorStop(0.4, col((0.08 + amp * 0.1) * coreIn, 50));
    g.addColorStop(1, col(0));
    x.fillStyle = g;
    disc(R * 2.8);
    for (let i = shocks.length - 1; i >= 0; i--) {
      const s = shocks[i];
      s.r += dt * 1.6;
      s.a -= dt * 0.45;
      if (s.a <= 0) { shocks.splice(i, 1); continue; }
      x.beginPath();
      x.arc(0, 0, R * s.r * 1.3, 0, TAU);
      stroke(s.soft ? 7 : 2, (s.gold ? acc : col)(s.a * (s.soft ? 0.35 : 0.5)));
    }

    // Jarvis HUD: segmented ring, tick scale, broken arcs, chevron ring, orbiting dot
    const arc = (r: number, a0: number, a1: number, w: number, al: number, d?: number[]): void => {
      x.beginPath();
      x.arc(0, 0, r, a0, a1);
      x.setLineDash(d || []);
      stroke(w, col(al * hudIn));
      x.setLineDash([]);
    };
    // ring A: dotted base + 6 bold segments
    x.save();
    x.rotate(t * 0.15 * P.spin);
    arc(R * 2 * S, 0, TAU, 1, 0.3, [2, 7]);
    for (let i = 0; i < 6; i++) arc(R * 2 * S, (i * TAU) / 6 + 0.05, (i * TAU) / 6 + 0.5, 3, 0.7);
    x.restore();
    // ring B: tick scale (minor + major)
    x.save();
    x.rotate(-t * 0.08);
    {
      const q = R * 2.08;
      const c1 = col(0.3 * hudIn);
      const c2 = col(0.7 * hudIn);
      for (let p = 0; p < 2; p++) {
        x.beginPath();
        for (let i = 0; i < 120; i++) {
          if ((i % 10 === 0) !== !!p) continue;
          const a = (i / 120) * TAU;
          const l = p ? 11 : 4;
          const co = cos(a);
          const si = sin(a);
          x.moveTo(co * q, si * q);
          x.lineTo(co * (q + l), si * (q + l));
        }
        stroke(1, p ? c2 : c1);
      }
    }
    x.restore();
    // ring C: broken arcs with perpendicular end caps + inner fine dashes
    x.save();
    x.rotate(-t * 0.2 * (0.6 + P.spin * 0.4));
    {
      const r = R * 2.28;
      const sg: Array<[number, number]> = [[0, 0.9], [1.1, 1.5], [1.7, 2.9], [3.1, 3.4], [3.6, 5.2], [5.4, 6.1]];
      arc(r, 0, TAU, 0.6, 0.18);
      x.beginPath();
      for (const [a0, a1] of sg) { x.moveTo(cos(a0) * r, sin(a0) * r); x.arc(0, 0, r, a0, a1); }
      stroke(2, col(0.6 * hudIn));
      x.beginPath();
      for (const [a0, a1] of sg) for (const a of [a0, a1]) { const co = cos(a), si = sin(a); x.moveTo(co * (r - 6), si * (r - 6)); x.lineTo(co * (r + 6), si * (r + 6)); }
      stroke(1.2, acc(0.85 * hudIn, 72));
      x.rotate(t * 0.35);
      arc(r - 9, 0, TAU, 0.8, 0.28, [1, 4]);
    }
    x.restore();
    // ring D: outer hairline, dots, and four gold chevrons
    x.save();
    x.rotate(t * 0.06);
    {
      const r = R * 2.44;
      arc(r, 0, TAU, 0.6, 0.2);
      x.fillStyle = col(0.45 * hudIn, 75);
      x.beginPath();
      for (let i = 0; i < 24; i++) { const a = (i * TAU) / 24, px = cos(a) * r, py = sin(a) * r; x.moveTo(px + 1.3, py); x.arc(px, py, 1.3, 0, TAU); }
      x.fill();
      x.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k * TAU) / 4, co = cos(a), si = sin(a);
        x.moveTo(co * (r + 8) - si * 6, si * (r + 8) + co * 6);
        x.lineTo(co * (r - 2), si * (r - 2));
        x.lineTo(co * (r + 8) + si * 6, si * (r + 8) - co * 6);
      }
      stroke(1.6, acc(0.9 * hudIn, 72));
    }
    x.restore();
    // bright dot orbiting ring C
    {
      const a = t * 1.1 * (0.6 + P.spin * 0.4);
      const r = R * 2.28;
      const px = cos(a) * r;
      const py = sin(a) * r;
      x.fillStyle = acc(0.95 * hudIn, 85);
      x.beginPath();
      x.arc(px, py, 2.6, 0, TAU);
      x.fill();
      x.beginPath();
      x.arc(px, py, 6, 0, TAU);
      stroke(1, acc(0.5 * hudIn, 80));
    }
    sa += dt * (0.8 + P.think * 3.5);
    for (let j = 0; j < 24; j++) { x.beginPath(); x.arc(0, 0, R * 1.92, sa - j * 0.05 - 0.05, sa - j * 0.05); stroke(6, col((1 - j / 24) * (0.1 + P.think * 0.3) * hudIn)); }
    // glass globe
    SO();
    const gr = R * S * (0.15 + 0.85 * globeIn);
    g = x.createRadialGradient(0, 0, gr * 0.92, 0, 0, gr * 1.32);
    g.addColorStop(0, col(0.16 * globeIn, 56));
    g.addColorStop(1, col(0));
    x.fillStyle = g;
    disc(gr * 1.32);
    x.save();
    x.beginPath();
    x.arc(0, 0, gr, 0, TAU);
    x.clip();
    g = x.createRadialGradient(0, 0, gr * 0.5, 0, 0, gr);
    g.addColorStop(0, col(0));
    g.addColorStop(0.8, col(0.1 * globeIn, 50));
    g.addColorStop(1, col(0.3 * globeIn, 56));
    x.fillStyle = g;
    disc(gr);
    g = x.createRadialGradient(0.45 * gr, 0.5 * gr, 0, 0.45 * gr, 0.5 * gr, gr * 0.6);
    g.addColorStop(0, acc(0.28 * globeIn, 70));
    g.addColorStop(1, acc(0));
    x.fillStyle = g;
    disc(gr);
    x.restore();
    GL();
    for (const w of waves) if ((t - w.t0) * 0.9 > Math.PI + 0.6) { const a = random() * TAU, b = acos(2 * random() - 1); w.c = [sin(b) * cos(a), cos(b), sin(b) * sin(a)]; w.t0 = t; }
    {
      const w0 = waves[0];
      const w1 = waves[1];
      const d0 = (t - w0.t0) * 0.9;
      const d1 = (t - w1.t0) * 0.9;
      G.v.forEach((p, i) => {
        const a = acos(max(-1, min(1, p[0] * w0.c[0] + p[1] * w0.c[1] + p[2] * w0.c[2])));
        const b = acos(max(-1, min(1, p[0] * w1.c[0] + p[1] * w1.c[1] + p[2] * w1.c[2])));
        vi[i] = min(1, exp(-(a - d0) * (a - d0) * 14) + amp * 0.25);
        vg[i] = exp(-(b - d1) * (b - d1) * 14);
      });
    }
    const cx = cos(ax), sx = sin(ax), cy = cos(ay), sy = sin(ay);
    for (let i = 0; i < pn.length; i++) PJ(G.v[i], cx, sx, cy, sy, gr, pn[i]);
    // lit glass facets
    for (const tri of G.f) {
      const a = tri[0], b = tri[1], d = tri[2];
      const zz = (pn[a][2] + pn[b][2] + pn[d][2]) / 3;
      const w = (vi[a] + vi[b] + vi[d]) / 3;
      const uu = (vg[a] + vg[b] + vg[d]) / 3;
      if (zz < -0.15 || w + uu < 0.12) continue;
      x.beginPath();
      x.moveTo(pn[a][0], pn[a][1]);
      x.lineTo(pn[b][0], pn[b][1]);
      x.lineTo(pn[d][0], pn[d][1]);
      x.closePath();
      x.fillStyle = w >= uu ? col(w * 0.35 * globeIn, 70) : acc(uu * 0.35 * globeIn, 72);
      x.fill();
    }
    // triangulated edges that glow as energy waves pass
    for (const eg of edges) {
      const i = eg[0], j = eg[1];
      const a = pn[i], b = pn[j];
      const z = (a[2] + b[2]) / 2;
      const w = (vi[i] + vi[j]) / 2;
      const uu = (vg[i] + vg[j]) / 2;
      const m = max(w, uu);
      x.beginPath();
      x.moveTo(a[0], a[1]);
      x.lineTo(b[0], b[1]);
      stroke(0.6 + m * 1.3, (uu > w ? acc : col)((0.04 + (z + 1) * 0.09 + m * 0.8) * globeIn, 52 + m * 30));
    }
    // equator band
    x.beginPath();
    EQ.forEach((e, i) => { PJ(e, cx, sx, cy, sy, gr, tmp); i ? x.lineTo(tmp[0], tmp[1]) : x.moveTo(tmp[0], tmp[1]); });
    stroke(1.2, col(0.3 * globeIn, 60));
    // energy packets running along the mesh
    const np = 10 + Math.round(P.think * 20);
    for (let k = 0; k < np; k++) {
      const p = packets[k];
      p.p += dt * p.v * (1 + amp * 3 + P.think * 2);
      if (p.p > 1) { p.p = 0; p.e = edges[(random() * edges.length) | 0]; }
      const a = pn[p.e[0]], b = pn[p.e[1]];
      const z = a[2] + (b[2] - a[2]) * p.p;
      x.fillStyle = col((0.4 + (z + 1) * 0.3) * globeIn, 88);
      x.beginPath();
      x.arc(a[0] + (b[0] - a[0]) * p.p, a[1] + (b[1] - a[1]) * p.p, max(0.3, 1.5 + (z + 1) * 0.8), 0, TAU);
      x.fill();
    }
    // vertices + hub markers
    pn.forEach((q, i) => {
      const z = (q[2] + 1) / 2;
      x.fillStyle = col((0.15 + z * 0.3 + vi[i]) * globeIn, 66);
      x.beginPath();
      x.arc(q[0], q[1], max(0.3, (0.7 + z * 0.7 + vi[i] * 2.4) * q[3]), 0, TAU);
      x.fill();
      if (i < 12 && q[2] > -0.2) { x.beginPath(); x.arc(q[0], q[1], (3.5 + vi[i] * 3) * q[3], 0, TAU); stroke(1, acc(0.55 * z * globeIn, 75)); }
    });
    // inner counter-rotating gold icosahedron
    {
      const a2 = ax + 0.5, b2 = -ay * 1.4, c2 = cos(a2), s2 = sin(a2), c3 = cos(b2), s3 = sin(b2);
      for (let i = 0; i < pi2.length; i++) PJ(G2.v[i], c2, s2, c3, s3, gr * 0.6, pi2[i]);
    }
    for (const eg of G2.e) {
      const a = pi2[eg[0]], b = pi2[eg[1]];
      x.beginPath();
      x.moveTo(a[0], a[1]);
      x.lineTo(b[0], b[1]);
      stroke(0.8, acc((0.12 + ((a[2] + b[2]) / 2 + 1) * 0.14) * globeIn));
    }
    for (const q of pi2) { x.fillStyle = acc(0.55 * globeIn, 82); x.beginPath(); x.arc(q[0], q[1], max(0.3, (0.8 + (q[2] + 1) * 0.5) * q[3]), 0, TAU); x.fill(); }
    // golden light motes streaming into the core
    const pa = E(1.5, 1.5);
    for (const p of parts) {
      p.r -= dt * p.v * (0.25 + P.think * 1.2 + amp);
      p.a += (dt * (0.5 + P.think * 2)) / max(0.5, p.r);
      if (p.r < 0.3) { p.r = 2.3 + random() * 0.5; p.a = random() * TAU; }
      const al = (1 - p.r / 2.8) * pa * 0.9;
      x.fillStyle = p.am ? acc(al, 75) : col(al, 85);
      x.beginPath();
      x.arc(cos(p.a) * p.r * R, sin(p.a) * p.r * R, 0.8 + (2.8 - p.r) * 0.5, 0, TAU);
      x.fill();
    }

    // radiant core: white-gold sun with plasma
    const cr = R * (0.06 + amp * 0.03) * (0.4 + 0.6 * coreIn);
    g = x.createRadialGradient(0, 0, 0, 0, 0, cr * 2.1);
    g.addColorStop(0, 'hsla(50,100%,98%,' + 0.45 * coreIn + ')');
    g.addColorStop(0.2, acc(0.45 * coreIn, 80));
    g.addColorStop(0.55, col((0.3 + amp * 0.3) * coreIn, 60));
    g.addColorStop(1, col(0));
    x.fillStyle = g;
    disc(cr * 2.1);

    // sun core: corona flares, glowing disc, surface granulation, white-hot centre
    {
      const c = R * 0.06 * (0.4 + 0.6 * coreIn) * (1 + amp * 0.07);
      GL();
      g = x.createRadialGradient(0, 0, c * 0.7, 0, 0, c * 2.1);
      g.addColorStop(0, 'hsla(42,100%,60%,' + 0.5 * coreIn + ')');
      g.addColorStop(0.5, 'hsla(36,100%,55%,' + 0.15 * coreIn + ')');
      g.addColorStop(1, 'hsla(36,100%,50%,0)');
      x.fillStyle = g;
      disc(c * 2.1);
      SO();
      g = x.createRadialGradient(0, 0, 0, 0, 0, c);
      g.addColorStop(0, 'hsla(54,100%,96%,' + coreIn + ')');
      g.addColorStop(0.4, 'hsla(48,100%,66%,' + coreIn + ')');
      g.addColorStop(0.8, 'hsla(34,100%,52%,' + coreIn + ')');
      g.addColorStop(1, 'hsla(22,100%,46%,' + coreIn + ')');
      x.fillStyle = g;
      disc(c);
      x.save();
      x.beginPath();
      x.arc(0, 0, c, 0, TAU);
      x.clip();
      for (let k = 0; k < 12; k++) {
        const a = k * 2.4 + t * (0.25 + (k % 3) * 0.08);
        const r = c * (0.25 + 0.55 * ((k * 0.37) % 1));
        x.fillStyle = 'hsla(' + (k % 2 ? 28 : 50) + ',100%,' + (k % 2 ? 42 : 80) + '%,' + 0.28 * coreIn + ')';
        x.beginPath();
        x.arc(cos(a) * r, sin(a) * r, c * (0.14 + 0.06 * sin(t * 1.5 + k)), 0, TAU);
        x.fill();
      }
      x.restore();
      x.beginPath();
      x.arc(0, 0, c, 0, TAU);
      stroke(1.2, 'hsla(40,100%,62%,' + 0.8 * coreIn + ')');
      GL();
      g = x.createRadialGradient(0, 0, 0, 0, 0, c * 0.5);
      g.addColorStop(0, 'hsla(55,100%,100%,' + coreIn + ')');
      g.addColorStop(1, 'hsla(50,100%,80%,0)');
      x.fillStyle = g;
      disc(c * 0.5);
    }
    // inner Jarvis rings around the core
    {
      const gi = globeIn;
      const sp = 0.5 + P.spin * 0.5;
      x.save();
      x.rotate(t * 0.9 * sp);
      x.beginPath();
      for (let k = 0; k < 4; k++) { const a = (k * TAU) / 4 + 0.2, r = R * 0.2; x.moveTo(cos(a) * r, sin(a) * r); x.arc(0, 0, r, a, a + 1.0); }
      stroke(2.2, col(0.85 * gi, 70));
      x.restore();
      x.save();
      x.rotate(-t * 0.6 * sp);
      {
        const r = R * 0.3;
        x.beginPath();
        for (let k = 0; k < 3; k++) { const a = (k * TAU) / 3 + 0.15; x.moveTo(cos(a) * r, sin(a) * r); x.arc(0, 0, r, a, a + 1.5); }
        stroke(1.6, acc(0.8 * gi, 72));
        x.beginPath();
        for (let k = 0; k < 3; k++) for (const a of [(k * TAU) / 3 + 0.15, (k * TAU) / 3 + 1.65]) { x.moveTo(cos(a) * (r - 4), sin(a) * (r - 4)); x.lineTo(cos(a) * (r + 4), sin(a) * (r + 4)); }
        stroke(1.2, acc(0.95 * gi, 80));
      }
      x.restore();
      x.save();
      x.rotate(t * 0.3);
      x.setLineDash([1, 3]);
      x.beginPath();
      x.arc(0, 0, R * 0.4, 0, TAU);
      stroke(0.9, col(0.45 * gi, 72));
      x.setLineDash([]);
      x.restore();
      x.save();
      x.rotate(-t * 0.15);
      {
        const r = R * 0.48;
        x.beginPath();
        for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU, l = i % 4 ? 3 : 6, co = cos(a), si = sin(a); x.moveTo(co * r, si * r); x.lineTo(co * (r + l), si * (r + l)); }
        stroke(1, col(0.55 * gi, 72));
      }
      x.restore();
      const sw = t * 1.6 * (1 + P.think);
      for (let j = 0; j < 16; j++) { x.beginPath(); x.arc(0, 0, R * 0.4, sw - j * 0.06 - 0.06, sw - j * 0.06); stroke(R * 0.18, col((1 - j / 16) * 0.14 * gi, 68)); }
      x.save();
      x.rotate(t * 0.25);
      x.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k * TAU) / 4 + TAU / 8, co = cos(a), si = sin(a), r = R * 0.56;
        x.moveTo(co * (r + 6) - si * 4, si * (r + 6) + co * 4);
        x.lineTo(co * (r - 1), si * (r - 1));
        x.lineTo(co * (r + 6) + si * 4, si * (r + 6) - co * 4);
      }
      stroke(1.4, acc(0.85 * gi, 78));
      x.restore();
    }

    // golden orbital ring: arc segments, diamonds, inward pointers, dashed inner ring
    {
      const hr = R * 1.2;
      x.save();
      x.rotate(-t * 0.12);
      x.beginPath();
      x.arc(0, 0, hr, 0, TAU);
      stroke(0.8, acc(0.25 * hudIn, 70));
      x.beginPath();
      for (let k = 0; k < 3; k++) { const a = (k * TAU) / 3; x.moveTo(cos(a + 0.12) * hr, sin(a + 0.12) * hr); x.arc(0, 0, hr, a + 0.12, a + 1.45); }
      stroke(3, acc(0.85 * hudIn, 70));
      x.beginPath();
      for (let k = 0; k < 3; k++) { const a = (k * TAU) / 3; x.moveTo(cos(a + 0.35) * hr * 0.955, sin(a + 0.35) * hr * 0.955); x.arc(0, 0, hr * 0.955, a + 0.35, a + 1.1); }
      stroke(1.2, acc(0.55 * hudIn, 75));
      x.fillStyle = acc(0.9 * hudIn, 80);
      for (let k = 0; k < 3; k++) {
        const a = (k * TAU) / 3, d = a + 1.785, p = a + 0.785, co = cos(d), si = sin(d), c2 = cos(p), s2 = sin(p);
        x.beginPath();
        x.moveTo(co * (hr + 5), si * (hr + 5));
        x.lineTo(co * hr - si * 3.5, si * hr + co * 3.5);
        x.lineTo(co * (hr - 5), si * (hr - 5));
        x.lineTo(co * hr + si * 3.5, si * hr - co * 3.5);
        x.fill();
        x.beginPath();
        x.moveTo(c2 * (hr * 0.9), s2 * (hr * 0.9));
        x.lineTo(c2 * hr * 0.95 - s2 * 4, s2 * hr * 0.95 + c2 * 4);
        x.lineTo(c2 * hr * 0.95 + s2 * 4, s2 * hr * 0.95 - c2 * 4);
        x.fill();
      }
      x.restore();
      x.save();
      x.rotate(t * 0.2);
      x.setLineDash([1, 5]);
      x.beginPath();
      x.arc(0, 0, hr * 0.89, 0, TAU);
      stroke(0.9, acc(0.45 * hudIn, 75));
      x.setLineDash([]);
      x.restore();
    }

    x.restore();

    // compose with bloom (blur once on the small canvas, draw it twice)
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    if (dark) {
      bc.clearRect(0, 0, bl.width, bl.height);
      bc.drawImage(off, 0, 0, bl.width, bl.height);
      bbc.clearRect(0, 0, bb.width, bb.height);
      bbc.filter = 'blur(' + 2.7 * u + 'px)';
      bbc.drawImage(bl, 0, 0);
      bbc.filter = 'none';
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      ctx.drawImage(bb, 0, 0, W, H);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(bb, 0, 0, W, H);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0, W, H);
    // Small brand icons: the fine hologram washes out at 28-58px, so paint a
    // bold simplified golden emblem on top — solid core + glow + crisp rings.
    if (size <= 80 && !animate) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cxp = W / 2, cyp = H / 2;
      const coreR = W * 0.20;
      let g2 = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, coreR * 2.4);
      g2.addColorStop(0, 'rgba(255,236,170,0.95)');
      g2.addColorStop(0.35, 'rgba(255,205,80,0.75)');
      g2.addColorStop(0.7, 'rgba(200,140,20,0.28)');
      g2.addColorStop(1, 'rgba(120,80,5,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(cxp, cyp, coreR * 2.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath(); ctx.arc(cxp, cyp, Math.max(1.6, coreR * 0.42), 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,215,110,0.95)';
      ctx.lineWidth = Math.max(1.4, W * 0.035);
      ctx.beginPath(); ctx.arc(cxp, cyp, W * 0.30, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,80,0.55)';
      ctx.setLineDash([Math.max(2, W * 0.05), Math.max(2, W * 0.045)]);
      ctx.lineWidth = Math.max(1, W * 0.022);
      ctx.beginPath(); ctx.arc(cxp, cyp, W * 0.385, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,215,110,0.9)';
      ctx.lineWidth = Math.max(1.2, W * 0.03);
      ctx.beginPath(); ctx.arc(cxp, cyp, W * 0.455, -1.2, 0.9); ctx.stroke();
      ctx.restore();
    }
  }





  let raf = 0;
  let running = false;

  const renderOnce = (): void => {
    // Draw a fully-settled frame (skip the intro ramp) for static logos.
    t = 14.5;
    frame(performance.now());
  };

  if (animate) {
    running = true;
    last = performance.now();
    const loop = (now: number): void => {
      frame(now);
      if (running) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  } else {
    renderOnce();
  }

  return {
    destroy: () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      off.width = off.height = 0;
      bl.width = bl.height = 0;
      bb.width = bb.height = 0;
    },
  };
}

