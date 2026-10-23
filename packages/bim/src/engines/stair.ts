/**
 * stair engine (Phase 11): a straight run. Intent: walking line (start -> end), width, riser count, base offset and a vertical intent
 * (like a column: the total rise follows the storeys). Everything else - riser height, tread depth, slope, steps, the solid - is derived.
 * Limits come from the StairType, not from constants: no building code is hard-wired.
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, StairElement, StairType } from "../model.js";
import { GEOMETRY_EPSILON as E, distance } from "../geometry.js";
import { fail, finite, positive, point, checkVertical } from "./kit.js";
import { stairGeometry, stairProfile, stairSteps } from "../arch.js";

export function validateStair(s: BimState, el: StairElement, d: ErrorDetails) {
  const a = point(el.start, `${el.id} start`, { ...d, field: "start" }), b = point(el.end, `${el.id} end`, { ...d, field: "end" });
  if (distance(a, b) <= E) fail("INVALID_STAIR_GEOMETRY", `${el.id}: the run (${distance(a, b)} m) must be longer than ${E} m.`, { ...d, field: "end" });
  positive(el.width, `${el.id} width`, { ...d, field: "width" });
  finite(el.baseOffset, `${el.id} base offset`, { ...d, field: "baseOffset" });
  if (!Number.isInteger(el.riserCount) || el.riserCount < 2)
    fail("INVALID_STAIR_GEOMETRY", `${el.id}: a stair needs at least 2 risers (got ${String(el.riserCount)}).`, { ...d, field: "riserCount" });
  // the vertical intent: a constraint must target an existing storey above the base; the stored rise equals the derived one exactly
  try { checkVertical(s, el, d); } catch (e: any) {
    if (e?.reason === "INVALID_VERTICAL_CONSTRAINT") fail("STAIR_VERTICAL_CONSTRAINT_INVALID", `${el.id}: ${e.message}`, { ...d, ...(e.details ?? {}) });
    throw e;
  }
  positive(el.height, `${el.id} total rise`, { ...d, field: "height" });
  const t = s.types[el.type] as StairType, g = stairGeometry(el);
  if (g.riserHeight > t.maxRiser + E)
    fail("STAIR_TYPE_LIMIT_EXCEEDED", `${el.id}: riser height ${g.riserHeight.toFixed(4)} m exceeds the limit ${t.maxRiser} m of type ${t.name}; add risers or change the type.`,
      { ...d, field: "riserCount", riserHeight: g.riserHeight, limit: t.maxRiser });
  if (g.treadDepth < t.minTread - E)
    fail("STAIR_TYPE_LIMIT_EXCEEDED", `${el.id}: tread depth ${g.treadDepth.toFixed(4)} m is below the minimum ${t.minTread} m of type ${t.name}; lengthen the run or use fewer risers.`,
      { ...d, field: "end", treadDepth: g.treadDepth, limit: t.minTread });
}
export const stairPlacement = (el: StairElement) => ({ kind: "stair_run" as const, storey: el.storey, start: el.start, end: el.end, width: el.width, baseOffset: el.baseOffset });
/** the derived run: steps and the stepped profile in the vertical plane of the walking line */
export function stairRepresentation(_s: BimState, el: StairElement) {
  const g = stairGeometry(el);
  return { kind: "stair_run" as const, origin: el.start, direction: g.dir, width: el.width, baseZ: el.baseOffset, riserCount: el.riserCount, riserHeight: g.riserHeight,
           treadDepth: g.treadDepth, run: g.run, slopeAngle: g.slopeAngle, steps: stairSteps(el), profile: stairProfile(el,(_s.types[el.type] as StairType).waistThickness) };
}

