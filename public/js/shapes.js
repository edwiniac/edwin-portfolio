// ─────────────────────────────────────────────────────────────
// Shapes — point clouds the voxel swarm assembles into.
// Each generator returns { pts, spin, tilt } where a point is
// [x, y, z, colour, size]; colour 0 = machine violet, 1 = human amber,
// 2 = pale highlight. Units are local (the symbols are ~4.5 wide).
// ─────────────────────────────────────────────────────────────
const TAU = Math.PI * 2;

// pad (or trim) to exactly n points; spare voxels hide inside the shape at size 0
function fit(pts, n) {
  const out = pts.slice(0, n);
  const src = pts.length;
  for (let i = out.length; i < n; i++) {
    const p = pts[(i * 7) % src];
    out.push([p[0], p[1], p[2], p[3], 0]);
  }
  return out;
}
function line(pts, a, b, count, c = 0, s = 0.4) {
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t, c, s]);
  }
}
function ring(pts, { r, from = 0, to = TAU, count, c = 0, s = 1, cx = 0, cy = 0, plane = 'xy', wobble = 0.05 }) {
  for (let i = 0; i < count; i++) {
    const a = from + (to - from) * (i / count);
    const rr = r + (i % 2 ? 0.07 : -0.07), w = (Math.random() - 0.5) * wobble * 2;
    const col = typeof c === 'function' ? c(i) : c;
    if (plane === 'xy') pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, w, col, s]);
    else pts.push([cx + Math.cos(a) * rr, cy + w, Math.sin(a) * rr, col, s]);
  }
}

const GAP = 0.62;         // where the loop is open (radians, upper right)
const GAP_HALF = 0.24;

export const SHAPES = {
  // A loop with a piece missing — and the missing piece, amber, waiting just outside it.
  loopOpen(n) {
    const pts = [];
    ring(pts, { r: 2.05, from: GAP + GAP_HALF, to: GAP - GAP_HALF + TAU, count: Math.floor(n * 0.42), c: i => (i % 9 === 0 ? 2 : 0) });
    pts.push([Math.cos(GAP) * 2.85, Math.sin(GAP) * 2.85, 0.1, 1, 2.6]);
    for (let i = 0; i < 5; i++) pts.push([Math.cos(GAP) * 2.85 + (Math.random() - 0.5) * 0.7, Math.sin(GAP) * 2.85 + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.5, 1, 0.55]);
    ring(pts, { r: 1.55, count: Math.floor(n * 0.16), s: 0.4, wobble: 0.02 });
    return { pts: fit(pts, n), spin: 0, tilt: 0 };
  },

  // The same loop, closed: the amber piece sits in the gap and light radiates from it.
  loopClosed(n) {
    const pts = [];
    ring(pts, { r: 2.05, from: GAP + GAP_HALF, to: GAP - GAP_HALF + TAU, count: Math.floor(n * 0.5), s: 0.6, c: i => (i % 9 === 0 ? 2 : 0), wobble: 0.03 });
    pts.push([Math.cos(GAP) * 2.05, Math.sin(GAP) * 2.05, 0.1, 1, 1.7]);
    for (let i = -3; i <= 3; i++) if (i) pts.push([Math.cos(GAP + i * 0.07) * 2.05, Math.sin(GAP + i * 0.07) * 2.05, 0, 1, 0.7]);
    ring(pts, { r: 2.4, count: Math.floor(n * 0.24), s: 0.3, c: i => (i % 4 === 0 ? 1 : 0), wobble: 0.02 });
    return { pts: fit(pts, n), spin: 0, tilt: 0 };
  },

  // A small neural network; the last decision is left to the amber node.
  network(n) {
    const pts = [], layers = [3, 4, 4, 2], xs = [-1.95, -0.65, 0.65, 1.95], nodes = [];
    layers.forEach((cnt, l) => {
      nodes[l] = [];
      for (let j = 0; j < cnt; j++) {
        const p = [xs[l], (j - (cnt - 1) / 2) * 1.0, 0];
        nodes[l].push(p);
        const human = l === 3 && j === 0;
        pts.push([p[0], p[1], 0, human ? 1 : (l === 0 ? 2 : 0), human ? 2.8 : 2.1]);
        for (let k = 0; k < 4; k++) pts.push([p[0] + Math.cos(k * 1.57) * 0.17, p[1] + Math.sin(k * 1.57) * 0.17, 0, human ? 1 : 0, 0.6]);
      }
    });
    // each neuron reaches for its two nearest neighbours in the next layer
    const dots = n >= 300 ? 7 : 4;
    for (let l = 0; l < 3; l++) nodes[l].forEach((a, j) => {
      const nx = nodes[l + 1], f = nodes[l].length > 1 ? (j / (nodes[l].length - 1)) * (nx.length - 1) : 0;
      const lo = Math.min(nx.length - 2, Math.floor(f));
      line(pts, a, nx[lo], dots, 0, 0.42); line(pts, a, nx[lo + 1], dots, 0, 0.42);
    });
    return { pts: fit(pts, n), spin: 0, tilt: 0.1 };
  },

  // MCP Witness — a Merkle tree: eight entries hashed upward into one root you can sign.
  merkle(n) {
    const pts = [], lv = [];
    for (let d = 3; d >= 0; d--) {
      const cnt = 1 << d; lv[d] = [];
      for (let j = 0; j < cnt; j++) {
        const x = d === 3 ? (j - 3.5) * 0.56 : (lv[d + 1][j * 2][0] + lv[d + 1][j * 2 + 1][0]) / 2;
        lv[d].push([x, 1.75 - d * 1.05, 0]);
      }
    }
    lv.forEach((nodes, d) => nodes.forEach(p => {
      pts.push([p[0], p[1], 0, d === 0 ? 1 : (d === 3 ? 2 : 0), d === 0 ? 2.8 : 1.9 - d * 0.2]);
    }));
    for (let k = 0; k < 6; k++) pts.push([Math.cos(k * 1.05) * 0.3, 1.75 + Math.sin(k * 1.05) * 0.3, 0, 1, 0.5]);
    const dots = n >= 300 ? 7 : 4;
    for (let d = 0; d < 3; d++) lv[d].forEach((p, j) => { line(pts, p, lv[d + 1][j * 2], dots, 0, 0.44); line(pts, p, lv[d + 1][j * 2 + 1], dots, 0, 0.44); });
    lv[3].forEach(p => { for (let k = 1; k <= 3; k++) pts.push([p[0], p[1] - k * 0.24, 0, 0, 0.75 - k * 0.12]); });
    return { pts: fit(pts, n), spin: 0, tilt: 0 };
  },

  // Research Swarm — specialists in orbit around shared state; one seat belongs to a person.
  swarm(n) {
    const pts = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) pts.push([x * 0.17, y * 0.17, z * 0.17, 2, 1.1]);
    const agents = 6, R = 1.9;
    for (let a = 0; a < agents; a++) {
      const ang = (a / agents) * TAU, cx = Math.cos(ang) * R, cz = Math.sin(ang) * R, cy = Math.sin(ang * 2) * 0.35;
      const human = a === 0;
      for (let k = 0; k < 8; k++) pts.push([cx + ((k & 1) - 0.5) * 0.18, cy + (((k >> 1) & 1) - 0.5) * 0.18, cz + (((k >> 2) & 1) - 0.5) * 0.18, human ? 1 : 0, human ? 1.4 : 1.1]);
      line(pts, [0, 0, 0], [cx, cy, cz], n >= 300 ? 6 : 4, human ? 1 : 0, 0.32);
    }
    for (let i = 0; i < (n >= 300 ? 70 : 44); i++) { const a = (i / (n >= 300 ? 70 : 44)) * TAU; pts.push([Math.cos(a) * R, Math.sin(a * 2) * 0.35, Math.sin(a) * R, 0, 0.3]); }
    return { pts: fit(pts, n), spin: 0.35, tilt: 0.38 };
  },

  // EvalKit — a gauge that is mostly, not entirely, full, and a check made by hand.
  evalkit(n) {
    const pts = [], cnt = Math.floor(n * 0.34), from = Math.PI * 1.25, to = -Math.PI * 0.25;
    for (let i = 0; i < cnt; i++) {
      const f = i / (cnt - 1), a = from + (to - from) * f, r = 2.05 + (i % 2 ? 0.07 : -0.07);
      pts.push([Math.cos(a) * r, Math.sin(a) * r, 0, f < 0.82 ? (i % 8 === 0 ? 2 : 0) : 0, f < 0.82 ? 1 : 0.35]);
    }
    for (let i = 0; i <= 10; i++) { const a = from + (to - from) * (i / 10); pts.push([Math.cos(a) * 2.42, Math.sin(a) * 2.42, 0, 2, 0.5]); }
    const seg = (a, b, c2) => { for (let i = 0; i <= c2; i++) { const t = i / c2; for (const o of [-0.07, 0.07]) pts.push([a[0] + (b[0] - a[0]) * t + o, a[1] + (b[1] - a[1]) * t - o, 0.05, 1, 1.25]); } };
    seg([-0.95, 0.05], [-0.3, -0.75], 7);
    seg([-0.3, -0.75], [1.05, 0.85], 15);
    return { pts: fit(pts, n), spin: 0, tilt: 0 };
  },

  // DevRAG Lite — pages on the left, three passages lifted out, one grounded answer.
  rag(n) {
    const pts = [], picks = [];
    for (let k = 2; k >= 0; k--)
      for (let row = 0; row < 6; row++) for (let col = 0; col < 5; col++) {
        const x = -2.2 + col * 0.21 + k * 0.2, y = 0.62 - row * 0.24 + k * 0.2, z = -k * 0.4;
        const pick = k === 0 && ((row === 1 && col === 1) || (row === 3 && col === 3) || (row === 4 && col === 0));
        if (pick) picks.push([x, y, z]);
        pts.push([x, y, z, pick ? 1 : (k === 0 ? 2 : 0), pick ? 1.5 : (k === 0 ? 0.75 : 0.5)]);
      }
    const ans = [1.75, 0.1, 0];
    picks.forEach(p => line(pts, p, ans, n >= 300 ? 13 : 8, 1, 0.42));
    pts.push([ans[0], ans[1], 0, 1, 2.6]);
    for (let k = 0; k < 8; k++) pts.push([ans[0] + Math.cos(k * 0.785) * 0.34, ans[1] + Math.sin(k * 0.785) * 0.34, 0, 2, 0.6]);
    for (let k = 0; k < 16; k++) pts.push([ans[0] + Math.cos(k * 0.39) * 0.62, ans[1] + Math.sin(k * 0.39) * 0.62, 0, 0, 0.32]);
    return { pts: fit(pts, n), spin: 0, tilt: 0 };
  },

  // The Craft — a block made of blocks, turning in the hand.
  lattice(n) {
    const pts = [], g = n >= 300 ? 6 : 5, sp = 3.1 / (g - 1);
    for (let x = 0; x < g; x++) for (let y = 0; y < g; y++) for (let z = 0; z < g; z++) {
      const edge = [x, y, z].filter(v => v === 0 || v === g - 1).length;
      if (edge === 0) continue;
      const human = x === g - 1 && y === g - 1 && z === g - 1;
      pts.push([(x - (g - 1) / 2) * sp, (y - (g - 1) / 2) * sp, (z - (g - 1) / 2) * sp, human ? 1 : (edge === 3 ? 2 : 0), human ? 2.2 : (edge >= 2 ? 1.05 : 0.5)]);
    }
    return { pts: fit(pts, n), spin: 0.3, tilt: 0.45 };
  },

  // The Belief — two rings, machine and human, that only hold because they are linked.
  rings(n) {
    const pts = [], half = Math.floor(n / 2);
    ring(pts, { r: 1.5, count: half, c: i => (i % 10 === 0 ? 2 : 0), cx: -0.78, plane: 'xy' });
    ring(pts, { r: 1.5, count: n - half, c: 1, cx: 0.78, plane: 'xz' });
    return { pts: fit(pts, n), spin: 0.22, tilt: 0.42 };
  },
};
