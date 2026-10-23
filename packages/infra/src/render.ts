/** Infra drawings as SVG -> PNG: plan, longitudinal profile, cross-section, shaded 3D (painter's algorithm). */
import { Resvg } from "@resvg/resvg-js";
import { Alignment3D, PI, PVI, evalH,point3d, sampleStations, kmLabel } from "./alignment.js";
import { boundaries, SectionType } from "./section.js";
import { frames, sweepSolid, sweepAnnulus, Mesh, Frame } from "./sweep.js";
import type { UV } from "./section.js";

/** Visible parts of a layer ring for drawing: coincident inter-layer surfaces are left out. */
function ringParts(fr: Frame[], inner: UV[], outer: UV[], withOuter: boolean, withInner: boolean,independent=false): Mesh {
  if(independent||inner.length!==outer.length){
    const mesh=sweepAnnulus(fr,inner,outer,true),stride=inner.length+outer.length,indices:number[]=[];
    for(let i=0;i<mesh.indices.length;i+=3){const tri=mesh.indices.slice(i,i+3),cap=tri.every(v=>Math.floor(v/stride)===Math.floor(tri[0]/stride)),outerFace=tri.every(v=>v%stride<outer.length);if(cap||(outerFace?withOuter:withInner))indices.push(...tri);}
    return {...mesh,indices};
  }
  const n = outer.length, m = fr.length, pos: number[] = [], ind: number[] = [];
  const place = (f: Frame, [x, y]: UV) => [f.p[0] - x * f.n[0], f.p[1] - x * f.n[1], f.p[2] + y];
  for (const f of fr) { for (const q of outer) pos.push(...place(f, q)); for (const q of inner) pos.push(...place(f, q)); }
  const o = (j: number, i: number) => j * 2 * n + (i % n), k = (j: number, i: number) => j * 2 * n + n + (i % n);
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < n; i++) {
    if (withOuter) ind.push(o(j, i), o(j + 1, i + 1), o(j, i + 1), o(j, i), o(j + 1, i), o(j + 1, i + 1));
    if (withInner) ind.push(k(j, i), k(j, i + 1), k(j + 1, i + 1), k(j, i), k(j + 1, i + 1), k(j + 1, i));
  }
  for (let i = 0; i < n; i++) {
    const e = m - 1;
    ind.push(o(0, i), o(0, i + 1), k(0, i + 1), o(0, i), k(0, i + 1), k(0, i), o(e, i), k(e, i + 1), o(e, i + 1), o(e, i), k(e, i), k(e, i + 1));
  }
  return { positions: pos, indices: ind };
}
import type { Range } from "./tunnel.js";

const FONT = "DejaVu Sans, Segoe UI, Arial, sans-serif";
const LAYER_COLORS = ["#9aa0a6", "#e3b04b", "#8a3b2a", "#5b8def", "#5fb38c"];
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = (v: number, d = 2) => v.toFixed(d);

export function toPng(svg: string): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" } }).render().asPng();
}

function frame(W: number, H: number, title: string, body: string[]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
<rect width="100%" height="100%" fill="#fff"/><text x="24" y="26" font-size="16" fill="#2c2f36">${esc(title)}</text>
${body.join("\n")}</svg>`;
}

const niceStep = (span: number, target: number) => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => span / s <= target) ?? 10000;

// ------------------------------------------------------------------ plan
export function planSvg(name: string, a: Alignment3D, pis: PI[], tunnel?: { ranges: Range[]; sections: Record<string, SectionType> }, W = 1400): string {
  const s0 = a.h[0].s0, s1 = s0 + a.h.reduce((x, e) => x + e.length, 0);
  const st = sampleStations(a, s0, s1, 0.05, 25);
  const pts = st.map((s) => evalH(a.h, s));
  const xs = [...pts.map((p) => p.x), ...pis.map((p) => p.x)], ys = [...pts.map((p) => p.y), ...pis.map((p) => p.y)];
  const pad = 70, span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.08 || 100;
  const minx = (Math.max(...xs) + Math.min(...xs)) / 2 - span / 2, miny = (Math.max(...ys) + Math.min(...ys)) / 2 - span / 2;
  const sc = (W - 2 * pad) / span, H = W;
  const X = (x: number) => fmt(pad + (x - minx) * sc), Y = (y: number) => fmt(H - pad - (y - miny) * sc);
  const out: string[] = [];
  const g = niceStep(span, 8);
  for (let x = Math.ceil(minx / g) * g; x <= minx + span; x += g)
    out.push(`<line x1="${X(x)}" y1="${pad}" x2="${X(x)}" y2="${H - pad}" stroke="#eef1f4"/><text x="${X(x)}" y="${H - pad + 18}" font-size="11" fill="#8c96a0" text-anchor="middle">E ${x.toFixed(0)}</text>`);
  for (let y = Math.ceil(miny / g) * g; y <= miny + span; y += g)
    out.push(`<line x1="${pad}" y1="${Y(y)}" x2="${W - pad}" y2="${Y(y)}" stroke="#eef1f4"/><text x="${pad - 6}" y="${Y(y)}" font-size="11" fill="#8c96a0" text-anchor="end">N ${y.toFixed(0)}</text>`);
  // PI polygon
  out.push(`<polyline points="${pis.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}" fill="none" stroke="#c9ced6" stroke-dasharray="6 5"/>`);
  // tunnel footprint per range
  const typeIds = tunnel ? [...new Set(tunnel.ranges.map((r) => r.section))] : [];
  if (tunnel) tunnel.ranges.forEach((rg) => {
    const i = typeIds.indexOf(rg.section);
    const t = tunnel.sections[rg.section];
    const b = boundaries(t, 0.01).payment, half = Math.max(...b.map((q) => Math.abs(q[0])));
    const fr = frames(a, sampleStations(a, rg.from, rg.to, 0.05, 25), [0, 0, 0]);
    const left = fr.map((f) => `${X(f.p[0] + f.n[0] * half)},${Y(f.p[1] + f.n[1] * half)}`);
    const right = fr.map((f) => `${X(f.p[0] - f.n[0] * half)},${Y(f.p[1] - f.n[1] * half)}`).reverse();
    out.push(`<polygon points="${[...left, ...right].join(" ")}" fill="${LAYER_COLORS[(i % 4) + 1]}" fill-opacity="0.35" stroke="${LAYER_COLORS[(i % 4) + 1]}"/>`);
  });
  out.push(`<polyline points="${pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}" fill="none" stroke="#c0392b" stroke-width="2"/>`);
  // stations
  const step = niceStep(s1 - s0, 12);
  for (let s = Math.ceil(s0 / step) * step; s <= s1 + 1e-6; s += step) {
    const p = evalH(a.h, s), nx = -Math.sin(p.az), ny = Math.cos(p.az);
    out.push(`<line x1="${X(p.x - nx * 6 / sc)}" y1="${Y(p.y - ny * 6 / sc)}" x2="${X(p.x + nx * 6 / sc)}" y2="${Y(p.y + ny * 6 / sc)}" stroke="#2c2f36" stroke-width="1.5"/>`,
             `<text x="${X(p.x + nx * 16 / sc)}" y="${Y(p.y + ny * 16 / sc)}" font-size="11" fill="#2c2f36" text-anchor="middle">${kmLabel(s)}</text>`);
  }
  // element boundaries (TS, SC, CS, ST) and PI data
  for (const e of a.h) if (e.kind !== "line" || e.s0 > s0) out.push(`<circle cx="${X(e.start[0])}" cy="${Y(e.start[1])}" r="3" fill="#fff" stroke="#c0392b"/>`);
  pis.forEach((p, i) => {
    out.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4" fill="#5b6470"/>`);
    if (p.radius) out.push(`<text x="${Number(X(p.x)) + 8}" y="${Number(Y(p.y)) - 8}" font-size="12" fill="#5b6470">PI${i} R=${p.radius}${p.spiral ? ` Ls=${p.spiral}` : ""}</text>`);
  });
  out.push(`<text x="${W - pad}" y="${pad - 20}" font-size="14" fill="#2c2f36" text-anchor="middle">K ↑</text>`);
  return frame(W, H, `${name} · plan · ${kmLabel(s0)} – ${kmLabel(s1)} (L=${fmt(s1 - s0)} m)`, out);
}

// ------------------------------------------------------------------ longitudinal profile
export function profileSvg(name: string, a: Alignment3D, v: PVI[], tunnel?: { ranges: Range[]; sections: Record<string, SectionType> }, W = 1500): string {
  const s0 = a.h[0].s0, s1 = s0 + a.h.reduce((x, e) => x + e.length, 0);
  const st = sampleStations(a, s0, s1, 0.01, 10);
  const zs = st.map((s) => point3d(a, s).z);
  let zmin = Math.min(...zs), zmax = Math.max(...zs);
  const lines: { pts: [number, number][]; color: string }[] = [];
  if (tunnel) tunnel.ranges.forEach((rg) => {
    const b = boundaries(tunnel.sections[rg.section], 0.01).excavation;
    const top = Math.max(...b.map((q) => q[1])), bot = Math.min(...b.map((q) => q[1]));
    const ss = sampleStations(a, rg.from, rg.to, 0.01, 10);
    lines.push({ pts: ss.map((s) => [s, point3d(a, s).z + top]), color: "#8a3b2a" }, { pts: ss.map((s) => [s, point3d(a, s).z + bot]), color: "#8a3b2a" });
    zmin = Math.min(zmin, ...ss.map((s) => point3d(a, s).z + bot)); zmax = Math.max(zmax, ...ss.map((s) => point3d(a, s).z + top));
  });
  const padL = 80, padR = 30, padT = 60, padB = 90, H = 640;
  const ex = Math.max(1, Math.round(((s1 - s0) / (W - padL - padR)) / ((zmax - zmin + 4) / (H - padT - padB)) / 1));
  const zr = (zmax - zmin) + 4, zm = (zmax + zmin) / 2;
  const X = (s: number) => fmt(padL + ((s - s0) / (s1 - s0)) * (W - padL - padR));
  const Y = (z: number) => fmt(padT + (H - padT - padB) * (1 - (z - (zm - zr / 2)) / zr));
  const out: string[] = [];
  const zg = niceStep(zr, 8);
  for (let z = Math.ceil((zm - zr / 2) / zg) * zg; z <= zm + zr / 2; z += zg)
    out.push(`<line x1="${padL}" y1="${Y(z)}" x2="${W - padR}" y2="${Y(z)}" stroke="#eef1f4"/><text x="${padL - 8}" y="${Y(z)}" font-size="11" fill="#8c96a0" text-anchor="end">${z.toFixed(1)}</text>`);
  const step = niceStep(s1 - s0, 14);
  for (let s = Math.ceil(s0 / step) * step; s <= s1 + 1e-6; s += step)
    out.push(`<line x1="${X(s)}" y1="${padT}" x2="${X(s)}" y2="${H - padB}" stroke="#eef1f4"/><text x="${X(s)}" y="${H - padB + 18}" font-size="11" fill="#2c2f36" text-anchor="middle">${kmLabel(s)}</text>`);
  for (const l of lines) out.push(`<polyline points="${l.pts.map(([s, z]) => `${X(s)},${Y(z)}`).join(" ")}" fill="none" stroke="${l.color}" stroke-width="1.5"/>`);
  out.push(`<polyline points="${v.map((p) => `${X(p.station)},${Y(p.z)}`).join(" ")}" fill="none" stroke="#c9ced6" stroke-dasharray="6 5"/>`);
  out.push(`<polyline points="${st.map((s, i) => `${X(s)},${Y(zs[i])}`).join(" ")}" fill="none" stroke="#c0392b" stroke-width="2"/>`);
  v.forEach((p, i) => {
    out.push(`<circle cx="${X(p.station)}" cy="${Y(p.z)}" r="3.5" fill="#5b6470"/>`,
             `<text x="${X(p.station)}" y="${H - padB + 38}" font-size="11" fill="#5b6470" text-anchor="middle">PVI${i} ${p.z.toFixed(2)}${p.curve ? ` L=${p.curve}` : ""}</text>`);
    if (i < v.length - 1) {
      const g = ((v[i + 1].z - p.z) / (v[i + 1].station - p.station)) * 100;
      out.push(`<text x="${X((p.station + v[i + 1].station) / 2)}" y="${H - padB + 58}" font-size="12" fill="#2c2f36" text-anchor="middle">%${g.toFixed(3)}</text>`);
    }
  });
  out.push(`<text x="${W - padR}" y="${H - 12}" font-size="11" fill="#8c96a0" text-anchor="end">düşey abartma ≈ 1:${ex}</text>`);
  return frame(W, H, `${name} · boykesit (kırmızı: proje kotu; kahverengi: tünel tavanı ve tabanı)`, out);
}

// ------------------------------------------------------------------ cross-section
export function sectionSvg(t: SectionType, W = 900): string {
  const b = boundaries(t, 0.001);
  const all = [...b.payment];
  const minx = Math.min(...all.map((q) => q[0])) - 1.5, maxx = Math.max(...all.map((q) => q[0])) + 1.5;
  const miny = Math.min(...all.map((q) => q[1]), 0) - 1.5, maxy = Math.max(...all.map((q) => q[1])) + 1.5;
  const sc = (W - 120) / Math.max(maxx - minx, maxy - miny), H = Math.round((maxy - miny) * sc + 120);
  const X = (x: number) => fmt(60 + (x - minx) * sc), Y = (y: number) => fmt(H - 60 - (y - miny) * sc);
  const poly = (r: [number, number][]) => r.map((q) => `${X(q[0])},${Y(q[1])}`).join(" ");
  const out: string[] = [];
  out.push(`<polygon points="${poly(b.payment)}" fill="#f7efe1" stroke="#b7955b" stroke-dasharray="5 4"/>`);
  for (let i = b.rings.length - 1; i >= 1; i--)
    out.push(`<polygon points="${poly(b.rings[i])}" fill="${LAYER_COLORS[i % LAYER_COLORS.length]}" stroke="#2c2f36" stroke-width="0.8"/>`);
  out.push(`<polygon points="${poly(b.rings[0])}" fill="#ffffff" stroke="#2c2f36" stroke-width="1.2"/>`);
  out.push(`<line x1="${X(-0.6)}" y1="${Y(0)}" x2="${X(0.6)}" y2="${Y(0)}" stroke="#c0392b" stroke-width="2"/><text x="${X(0.7)}" y="${Y(0) }" font-size="12" fill="#c0392b">güzergâh (proje kotu)</text>`);
  const legend = [`iç (serbest) alan ${fmt(areaOf(b.rings[0]))} m²`,
    ...t.layers.map((l, i) => `${l.name}: ${l.outer_profile ? "ölçülü değişken kontur" : l.thickness<.01?`${fmt(l.thickness*1000,1)} mm`:`${fmt(l.thickness * 100, 0)} cm`} · ${fmt(areaOf(b.rings[i + 1]) - areaOf(b.rings[i]))} m²`),
    `kazı hattı ${fmt(areaOf(b.excavation))} m²`, ...(t.overbreak ? [`aşırı kazı payı ${fmt(t.overbreak * 100, 0)} cm → ödeme hattı ${fmt(areaOf(b.payment))} m²`] : [])];
  legend.forEach((l, i) => out.push(`<rect x="${W - 330}" y="${48 + i * 20}" width="12" height="12" fill="${i === 0 ? "#fff" : i <= t.layers.length ? LAYER_COLORS[i % LAYER_COLORS.length] : "#f7efe1"}" stroke="#2c2f36" stroke-width="0.5"/><text x="${W - 312}" y="${58 + i * 20}" font-size="12" fill="#2c2f36">${esc(l)}</text>`));
  return frame(W, H, `Enkesit · ${t.name} (ileri bakış)`, out);
}
function areaOf(p: [number, number][]) { let a = 0; for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; } return Math.abs(a / 2); }

// ------------------------------------------------------------------ shaded 3D (painter's algorithm)
export function threeDSvg(title: string, a: Alignment3D, ranges: Range[], sections: Record<string, SectionType>, W = 1400): string {
  const meshes: { mesh: Mesh; color: string }[] = [];
  const origin = (() => { const p = point3d(a, ranges[0].from); return [p.x, p.y, p.z] as [number, number, number]; })();
  for (const rg of ranges) {
    const t = sections[rg.section];
    const b = boundaries(t, 0.02);
    const fr = frames(a, sampleStations(a, rg.from, rg.to, 0.05, 8), origin);
    const last = t.layers.length - 1;
    t.layers.forEach((l, i) => meshes.push({ mesh: ringParts(fr, b.rings[i], b.rings[i + 1], i === last, i === 0,Boolean(l.outer_profile)), color: LAYER_COLORS[(i + 1) % LAYER_COLORS.length] }));
    if (!t.layers.length) meshes.push({ mesh: sweepSolid(fr, b.excavation), color: LAYER_COLORS[1] });
  }
  const dir = [-0.55, 0.62, -0.56];                 // view direction (from the south-east, above)
  const nrm = Math.hypot(dir[0], dir[1], dir[2]); const d = dir.map((x) => x / nrm);
  const right = (() => { const r = [d[1], -d[0], 0]; const l = Math.hypot(r[0], r[1]); return [r[0] / l, r[1] / l, 0]; })();
  const up = [right[1] * d[2] - right[2] * d[1], right[2] * d[0] - right[0] * d[2], right[0] * d[1] - right[1] * d[0]];
  const light = (() => { const l = [-d[0] + 0.35 * up[0] + 0.3 * right[0], -d[1] + 0.35 * up[1] + 0.3 * right[1], -d[2] + 0.35 * up[2]]; const n = Math.hypot(...l); return l.map((x) => -x / n); })(); // from behind the camera, slightly above
  type Tri = { pts: [number, number][]; depth: number; fill: string };
  const tris: Tri[] = [];
  const shade = (hex: string, k: number) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${c.map((v) => Math.min(255, Math.round(v * (0.45 + 0.75 * k)))).join(",")})`;
  };
  for (const { mesh, color } of meshes) {
    const P = mesh.positions;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const v = [0, 1, 2].map((k) => { const i = mesh.indices[t + k] * 3; return [P[i], P[i + 1], P[i + 2]]; });
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const facing = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / nl;
      if (facing > 0) continue;                       // back-face culling
      const lam = Math.max(0, -(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / nl);
      tris.push({ pts: v.map((p) => [p[0] * right[0] + p[1] * right[1] + p[2] * right[2], p[0] * up[0] + p[1] * up[1] + p[2] * up[2]]) as [number, number][],
                  depth: v.reduce((s, p) => s + p[0] * d[0] + p[1] * d[1] + p[2] * d[2], 0) / 3, fill: shade(color, lam) });
    }
  }
  tris.sort((x, y) => y.depth - x.depth);
  const xs = tris.flatMap((t) => t.pts.map((p) => p[0])), ys = tris.flatMap((t) => t.pts.map((p) => p[1]));
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const sc = Math.min((W - 80) / (maxx - minx), 900 / (maxy - miny)), H = Math.round((maxy - miny) * sc + 100);
  const out = tris.map((t) => `<polygon points="${t.pts.map((p) => `${fmt(40 + (p[0] - minx) * sc, 1)},${fmt(H - 40 - (p[1] - miny) * sc, 1)}`).join(" ")}" fill="${t.fill}" stroke="${t.fill}" stroke-width="0.4"/>`);
  return frame(W, H, title, out);
}
