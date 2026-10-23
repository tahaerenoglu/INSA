/**
 * boundary engine: polygon-bounded elements (outline + holes) with a layered type: floors, ceilings and roofs share ONE model and ONE
 * validator / representation. Two placements: horizontal (a reference level) and plane (a single sloped plane: arch.slopeFrame).
 * The CATEGORY supplies the thickness side (registry data) and the type kind; nothing here branches on a category id.
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, Boundary, LayeredType } from "../model.js";
import { polygonProblem, holeProblem, isFiniteNumber } from "../geometry.js";
import { thickness } from "../model.js";
import { findCategory } from "../taxonomy.js";
import { fail, finite, loc, layeredThickness } from "./kit.js";
import { MAX_ROOF_PITCH_DEG, slopeFrame, planeHeight } from "../arch.js";
import { r } from "../geo.js";

export function validateBoundary(s: BimState, el: Boundary, d: ErrorDetails) {
  layeredThickness(s.types[el.type] as LayeredType, d);
  finite(el.offset, `${el.id} offset`, { ...d, field: "offset" });
  const op = polygonProblem(el.outline);
  if (op) fail(op.reason, `${el.id}: outline ${op.message}.`, { ...d, field: "outline", ...loc(op) });
  if (!Array.isArray(el.holes)) fail("INVALID_GEOMETRY", `${el.id}: holes must be a list of polygons.`, { ...d, field: "holes" });
  el.holes.forEach((h, i) => {
    const hp = polygonProblem(h);
    if (hp) fail("INVALID_SLAB_HOLE", `${el.id}: hole ${i} ${hp.message}.`, { ...d, field: "holes", holeIndex: i, problem: hp.reason, ...loc(hp) });
  });
  const hp = holeProblem(el.outline, el.holes);
  if (hp) fail("INVALID_SLAB_HOLE", `${el.id}: ${hp.message}.`, { ...d, field: "holes", holeIndex: hp.holeIndex, problem: hp.problem,
                                                                   ...(hp.otherHoleIndex !== undefined ? { otherHoleIndex: hp.otherHoleIndex } : {}) });
  if (el.slope !== undefined) {                              // canonical plane intent: finite, azimuth in [0, 360), 0 < pitch <= the domain bound
    const sl = el.slope as { azimuth?: unknown; pitch?: unknown };
    if (!sl || !isFiniteNumber(sl.azimuth) || !isFiniteNumber(sl.pitch))
      fail("INVALID_ROOF_PLANE", `${el.id}: slope needs a finite azimuth and pitch.`, { ...d, field: "slope" });
    if (!(sl.azimuth! as number >= 0 && (sl.azimuth as number) < 360))
      fail("INVALID_ROOF_PLANE", `${el.id}: slope azimuth ${String(sl.azimuth)} must be in [0, 360) degrees (the canonical form).`, { ...d, field: "slope.azimuth" });
    if (!((sl.pitch as number) > 0 && (sl.pitch as number) <= MAX_ROOF_PITCH_DEG))
      fail("INVALID_ROOF_PLANE", `${el.id}: slope pitch ${String(sl.pitch)} must be in (0, ${MAX_ROOF_PITCH_DEG}] degrees.`, { ...d, field: "slope.pitch" });
  }
}
/** horizontal boundaries keep the placement name "boundary"; a sloped one is a "boundary_plane" (the chain checks the category allows it) */
export const boundaryPlacement = (el: Boundary) => el.slope
  ? { kind: "boundary_plane" as const, storey: el.storey, outline: el.outline, holes: el.holes, eaveOffset: el.offset, azimuth: el.slope.azimuth, pitch: el.slope.pitch }
  : { kind: "boundary" as const, storey: el.storey, outline: el.outline, holes: el.holes, offset: el.offset };

/**
 * Derived solid, storey-local. Horizontal: the reference level `offset`, thickness below (floors, roofs) or above (ceilings) it.
 * Sloped: the plane through the eave at `offset`, thickness perpendicular to it (below the plane unless the category says above).
 */
export function boundaryRepresentation(s: BimState, el: Boundary) {
  const t = thickness(s.types[el.type] as LayeredType);
  const dir = findCategory(el.category)?.thickness ?? "below";
  if (!el.slope) {
    return dir === "above"
      ? { kind: "boundary_extrusion" as const, outer: el.outline, holes: el.holes, top: r(el.offset + t), bottom: el.offset, thickness: t, direction: dir }
      : { kind: "boundary_extrusion" as const, outer: el.outline, holes: el.holes, top: el.offset, bottom: el.offset - t, thickness: t, direction: dir };   // floors: exactly as before Phase 11 (no rounding)
  }
  const f = slopeFrame({ outline: el.outline, slope: el.slope });
  return { kind: "boundary_plane_extrusion" as const, outer: el.outline, holes: el.holes, eaveOffset: el.offset, azimuth: el.slope.azimuth, pitch: el.slope.pitch,
           direction: dir, thickness: t, riseDir: f.u, eaveLine: f.s0, tan: f.tan, cos: f.cos, sin: f.sin,
           /** top-surface elevation at each outline vertex: the one height formula */
           outerHeights: el.outline.map((v) => planeHeight(el, v)) };
}
