/** Shared validation primitives for the engine validators and the central validator (no business rules here). */
import { DomainError, ErrorReason, ErrorDetails } from "@insa/core";
import type { BimState, LayeredType } from "../model.js";
import { GEOMETRY_EPSILON as E, isFiniteNumber, isFinitePoint, PolygonProblem, Pt } from "../geometry.js";
import { VerticalElement, derivedValue, derivedField } from "../vertical.js";

export const fail = (reason: ErrorReason, message: string, details: ErrorDetails = {}): never => { throw new DomainError(message, reason, details); };
export function finite(v: unknown, what: string, d: ErrorDetails) {
  if (!isFiniteNumber(v)) fail("INVALID_GEOMETRY", `${what} must be a finite number.`, d);
}
export function positive(v: unknown, what: string, d: ErrorDetails) {
  finite(v, what, d);
  if ((v as number) <= E) fail("INVALID_DIMENSION", `${what} must be greater than ${E} m (got ${v}).`, d);
}
export function point(v: unknown, what: string, d: ErrorDetails): Pt {
  if (!isFinitePoint(v)) fail("INVALID_GEOMETRY", `${what} must be a finite [x, y] point.`, d);
  return v as Pt;
}
/** Safe location context of a polygon problem (indices only). */
export const loc = (p: PolygonProblem): ErrorDetails => Object.fromEntries(
  (["vertexIndex", "segmentIndex", "otherSegmentIndex"] as const).filter((k) => p[k] !== undefined).map((k) => [k, p[k] as number]));
export function layeredThickness(t: LayeredType, d: ErrorDetails): number {
  if (!Array.isArray(t.layers) || !t.layers.length) fail("INVALID_DIMENSION", `Type ${t.name} has no layers.`, d);
  let sum = 0;
  t.layers.forEach((l, i) => {
    finite(l.thickness, `Layer ${i} thickness of type ${t.name}`, { ...d, layer: i });
    if (l.thickness < 0) fail("INVALID_DIMENSION", `Layer ${i} of type ${t.name} has a negative thickness.`, { ...d, layer: i });
    sum += l.thickness;
  });
  if (sum <= E) fail("INVALID_DIMENSION", `Type ${t.name} has a total thickness of ${sum} m; it must be greater than ${E} m.`, d);
  return sum;
}
/**
 * Vertical intent (Phase 5) of walls / profile members / spatial elements: well-formed; a storey constraint
 * targets an existing storey, is physically possible and the stored value equals the derived one exactly.
 */
export function checkVertical(s: BimState, el: VerticalElement, d: ErrorDetails) {
  const v = el.vertical as { mode?: string; storey?: unknown } | undefined;
  if (!v || (v.mode !== "fixed" && v.mode !== "storey") || (v.mode === "fixed" && Object.keys(v).length !== 1))
    fail("INVALID_VERTICAL_CONSTRAINT", `${el.id}: vertical intent must be { mode: "fixed" } or { mode: "storey", storey }.`, { ...d, field: "vertical" });
  finite((el as any)[derivedField(el)], `${el.id} ${derivedField(el)}`, { ...d, field: derivedField(el) });
  if (v!.mode === "fixed") return;
  if (typeof v!.storey !== "string" || !s.storeys[v!.storey])
    fail("INVALID_REFERENCE", `${el.id}: constraint storey ${String(v!.storey)} does not exist.`, { ...d, field: "vertical" });
  const dv = derivedValue(s, el)!;
  const f = derivedField(el);
  if (f === "height" && !(dv > E))
    fail("INVALID_VERTICAL_CONSTRAINT", `${el.id}: top storey ${s.storeys[v!.storey as string].name} is not above the base (${s.storeys[el.storey].name} + base offset); derived height ${dv} m.`,
      { ...d, field: "vertical", targetStorey: String(v!.storey), derived: dv });
  if ((el as any)[f] !== dv)
    fail("INVALID_VERTICAL_CONSTRAINT", `${el.id}: ${f} ${(el as any)[f]} does not match its storey constraint (${dv}).`,
      { ...d, field: f, targetStorey: String(v!.storey), derived: dv });
}
