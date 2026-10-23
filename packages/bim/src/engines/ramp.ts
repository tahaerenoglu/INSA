/**
 * ramp_flight engine (Phase 14, Milestone B): a straight, sloped walking surface (IfcRampFlight). Intent: the walking line (start -> end), width, the
 * rise over that run and the base elevation of the surface at the start; the thickness and the SLOPE LIMIT come from the RampType (no code is hard-wired).
 * Run, length, slope and the solid are derived. Several flights + landings form a ramp through an ASSEMBLY (rule `ramp_run`), never through special cases here.
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, RampElement, RampType } from "../model.js";
import type { IfcWriteContext } from "../ifc.js";
import type { PlanDrawContext } from "./handlers.js";
import { findCategory } from "../taxonomy.js";
import { GEOMETRY_EPSILON as E, distance } from "../geometry.js";
import { fail, finite, positive, point } from "./kit.js";

export function rampGeometry(el: Pick<RampElement, "start" | "end" | "rise">) {
  const dx = el.end[0] - el.start[0], dy = el.end[1] - el.start[1], run = Math.hypot(dx, dy), length = Math.hypot(run, el.rise);
  return { run, dir: [dx / run, dy / run] as [number, number], length, slope: el.rise / run, angle: Math.atan2(el.rise, run) };
}
export function validateRamp(s: BimState, el: RampElement, d: ErrorDetails) {
  const a = point(el.start, `${el.id} start`, { ...d, field: "start" }), b = point(el.end, `${el.id} end`, { ...d, field: "end" });
  if (distance(a, b) <= E) fail("INVALID_RAMP_GEOMETRY", `${el.id}: the run (${distance(a, b)} m) must be longer than ${E} m.`, { ...d, field: "end" });
  positive(el.width, `${el.id} width`, { ...d, field: "width" });
  finite(el.baseOffset, `${el.id} base offset`, { ...d, field: "baseOffset" });
  positive(el.rise, `${el.id} rise`, { ...d, field: "rise" });
  const t = s.types[el.type] as RampType, g = rampGeometry(el);
  if (g.slope > t.maxSlope + 1e-9) fail("RAMP_TYPE_LIMIT_EXCEEDED", `${el.id}: slope ${(g.slope * 100).toFixed(2)} % exceeds the limit ${(t.maxSlope * 100).toFixed(2)} % of type ${t.name}; lengthen the run or lower the rise.`, { ...d, field: "rise", slope: g.slope, limit: t.maxSlope });
}
export const rampPlacement = (el: RampElement) => ({ kind: "ramp_run" as const, storey: el.storey, start: el.start, end: el.end, width: el.width, baseOffset: el.baseOffset, rise: el.rise });
/** derived: the sloped slab whose TOP face is the walking surface; thickness is measured perpendicular to the slope */
export function rampRepresentation(s: BimState, el: RampElement) {
  const g = rampGeometry(el), t = s.types[el.type] as RampType;
  return { kind: "ramp_run" as const, origin: el.start, direction: g.dir, width: el.width, baseZ: el.baseOffset, rise: el.rise, run: g.run, length: g.length, slope: g.slope, slopeAngle: g.angle, thickness: t.thickness };
}
export function rampQuantities(s: BimState, el: RampElement) {
  const g = rampGeometry(el), t = s.types[el.type] as RampType;
  return { run: g.run, rise: el.rise, length: g.length, width: el.width, slope_percent: g.slope * 100, slope_angle: (g.angle * 180) / Math.PI, thickness: t.thickness, surface_area: el.width * g.length, plan_area: el.width * g.run, volume: el.width * g.length * t.thickness };
}

/** plan: the footprint of every flight, an arrow pointing UP the slope and the slope in percent */
export function drawRampsPlan(c: PlanDrawContext, els: readonly RampElement[]): string[] {
  const out: string[] = [];
  for (const el of els) {
    const g = rampGeometry(el), [dx, dy] = g.dir, nx = -dy * (el.width / 2), ny = dx * (el.width / 2);
    const corners: [number, number][] = [[el.start[0] + nx, el.start[1] + ny], [el.end[0] + nx, el.end[1] + ny], [el.end[0] - nx, el.end[1] - ny], [el.start[0] - nx, el.start[1] - ny]];
    out.push(`<polygon points="${c.poly(corners)}" fill="#efe6cf" stroke="#8a7a4a" stroke-width="1.6"/>`);
    const mx = (el.start[0] + el.end[0]) / 2, my = (el.start[1] + el.end[1]) / 2, hx = el.end[0] - dx * Math.min(0.3, g.run / 4), hy = el.end[1] - dy * Math.min(0.3, g.run / 4);
    out.push(`<polyline points="${c.poly([el.start, el.end])}" fill="none" stroke="#8a7a4a" stroke-width="1.4"/>`,
      `<polyline points="${c.poly([[hx - dy * 0.15, hy + dx * 0.15], el.end, [hx + dy * 0.15, hy - dx * 0.15]])}" fill="none" stroke="#8a7a4a" stroke-width="1.4"/>`,
      `<text x="${c.X(mx)}" y="${c.Y(my)}" font-size="11" fill="#5a4d22" text-anchor="middle">${(g.slope * 100).toFixed(1)} %</text>`);
  }
  return out;
}

// ---- IFC (engine-owned writer): IfcRampFlight swept along the inclined axis; the profile (width x thickness) is centred so the TOP face is the walking surface.
export function writeRampsIfc(c: IfcWriteContext, els: readonly RampElement[]) {
  for (const el of els) {
    const g = rampGeometry(el), t = c.s.types[el.type] as RampType, cat = findCategory(el.category)!, tpl = c.template(cat.ifcClass!);
    const cs = g.run / g.length, sn = el.rise / g.length, a: [number, number, number] = [g.dir[0] * cs, g.dir[1] * cs, sn], ref: [number, number, number] = [-g.dir[1], g.dir[0], 0];
    const n: [number, number, number] = [-sn * g.dir[0], -sn * g.dir[1], cs];                         // unit normal pointing up out of the walking surface (= a x ref)
    const pos = c.axis3(c.pt3(el.start[0] - (n[0] * t.thickness) / 2, el.start[1] - (n[1] * t.thickness) / 2, el.baseOffset - (n[2] * t.thickness) / 2), c.dir3(a[0], a[1], a[2]), c.dir3(ref[0], ref[1], ref[2]));
    const solid = c.extrude(c.profile({ shape: "rect", b: el.width, h: t.thickness }), pos, g.length);
    const vals: Record<string, string> = { GlobalId: c.gid(el.id), Name: c.str(el.name ?? el.id), ObjectPlacement: c.placement(c.storeyPlacement(el.storey), c.identity), Representation: c.product([c.bodyShape("SweptSolid", [solid])]),
      Tag: c.str(el.id), PredefinedType: `.${cat.ifcPredefined ?? "NOTDEFINED"}.` };
    const ref3 = c.add(cat.ifcClass!.toUpperCase(), (tpl ?? []).map(([nm]) => vals[nm] ?? "$").join(","));
    c.elRef[el.id] = ref3; c.contain(el, ref3); c.typed(el, ref3);
  }
}
