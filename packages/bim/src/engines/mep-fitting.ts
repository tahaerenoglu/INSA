/**
 * mep_fitting engine (Phase 14): REAL fitting products (elbow, tee, cross, reducer, transition, coupling) for pipes, ducts, cable carriers and cables.
 * A fitting is an element with a point placement (yaw / pitch / roll about its origin) whose geometry and CONNECTORS are DERIVED from its type's
 * parameters (sections, angle, radius, lengths): nothing derived is stored. Connectivity stays with MepJunction (explicit); a fitting passes the medium
 * between all its connectors in the network graph. Local frame: the run is along +X; inlet at the origin facing -X.
 * No fabrication detail (no flanges, welds, wall thickness); no engineering analysis (no loss coefficients).
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, MepFitting, FittingType, FittingSection } from "../model.js";
import type { IfcWriteContext } from "../ifc.js";
import type { ResolvedConnector, V3 } from "../mep.js";
import { findCategory } from "../taxonomy.js";
import { fail } from "./kit.js";
import { memberFrame } from "./profile-member.js";

const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;   // + 0: never -0
const rad = (d: number) => (d * Math.PI) / 180;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const FITTING_KINDS = ["elbow", "tee", "cross", "reducer", "transition", "coupling"] as const;
/** IFC PredefinedType of a fitting kind, per fitting CLASS (checked against the schema enumeration of the category: a kind a class cannot express is refused) */
export const FITTING_PREDEFINED: Record<string, Partial<Record<(typeof FITTING_KINDS)[number], string>>> = {
  IfcPipeFitting: { elbow: "BEND", tee: "JUNCTION", cross: "JUNCTION", reducer: "TRANSITION", transition: "TRANSITION", coupling: "CONNECTOR" },
  IfcDuctFitting: { elbow: "BEND", tee: "JUNCTION", cross: "JUNCTION", reducer: "TRANSITION", transition: "TRANSITION", coupling: "CONNECTOR" },
  IfcCableCarrierFitting: { elbow: "BEND", tee: "TEE", cross: "CROSS", reducer: "REDUCER" },
  IfcCableFitting: { coupling: "CONNECTOR", transition: "TRANSITION" },
};

export const sectionProblem = (s: FittingSection | undefined, what: string): string | null => {
  if (!s || typeof s !== "object") return `${what}: a section is required`;
  if (s.shape === "round") return fin(s.diameter) && s.diameter > 0 ? null : `${what}: a round section needs a positive diameter`;
  if (s.shape === "rectangular") return fin(s.width) && s.width > 0 && fin(s.height) && s.height > 0 ? null : `${what}: a rectangular section needs positive width and height`;
  return `${what}: shape must be round | rectangular`;
};
const size = (s: FittingSection) => (s.shape === "round" ? s.diameter : Math.max(s.width, s.height));
export const sectionArea = (s: FittingSection) => (s.shape === "round" ? (Math.PI * s.diameter ** 2) / 4 : s.width * s.height);

/** the first problem of a fitting TYPE (null = valid) */
export function fittingTypeProblem(t: FittingType): string | null {
  if (!(FITTING_KINDS as readonly string[]).includes(t.fitting)) return `fitting must be one of ${FITTING_KINDS.join(" | ")}`;
  const p = sectionProblem(t.run, "run section") ?? (t.outlet ? sectionProblem(t.outlet, "outlet / branch section") : null);
  if (p) return p;
  const pos = (n: string, v: unknown) => (fin(v) && v > 0 ? null : `${n} must be a finite number greater than 0`);
  switch (t.fitting) {
    case "elbow": return (fin(t.angle) && t.angle > 0 && t.angle < 180 ? null : "an elbow needs an angle in (0, 180) degrees") ?? pos("radius", t.radius) ?? (t.radius! > size(t.run) / 2 ? null : "the centre-line radius must exceed half the section size (the inner radius would vanish)");
    case "coupling": return pos("length", t.length);
    case "reducer": return pos("length", t.length) ?? (t.outlet ? (t.outlet.shape === t.run.shape ? null : "a reducer keeps the section shape (use a transition to change it)") : "a reducer needs an outlet section");
    case "transition": return pos("length", t.length) ?? (t.outlet ? (t.outlet.shape !== t.run.shape ? null : "a transition changes the section shape (use a reducer to change only the size)") : "a transition needs an outlet section");
    case "tee": case "cross": return pos("length", t.length) ?? pos("branchLength", t.branchLength) ?? (t.angle === undefined || (fin(t.angle) && t.angle > 0 && t.angle < 180) ? null : "the branch angle must be in (0, 180) degrees");
  }
  return null;
}

type Part = { kind: "straight"; section: FittingSection; origin: V3; axis: V3; length: number } | { kind: "tapered"; section: FittingSection; end: FittingSection; origin: V3; axis: V3; length: number }
  | { kind: "bend"; section: FittingSection; origin: V3; axis: V3; radius: number; angle: number };
interface LConn { key: string; position: V3; direction: V3; section: FittingSection }
/** the LOCAL layout of a fitting type: connectors, geometry parts and the centre line (no placement applied) */
export function fittingLayout(t: FittingType): { connectors: LConn[]; parts: Part[]; centerline: V3[]; centerlineLength: number } {
  const A = t.run, B = t.outlet ?? t.run, L = t.length ?? 0, X: V3 = [1, 0, 0];
  switch (t.fitting) {
    case "coupling": return { connectors: [{ key: "inlet", position: [0, 0, 0], direction: [-1, 0, 0], section: A }, { key: "outlet", position: [L, 0, 0], direction: X, section: A }], parts: [{ kind: "straight", section: A, origin: [0, 0, 0], axis: X, length: L }], centerline: [[0, 0, 0], [L, 0, 0]], centerlineLength: L };
    case "reducer": return { connectors: [{ key: "inlet", position: [0, 0, 0], direction: [-1, 0, 0], section: A }, { key: "outlet", position: [L, 0, 0], direction: X, section: B }], parts: [{ kind: "tapered", section: A, end: B, origin: [0, 0, 0], axis: X, length: L }], centerline: [[0, 0, 0], [L, 0, 0]], centerlineLength: L };
    case "transition": return { connectors: [{ key: "inlet", position: [0, 0, 0], direction: [-1, 0, 0], section: A }, { key: "outlet", position: [L, 0, 0], direction: X, section: B }],
      parts: [{ kind: "straight", section: A, origin: [0, 0, 0], axis: X, length: L / 2 }, { kind: "straight", section: B, origin: [L / 2, 0, 0], axis: X, length: L / 2 }], centerline: [[0, 0, 0], [L, 0, 0]], centerlineLength: L };
    case "elbow": {
      const th = rad(t.angle!), R = t.radius!, o: V3 = [round(R * Math.sin(th)), round(R * (1 - Math.cos(th))), 0];
      const cl: V3[] = Array.from({ length: 13 }, (_, i) => { const a = (th * i) / 12; return [round(R * Math.sin(a)), round(R * (1 - Math.cos(a))), 0] as V3; });
      return { connectors: [{ key: "inlet", position: [0, 0, 0], direction: [-1, 0, 0], section: A }, { key: "outlet", position: o, direction: [round(Math.cos(th)), round(Math.sin(th)), 0], section: A }],
        parts: [{ kind: "bend", section: A, origin: [0, 0, 0], axis: X, radius: R, angle: th }], centerline: cl, centerlineLength: R * th };
    }
    case "tee": case "cross": {
      const be = rad(t.angle ?? 90), bl = t.branchLength!, d: V3 = [round(Math.cos(be)), round(Math.sin(be)), 0], mid: V3 = [L / 2, 0, 0];
      const tip = (k: number): V3 => [round(L / 2 + k * bl * d[0]), round(k * bl * d[1]), 0];
      const cs: LConn[] = [{ key: "inlet", position: [0, 0, 0], direction: [-1, 0, 0], section: A }, { key: "outlet", position: [L, 0, 0], direction: X, section: A }];
      const parts: Part[] = [{ kind: "straight", section: A, origin: [0, 0, 0], axis: X, length: L }, { kind: "straight", section: B, origin: mid, axis: d, length: bl }];
      if (t.fitting === "tee") cs.push({ key: "branch", position: tip(1), direction: d, section: B });
      else { cs.push({ key: "branch_a", position: tip(1), direction: d, section: B }, { key: "branch_b", position: tip(-1), direction: [-d[0], -d[1], 0], section: B }); parts.push({ kind: "straight", section: B, origin: mid, axis: [-d[0], -d[1], 0], length: bl }); }
      return { connectors: cs, parts, centerline: [[0, 0, 0], [L, 0, 0]], centerlineLength: L + bl * (t.fitting === "cross" ? 2 : 1) };
    }
  }
}

// ---- placement: yaw (Z), pitch (Y), roll (X): R = Rz . Ry . Rx
type M3 = [V3, V3, V3];
export function fittingRotation(el: Pick<MepFitting, "rotation" | "pitch" | "roll">): M3 {
  const [a, b, c] = [rad(el.rotation), rad(el.pitch), rad(el.roll)], ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [[ca * cb, ca * sb * sc - sa * cc, ca * sb * cc + sa * sc], [sa * cb, sa * sb * sc + ca * cc, sa * sb * cc - ca * sc], [-sb, cb * sc, cb * cc]];
}
const mul = (m: M3, v: V3): V3 => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const rv = (v: V3): V3 => [round(v[0]), round(v[1]), round(v[2])];

/** storey-local geometry of a placed fitting (z relative to the storey elevation): what plan, quantities and IFC read */
export function fittingRepresentation(s: BimState, el: MepFitting) {
  const t = s.types[el.type] as FittingType, lay = fittingLayout(t), R = fittingRotation(el), o: V3 = [el.at[0], el.at[1], el.offset];
  const place = (p: V3): V3 => { const q = mul(R, p); return [round(o[0] + q[0]), round(o[1] + q[1]), round(o[2] + q[2])]; };
  const parts = lay.parts.map((p) => {
    const axis = rv(mul(R, p.axis)), f = memberFrame(axis, 0);
    return { ...p, origin: place(p.origin), axis: f.axis, ref: f.ref };
  });
  return { kind: "fitting_sweep" as const, fitting: t.fitting, parts, centerline: lay.centerline.map(place), centerlineLength: lay.centerlineLength };
}
export const fittingPlacement = (el: MepFitting) => ({ kind: "fitting_point" as const, storey: el.storey, at: el.at, offset: el.offset, rotation: el.rotation, pitch: el.pitch, roll: el.roll });

/** DERIVED world connectors (positions follow storey, placement and the type's parameters) */
export function fittingConnectors(s: BimState, el: MepFitting): ResolvedConnector[] {
  const t = s.types[el.type] as FittingType | undefined, cat = findCategory(el.category);
  if (!t || t.kind !== "mep_fitting" || !cat?.mepDomain || fittingTypeProblem(t)) return [];
  const R = fittingRotation(el), z0 = s.storeys[el.storey]?.elevation ?? 0;
  return fittingLayout(t).connectors.map((c) => {
    const p = mul(R, c.position), d = mul(R, c.direction);
    return { ref: { element: el.id, connector: c.key }, owner: "route" as const, domain: cat.mepDomain!, position: [round(el.at[0] + p[0]), round(el.at[1] + p[1]), round(z0 + el.offset + p[2])] as V3, direction: rv(d), flow: "bidirectional" as const,
      shape: c.section.shape, ...(c.section.shape === "round" ? { diameter: c.section.diameter } : { width: c.section.width, height: c.section.height }), system: el.system };
  });
}
export function fittingQuantities(s: BimState, el: MepFitting) {
  const t = s.types[el.type] as FittingType, lay = fittingLayout(t);
  const q: Record<string, number> = { centerline_length: lay.centerlineLength, inlet_area: sectionArea(t.run), connector_count: lay.connectors.length };
  if (t.outlet) q[t.fitting === "tee" || t.fitting === "cross" ? "branch_area" : "outlet_area"] = sectionArea(t.outlet);
  if (t.fitting === "elbow") { q.angle_degrees = t.angle!; q.radius = t.radius!; }
  return q;
}

export function validateFitting(s: BimState, el: MepFitting, d: ErrorDetails) {
  const cat = findCategory(el.category), t = s.types[el.type] as FittingType | undefined, sys = s.mepSystems?.[el.system];
  if (!sys) fail("INVALID_REFERENCE", `${el.id}: MEP system ${String(el.system)} does not exist.`, { ...d, field: "system" });
  if (!t || t.kind !== "mep_fitting") fail("INVALID_REFERENCE", `${el.id}: type ${el.type} is not a fitting type.`, { ...d, field: "type" });
  const tp = fittingTypeProblem(t!);
  if (tp) fail("INVALID_DIMENSION", `${el.id}: type ${t!.name}: ${tp}.`, { ...d, field: "type" });
  if (cat?.mepDomain !== sys!.domain || t!.domain !== sys!.domain) fail("MEP_SYSTEM_DOMAIN_MISMATCH", `${el.id}: ${el.category} (${cat?.mepDomain}), type ${t!.name} (${t!.domain}) and system ${sys!.name} (${sys!.domain}) must share one domain.`, { ...d, field: "system", categoryId: el.category });
  const want = FITTING_PREDEFINED[cat?.ifcClass ?? ""]?.[t!.fitting];
  if (!want || !cat?.ifcPredefinedValues?.includes(want)) fail("INVALID_PREDEFINED_TYPE", `${el.id}: a ${t!.fitting} cannot be expressed by ${cat?.ifcClass} (valid fitting kinds: ${Object.keys(FITTING_PREDEFINED[cat?.ifcClass ?? ""] ?? {}).join(", ")}).`, { ...d, field: "type" });
  if (!s.storeys[el.storey]) fail("INVALID_REFERENCE", `${el.id}: storey ${el.storey} does not exist.`, { ...d, field: "storey" });
  if (!Array.isArray(el.at) || el.at.length !== 2 || !el.at.every(fin) || ![el.offset, el.rotation, el.pitch, el.roll].every(fin)) fail("INVALID_GEOMETRY", `${el.id}: at [x, y], offset, rotation, pitch and roll must be finite numbers.`, { ...d, field: "at" });
}

// ---- IFC (engine-owned writer): ONE writer for every fitting class. Geometry from the derived parts: straight prisms, a TAPERED prism for a round reducer,
// an IfcRevolvedAreaSolid for an elbow (exact for round AND rectangular sections), an exact IfcFacetedBrep for a RECTANGULAR reducer (IfcExtrudedAreaSolidTapered
// between rectangles of different aspect is mis-built by common kernels: found by the independent volume oracle); a transition between different shapes is TWO
// prisms (the loft between a round and a rectangular section is not an IFC primitive: that detail is lost). Class and PredefinedType come from category + type.
export function writeFittingsIfc(c: IfcWriteContext, els: readonly MepFitting[]) {
  for (const el of els) {
    let brepUsed = false;
    const rep = fittingRepresentation(c.s, el), cat = findCategory(el.category), pre = FITTING_PREDEFINED[cat?.ifcClass ?? ""]?.[rep.fitting] ?? "NOTDEFINED";
    const prof = (sec: FittingSection) => c.profile(sec.shape === "round" ? { shape: "circle", d: sec.diameter } : { shape: "rect", b: sec.width, h: sec.height });
    const items = rep.parts.map((p) => {
      const pos = c.axis3(c.pt3(p.origin[0], p.origin[1], p.origin[2]), c.dir3(p.axis[0], p.axis[1], p.axis[2]), c.dir3(p.ref[0], p.ref[1], p.ref[2]));
      if (p.kind === "straight") return c.extrude(prof(p.section), pos, p.length);
      if (p.kind === "tapered" && p.section.shape === "rectangular" && p.end.shape === "rectangular") {
        brepUsed = true;
        const a = p.axis, r = p.ref, u: V3 = [a[1] * r[2] - a[2] * r[1], a[2] * r[0] - a[0] * r[2], a[0] * r[1] - a[1] * r[0]];
        const corner = (sec: { width: number; height: number }, z: number, sw: number, sh: number): V3 => [0, 1, 2].map((i) => p.origin[i] + a[i] * z + r[i] * sw * sec.width / 2 + u[i] * sh * sec.height / 2) as V3;
        const A = [corner(p.section, 0, -1, -1), corner(p.section, 0, 1, -1), corner(p.section, 0, 1, 1), corner(p.section, 0, -1, 1)], B = [corner(p.end, p.length, -1, -1), corner(p.end, p.length, 1, -1), corner(p.end, p.length, 1, 1), corner(p.end, p.length, -1, 1)];
        const pts = [...A, ...B], ctr = [0, 1, 2].map((i) => pts.reduce((m, q) => m + q[i], 0) / 8);
        const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].map((f) => {
          const [P0, P1, P2] = [pts[f[0]], pts[f[1]], pts[f[2]]], n: V3 = [(P1[1] - P0[1]) * (P2[2] - P0[2]) - (P1[2] - P0[2]) * (P2[1] - P0[1]), (P1[2] - P0[2]) * (P2[0] - P0[0]) - (P1[0] - P0[0]) * (P2[2] - P0[2]), (P1[0] - P0[0]) * (P2[1] - P0[1]) - (P1[1] - P0[1]) * (P2[0] - P0[0])];
          const mid = [0, 1, 2].map((i) => f.reduce((m, k) => m + pts[k][i], 0) / 4);
          return [0, 1, 2].reduce((m, i) => m + n[i] * (mid[i] - ctr[i]), 0) > 0 ? f : [...f].reverse();       // outward normal
        });
        const ids = pts.map((q) => c.pt3(q[0], q[1], q[2]));
        return c.add("IFCFACETEDBREP", c.add("IFCCLOSEDSHELL", c.list(faces.map((f) => c.add("IFCFACE", c.list([c.add("IFCFACEOUTERBOUND", `${c.add("IFCPOLYLOOP", c.list(f.map((k) => ids[k])))},.T.`)]))))));
      }
      if (p.kind === "tapered") return c.add("IFCEXTRUDEDAREASOLIDTAPERED", `${prof(p.section)},${pos},${c.zAxis},${c.real(p.length)},${prof(p.end)}`);
      return c.add("IFCREVOLVEDAREASOLID", `${prof(p.section)},${pos},${c.add("IFCAXIS1PLACEMENT", `${c.pt3(p.radius, 0, 0)},${c.dir3(0, 1, 0)}`)},${c.real(p.angle)}`);   // the bend centre is at +ref * radius; the plane normal is the local Y
    });
    const cls = c.classFor(el.category);
    const ref = c.add(cls.entity, `${c.gid(el.id)},$,${c.str(el.name ?? el.id)},$,$,${c.placement(c.storeyPlacement(el.storey), c.identity)},${c.product([c.bodyShape(brepUsed ? "Brep" : "SweptSolid", items)])},${c.str(el.id)},.${pre}.`);
    c.elRef[el.id] = ref;
    c.contain(el, ref);
  }
}
