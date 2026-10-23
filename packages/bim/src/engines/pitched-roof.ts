/**
 * pitched_roof engine (Phase 14, Milestone B): GABLE and HIP roofs on a RECTANGULAR footprint (IfcRoof decomposed into IfcSlab ROOF planes). Intent: the
 * footprint (4 points, a rectangle in any orientation), the form, the pitch (deg), which side the ridge runs along, the overhang and the eave elevation;
 * the layered roof TYPE gives the thickness. The planes, ridge, hips, eaves, areas and the solids are DERIVED with stable plane ids `<id>.R<k>`.
 *   gable  2 planes, ridge parallel to the chosen side, height (span / 2) * tan(pitch).
 *   hip    4 planes (2 trapezoids + 2 triangles); the ridge must run along the long side (ridge length = length - span; 0 = a pavilion roof of 4 triangles).
 * Planes are slabs whose TOP face is the roof surface (thickness below, perpendicular to the plane); at hips / ridges neighbouring slabs overlap, so
 * `volume_gross` is the sum of the plane volumes (overlaps not subtracted).
 * NOT modelled (and not claimed): valleys, L / T / general footprints and multi-roof intersections, roof openings (skylights, chimneys), dormers, gambrel /
 * mansard forms, eave detailing, layer-by-layer plane build-up.
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, PitchedRoof, LayeredType } from "../model.js";
import type { IfcWriteContext } from "../ifc.js";
import type { PlanDrawContext } from "./handlers.js";
import { findCategory } from "../taxonomy.js";
import { GEOMETRY_EPSILON as E } from "../geometry.js";
import { fail, finite, positive } from "./kit.js";

type V3 = [number, number, number];
type P2 = [number, number];
const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
const rad = (d: number) => (d * Math.PI) / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/** the rectangle behind an outline: null when it is not one (4 points, right angles, positive size) */
export function rectangleOf(outline: P2[]) {
  if (!Array.isArray(outline) || outline.length !== 4 || !outline.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return null;
  const [p0, p1, p2, p3] = outline, a: P2 = [p1[0] - p0[0], p1[1] - p0[1]], b: P2 = [p3[0] - p0[0], p3[1] - p0[1]], la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
  if (la <= E || lb <= E) return null;
  if (Math.abs(a[0] * b[0] + a[1] * b[1]) > 1e-6 * la * lb) return null;
  if (Math.hypot(p2[0] - (p0[0] + a[0] + b[0]), p2[1] - (p0[1] + a[1] + b[1])) > 1e-6 * (la + lb)) return null;
  return { p0, a, b, la, lb, center: [p0[0] + (a[0] + b[0]) / 2, p0[1] + (a[1] + b[1]) / 2] as P2 };
}
export function roofGeometry(s: BimState, el: PitchedRoof) {
  const r = rectangleOf(el.outline)!, t = s.types[el.type] as LayeredType, thickness = t.layers.reduce((n, l) => n + l.thickness, 0);
  // ridge direction: along the longer ('long') or the shorter ('short') side
  const aLong = r.la >= r.lb, alongA = (el.ridge === "long") === aLong;
  const lenRaw = alongA ? r.la : r.lb, spanRaw = alongA ? r.lb : r.la, rv: P2 = alongA ? [r.a[0] / r.la, r.a[1] / r.la] : [r.b[0] / r.lb, r.b[1] / r.lb], cv: P2 = [-rv[1], rv[0]];
  const ell = lenRaw + 2 * el.overhang, span = spanRaw + 2 * el.overhang, tan = Math.tan(rad(el.pitch)), hR = (span / 2) * tan;
  const at = (x: number, y: number, z: number): V3 => [round(r.center[0] + rv[0] * x + cv[0] * y), round(r.center[1] + rv[1] * x + cv[1] * y), round(el.offset + z)];
  const hx = el.form === "hip" ? (ell - span) / 2 : ell / 2;                       // half the ridge length
  const polys: V3[][] = el.form === "gable"
    ? [[at(-ell / 2, span / 2, 0), at(ell / 2, span / 2, 0), at(ell / 2, 0, hR), at(-ell / 2, 0, hR)], [at(ell / 2, -span / 2, 0), at(-ell / 2, -span / 2, 0), at(-ell / 2, 0, hR), at(ell / 2, 0, hR)]]
    : [[at(-ell / 2, span / 2, 0), at(ell / 2, span / 2, 0), at(hx, 0, hR), at(-hx, 0, hR)], [at(ell / 2, -span / 2, 0), at(-ell / 2, -span / 2, 0), at(-hx, 0, hR), at(hx, 0, hR)],
       [at(ell / 2, -span / 2, 0), at(ell / 2, span / 2, 0), at(hx, 0, hR)], [at(-ell / 2, span / 2, 0), at(-ell / 2, -span / 2, 0), at(-hx, 0, hR)]];
  const planes = polys.map((poly, k) => {
    const pts = poly.filter((p, i) => i === 0 || Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1], p[2] - poly[i - 1][2]) > 1e-9);    // a pavilion roof's trapezoids collapse to triangles
    let n = unit(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];                                          // upward normal
    const area = Math.abs(pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length], c = cross(sub(p, pts[0]), sub(q, pts[0])); return sum + dot(c, n); }, 0)) / 2;
    return { id: `${el.id}.R${k}`, polygon: pts, normal: n.map(round) as V3, area };
  });
  const ridge: [V3, V3] | null = hx > 1e-9 ? [at(-hx, 0, hR), at(hx, 0, hR)] : null;
  const hips: [V3, V3][] = el.form === "hip" ? [[at(ell / 2, span / 2, 0), at(hx, 0, hR)], [at(-ell / 2, span / 2, 0), at(-hx, 0, hR)], [at(ell / 2, -span / 2, 0), at(hx, 0, hR)], [at(-ell / 2, -span / 2, 0), at(-hx, 0, hR)]] : [];
  const eave: V3[] = [at(-ell / 2, -span / 2, 0), at(ell / 2, -span / 2, 0), at(ell / 2, span / 2, 0), at(-ell / 2, span / 2, 0)];
  return { thickness, ell, span, hR, rv, cv, center: r.center, planes, ridge, hips, eave };
}
const len3 = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

export function validatePitchedRoof(s: BimState, el: PitchedRoof, d: ErrorDetails) {
  const r = rectangleOf(el.outline);
  if (!r) fail("INVALID_ROOF_GEOMETRY", `${el.id}: the footprint must be a rectangle (4 points, right angles, positive size).`, { ...d, field: "outline" });
  if (el.form !== "gable" && el.form !== "hip") fail("INVALID_ROOF_GEOMETRY", `${el.id}: form must be gable | hip.`, { ...d, field: "form" });
  if (el.ridge !== "long" && el.ridge !== "short") fail("INVALID_ROOF_GEOMETRY", `${el.id}: ridge must be long | short.`, { ...d, field: "ridge" });
  if (!(finite(el.pitch, `${el.id} pitch`, { ...d, field: "pitch" }), el.pitch > 0 && el.pitch <= 80)) fail("INVALID_ROOF_GEOMETRY", `${el.id}: the pitch must be in (0, 80] degrees.`, { ...d, field: "pitch" });
  if (!(Number.isFinite(el.overhang) && el.overhang >= 0)) fail("INVALID_ROOF_GEOMETRY", `${el.id}: the overhang must be >= 0.`, { ...d, field: "overhang" });
  finite(el.offset, `${el.id} eave elevation`, { ...d, field: "offset" });
  const t = s.types[el.type] as LayeredType;
  positive(t.layers.reduce((n, l) => n + l.thickness, 0), `${el.id} roof thickness`, { ...d, field: "type" });
  const g = roofGeometry(s, el);
  if (el.form === "hip" && g.ell < g.span - 1e-9) fail("INVALID_ROOF_GEOMETRY", `${el.id}: a hip roof's ridge must run along the LONG side (length ${g.ell.toFixed(3)} m < span ${g.span.toFixed(3)} m); use ridge 'long' or a gable.`, { ...d, field: "ridge" });
}
export const pitchedRoofPlacement = (el: PitchedRoof) => ({ kind: "boundary" as const, storey: el.storey, outline: el.outline, offset: el.offset });
export function pitchedRoofRepresentation(s: BimState, el: PitchedRoof) {
  const g = roofGeometry(s, el);
  return { kind: "roof_planes" as const, form: el.form, pitch: el.pitch, thickness: g.thickness, ridgeHeight: g.hR, planes: g.planes.map((p) => ({ id: p.id, polygon: p.polygon, normal: p.normal, area: p.area })), ridge: g.ridge, hips: g.hips, eave: g.eave };
}
export function pitchedRoofQuantities(s: BimState, el: PitchedRoof) {
  const g = roofGeometry(s, el), area = g.planes.reduce((n, p) => n + p.area, 0);
  return { plane_count: g.planes.length, roof_area: area, plan_area: g.ell * g.span, pitch: el.pitch, ridge_height: g.hR, ridge_length: g.ridge ? len3(g.ridge[0], g.ridge[1]) : 0, hip_length_total: g.hips.reduce((n, h) => n + len3(h[0], h[1]), 0),
           eave_length: 2 * (g.ell + g.span), thickness: g.thickness, volume_gross: area * g.thickness };
}

export function drawPitchedRoofsPlan(c: PlanDrawContext, els: readonly PitchedRoof[]): string[] {
  const out: string[] = [];
  for (const el of els) {
    const g = roofGeometry(c.s, el), xy = (p: V3): P2 => [p[0], p[1]];
    out.push(`<polygon points="${c.poly(g.eave.map(xy))}" fill="#f3e3d3" fill-opacity="0.6" stroke="#9a5b34" stroke-width="1.6"/>`);
    for (const h of g.hips) out.push(`<polyline points="${c.poly(h.map(xy))}" fill="none" stroke="#9a5b34" stroke-width="1.3"/>`);
    if (g.ridge) out.push(`<polyline points="${c.poly(g.ridge.map(xy))}" fill="none" stroke="#6b3412" stroke-width="2.4"/>`);
  }
  return out;
}

// ---- IFC (engine-owned writer): IfcRoof (GABLE_ROOF | HIP_ROOF) aggregating one IfcSlab ROOF per plane. Each plane is a polygon in its own frame (X along the
// first edge, Z pointing DOWN through the thickness), extruded by the thickness: the top face is the roof surface.
export function writePitchedRoofsIfc(c: IfcWriteContext, els: readonly PitchedRoof[]) {
  for (const el of els) {
    const g = roofGeometry(c.s, el), cat = findCategory(el.category)!, tpl = c.template(cat.ifcClass!), slabTpl = c.template("IfcSlab");
    const rvals: Record<string, string> = { GlobalId: c.gid(el.id), Name: c.str(el.name ?? el.id), ObjectPlacement: c.placement(c.storeyPlacement(el.storey), c.identity), Tag: c.str(el.id), PredefinedType: el.form === "gable" ? ".GABLE_ROOF." : ".HIP_ROOF." };
    const roof = c.add(cat.ifcClass!.toUpperCase(), (tpl ?? []).map(([n]) => rvals[n] ?? "$").join(","));
    c.elRef[el.id] = roof; c.contain(el, roof); c.typed(el, roof);
    const refs: string[] = [];
    for (const p of g.planes) {
      const X = unit(sub(p.polygon[1], p.polygon[0])), Z: V3 = [-p.normal[0], -p.normal[1], -p.normal[2]], Y = cross(Z, X);
      const pts = p.polygon.map((q) => [round(dot(sub(q, p.polygon[0]), X)), round(dot(sub(q, p.polygon[0]), Y))] as P2);
      const pos = c.axis3(c.pt3(p.polygon[0][0], p.polygon[0][1], p.polygon[0][2]), c.dir3(Z[0], Z[1], Z[2]), c.dir3(X[0], X[1], X[2]));
      const vals: Record<string, string> = { GlobalId: c.gid(p.id), Name: c.str(p.id), ObjectPlacement: c.placement(c.storeyPlacement(el.storey), c.identity), Representation: c.product([c.bodyShape("SweptSolid", [c.extrude(c.polygonProfile(pts), pos, g.thickness)])]),
        Tag: c.str(p.id), PredefinedType: ".ROOF." };
      refs.push(c.add("IFCSLAB", (slabTpl ?? []).map(([n]) => vals[n] ?? "$").join(",")));
    }
    c.add("IFCRELAGGREGATES", `${c.gid("roof:" + el.id)},$,$,$,${roof},${c.list(refs)}`);
  }
}
