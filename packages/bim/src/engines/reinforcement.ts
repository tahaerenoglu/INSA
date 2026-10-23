/**
 * reinforcement engine (Phase 14): bar SETS, meshes, tendons and tendon conduits bound to an explicit HOST element. Intent = the host, a bar path
 * (storey-local x, y, z), a layout (count, spacing, direction) per layer, an optional bend radius and the cover. Every bar, its length and its volume
 * are DERIVED (nothing per-bar is persisted). Hosting is explicit (never inferred); the bars follow their host when it moves. No code checks, no
 * reinforcement design (no cover / spacing verification beyond positive-number consistency).
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, Reinforcement, RebarType, BarLayer, ProfileType } from "../model.js";
import { findCategory, categoryIdOfElement } from "../taxonomy.js";
import type { IfcWriteContext } from "../ifc.js";
import { fail } from "./kit.js";

export type V3 = [number, number, number];
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]), unit = (a: V3): V3 => { const l = len(a); return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const REBAR_HOSTS = ["structure.column", "structure.framing", "structure.shear_wall", "structure.slab", "structure.footing", "structure.foundation_slab"] as const;
export const MAX_BARS_PER_LAYER = 500;

/** replace every interior corner by a circular arc of the bend radius (6 chords); null = impossible (segments too short for the tangent length) */
export function filletPolyline(pts: V3[], r: number): V3[] | null {
  if (!(r > 0) || pts.length < 3) return pts;
  if (pts.length > 3 && len(sub(pts[0], pts[pts.length - 1])) < 1e-9) {
    const ring = pts.slice(0, -1), out: V3[] = [];
    for (let i = 0; i < ring.length; i++) {
      const corner = filletPolyline([ring[(i + ring.length - 1) % ring.length], ring[i], ring[(i + 1) % ring.length]], r);
      if (!corner) return null;
      out.push(...corner.slice(1, -1));
    }
    return [...out, out[0]];
  }
  const out: V3[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1], P = pts[i], B = pts[i + 1], u1 = unit(sub(P, A)), u2 = unit(sub(B, P));
    const cosPhi = Math.max(-1, Math.min(1, dot(u1, u2))), phi = Math.acos(cosPhi);          // turning angle
    if (phi < 1e-9) { out.push(P); continue; }
    const t = r * Math.tan(phi / 2);
    if (t > len(sub(P, A)) / 2 + 1e-12 || t > len(sub(B, P)) / 2 + 1e-12) return null;
    const T1 = sub(P, mul(u1, t)), T2 = add(P, mul(u2, t)), C = add(P, mul(unit(sub(u2, u1)), r / Math.cos(phi / 2)));
    const v1 = sub(T1, C), v2 = sub(T2, C), psi = Math.PI - phi;
    for (let k = 0; k <= 6; k++) { const s = k / 6, w = add(mul(v1, Math.sin((1 - s) * psi) / Math.sin(psi)), mul(v2, Math.sin(s * psi) / Math.sin(psi))); out.push([round(C[0] + w[0]), round(C[1] + w[1]), round(C[2] + w[2])]); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const polyLen = (p: V3[]) => p.slice(1).reduce((a, q, i) => a + len(sub(q, p[i])), 0);

/** the derived bars of an element, in storey-local coordinates: layer, index and the (filleted) polyline */
export function rebarBars(el: Reinforcement): { layer: number; index: number; points: V3[] }[] {
  const out: { layer: number; index: number; points: V3[] }[] = [];
  el.layers.forEach((L, li) => {
    const base = (el.bendRadius ? filletPolyline(L.path, el.bendRadius) : null) ?? L.path, d = unit(L.direction);
    for (let i = 0; i < L.count; i++) out.push({ layer: li, index: i, points: base.map((p) => [round(p[0] + d[0] * L.spacing * i), round(p[1] + d[1] * L.spacing * i), round(p[2] + d[2] * L.spacing * i)] as V3) });
  });
  return out;
}
export function rebarQuantities(s: BimState, el: Reinforcement) {
  const t = s.types[el.type] as RebarType, bars = rebarBars(el), area = (Math.PI * t.diameter ** 2) / 4, total = bars.reduce((a, b) => a + polyLen(b.points), 0);
  return { bar_count: bars.length, bar_length: polyLen(bars[0].points), total_length: total, nominal_diameter: t.diameter, cross_section_area: area, volume: area * total, layer_count: el.layers.length };
}
export const rebarPlacement = (el: Reinforcement) => ({ kind: "host_layout" as const, storey: el.storey, host: el.host, layers: el.layers.length });
export function rebarRepresentation(s: BimState, el: Reinforcement) {
  const t = s.types[el.type] as RebarType;
  return { kind: "bar_sweep" as const, diameter: t.diameter, ...(t.wallThickness ? { wallThickness: t.wallThickness } : {}), bars: rebarBars(el), total_length: rebarQuantities(s, el).total_length };
}

export function validateReinforcement(s: BimState, el: Reinforcement, d: ErrorDetails) {
  const cat = findCategory(el.category), t = s.types[el.type] as RebarType | undefined, host = s.elements[el.host];
  if (!t || t.kind !== "rebar") fail("INVALID_REFERENCE", `${el.id}: type ${el.type} is not a reinforcement type.`, { ...d, field: "type" });
  if (!host) fail("INVALID_REFERENCE", `${el.id}: host ${el.host} does not exist.`, { ...d, field: "host" });
  const hc = categoryIdOfElement(s, host!) ?? "";
  if (!(REBAR_HOSTS as readonly string[]).includes(hc)) fail("INVALID_HOST_RELATION", `${el.id}: ${hc || host!.kind} cannot host reinforcement (hosts: ${REBAR_HOSTS.join(", ")}).`, { ...d, field: "host", hostId: el.host });
  if (host!.storey !== el.storey) fail("INVALID_HOST_RELATION", `${el.id}: reinforcement and its host share one storey (${host!.storey}).`, { ...d, field: "storey", hostId: el.host });
  if (cat?.ifcClass === "IfcTendonConduit" && !(t!.wallThickness && t!.wallThickness * 2 < t!.diameter)) fail("INVALID_DIMENSION", `${el.id}: a tendon conduit needs a type with a wall thickness below half its diameter.`, { ...d, field: "type" });
  if (!fin(el.cover) || el.cover < 0) fail("INVALID_DIMENSION", `${el.id}: cover must be a finite number >= 0.`, { ...d, field: "cover" });
  if (el.bendRadius !== undefined && !(fin(el.bendRadius) && el.bendRadius >= t!.diameter / 2)) fail("INVALID_DIMENSION", `${el.id}: the bend radius must be at least the bar radius.`, { ...d, field: "bend_radius" });
  if (!Array.isArray(el.layers) || !el.layers.length) fail("INVALID_GEOMETRY", `${el.id}: at least one bar layer is required.`, { ...d, field: "layers" });
  if (cat?.ifcClass === "IfcReinforcingMesh" && el.layers.length !== 2) fail("INVALID_GEOMETRY", `${el.id}: a mesh is two crossing layers (longitudinal and transverse).`, { ...d, field: "layers" });
  if ((cat?.ifcClass === "IfcTendon" || cat?.ifcClass === "IfcTendonConduit") && (el.layers.length !== 1 || el.layers[0].count !== 1)) fail("INVALID_GEOMETRY", `${el.id}: a tendon / conduit is ONE path (one layer, count 1).`, { ...d, field: "layers" });
  el.layers.forEach((L: BarLayer, i) => {
    const bad = (m: string): never => fail("INVALID_GEOMETRY", `${el.id}: layer ${i}: ${m}`, { ...d, field: "layers", index: i });
    if (!Array.isArray(L.path) || L.path.length < 2 || !L.path.every((p) => Array.isArray(p) && p.length === 3 && p.every(fin))) bad("a path needs >= 2 points [x, y, z] of finite numbers.");
    L.path.slice(1).forEach((p, k) => { if (len(sub(p, L.path[k])) < 1e-6) bad(`segment ${k} has zero length.`); });
    if (!Number.isInteger(L.count) || L.count < 1 || L.count > MAX_BARS_PER_LAYER) bad(`count must be an integer in [1, ${MAX_BARS_PER_LAYER}].`);
    if (L.count > 1 && !(fin(L.spacing) && L.spacing > 0 && Array.isArray(L.direction) && L.direction.length === 3 && L.direction.every(fin) && len(L.direction) > 1e-9)) bad("a set needs a positive spacing and a non-zero direction.");
    if (L.count > 1 && L.spacing < t!.diameter) bad(`spacing ${L.spacing} is smaller than the bar diameter ${t!.diameter}: bars would overlap.`);
    if (el.bendRadius && filletPolyline(L.path, el.bendRadius) === null) bad("the bend radius does not fit: the segments around a corner are too short.");
  });
  if (el.geometryValidation) {
    const problem = rebarCoverProblem(s, el);
    if (problem) fail('INVALID_HOST_RELATION', `${el.id}: ${problem}`, { ...d, hostId: el.host, field: 'cover' });
  }
}

/** Geometric check, independent of any selected design standard. Historic unverified sets are not silently reclassified. */
export function rebarCoverProblem(s: BimState, el: Reinforcement): string | null {
  const host = s.elements[el.host];
  if (!host || host.kind !== 'profile_member' || host.placement !== 'member_vertical' || host.direction === 'down') return 'Unsupported host for rectangular-column cover verification';
  const profile = (s.types[host.type] as ProfileType).profile;
  if (profile.shape !== 'rect') return 'Unsupported section for rectangular-column cover verification';
  const a = host.rotation * Math.PI / 180, radius = (s.types[el.type] as RebarType).diameter / 2, margin = el.cover + radius;
  for (const bar of rebarBars(el)) for (const p of bar.points) {
    const dx = p[0] - host.at[0], dy = p[1] - host.at[1], x = dx * Math.cos(a) + dy * Math.sin(a), y = -dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(x) > profile.b / 2 - margin + 1e-8 || Math.abs(y) > profile.h / 2 - margin + 1e-8 || p[2] < host.baseOffset + margin - 1e-8 || p[2] > host.baseOffset + host.height - margin + 1e-8)
      return 'Bar surface violates supplied cover or leaves the host prism';
  }
  return null;
}

/** product keys (GlobalId seeds) of a reinforcement element: one per bar, or the element itself for a mesh / tendon / conduit */
export function rebarProductKeys(s: BimState, el: Reinforcement): string[] {
  const cls = findCategory(el.category)?.ifcClass;
  return cls === "IfcReinforcingMesh" || el.layers.reduce((n, L) => n + L.count, 0) === 1 && cls !== "IfcReinforcingBar" ? [el.id] : rebarBars(el).map((b) => `${el.id}:${b.layer}.${b.index}`);
}
// ---- IFC (engine-owned writer): every bar is an IfcReinforcingBar (IfcTendon / IfcTendonConduit for those classes) swept as an IfcSweptDiskSolid along its
// (filleted) polyline; a MESH is ONE product with all its bars. The attribute list comes from the schema template; the host aggregates its bars
// (IfcRelAggregates; the bars are parts, so they are not separately contained in the storey).
export function writeReinforcementIfc(c: IfcWriteContext, els: readonly Reinforcement[]) {
  const parts: Record<string, string[]> = {};
  for (const el of els) {
    const rep = rebarRepresentation(c.s, el), t = c.s.types[el.type] as RebarType, cat = findCategory(el.category)!, cls = cat.ifcClass!, tplAttrs = c.template(cls);
    const A = (Math.PI * t.diameter ** 2) / 4, pre = `.${cat.ifcPredefined ?? "NOTDEFINED"}.`;
    const plen = (pts: number[][]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]), 0);
    const sweep = (pts: number[][]) => c.add("IFCSWEPTDISKSOLID", `${c.add("IFCPOLYLINE", c.list(pts.map((p) => c.pt3(p[0], p[1], p[2]))))},${c.real(t.diameter / 2)},${t.wallThickness ? c.real(t.diameter / 2 - t.wallThickness) : "$"},$,$`);
    const write = (key: string, name: string, solids: string[], extra: Record<string, string>) => {
      const vals: Record<string, string> = { GlobalId: c.gid(key), Name: c.str(name), ObjectPlacement: c.placement(c.storeyPlacement(el.storey), c.identity), Representation: c.product([c.bodyShape("AdvancedSweptSolid", solids)]), Tag: c.str(el.id), PredefinedType: pre,
        SteelGrade: t.steelGrade ? c.str(t.steelGrade) : "$", NominalDiameter: c.real(t.diameter), CrossSectionArea: c.real(A), ...extra };
      const ref = c.add(cls.toUpperCase(), (tplAttrs ?? []).map(([n]) => vals[n] ?? "$").join(","));
      if (cls === 'IfcReinforcingBar') c.typed(el, ref);
      (parts[el.host] ??= []).push(ref); c.elRef[el.id] = c.elRef[el.id] ?? ref;
    };
    if (cls === "IfcReinforcingMesh") write(el.id, el.name ?? el.id, rep.bars.map((b) => sweep(b.points)), { LongitudinalBarNominalDiameter: c.real(t.diameter), TransverseBarNominalDiameter: c.real(t.diameter), LongitudinalBarCrossSectionArea: c.real(A), TransverseBarCrossSectionArea: c.real(A),
      LongitudinalBarSpacing: c.real(el.layers[0].spacing), TransverseBarSpacing: c.real(el.layers[1].spacing) });
    else {
      const keys = rebarProductKeys(c.s, el);
      rep.bars.forEach((b, n) => write(keys[n], `${el.name ?? el.id}${rep.bars.length > 1 ? `.${n + 1}` : ""}`, [sweep(b.points)], { BarLength: c.real(plen(b.points)) }));
    }
  }
  for (const [h, refs] of Object.entries(parts)) if (c.elRef[h]) c.add("IFCRELAGGREGATES", `${c.gid("rebar:" + h)},$,$,$,${c.elRef[h]},${c.list(refs)}`);
}
