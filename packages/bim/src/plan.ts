/**
 * Plan drawings of a storey as SVG (and PNG for AI vision): walls drawn layer
 * by layer, slabs with holes, columns, beams, openings with door swings,
 * grid axes and a labelled metre grid so coordinates can be read off the image.
 */
import { Resvg } from "@resvg/resvg-js";
import { BimState, Wall, Slab, Column, Beam, Opening, Insert, LayeredType, ProfileType, Storey, wallFrame, Component } from "./model.js";
import { componentBox } from "./family.js";
import { memberRepresentation, memberWorldEnds } from "./engines/profile-member.js";
import { mepRepresentation, connectorsOf } from "./mep.js";
import { fittingRepresentation } from "./engines/mep-fitting.js";
import { rebarRepresentation } from "./engines/reinforcement.js";
import { isRoundSection, sectionBounds, sectionOutline } from "./section.js";
import { boundaryRepresentation } from "./engines/boundary.js";
import { findCategory } from "./taxonomy.js";
import type { ProfileMember, Boundary, StairElement, PathElement, MepSegment, MepFitting, Reinforcement, FittingType } from "./model.js";
import { stairRepresentation } from "./engines/stair.js";
import { pathRepresentation } from "./engines/path.js";
import { SpatialContext, resolveSpatialElement } from "./spatial.js";
import type { SpatialElement } from "./model.js";
import { P2, add, mul, leftNormal } from "./geo.js";
import { handlersOf, allHandlers } from "./engines/handlers.js";
import type { PlanDrawContext } from "./engines/handlers.js";

const FN_COLORS: Record<string, string> = {
  finish: "#d9cfb8", substrate: "#b9b2a5", insulation: "#f2d16b", structure: "#8a3b2a", membrane: "#3b6fd1",
};

/** Partition the canonical joined cap, including unequal wall thicknesses. */
export function wallLayerPolygon(footprint: P2[], total: number, outer: number, inner: number): P2[] {
  const at = (a: P2, b: P2, offset: number): P2 => {
    const ratio = (offset + total / 2) / total;
    return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
  };
  return [at(footprint[3], footprint[0], outer), at(footprint[2], footprint[1], outer),
    at(footprint[2], footprint[1], inner), at(footprint[3], footprint[0], inner)];
}

export interface PlanOptions { showIds?: boolean; width?: number; }

export function planSvg(s: BimState, storey: Storey, o: PlanOptions = {}): string {
  const W = o.width ?? 1400, pad = 70;
  const els = Object.values(s.elements).filter((e) => e.storey === storey.id);
  const walls = els.filter((e): e is Wall => e.kind === "wall");
  const pts: P2[] = [];
  for (const w of walls) pts.push(...wallFrame(s, w).footprint);
  for (const e of els) {
    pts.push(...(handlersOf(e).planBounds?.(s, e) ?? []).map((q) => [q[0], q[1]] as P2));      // engines that declare their own plan extent
    if (e.kind === "boundary") pts.push(...e.outline);
    if (e.kind === "stair") pts.push(...stairOutline(e));
    if (e.kind === "path") pts.push(...e.path);
    if (e.kind === "mep_segment") pts.push(...e.route.map((q) => q.at));
    if (e.kind === "profile_member") { const w = memberWorldEnds(s, e); pts.push([w.start[0], w.start[1]], [w.end[0], w.end[1]]); }
    if (e.kind === "component") pts.push([e.placement.x, e.placement.y]);
  }
  for (const g of Object.values(s.grids)) pts.push(g.start, g.end);
  if (!pts.length) pts.push([0, 0], [10, 10]);
  const minx = Math.min(...pts.map((p) => p[0])) - 1.5, maxx = Math.max(...pts.map((p) => p[0])) + 1.5;
  const miny = Math.min(...pts.map((p) => p[1])) - 1.5, maxy = Math.max(...pts.map((p) => p[1])) + 1.5;
  const sc = (W - 2 * pad) / Math.max(maxx - minx, 1e-3);
  const H = Math.round((maxy - miny) * sc + 2 * pad);
  const X = (x: number) => (pad + (x - minx) * sc).toFixed(2);
  const Y = (y: number) => (H - pad - (y - miny) * sc).toFixed(2);
  const poly = (p: P2[]) => p.map((q) => `${X(q[0])},${Y(q[1])}`).join(" ");
  const pathOf = (p: P2[]) => "M" + p.map((q) => `${X(q[0])} ${Y(q[1])}`).join(" L") + " Z";
  const out: string[] = [];
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  // metre grid
  const span = Math.max(maxx - minx, maxy - miny);
  const step = [1, 2, 5, 10, 20, 50, 100].find((v) => span / v <= 14) ?? 200;
  for (let x = Math.ceil(minx / step) * step; x <= maxx; x += step)
    out.push(`<line x1="${X(x)}" y1="${pad - 8}" x2="${X(x)}" y2="${H - pad + 8}" stroke="#e8ecf0"/>`,
             `<text x="${X(x)}" y="${H - pad + 24}" font-size="12" fill="#8c96a0" text-anchor="middle">${x}</text>`);
  for (let y = Math.ceil(miny / step) * step; y <= maxy; y += step)
    out.push(`<line x1="${pad - 8}" y1="${Y(y)}" x2="${W - pad + 8}" y2="${Y(y)}" stroke="#e8ecf0"/>`,
             `<text x="${pad - 14}" y="${Number(Y(y)) + 4}" font-size="12" fill="#8c96a0" text-anchor="end">${y}</text>`);

  // slabs
  // rooms / spaces: their DERIVED regions under everything else, labelled with number / name
  const sctx = new SpatialContext(s);
  const spaceLabels: [P2, string][] = [];
  for (const sp of els.filter((e): e is SpatialElement => e.kind === "spatial")) {
    const res = resolveSpatialElement(sctx, sp);
    if (res.status !== "bounded") continue;
    const g = res.region!;
    const pathOfRing = (r: P2[]) => "M " + r.map((q) => `${X(q[0])} ${Y(q[1])}`).join(" L ") + " Z";
    out.push(`<path d="${[g.outer, ...g.holes].map(pathOfRing).join(" ")}" fill="${sp.category === "architecture.room" ? "#f3ead2" : "#dcecf5"}" fill-opacity="0.6" fill-rule="evenodd" stroke="none"/>`);
    spaceLabels.push([g.representativePoint, [sp.number, sp.name].filter(Boolean).join(" ") || sp.id]);
  }
  // boundary engine: floors, ceilings and roofs from the boundary representation. The category's semantic class picks the drawing style
  // (a covering is drawn dashed, as in a reflected ceiling plan; a roof tinted, with an arrow up its slope); geometry is the engine's.
  for (const sl of els.filter((e): e is Boundary => e.kind === "boundary")) {
    const rep = boundaryRepresentation(s, sl), cls = findCategory(sl.category)?.ifcClass, ring = [rep.outer, ...rep.holes].map(pathOf).join(" ");
    if (cls === "IfcCovering") out.push(`<path d="${ring}" fill="none" fill-rule="evenodd" stroke="#b08a2e" stroke-width="1.2" stroke-dasharray="7 4"/>`);
    else if (cls === "IfcRoof") {
      out.push(`<path d="${ring}" fill="#d9a38f" fill-opacity="0.30" fill-rule="evenodd" stroke="#a65d46" stroke-width="1.2"/>`);
      if (rep.kind === "boundary_plane_extrusion") {                              // an arrow up the slope, from the eave side across the middle of the outline
        const u = rep.riseDir, ps = rep.outer.map((q) => q[0] * u[0] + q[1] * u[1]), mid = (Math.min(...ps) + Math.max(...ps)) / 2, len = (Math.max(...ps) - Math.min(...ps)) * 0.3;
        const cx = rep.outer.reduce((a, q) => a + q[0], 0) / rep.outer.length, cy = rep.outer.reduce((a, q) => a + q[1], 0) / rep.outer.length;
        const k = mid - (cx * u[0] + cy * u[1]), base: P2 = [cx + u[0] * (k - len / 2), cy + u[1] * (k - len / 2)], tip: P2 = [base[0] + u[0] * len, base[1] + u[1] * len];
        const n: P2 = [-u[1], u[0]], hd = len * 0.18;
        out.push(`<line x1="${X(base[0])}" y1="${Y(base[1])}" x2="${X(tip[0])}" y2="${Y(tip[1])}" stroke="#a65d46" stroke-width="1.6"/>`,
                 `<polygon points="${poly([tip, [tip[0] - u[0] * hd + n[0] * hd * 0.6, tip[1] - u[1] * hd + n[1] * hd * 0.6], [tip[0] - u[0] * hd - n[0] * hd * 0.6, tip[1] - u[1] * hd - n[1] * hd * 0.6]])}" fill="#a65d46"/>`);
      }
    } else out.push(`<path d="${ring}" fill="#c8ccd2" fill-opacity="0.35" fill-rule="evenodd" stroke="#9aa1aa" stroke-width="1"/>`);
  }
  // stair engine: the run outline, a line at every riser and an arrow in the walking direction (up)
  for (const st of els.filter((e): e is StairElement => e.kind === "stair")) {
    const rep = stairRepresentation(s, st), [dx, dy] = rep.direction, nx = -dy, ny = dx, h = rep.width / 2;
    const at = (sv: number, lat: number): P2 => [rep.origin[0] + dx * sv + nx * lat, rep.origin[1] + dy * sv + ny * lat];
    out.push(`<polygon points="${poly([at(0, -h), at(rep.run, -h), at(rep.run, h), at(0, h)])}" fill="#eef1f4" stroke="#2c2f36" stroke-width="1.2"/>`);
    for (const stp of rep.steps) out.push(`<line x1="${X(at(stp.riserAt, -h)[0])}" y1="${Y(at(stp.riserAt, -h)[1])}" x2="${X(at(stp.riserAt, h)[0])}" y2="${Y(at(stp.riserAt, h)[1])}" stroke="#2c2f36" stroke-width="0.9"/>`);
    const a0 = at(rep.treadDepth * 0.25, 0), a1 = at(rep.run - rep.treadDepth * 0.25, 0), hd = Math.min(0.3, rep.width * 0.25);
    out.push(`<line x1="${X(a0[0])}" y1="${Y(a0[1])}" x2="${X(a1[0])}" y2="${Y(a1[1])}" stroke="#2c2f36" stroke-width="1.4"/>`,
             `<polygon points="${poly([a1, at(rep.run - rep.treadDepth * 0.25 - hd, hd * 0.5), at(rep.run - rep.treadDepth * 0.25 - hd, -hd * 0.5)])}" fill="#2c2f36"/>`);
  }
  // path engine: the railing path (its derived posts as dots)
  for (const pe of els.filter((e): e is PathElement => e.kind === "path")) {
    const rep = pathRepresentation(s, pe);
    out.push(`<polyline points="${poly(pe.closed ? [...rep.path, rep.path[0]] : rep.path)}" fill="none" stroke="#2f6f4f" stroke-width="2.4"/>`);
    for (const p of rep.posts) out.push(`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="2.6" fill="#2f6f4f"/>`);
  }

  // mep_network engine: the projected route centreline (width from the section), one style per category; a vertical segment (no plan length) is a riser marker
  const MEP_STYLE: Record<string, { color: string; dash: string }> = { "plumbing.pipe": { color: "#1f6fb4", dash: "" }, "mechanical.duct": { color: "#3a9d5d", dash: "" },
    "electrical.cable_tray": { color: "#c98a12", dash: "6 3" }, "electrical.conduit": { color: "#b03a2e", dash: "2 3" },
    "electrical.cable_segment": { color: "#8e3a9d", dash: "1 2" }, "mechanical.flexible_duct": { color: "#3a9d5d", dash: "4 2" }, "plumbing.flexible_pipe": { color: "#1f6fb4", dash: "4 2" },
    "plumbing.pipe_fitting": { color: "#0d4f8b", dash: "" }, "mechanical.duct_fitting": { color: "#1f7a43", dash: "" }, "electrical.cable_carrier_fitting": { color: "#a06a00", dash: "" }, "electrical.cable_fitting": { color: "#6c2478", dash: "" } };
  for (const m of els.filter((e): e is MepSegment => e.kind === "mep_segment")) {
    const rep = mepRepresentation(s, m), style = MEP_STYLE[m.category] ?? { color: "#555", dash: "" };
    const w = Math.max(1.5, (rep.section.shape === "round" ? rep.section.diameter! : rep.section.width!) * sc);
    for (const g of rep.segments) {
      if (Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1]) < 1e-6) {
        const cx = Number(X(g.start[0])), cy = Number(Y(g.start[1]));
        out.push(`<circle cx="${cx}" cy="${cy}" r="${(w / 2 + 3).toFixed(2)}" fill="#fff" stroke="${style.color}" stroke-width="1.6"/><path d="M ${cx - 3} ${cy - 3} L ${cx + 3} ${cy + 3} M ${cx + 3} ${cy - 3} L ${cx - 3} ${cy + 3}" stroke="${style.color}" stroke-width="1.2"/>`);
      }
      else out.push(`<line x1="${X(g.start[0])}" y1="${Y(g.start[1])}" x2="${X(g.end[0])}" y2="${Y(g.end[1])}" stroke="${style.color}" stroke-width="${w.toFixed(2)}"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""}/>`);
    }
  }

  // mep_fitting engine: the fitting's centre line (an elbow is its arc) in its category's colour, with a dot at every connector
  for (const f of els.filter((e): e is MepFitting => e.kind === "mep_fitting")) {
    const rep = fittingRepresentation(s, f), col = MEP_STYLE[f.category]?.color ?? "#555";
    const sec = (s.types[f.type] as FittingType).run, w = Math.max(1.8, (sec.shape === "round" ? sec.diameter : sec.width) * sc);
    out.push(`<polyline points="${poly(rep.centerline.map((p) => [p[0], p[1]] as P2))}" fill="none" stroke="${col}" stroke-width="${w.toFixed(2)}" stroke-linejoin="round" opacity="0.85"/>`);
    for (const c of connectorsOf(s, f)) out.push(`<circle cx="${X(c.position[0])}" cy="${Y(c.position[1])}" r="2.8" fill="#fff" stroke="${col}" stroke-width="1.4"/>`);
  }

  // reinforcement engine: every derived bar projected on the plan (thin, one colour per class); a tendon is dashed
  for (const rb of els.filter((e): e is Reinforcement => e.kind === "reinforcement")) {
    const rep = rebarRepresentation(s, rb), tendon = /tendon/.test(rb.category);
    for (const b of rep.bars) out.push(`<polyline points="${poly(b.points.map((p) => [p[0], p[1]] as P2))}" fill="none" stroke="${tendon ? "#7b2d8e" : "#8b1a1a"}" stroke-width="${Math.max(0.8, rep.diameter * sc).toFixed(2)}"${tendon ? ' stroke-dasharray="5 3"' : ""}/>`);
  }

  // engine-owned drawings (capability `plan: draw`): ramps and any extension engine
  const dctx: PlanDrawContext = { s, sc, X, Y, poly };
  for (const h of allHandlers()) if (h.plan.mode === "draw") out.push(...h.plan.draw(dctx, els.filter((e) => e.kind === h.kind)));

  // grid axes
  for (const g of Object.values(s.grids)) {
    out.push(`<line x1="${X(g.start[0])}" y1="${Y(g.start[1])}" x2="${X(g.end[0])}" y2="${Y(g.end[1])}" stroke="#c85050" stroke-width="1" stroke-dasharray="10 6"/>`);
    for (const p of [g.start, g.end])
      out.push(`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="12" fill="#fff" stroke="#c85050" stroke-width="1.5"/>`,
               `<text x="${X(p[0])}" y="${Number(Y(p[1])) + 4.5}" font-size="13" fill="#c85050" text-anchor="middle">${esc(g.name)}</text>`);
  }

  // walls, layer by layer (exterior layer on the exterior side)
  for (const w of walls) {
    const t = s.types[w.type] as LayeredType;
    const total = t.layers.reduce((a, l) => a + l.thickness, 0);
    const sign = w.exterior === "left" ? 1 : -1; // exterior side as signed axis offset
    const footprint = wallFrame(s, w).footprint;
    let o = sign * total / 2;
    for (const l of t.layers) {
      const o2 = o - sign * l.thickness;
      const m = s.materials[l.material];
      out.push(`<polygon points="${poly(wallLayerPolygon(footprint, total, o, o2))}" fill="${m?.color ?? FN_COLORS[l.function] ?? "#777"}" stroke="none"/>`);
      o = o2;
    }
    out.push(`<polygon points="${poly(footprint)}" fill="none" stroke="#2c2f36" stroke-width="1.2"/>`);
  }

  // openings, doors, windows
  for (const op of els.filter((e): e is Opening => e.kind === "opening")) {
    const w = s.elements[op.host] as Wall;
    const f = wallFrame(s, w);
    const n = leftNormal(f.dir);
    const c = add(w.start, mul(f.dir, op.along));
    const a = add(c, mul(f.dir, -op.width / 2)), b = add(c, mul(f.dir, op.width / 2));
    const h = f.t / 2 + 0.02;
    out.push(`<polygon points="${poly([add(a, mul(n, h)), add(b, mul(n, h)), add(b, mul(n, -h)), add(a, mul(n, -h))])}" fill="#fff" stroke="none"/>`);
    const fill = op.filledBy ? (s.elements[op.filledBy] as Insert) : undefined;
    const fillClass = fill ? findCategory(fill.category)?.ifcClass : undefined;      // door / window symbols: category semantics
    if (fillClass === "IfcDoor") {
      const inward = mul(n, w.exterior === "left" ? -1 : 1); // swing into the interior
      const leafEnd = add(a, mul(inward, op.width));
      const rpx = (op.width * sc).toFixed(2);
      out.push(`<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(leafEnd[0])}" y2="${Y(leafEnd[1])}" stroke="#d9822b" stroke-width="2"/>`,
               `<path d="M ${X(leafEnd[0])} ${Y(leafEnd[1])} A ${rpx} ${rpx} 0 0 ${w.exterior === "left" ? 1 : 0} ${X(b[0])} ${Y(b[1])}" fill="none" stroke="#d9822b" stroke-width="1" stroke-dasharray="4 3"/>`);
    } else if (fillClass === "IfcWindow") {
      for (const k of [-0.03, 0.03]) {
        const p1 = add(a, mul(n, k)), p2 = add(b, mul(n, k));
        out.push(`<line x1="${X(p1[0])}" y1="${Y(p1[1])}" x2="${X(p2[0])}" y2="${Y(p2[1])}" stroke="#3c96dc" stroke-width="2"/>`);
      }
    } else {
      out.push(`<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}" stroke="#999" stroke-dasharray="3 3"/>`);
    }
  }

  // profile_member engine: ONE drawing from the profile sweep. An axis member is a dashed axis line, a spatial-axis member (brace) a dashed
  // diagonal in its own colour with end markers, a vertical member its section footprint at the point (a pile in a different tone: it hangs DOWN).
  for (const m of els.filter((e): e is ProfileMember => e.kind === "profile_member")) {
    const rep = memberRepresentation(s, m), w = memberWorldEnds(s, m);
    const o: P2 = [rep.origin[0], rep.origin[1]], u: P2 = rep.direction;
    if (rep.sweep === "axis" || rep.sweep === "spatial") {
      const spatial = rep.sweep === "spatial", col = spatial ? "#b5651d" : "#7850a0";
      out.push(`<line x1="${X(w.start[0])}" y1="${Y(w.start[1])}" x2="${X(w.end[0])}" y2="${Y(w.end[1])}" stroke="${col}" stroke-width="2" stroke-dasharray="${spatial ? "4 4" : "12 6"}"/>`);
      if (spatial) for (const p of [w.start, w.end]) out.push(`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3.2" fill="${col}"/>`);
    } else {
      const fill = m.placement === "member_vertical" && m.direction === "down" ? "#8a6d3b" : "#1e1e1e";
      if (isRoundSection(rep.profile)) out.push(`<circle cx="${X(o[0])}" cy="${Y(o[1])}" r="${(sectionBounds(rep.profile).w / 2 * sc).toFixed(2)}" fill="${fill}"/>`);
      else {
        const v = leftNormal(u), ol = sectionOutline(rep.profile)!;
        out.push(`<polygon points="${poly(ol.map(([x, y]) => add(add(o, mul(u, x)), mul(v, y))))}" fill="${fill}"/>`);
      }
    }
  }

  // generic components: one footprint for every category (derived BOX, never stored)
  for (const c of els.filter((e): e is Component => e.kind === "component"))
    out.push(`<polygon points="${poly(componentBox(s, c).corners)}" fill="#e8f0f8" stroke="#3a6ea5" stroke-width="1.2"/>`);

  for (const [p, t] of spaceLabels)
    out.push(`<text x="${X(p[0])}" y="${Y(p[1])}" font-size="13" fill="#5a4a20" text-anchor="middle" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(t)}</text>`);
  if (o.showIds) {
    const label = (p: P2, t: string, col = "#a02020") =>
      out.push(`<text x="${X(p[0])}" y="${Y(p[1])}" font-size="11" fill="${col}" text-anchor="middle" stroke="#fff" stroke-width="3" paint-order="stroke">${t}</text>`);
    for (const w of walls) label(mul(add(w.start, w.end), 0.5), w.id);
    for (const e of els) {
      if (e.kind === "profile_member" && e.placement === "member_vertical") label(add(e.at, [0, 0.45]), e.id);
      if (e.kind === "boundary") label(e.outline[0].map((v, k) => v + (k ? 0.5 : 0.8)) as P2, e.id, "#555");
      if (e.kind === "hosted_component") {
        const op = s.elements[e.opening] as Opening, w = s.elements[op.host] as Wall, f = wallFrame(s, w);
        label(add(add(w.start, mul(f.dir, op.along)), mul(leftNormal(f.dir), w.exterior === "left" ? -0.6 : 0.6)), e.id, "#b06010");
      }
    }
  }

  const legend = Object.values(s.types).filter((t) => t.kind === "wall").map((t, i) =>
    `<text x="${W - pad}" y="${22 + i * 16}" font-size="12" fill="#2c2f36" text-anchor="end">${esc(t.name)}: ${(t as LayeredType).layers.map((l) => `${esc(s.materials[l.material]?.name ?? "?")} ${(l.thickness * 100).toFixed(1)}`).join(" | ")} (dış → iç, cm)</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, Segoe UI, Arial, sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="28" font-size="17" fill="#2c2f36">${esc(s.project.name)} · ${esc(storey.name)} (+${storey.elevation.toFixed(2)} m)</text>
${legend.join("\n")}
${out.join("\n")}
<text x="${W - pad}" y="${H - 12}" font-size="11" fill="#8c96a0" text-anchor="end">ızgara ${step} m · x → · y ↑</text>
</svg>`;
}

export function svgToPng(svg: string, width?: number): Uint8Array {
  const r = new Resvg(svg, { fitTo: width ? { mode: "width", value: width } : { mode: "original" },
                            font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" } });
  return r.render().asPng();
}

/** Corners of a stair run in plan (for the drawing extents). */
function stairOutline(e: StairElement): P2[] {
  const rep = stairRepresentation({} as BimState, e), [dx, dy] = rep.direction, h = rep.width / 2;
  const at = (sv: number, lat: number): P2 => [rep.origin[0] + dx * sv - dy * lat, rep.origin[1] + dy * sv + dx * lat];
  return [at(0, -h), at(rep.run, -h), at(rep.run, h), at(0, h)];
}
