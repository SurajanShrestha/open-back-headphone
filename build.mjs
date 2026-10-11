// Builds index.html: a self-contained page with the figure, its styles and its live script.
// Run: node build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";
import { tubePieces, tubeSvg } from "./kit/tube.mjs";

// The kit's core, inlined into the page so it can animate without any other file.
const kitScript = () => readFileSync(new URL("./kit/iso-kit.mjs", import.meta.url), "utf8").replace(/^export /gm, "");

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = "light"; // light mode only

const WIDTH = 640;
const HEIGHT = 560;

// World units are millimetres. x is the ear axis (the right cup is at +x), y points to the front, z up.
// The headphone hangs on a display stand; its right cup comes off the yoke and its layers fan out along +x.
const XP = 52; // pad face of each cup, measured from the centre plane
const ZC = 128; // centre height of each cup
const CUP = { ry: 45, rz: 54 }; // housing half-width (front-back) and half-height
// Layers of one cup along its axis, from the pad face (s = 0) outward.
const L_PAD = [0, 22];
const L_BAFFLE = [22, 27];
const L_HOUSING = [27, 44];
const L_GRILLE = [44, 49];
const DRIVER = { s: 32, tilt: (10 * Math.PI) / 180, frame: 21, diaphragm: 19 }; // 42 mm frame, 38 mm diaphragm
// A plain headband: an arch over the top whose ends come down outside each cup and end in a yoke block
// that sits on the cup's top rim.
const BAND = { x: XP + 47.5, y: 0, zEnd: ZC + 52, rise: 105, th: 7, w: 32 };
const SHOE = { z0: ZC + 44, z1: ZC + 60 };
const CUSHION = { th: 8, wide: 26, narrow: 18, span: 0.62 };
const SADDLE = { r: 9, half: 20 };
SADDLE.z = BAND.zEnd + BAND.rise - BAND.th / 2 - CUSHION.th - SADDLE.r;
const POST_R = 6;
const BASE = { x: -135, y: -70, w: 220, d: 152, r: 10 };
const BASE_H = 12;
const FOOT_H = 5;
// Explode: how far each right-cup layer travels along +x; all of them also drop a little to clear the yoke block.
const APART = { pad: 30, baffle: 76, driver: 134, housing: 214, grille: 262 };
const DROP = 26;
const DELAY = { grille: 0, housing: 0.1, driver: 0.2, baffle: 0.3, pad: 0.4 };

const far = 262 + XP + L_GRILLE[1] + 30;
const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, BAND.y - BAND.w / 2, BAND.zEnd + BAND.rise + BAND.th],
    [0, BAND.y + BAND.w / 2, BAND.zEnd + BAND.rise + BAND.th],
    [-BAND.x - 8, -CUP.ry, ZC + CUP.rz],
    [far, -CUP.ry, ZC - DROP + CUP.rz],
    [far, CUP.ry, ZC - DROP - CUP.rz],
  ],
  WIDTH,
  HEIGHT,
  { pad: 20, azimuth: 33 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const V = G.viewOf(P);
const pathOf3 = (points, closed = false) => k.pathOf(points.map(at), closed);

// ---------- helpers for oval parts on the ear axis ----------
const ellipse = (ry, rz, n = 72) => Array.from({ length: n }, (_, i) => [ry * Math.cos((i / n) * 2 * Math.PI), rz * Math.sin((i / n) * 2 * Math.PI)]);
// A frame on the ear axis: side = +1 for the right cup (outward = +x), -1 for the left cup.
const cupFrame = (side, zc = ZC) => G.frameOf([side * XP, 0, zc], [side, 0, 0], [0, 1, 0], [0, 0, 1]);
const oval = (F, ry, rz, s0, s1) => G.prismOf(F, ellipse(ry, rz), s0, s1, P);
const onFace = (F, s, [u, v]) => G.add3(G.add3(G.add3(F.o, G.mul3(F.a, s)), G.mul3(F.u, u)), G.mul3(F.v, v));
const ovalLine = (F, s, ry, rz, n = 72) => pathOf3(ellipse(ry, rz, n).map((p) => onFace(F, s, p)), true);
// The visible arc of an oval seam around the side wall of an oval part.
function ovalSeam(F, s, ry, rz, n = 120) {
  const runs = [];
  let run = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const normal = G.unit3(G.add3(G.mul3(F.u, Math.cos(a) / ry), G.mul3(F.v, Math.sin(a) / rz)));
    if (G.dot3(normal, V) > 0.04) run.push(onFace(F, s, [ry * Math.cos(a), rz * Math.sin(a)]));
    else if (run.length) (runs.push(run), (run = []));
  }
  if (run.length) runs.push(run);
  if (runs.length > 1 && G.dot3(G.unit3(G.add3(G.mul3(F.u, 1 / ry), [0, 0, 0])), V) > 0.04) runs[0] = [...runs.pop(), ...runs[0]];
  return runs.filter((r) => r.length > 1).map((r) => pathOf3(r)).join("");
}

// ---------- the headband: a curved strip, drawn as depth-sorted segments ----------
function arch(t) {
  return [BAND.x * Math.sin(t), BAND.zEnd + BAND.rise * Math.cos(t)];
}
function ribbon(points, th, width, { tone = "mid", seamless = true, groove = 0, y0 = 0 } = {}) {
  const n = points.length;
  const half = (i) => (typeof width === "function" ? width(i / (n - 1)) : width) / 2;
  const tangents = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  });
  const normals = tangents.map(([tx, tz]) => [-tz, tx]); // points away from the arch centre for a left-to-right arch
  // y is -1 (back edge), +1 (front edge) or a fraction across the width.
  const P3 = (i, side, y) => [points[i][0] + normals[i][0] * side * (th / 2), y0 + y * half(i), points[i][1] + normals[i][1] * side * (th / 2)];
  const items = [];
  for (let i = 0; i < n - 1; i++) {
    const nm = G.unit3([normals[i][0] + normals[i + 1][0], 0, normals[i][1] + normals[i + 1][1]]);
    const faces = [
      { normal: nm, quad: [P3(i, 1, -1), P3(i + 1, 1, -1), P3(i + 1, 1, 1), P3(i, 1, 1)] },
      { normal: G.mul3(nm, -1), quad: [P3(i, -1, -1), P3(i + 1, -1, -1), P3(i + 1, -1, 1), P3(i, -1, 1)] },
      { normal: [0, 1, 0], quad: [P3(i, 1, 1), P3(i + 1, 1, 1), P3(i + 1, -1, 1), P3(i, -1, 1)] },
    ];
    const seen = faces.map((f) => G.dot3(f.normal, V) > 0);
    const body = [];
    faces.forEach((f, j) => {
      if (!seen[j]) return;
      const d = pathOf3(f.quad, true);
      const band = G.toneOf(f.normal, P);
      body.push(`<path class="iso-fill" d="${d}"/>`);
      body.push(band === 4 ? `<path class="iso-top" d="${d}"/>` : `<path class="iso-shade" data-shade="${band}" d="${d}"/>`);
    });
    const edges = [];
    const edge = (side, y, visible, both) => visible && edges.push({ d: pathOf3([P3(i, side, y), P3(i + 1, side, y)]), crease: both });
    edge(1, 1, true, seen[0]);
    edge(-1, 1, true, seen[1]);
    edge(1, -1, seen[0], false);
    edge(-1, -1, seen[1], false);
    const grooves = seen[0] && groove ? [-groove, groove].map((y) => `<path class="iso-line" data-tone="faint" d="${pathOf3([P3(i, 1, y), P3(i + 1, 1, y)])}"/>`).join("") : "";
    const lines = grooves + edges.map((e) => `<path class="iso-line iso-edge" data-tone="${e.crease ? "faint" : tone}" d="${e.d}"/>`).join("");
    const mid = [(points[i][0] + points[i + 1][0]) / 2, y0, (points[i][1] + points[i + 1][1]) / 2];
    items.push({ x: mid[0], key: G.dot3(mid, V), svg: `<g class="iso-solid"${seamless ? " data-seamless" : ""}>${body.join("")}${lines}</g>` });
  }
  return items.sort((a, b) => a.key - b.key);
}
const bandPoints = Array.from({ length: 97 }, (_, i) => arch(-Math.PI / 2 + (i / 96) * Math.PI));
const BAND_ITEMS = ribbon(bandPoints, BAND.th, BAND.w, { groove: 1 - 8 / BAND.w, y0: BAND.y });
const armRight = () => BAND_ITEMS.filter((item) => item.x >= 62).map((item) => item.svg).join("") + shoe(1);
const CUSHION_OFF = BAND.th / 2 + CUSHION.th / 2;
const cushionPoints = Array.from({ length: 49 }, (_, i) => {
  const t = -CUSHION.span + (i / 48) * 2 * CUSHION.span;
  const [x, z] = arch(t);
  const dx = BAND.x * Math.cos(t);
  const dz = -BAND.rise * Math.sin(t);
  const len = Math.hypot(dx, dz);
  return [x - (-dz / len) * CUSHION_OFF, z - (dx / len) * CUSHION_OFF];
});
// The velour suspension pad: wide in the middle, tapering to both ends, inset from the band edges.
const CUSHION_ITEMS = ribbon(cushionPoints, CUSHION.th, (f) => CUSHION.narrow + (CUSHION.wide - CUSHION.narrow) * Math.sin(Math.PI * f) ** 0.6, { tone: "mid", groove: 0.6, y0: BAND.y });
const bandSlice = (from, to) => BAND_ITEMS.filter((item) => item.x >= from && item.x < to).map((item) => item.svg).join("");

// The yoke block at each band end: where the cup hangs from the band.
function shoe(side) {
  const x0 = side > 0 ? BAND.x - 4 : -BAND.x - 6;
  const plan = { x: x0, y: -18, w: 10, d: 36, r: 3 };
  const out = [S(k.slabOf(plan, SHOE.z0, SHOE.z1 - SHOE.z0, P, 4, 0.5), { tone: "mid" })];
  out.push(D([at([plan.x + 5, plan.y + plan.d, SHOE.z0 + 5]), at([plan.x + 5, plan.y + plan.d, SHOE.z1 - 5])], { size: 0.45 }));
  if (side > 0) {
    const F = G.frameOf([plan.x + plan.w, 0, (SHOE.z0 + SHOE.z1) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    out.push(S(G.disc(0, 1.6, 4.4, F, P), { tone: "mid" }));
    out.push(Ln(G.circleOf(F, 1.6, 2, P), { tone: "lo" }));
    // Size-adjust ticks on the band just above the block.
    const ticks = [0, 1, 2, 3, 4].map((i) => pathOf3([[BAND.x + BAND.th / 2, 6, SHOE.z1 + 6 + i * 4], [BAND.x + BAND.th / 2, 12, SHOE.z1 + 6 + i * 4]]));
    out.push(Ln(ticks.join(""), { tone: "lo", free: true }));
  }
  return out.join("");
}

// ---------- the stand ----------
function stand() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of [...k.corners(BASE, 22)].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))) {
    out.push(S(k.cylinder(x, y, 8, -BASE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 6.2, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(Ln(k.planOutline(k.insetPlan(BASE, 6), 0, P), { tone: "lo" }));
  const screws = k.corners(BASE, 12);
  out.push(Ln(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  const label = { x: -118, y: 50, w: 48, d: 15, r: 1.5 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(k.faceTextSvg(k.topMatrix([label.x + 4, label.y + 6], 0.8, P, "x"), "OPEN BACK", { size: 3.6, tone: "mid" }));
  out.push(Ln([9.6, 12].map((y) => k.lineOnTop([label.x + 4, label.y + y], [label.x + 34, label.y + y], 0.8, P)).join(""), { tone: "faint", free: true }));
  out.push(D([at([label.x + 2.2, label.y + 7.5, 0.8]), at([label.x + label.w - 2.2, label.y + 7.5, 0.8])], { size: 0.4 }));
  out.push(S(k.cylinder(0, BAND.y, 14, 0, 4, P, 40, 0.6), { tone: "mid" }));
  out.push(D([0, 1, 2, 3].map((i) => at([10 * Math.cos(i * Math.PI / 2 + 0.6), BAND.y + 10 * Math.sin(i * Math.PI / 2 + 0.6), 4])), { size: 0.45 }));
  return out.join("");
}
function post() {
  const out = [];
  const top = SADDLE.z - SADDLE.r - 6;
  out.push(S(k.cylinder(0, BAND.y, POST_R, 4, top - 4, P, 28), { tone: "mid", crease: "none" }));
  out.push(Ln([60, 140, 200, 250].map((z) => k.sideArc(0, BAND.y, POST_R, z, P, 16)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(0, BAND.y, 8.5, 120, 8, P, 32, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(4.5, BAND.y + 7.5, 2.4, 122, 4, P, 16), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -8, y: BAND.y - 14, w: 16, d: 28, r: 2 }, top, 7, P, 3, 0.5), { tone: "mid" }));
  const F = G.frameOf([0, BAND.y, SADDLE.z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  out.push(S(G.disc(-SADDLE.half, CUSHION.wide / 2, SADDLE.r, F, P), { tone: "mid" }));
  out.push(Ln([-12, -6, 0, 6, 12].map((s) => G.arcOf(F, s, SADDLE.r, P)).join(""), { tone: "lo" }));
  return out.join("");
}
// The near end of the saddle bar sticks out in front of the band cushion, so it is drawn after it.
function saddleEnd() {
  const F = G.frameOf([0, BAND.y, SADDLE.z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  return S(G.disc(CUSHION.wide / 2, SADDLE.half, SADDLE.r, F, P), { tone: "mid", inner: Ln(G.arcOf(F, 17, SADDLE.r, P), { tone: "lo" }) }) + S(G.disc(SADDLE.half, SADDLE.half + 1.4, SADDLE.r - 1.2, F, P), { tone: "mid" });
}

// ---------- cup parts ----------
// side: +1 right cup (seen from outside), -1 left cup (seen from the ear side). F is the cup frame.
function pad(F, side) {
  const out = [];
  const [s0, s1] = L_PAD;
  out.push(S(oval(F, 44, 53, s0, s1), { tone: "mid", crease: "lo" }));
  if (side > 0) {
    // Back of the pad (toward the baffle): the plastic mounting ring with its clips.
    out.push(Ln(ovalLine(F, s1, 41, 50), { tone: "lo" }));
    out.push(Ln(ovalSeam(F, s1 - 6, 44, 53), { tone: "faint" }));
    out.push(S(G.prismOf(F, ellipse(28, 37), s1 - 0.1, s1, P), { tone: "lo", flat: true, crease: "none" }));
    out.push(Ln(ovalLine(F, s1, 28, 37), { tone: "mid" }));
    const clips = [[0, 45.5], [0, -45.5], [36.5, 0], [-36.5, 0]];
    out.push(D(clips.map((p) => at(onFace(F, s1, p))), { size: 0.7, tone: "mid" }));
  } else {
    // Ear side of the pad: velour face, the ear opening, and the fabric and driver seen through it.
    const id = `open${Math.round(F.o[0])}`;
    const opening = ovalLine(F, s0, 28, 37);
    out.push(Ln(ovalSeam(F, s0 + 7, 44, 53), { tone: "faint" }));
    out.push(Ln(ovalLine(F, s0, 38, 47), { tone: "faint" }));
    out.push(`<clipPath id="${id}"><path d="${opening}"/></clipPath>`);
    out.push(`<g clip-path="url(#${id})"><path class="iso-shade" data-shade="1" d="${opening}"/>`);
    out.push(`<path class="iso-shade" data-shade="0" d="${ovalLine(F, L_BAFFLE[0], 30, 39)}"/>`);
    out.push(Ln(ovalLine(F, L_BAFFLE[0], 30, 39), { tone: "lo" }));
    out.push(`<g data-part="left-diaphragm">${Ln(pathOf3(ellipse(DRIVER.diaphragm, DRIVER.diaphragm, 56).map(([u, v]) => onFace(F, L_BAFFLE[0] + 0.1, [u - 4, v])), true), { tone: "lo" })}${Ln(pathOf3(ellipse(9, 9, 40).map(([u, v]) => onFace(F, L_BAFFLE[0] + 0.1, [u - 4, v])), true), { tone: "faint" })}</g>`);
    out.push(`</g>`);
    out.push(Ln(opening, { tone: "mid" }));
  }
  return out.join("");
}
function baffle(F, side) {
  const out = [];
  const [s0, s1] = L_BAFFLE;
  out.push(S(oval(F, 46, 55, s0, s1), { tone: "mid" }));
  if (side < 0) return out.join("");
  out.push(Ln(ovalLine(F, s1, 43, 52), { tone: "lo" }));
  // Front fabric behind the driver seat, the angled seat ring, vents and four screw bosses.
  out.push(S(G.prismOf(F, ellipse(26, 26, 56), s1 - 0.1, s1, P), { tone: "lo", flat: true, crease: "none" }));
  out.push(Ln(ovalLine(F, s1, 26, 26, 56), { tone: "mid" }));
  out.push(Ln(ovalLine(F, s1, 22.5, 22.5, 56), { tone: "lo" }));
  const vents = Array.from({ length: 12 }, (_, i) => (i / 12) * 2 * Math.PI + 0.26).map((a) => [33 * Math.cos(a), 41 * Math.sin(a)]);
  out.push(Ln(vents.map(([u, v]) => pathOf3(ellipse(1.8, 1.8, 12).map(([a, b]) => onFace(F, s1, [u + a, v + b])), true)).join(""), { tone: "lo" }));
  for (const [u, v] of [[29, 31], [-29, 31], [29, -31], [-29, -31]]) {
    const B = G.frameOf(onFace(F, s1, [u, v]), F.a, F.u, F.v);
    out.push(S(G.disc(0, 2.2, 3.4, B, P), { tone: "mid" }));
    out.push(D([at(onFace(B, 2.2, [0, 0]))], { size: 0.5 }));
  }
  return out.join("");
}
function housing(F, side) {
  const out = [];
  const [s0, s1] = L_HOUSING;
  out.push(S(oval(F, CUP.ry, CUP.rz, s0, s1), { tone: "mid", inner: Ln(ovalSeam(F, s0 + 6, CUP.ry, CUP.rz), { tone: "faint" }) }));
  if (side < 0) return out.join("");
  // The open back: a spoke cage over a dark field.
  out.push(S(G.prismOf(F, ellipse(39, 48), s1 - 0.1, s1, P), { tone: "lo", flat: true, crease: "none" }));
  out.push(Ln(ovalLine(F, s1, 39, 48), { tone: "mid" }));
  const hub = 11;
  const spokes = Array.from({ length: 8 }, (_, i) => (i / 8) * 2 * Math.PI + Math.PI / 8).map((a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = 1 / Math.sqrt((c / 39) ** 2 + (s / 48) ** 2);
    return pathOf3([onFace(F, s1, [hub * c, hub * s]), onFace(F, s1, [r * c, r * s])]);
  });
  out.push(Ln(spokes.join(""), { tone: "mid" }));
  out.push(S(G.disc(s1 - 0.1, s1 + 1.6, hub, F, P), { tone: "mid" }));
  out.push(Ln(G.circleOf(F, s1 + 1.6, hub - 3, P), { tone: "lo" }));
  return out.join("");
}
function grille(F, side) {
  const out = [];
  const [s0, s1] = L_GRILLE;
  out.push(S(oval(F, 41, 46, s0, s0 + 2), { tone: "mid" }));
  out.push(S(oval(F, 38, 43, s0 + 2, s1), { tone: "mid", crease: "lo" }));
  if (side < 0) return out.join("");
  const holes = [];
  const gap = 3.1;
  for (let row = -14; row <= 14; row++) {
    const v = row * gap * 0.866;
    for (let col = -13; col <= 13; col++) {
      const u = col * gap + (row % 2 ? gap / 2 : 0);
      if ((u / 35) ** 2 + (v / 40) ** 2 > 1) continue;
      if (u > 4 && u < 19 && v > -29 && v < -17) continue; // the badge
      holes.push(at(onFace(F, s1, [u, v])));
    }
  }
  out.push(D(holes, { size: 0.42, tone: "lo" }));
  const badge = [[6, -27.5], [17, -27.5], [17, -18.5], [6, -18.5]];
  out.push(S(G.prismOf(F, badge, s1, s1 + 0.8, P), { tone: "hi", crease: "none" }));
  out.push(Ln(pathOf3([[7.6, -26], [15.4, -26], [15.4, -20], [7.6, -20]].map((p) => onFace(F, s1 + 0.8, p)), true), { tone: "faint" }));
  return out.join("");
}
// The angled driver: a clear plastic frame, a silver magnet with a copper pole, and the diaphragm seen through the frame.
const DF = (() => {
  const a = [Math.cos(DRIVER.tilt), Math.sin(DRIVER.tilt), 0];
  return G.frameOf([XP + DRIVER.s, 0, ZC], a, G.unit3(G.cross3([0, 0, 1], a)), [0, 0, 1]);
})();
function diaphragm() {
  const out = [];
  out.push(S(G.disc(-0.7, 0, DRIVER.diaphragm, DF, P), { tone: "hi", lit: true, crease: "none" }));
  out.push(Ln([16.5, 14, 11.5].map((r) => G.circleOf(DF, 0, r, P)).join(""), { tone: "lo" }));
  out.push(S(G.disc(0, 6, 8.5, DF, P), { tone: "hi", lit: true }));
  out.push(Ln([2, 3.2, 4.4].map((s) => G.arcOf(DF, s, 8.5, P)).join(""), { tone: "lo" }));
  return out.join("");
}
function driverBody() {
  const out = [];
  out.push(`<g class="clear">${S(G.ringBand(-2.4, 4, DRIVER.diaphragm + 0.4, DRIVER.frame, DF, P), { tone: "mid" })}</g>`);
  out.push(Ln(G.spokesOf(DF, 4, 11.5, DRIVER.frame - 0.6, 6, P, { phase: Math.PI / 6 }), { tone: "mid" }));
  out.push(Ln(G.circleOf(DF, 4, DRIVER.frame - 2.5, P), { tone: "lo" }));
  for (const a of [-0.35, 0.35]) {
    const c = G.add3(G.add3(DF.o, G.mul3(DF.a, 4)), G.add3(G.mul3(DF.u, (DRIVER.frame - 1.6) * Math.cos(a)), G.mul3(DF.v, (DRIVER.frame - 1.6) * Math.sin(a))));
    const T = G.frameOf(c, DF.a, DF.u, DF.v);
    out.push(S(G.disc(0, 0.9, 1.5, T, P), { tone: "mid" }));
    out.push(D([at(G.add3(c, G.mul3(DF.a, 0.9)))], { size: 0.55, tone: "hi" }));
  }
  out.push(S(G.disc(4, 11, 11, DF, P), { tone: "hi", crease: "lo" }));
  out.push(Ln(G.arcOf(DF, 7.5, 11, P), { tone: "faint" }));
  out.push(S(G.disc(11, 12.4, 9.5, DF, P, { bevel: 0.4 }), { tone: "mid" }));
  out.push(S(G.disc(12.4, 13.6, 2.6, DF, P), { tone: "hi" }));
  return out.join("");
}

// Cable socket and twist-lock plug under the left cup, then the cable to a 3.5 mm plug on the stand.
const SOCKET = [-XP - 35.5, 8];
function socket() {
  const [x, y] = SOCKET;
  const bottom = ZC - CUP.rz * Math.sqrt(1 - (y / CUP.ry) ** 2);
  const out = [];
  out.push(S(k.cylinder(x, y, 5.2, bottom - 4, 6, P, 28, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 3.8, bottom - 22, 18, P, 24), { tone: "mid" }));
  out.push(Ln([4, 7, 10, 13].map((dz) => k.sideArc(x, y, 3.8, bottom - 22 + dz, P, 14)).join(""), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 3.2, bottom - 34, 12, P, 24), { tone: "mid", crease: "none" }));
  out.push(Ln([2, 4, 6, 8, 10].map((dz) => k.sideArc(x, y, 3.2, bottom - 34 + dz, P, 14)).join(""), { tone: "lo" }));
  return { svg: out.join(""), end: bottom - 34 };
}
const SOCK = socket();
const JACK = { x: 6, y: 62, z: 5 };
const CABLE_R = 1.8;
const cableRoute = G.fillet(
  [
    [SOCKET[0], SOCKET[1], SOCK.end],
    [SOCKET[0], SOCKET[1], 14],
    [SOCKET[0] + 8, SOCKET[1] + 30, CABLE_R],
    [-30, JACK.y, CABLE_R],
    [JACK.x - 10, JACK.y, JACK.z],
    [JACK.x, JACK.y, JACK.z],
  ],
  10,
  9,
  { P, tube: CABLE_R },
);
const CABLE = tubePieces(cableRoute, CABLE_R, P, { maxLength: 18, caps: [false, false] });
const cableSvg = (filter) => CABLE.filter(filter).map((piece) => tubeSvg(piece, { tone: "mid" })).join("");
function jackPlug() {
  const F = G.frameOf([JACK.x, JACK.y, JACK.z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const out = [];
  out.push(S(G.disc(0, 14, 3.4, F, P), { tone: "mid" }));
  out.push(Ln([2, 4, 6, 8, 10, 12].map((s) => G.arcOf(F, s, 3.4, P)).join(""), { tone: "lo" }));
  out.push(S(G.disc(14, 34, 4.8, F, P, { bevel: 0.4 }), { tone: "mid" }));
  out.push(Ln(G.arcOf(F, 24, 4.8, P), { tone: "faint" }));
  out.push(S(G.disc(34, 37, 3, F, P), { tone: "hi" }));
  out.push(S(G.solidOf([[37, 1.75], [47, 1.75], [48.6, 1.2, 1], [49.4, 0.6, 1], [49.8, 0]], F, P), { tone: "hi" }));
  out.push(Ln([40.5, 44].map((s) => G.arcOf(F, s, 1.75, P)).join(""), { tone: "lo" }));
  return out.join("");
}

// A small headphone amplifier on the stand: the 3.5 mm plug goes into its side. A level ladder on top
// shows the music level that also drives the diaphragms and the ripples.
const AMP = { x: JACK.x + 37, y: 46, w: 38, d: 32, r: 3 };
const AMP_H = 20;
const LADDER = Array.from({ length: 8 }, (_, i) => ({ x: AMP.x + 7 + i * 2.9, y: AMP.y + AMP.d - 9 }));
function amp() {
  const out = [`<path class="iso-halo" d="${k.haloOf(AMP, 0, AMP_H, P)}" style="filter:blur(3px)"/>`];
  out.push(S(k.slabOf(AMP, 0, AMP_H, P, 4, 0.8), { tone: "mid", inner: Ln(k.sideSeam(AMP, 3, P, 4), { tone: "faint" }) }));
  const top = AMP_H;
  out.push(Ln(k.planOutline(k.insetPlan(AMP, 3), top, P, 4), { tone: "faint" }));
  // Volume knob with a pointer line, power lamp, and the level ladder.
  const knob = [AMP.x + AMP.w - 9, AMP.y + 11];
  out.push(S(k.cylinder(knob[0], knob[1], 5.5, top, 5, P, 32, 0.4), { tone: "mid" }));
  out.push(Ln(k.knurl(knob[0], knob[1], 5.5, top, top + 5, 36, P), { tone: "lo" }));
  out.push(Ln(k.lineOnTop([knob[0] + 1.2, knob[1] + 1.2], [knob[0] + 3.9, knob[1] + 3.9], top + 5, P), { tone: "hi", free: "start" }));
  out.push(Ln(k.ring(AMP.x + 7, AMP.y + 9, 1.8, top, P, 14), { tone: "lo" }));
  out.push(`<circle class="amp-lamp" cx="${at([AMP.x + 7, AMP.y + 9, top])[0].toFixed(1)}" cy="${at([AMP.x + 7, AMP.y + 9, top])[1].toFixed(1)}" r="1"/>`);
  out.push(LADDER.map(({ x, y }) => `<path class="amp-cell" data-part="cell" d="${k.onTop([[x, y], [x + 2, y], [x + 2, y + 5], [x, y + 5]], top, P, true)}"/>`).join(""));
  out.push(D([[AMP.x + 3, AMP.y + AMP.d - 3], [AMP.x + AMP.w - 3, AMP.y + AMP.d - 3]].map(([x, y]) => at([x, y, top])), { size: 0.45 }));
  return out.join("");
}
// The music signal: a dashed line along the cable centre, flowing from the amplifier to the left cup.
const SIGNAL = `<path class="iso-line signal" data-tone="lit" data-free="" data-part="signal" d="${pathOf3([...cableRoute].reverse())}"/>`;

// ---------- assembling the figure ----------
const RIGHT = cupFrame(1);
const LEFT = cupFrame(-1);
const ripple = (name, count) => Array.from({ length: count }, () => `<path class="iso-line" data-tone="lit" data-free="" data-part="${name}" d="" opacity="0" style="stroke-width:0.6"/>`).join("");
const part = (name, inner) => `<g data-part="${name}">${inner}</g>`;
const layer = (name, inner) => `<g data-part="${name}" data-layer="${name}">${inner}</g>`;


const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "An open-back headphone hanging on a display stand. The left cup shows its velour pad and the cable socket underneath; a cable runs across the stand to a 3.5 mm plug in a small amplifier, whose level ladder rises and falls with the music. The right cup can come off its yoke: its layers fan out along the ear axis — velour pad, baffle with front fabric and screws, the angled driver with a clear frame and a silver magnet, the housing with its open spoke cage, and the perforated grille. The diaphragm moves; ripples show the front wave going to the ear and the back wave leaving through the open grille.",
  body: [
    `<style>.clear .iso-fill,.clear .iso-shade,.clear .iso-top{opacity:.3}</style>`,
    stand(),
    cableSvg((piece) => piece.mid[2] < 10),
    jackPlug(),
    amp(),
    bandSlice(-999, -62) + shoe(-1),
    grille(LEFT, -1),
    housing(LEFT, -1),
    SOCK.svg,
    cableSvg((piece) => piece.mid[2] >= 10),
    SIGNAL,
    baffle(LEFT, -1),
    pad(LEFT, -1),
    `<g>${ripple("front", 3)}</g>`,
    post(),
    CUSHION_ITEMS.map((item) => item.svg).join(""),
    saddleEnd(),
    bandSlice(-62, 62),
    `<g data-part="arm-apart" style="display:none">${armRight()}</g>`,
    layer("pad", pad(RIGHT, 1)),
    layer("baffle", baffle(RIGHT, 1)),
    layer("driver", `${part("diaphragm", diaphragm())}${driverBody()}`),
    layer("housing", housing(RIGHT, 1)),
    `<g data-part="arm-on">${armRight()}</g>`,
    layer("grille", grille(RIGHT, 1)),
    `<g>${ripple("back", 4)}</g>`,
  ],
});

// What each layer of the right cup is and does.
const LAYERS = [
  {
    id: "pad",
    name: "Velour ear pad",
    body: "The pad sits on your head around the ear, not on the ear. With your head, it closes a small air space in front of the ear. That seal keeps the bass: if air leaked around the pad, the back wave would cancel the front wave at low notes. Velour is soft and lets heat out, so the ear stays cool. The pad clips onto the baffle ring.",
    facts: [["Material", "Velour"], ["Fit", "Around the ear"], ["Job", "Seals the air space in front of the ear"]],
  },
  {
    id: "baffle",
    name: "Baffle and front fabric",
    body: "The baffle is the plate that holds the driver at its angle and closes the gap around it, so air moves only through the driver area. Fabric and small openings slow the airflow a little: this is acoustic damping. Designers tune these openings to smooth the bass and calm resonances. Screws fix the baffle to the housing.",
    facts: [["Holds", "The angled driver"], ["Damping", "Fabric and small openings"], ["Fixing", "Four screws into the housing"]],
  },
  {
    id: "driver",
    name: "Driver",
    body: "The part that makes the sound. Music current flows through the voice coil, which sits in the gap of a strong magnet. The magnet pushes the coil, and the coil moves the diaphragm in and out. Each stroke pushes air forward to the ear and backward into the cup at the same moment. The frame here is clear plastic, so you see the lit diaphragm through it. Many open-back designs tilt the driver forward, so sound reaches the ear from slightly in front, like two speakers in front of you.",
    facts: [["Type", "Dynamic (moving coil)"], ["Moving parts", "Diaphragm and voice coil"], ["Drawn size", "42 mm unit, 38 mm diaphragm"], ["Drawn tilt", "10° forward"]],
  },
  {
    id: "housing",
    name: "Open housing",
    body: "The cup body. It carries the baffle and hangs from the yoke block at the end of the headband. Its back is not a wall but a cage of thin spokes, mostly open air. That makes the headphone open-back: the back wave from the driver goes straight out. In a closed cup that air would be trapped. It would push back on the diaphragm like a spring and bounce around inside the cup as echoes.",
    facts: [["Back", "Open spoke cage"], ["Gain", "No trapped air, fewer cup echoes"], ["Cost", "Sound leaks out, room noise comes in"]],
  },
  {
    id: "grille",
    name: "Grille",
    body: "A perforated cover over the cage. It protects the driver from fingers and dust, but it is mostly holes, so the back wave passes into the room. That is why people near you hear your music, and why outside noise reaches your ears. At low notes the wavelength is metres long, far bigger than the driver: the pad seal, not the grille, stops the back wave from cancelling the bass.",
    facts: [["Surface", "Perforated mesh with a badge"], ["Lets out", "The back wave"], ["Wavelength at 50 Hz", "≈ 6.9 m (343 m/s ÷ 50 Hz)"]],
  },
];

const live = `
const P = ${JSON.stringify(P)};
const APART = ${JSON.stringify(APART)}, DELAY = ${JSON.stringify(DELAY)}, DROP = ${DROP};
const ZC = ${ZC}, PAD_X = ${XP}, GRILLE_X = ${XP + L_GRILLE[1]};
const AXIS = ${JSON.stringify(DF.a)};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const parts = Object.fromEntries(Object.keys(APART).map((name) => [name, svg.querySelector('[data-part="' + name + '"]')]));
const diaphragm = svg.querySelector('[data-part="diaphragm"]');
const armOn = svg.querySelector('[data-part="arm-on"]');
const armApart = svg.querySelector('[data-part="arm-apart"]');
const front = [...svg.querySelectorAll('[data-part="front"]')];
const leftDiaphragm = svg.querySelector('[data-part="left-diaphragm"]');
const signal = svg.querySelector('[data-part="signal"]');
const cells = [...svg.querySelectorAll('[data-part="cell"]')];
const back = [...svg.querySelectorAll('[data-part="back"]')];
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const LAYERS = ${JSON.stringify(LAYERS)};
const info = document.querySelector(".hd-info");
const toggleButton = document.querySelector("[data-toggle]");
const chips = [...document.querySelectorAll("[data-pick]")];
const expandButton = info.querySelector("[data-expand]");
const sheetHead = info.querySelector(".hd-sheet-head");
const sheetBody = info.querySelector(".hd-sheet-body");
const infoTitle = info.querySelector("[data-title]");
const infoBody = info.querySelector("[data-body]");
const infoFacts = info.querySelector("[data-facts]");
const IDLE_TITLE = infoTitle.textContent, IDLE_BODY = infoBody.textContent;
let selected = null;
const RATE = 1.1; // visual cycles per second; a real tone is far faster
let hovered = null, drag = null, dragGoal = 0, swallowClick = false;
const nudge = Object.fromEntries(Object.keys(APART).map((name) => [name, 0]));
// One music level drives everything that moves: a beat with accents over a slow swell.
function levelAt(t) {
  if (still.matches) return 0.6;
  const beat = 0.6, b = Math.floor(t / beat), u = (t % beat) / beat;
  const kick = Math.exp(-u * 5) * [1, 0.55, 0.8, 0.5][b % 4];
  return Math.min(1, 0.2 + 0.55 * kick + 0.25 * (0.5 + 0.5 * Math.sin(t * 0.7)));
}
let level = 0.6;
let apart = false, touring = true, visible = false, frame = 0, last = 0, clock = 0, tourClock = 0, idle = 0, progress = 0;
const ease = (t) => t * t * (3 - 2 * t);
const share = (name) => ease(Math.min(1, Math.max(0, (progress - DELAY[name]) / 0.6)));
function ringAt(x, zc, r) {
  const pts = [];
  for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push(iso([x, r * Math.cos(a), zc + r * Math.sin(a)], P)); }
  return pathOf(pts, true);
}
function rings(list, phase, place, gain) {
  list.forEach((el, i) => {
    const age = (phase + i / list.length) % 1;
    const [x, zc, r] = place(age);
    const alpha = gain * (0.35 + 0.65 * level) * Math.sin(Math.PI * age) * 0.6;
    el.setAttribute("d", alpha > 0.01 ? ringAt(x, zc, r) : "");
    el.setAttribute("opacity", alpha.toFixed(3));
  });
}
function draw() {
  for (const name in APART) {
    const f = share(name);
    parts[name].setAttribute("transform", translateAlong(P, [APART[name] * f + nudge[name], 0, -DROP * Math.min(1, f * 3) + Math.abs(nudge[name]) * 0.4]));
  }
  // The band arm is in front of the housing while the cup is on, and behind every layer once the housing has left.
  const housingOff = APART.housing * share("housing");
  armOn.style.display = housingOff < 4 ? "" : "none";
  armApart.style.display = housingOff < 4 ? "none" : "";
  const phase = clock * RATE;
  const push = Math.sin(phase * Math.PI * 2) * 1.6 * level;
  diaphragm.setAttribute("transform", translateAlong(P, [-AXIS[0] * push, -AXIS[1] * push, 0]));
  leftDiaphragm.setAttribute("transform", translateAlong(P, [push * 0.8, 0, 0]));
  signal.style.strokeDashoffset = String(-(clock * 26) % 64);
  signal.style.opacity = (0.3 + 0.7 * level).toFixed(2);
  const lit = Math.round(level * cells.length);
  cells.forEach((cell, i) => cell.toggleAttribute("data-on", i < lit));
  // Both drivers play: the left cup's front wave leaves its pad toward the ear, the right cup's back wave leaves its grille.
  const grilleF = share("grille");
  rings(front, phase % 1, (age) => [-PAD_X + 2 + 26 * age, ZC, 12 + 12 * age], 1);
  rings(back, (phase + 0.5) % 1, (age) => [GRILLE_X + 4 + 34 * age, ZC, 12 + 26 * age], 1 - Math.min(1, grilleF * 4));
  const index = LAYERS.findIndex((item) => item.id === selected);
  const text = index >= 0 ? "layer " + (index + 1) + " of 5 · " + LAYERS[index].name.toLowerCase() : apart ? "right cup apart · 5 layers" : "open back · rear wave exits";
  if (readout.textContent !== text) readout.textContent = text;
  const label = apart ? "Close cup" : "Open cup";
  if (toggleButton.textContent !== label) toggleButton.textContent = label;
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  level = levelAt(clock);
  if (touring) { tourClock += dt; apart = Math.floor(tourClock / 5) % 2 === 1; }
  const dragging = drag && drag.moved;
  const target = dragging ? dragGoal : apart ? 1.4 : 0;
  progress = dragging ? target : progress + (target - progress) * (1 - Math.exp(-dt / 0.45));
  // Hover nudge: the part under the pointer slides a little along the ear axis (outward; the pad toward the ear).
  for (const name in nudge) {
    const open = share(name) > 0.5;
    const want = hovered === name && !dragging ? (open ? 6 : name === "grille" ? 3 : name === "pad" ? -3 : 0) : 0;
    nudge[name] += (want - nudge[name]) * (1 - Math.exp(-dt / 0.16));
  }
  draw();
  frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible && !still.matches) { last = 0; frame = requestAnimationFrame(tick); } };
function rest() {
  touring = false;
  clearTimeout(idle);
  // The idle tour comes back only when no layer is open.
  idle = setTimeout(() => { if (!selected) { touring = true; tourClock = apart ? 5 : 0; run(); } }, 8000);
}
function setApart(next) {
  rest();
  apart = next;
  if (!apart) select(null);
  if (still.matches) { progress = apart ? 1.4 : 0; draw(); }
  run();
}
const toggle = () => setApart(!apart);
function select(id) {
  selected = id;
  for (const name in parts) parts[name].toggleAttribute("data-on", name === id);
  chips.forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.pick === id)));
  // On the phone strip, slide the active button into view without moving the page.
  const strip = document.querySelector(".hd-controls");
  const active = chips.find((chip) => chip.dataset.pick === id);
  if (active && strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2, behavior: still.matches ? "auto" : "smooth" });
  const item = LAYERS.find((entry) => entry.id === id);
  infoTitle.textContent = item ? (LAYERS.indexOf(item) + 1) + " · " + item.name : IDLE_TITLE;
  infoBody.textContent = item ? item.body : IDLE_BODY;
  infoFacts.replaceChildren(...(item ? item.facts.flatMap(([key, value]) => {
    const dt = document.createElement("dt"); dt.textContent = key;
    const dd = document.createElement("dd"); dd.textContent = value;
    return [dt, dd];
  }) : []));
  info.toggleAttribute("data-has", Boolean(item));
  setSheet(item ? (info.dataset.sheet === "full" ? "full" : "peek") : "closed");
  if (item) { rest(); if (!apart) { apart = true; if (still.matches) progress = 1.4; } }
  draw();
  run();
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointerover", (event) => {
  const hit = event.target.closest("[data-layer]");
  hovered = hit ? hit.dataset.layer : null;
  run();
});
stage.addEventListener("pointerleave", () => { hovered = null; });
// Drag sideways anywhere on the figure: right opens the cup, left closes it. A press without movement stays a click.
stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  drag = { x: event.clientX, p: Math.min(1.4, progress), moved: false, id: event.pointerId };
});
stage.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    stage.setPointerCapture(drag.id);
    stage.classList.add("dragging");
    rest();
  }
  dragGoal = Math.min(1.4, Math.max(0, drag.p + (dx / (stage.getBoundingClientRect().width * 0.45)) * 1.4));
  if (still.matches) { progress = dragGoal; draw(); }
  run();
});
function endDrag() {
  if (!drag) return;
  if (drag.moved) {
    swallowClick = true;
    stage.classList.remove("dragging");
    setApart(dragGoal > 0.7);
  }
  drag = null;
}
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);
stage.addEventListener("click", (event) => {
  if (swallowClick) { swallowClick = false; return; }
  const hit = event.target.closest("[data-layer]");
  if (hit) select(hit.dataset.layer);
});
stage.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggle(); return; }
  if (event.key === "Escape") { select(null); return; }
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const at = LAYERS.findIndex((item) => item.id === selected);
  const step = event.key === "ArrowRight" ? 1 : -1;
  const next = at < 0 ? (step > 0 ? 0 : LAYERS.length - 1) : (at + step + LAYERS.length) % LAYERS.length;
  select(LAYERS[next].id);
});
toggleButton.addEventListener("click", toggle);
// The description sheet (phones): closed, peeking with the first lines, or full. Desktop ignores the state.
function setSheet(state) {
  info.dataset.sheet = state;
  document.body.classList.toggle("hd-sheet-open", state !== "closed");
  expandButton.setAttribute("aria-expanded", String(state === "full"));
  expandButton.setAttribute("aria-label", state === "full" ? "Show less" : "Show the full description");
  if (state !== "full") sheetBody.scrollTop = 0;
}
const step = (by) => {
  const at = LAYERS.findIndex((item) => item.id === selected);
  select(LAYERS[at < 0 ? 0 : (at + by + LAYERS.length) % LAYERS.length].id);
};
info.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => step(Number(button.dataset.step))));
info.querySelector("[data-close]").addEventListener("click", () => select(null));
expandButton.addEventListener("click", () => setSheet(info.dataset.sheet === "full" ? "peek" : "full"));
sheetBody.addEventListener("click", () => { if (info.dataset.sheet === "peek") setSheet("full"); });
// Swipe the sheet head: up opens it fully, down shrinks it, and down again closes it.
let swipe = null;
sheetHead.addEventListener("pointerdown", (event) => { if (!event.target.closest(".hd-step")) swipe = { y: event.clientY, id: event.pointerId }; });
// Listen on the window: the finger usually ends outside the head.
window.addEventListener("pointerup", (event) => {
  if (!swipe || event.pointerId !== swipe.id) return;
  const dy = event.clientY - swipe.y;
  swipe = null;
  if (dy < -24) setSheet("full");
  else if (dy > 24) info.dataset.sheet === "full" ? setSheet("peek") : select(null);
});
window.addEventListener("pointercancel", () => { swipe = null; });
chips.forEach((chip) => chip.addEventListener("click", () => select(chip.dataset.pick === selected ? null : chip.dataset.pick)));
if (still.matches) touring = false;
draw();
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "Open-back headphone",
  hint: "Grab and drag ← → to open/close · click a layer",
  readout: "open back · rear wave exits",
  keys: [
    { mark: "edge", label: "Ripples: front wave out of the left pad, back wave out of the right grille" },
    { mark: "dashed", label: "Signal: music current from the amplifier through the cable" },
  ],
  caption:
    "An open-back headphone on a stand. The cable plugs into the left cup only. Take the right cup apart and its layers line up along the ear axis: velour pad, baffle with front fabric, the driver, the housing with its open spoke cage, and the perforated grille. The driver sits at a slight angle, so sound reaches the ear from slightly in front. Each diaphragm stroke sends one wave to the ear and an opposite wave backward, out through the cage and grille: that is what open-back means. Motion is slowed and enlarged.",
  body: `<div class="iso-stage" tabindex="0" role="group" aria-label="Open-back headphone. Drag sideways or press Space to take the right cup apart or put it back. Left and right arrows step through its layers; Escape closes the description.">${svg}</div>`,
});

const PANEL_CSS = `
.iso-stage{cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.iso-stage [data-layer]{cursor:pointer}
.iso-stage.dragging,.iso-stage.dragging [data-layer]{cursor:grabbing}
.iso-stage .signal{stroke-dasharray:2.5 5.5;stroke-width:.9;pointer-events:none}
.iso-stage .amp-cell{fill:var(--anatomy-faint)}
.iso-stage .amp-cell[data-on]{fill:var(--anatomy-lit)}
.iso-stage .amp-lamp{fill:var(--anatomy-lit)}
.iso-stage [data-part="front"],.iso-stage [data-part="back"],.iso-stage [data-part="arm-on"],.iso-stage [data-part="arm-apart"]{pointer-events:none}
.iso-stage [data-layer]:hover .iso-edge{stroke:var(--anatomy-hi)}
.iso-stage [data-layer][data-on] .iso-edge{stroke:var(--anatomy-lit);stroke-width:1.1px}
.hd-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,380px);grid-template-areas:"plate side" "legend side";column-gap:28px;align-items:start;margin:32px 0 36px}
.hd-plate{grid-area:plate}
.hd-legend-wrap{grid-area:legend}
.hd-side{grid-area:side;position:sticky;top:24px;padding:18px 20px 20px;background:var(--anatomy-card);box-shadow:0 0 0 1px var(--anatomy-mid)}
.hd-controls{display:grid;gap:10px;justify-items:start}
.hd-chips{display:flex;flex-wrap:wrap;gap:6px}
.hd-layout button{cursor:pointer;font-family:var(--anatomy-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--anatomy-text);background:var(--anatomy-page);border:1px solid var(--anatomy-lo);border-radius:0;padding:7px 10px;line-height:1}
.hd-layout button:hover{border-color:var(--anatomy-mid);color:var(--anatomy-strong)}
.hd-layout button:focus-visible{outline:2px solid var(--anatomy-blue);outline-offset:2px}
.hd-layout button[data-toggle]{color:var(--anatomy-strong);border-color:var(--anatomy-mid)}
.hd-layout button[aria-pressed="true"]{background:var(--anatomy-strong);border-color:var(--anatomy-strong);color:var(--anatomy-card)}
.hd-info{margin-top:18px}
.hd-grab{display:none}
.hd-titlebar{display:flex;align-items:center;gap:10px}
.hd-info h2{flex:1;margin:0;font-size:15px;font-weight:600;color:var(--anatomy-strong)}
.hd-step{display:none;gap:4px}
.hd-info[data-has] .hd-step{display:flex}
.hd-layout .hd-step button{width:30px;height:30px;padding:0;font-size:15px;letter-spacing:0;text-transform:none}
.hd-sheet-body{margin-top:8px}
.hd-info p{margin:0;max-width:62ch;color:var(--anatomy-text);font-size:13.5px;line-height:1.6}
.hd-info dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:12px 0 0;font-size:12.5px}
.hd-info dl:empty{display:none}
.hd-info dt{font-family:var(--anatomy-mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--anatomy-muted);padding-top:2px}
.hd-info dd{margin:0;color:var(--anatomy-strong);font-variant-numeric:tabular-nums}
/* Phones and small tablets: controls sit right under the figure; the description is a bottom sheet over the page. */
@media (max-width:900px){
  .iso-page{margin-top:16px}
  .hd-layout{--peek:164px;grid-template-columns:minmax(0,1fr);grid-template-areas:"plate" "controls" "legend";margin:0 0 24px}
  .hd-side{display:contents}
  .hd-controls{grid-area:controls;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:10px 16px 4px;scroll-padding-inline:16px}
  .hd-controls::-webkit-scrollbar{display:none}
  .hd-chips{display:contents}
  .hd-layout .hd-controls button{flex:none;min-height:40px;padding:0 12px}
  .hd-info{position:fixed;left:0;right:0;bottom:0;z-index:20;margin:0;display:flex;flex-direction:column;max-height:min(74vh,600px);padding:0 max(16px, calc((100vw - 680px) / 2)) calc(14px + env(safe-area-inset-bottom));background:var(--anatomy-card);box-shadow:0 -1px 0 var(--anatomy-mid),0 -14px 36px rgba(0,0,0,.10);transform:translateY(calc(100% + 56px));transition:transform .32s var(--anatomy-ease),max-height .32s var(--anatomy-ease)}
  .hd-info[data-sheet="peek"]{transform:none;max-height:var(--peek)}
  .hd-info[data-sheet="full"]{transform:none}
  .hd-grab{display:block;align-self:center;width:72px;height:22px;margin:0 auto;padding:0;border:0!important;background:none!important;cursor:grab;touch-action:none}
  .hd-grab span{display:block;width:36px;height:4px;margin:0 auto;border-radius:2px;background:var(--anatomy-lo)}
  .hd-sheet-head{flex:none;touch-action:none}
  .hd-layout .hd-step button{width:40px;height:40px}
  .hd-sheet-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-bottom:4px}
  .hd-info[data-sheet="peek"] .hd-sheet-body{overflow:hidden;cursor:pointer;-webkit-mask-image:linear-gradient(#000 45%,transparent);mask-image:linear-gradient(#000 45%,transparent)}
  body.hd-sheet-open .iso-page{padding-bottom:var(--peek)}
}
@media (max-width:900px) and (prefers-reduced-motion:reduce){.hd-info{transition:none}}
.hint-tap{display:none}
@media (hover:none){.hint-click{display:none}.hint-tap{display:inline}}
/* Phones: the hint wraps inside the card instead of running past its edge. */
@media (max-width:560px){
  .iso-plate{padding-bottom:88px}
  .iso-plate-corner[data-corner="hint"]{right:0;white-space:normal;line-height:1.6}
  .hint-sep{display:none}
  .hint-tail{display:block}
}
`;
const chipsHtml = LAYERS.map((item, i) => `<button type="button" data-pick="${item.id}" aria-pressed="false">${i + 1} · ${item.id}</button>`).join("");
const side = `<aside class="hd-side">
<div class="hd-controls" role="toolbar" aria-label="Right cup"><button type="button" data-toggle>Open cup</button><div class="hd-chips" role="group" aria-label="Layers of the right cup">${chipsHtml}</div></div>
<section class="hd-info" data-sheet="closed" aria-live="polite" aria-label="Layer description">
<div class="hd-sheet-head"><button type="button" class="hd-grab" data-expand aria-expanded="false" aria-label="Show the full description"><span></span></button>
<div class="hd-titlebar"><h2 data-title>Pick a layer</h2><div class="hd-step"><button type="button" data-step="-1" aria-label="Previous layer">‹</button><button type="button" data-step="1" aria-label="Next layer">›</button><button type="button" data-close aria-label="Close the description">×</button></div></div></div>
<div class="hd-sheet-body"><p data-body>Grab and drag the figure ← → to open or close the right cup. Click any of its layers, or a button above, to see what it is and what it does. Five layers, from the ear outward: pad, baffle, driver, housing, grille.</p>
<dl data-facts></dl></div>
</section>
</aside>`;
// Split the card from its legend so the grid can place them: card and legend on the left, controls and
// description on the right; on narrow screens card, controls, legend, with the description as a bottom sheet.
const plateStart = body.indexOf('<div class="iso-plate">');
const captionStart = body.indexOf("<figcaption");
const captionEnd = body.lastIndexOf("</figcaption>") + "</figcaption>".length;
const plateMarkup = body.slice(plateStart, captionStart);
const legendMarkup = body.slice(captionStart, captionEnd).replace("<figcaption", "<div").replace(/<\/figcaption>$/, "</div>");
// The hint corner: one line on wide screens; on phones it breaks after "open/close" and says "tap".
const hintFrom = `>${"Grab and drag ← → to open/close · click a layer"}<`;
if (!plateMarkup.includes(hintFrom)) throw new Error("hint text not found");
const plateWithHint = plateMarkup.replace(hintFrom, '>Grab and drag ← → to open/close<span class="hint-sep"> · </span><span class="hint-tail"><span class="hint-click">click</span><span class="hint-tap">tap</span> a layer</span><');
const page = `<style>${PANEL_CSS}</style><div class="hd-layout"><div class="hd-plate">${plateWithHint}</div>${side}<div class="hd-legend-wrap">${legendMarkup}</div></div>`;

const file = "index.html";
writeFileSync(join(HERE, file), k.pageHtml({ title: "Open-back headphone", theme, body: page, script: kitScript() + live, width: 1160 }));
console.log("wrote", file);
