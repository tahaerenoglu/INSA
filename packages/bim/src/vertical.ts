/**
 * Vertical constraints (Phase 5): derivation, propagation and storey reassignment.
 * The only place that knows how a storey-constrained value is computed; tools call
 * these functions, the validator (invariants.ts) checks the result on the candidate state.
 */
import { DomainError } from "@insa/core";
import type { BimState, Element, Wall, AxisMember, VerticalMember, Vertical, SpatialElement, StairElement } from "./model.js";
import { r } from "./geo.js";
import { pointInPolygon } from "./geometry.js";
import { thickness } from "./model.js";
import type { LayeredType } from "./model.js";
import { findCategory, categoryIdOfElement, hasCapability } from "./taxonomy.js";

export const FIXED: Vertical = { mode: "fixed" };
/** Elements with a vertical intent: not the spatial-axis members (storey-referenced endpoints) and not downward members (fixed length). */
export type VerticalElement = Wall | AxisMember | VerticalMember | SpatialElement | StairElement;
export const isVerticalElement = (el: Element | undefined): el is VerticalElement =>
  !!el && (el.kind === "wall" || (el.kind === "profile_member" && el.placement !== "member_spatial_axis" && !(el.placement === "member_vertical" && el.direction === "down"))
           || el.kind === "spatial" || el.kind === "stair");
/** Axis-placed members have no base offset and derive their top z; everything else derives a height. */
const isAxis = (el: VerticalElement) => el.kind === "profile_member" && el.placement === "member_axis";
const isFloorBoundColumn = (el: VerticalElement): el is VerticalMember => el.kind === "profile_member" && el.placement === "member_vertical" && el.category === "structure.column";
/** The stored field a constraint derives: walls and columns `height`, beams `z`. */
export const derivedField = (el: VerticalElement): "height" | "z" => (isAxis(el) ? "z" : "height");

/**
 * Derived value of a storey-constrained element from the CURRENT storey elevations,
 * rounded like every stored length (1e-6 m); null for fixed elements or missing storeys.
 */
export function derivedValue(s: BimState, el: VerticalElement): number | null {
  if (!el.vertical || el.vertical.mode !== "storey") return null;
  const base = s.storeys[el.storey], top = s.storeys[el.vertical.storey];
  if (!base || !top) return null;
  if (el.kind === "wall" || isFloorBoundColumn(el)) {
    const surfaces = elementSlabSurfaces(s, el, top.id);
    return r(top.elevation - base.elevation + surfaces.top - el.baseOffset);
  }
  // beams and spatial elements have no base offset: z / height = target - base
  return isAxis(el) || el.kind === "spatial" ? r(top.elevation - base.elevation) : r(top.elevation - base.elevation - (el as { baseOffset: number }).baseOffset);
}

/** Horizontal floor surfaces covering the wall axis; landings and slab holes do not support walls. */
export function wallSlabSurfaces(s: BimState, wall: Wall, topStorey: string) {
  return elementSlabSurfaces(s, wall, topStorey);
}
function elementSlabSurfaces(s: BimState, element: Wall | VerticalMember, topStorey: string) {
  const points = element.kind === "wall" ? [0.05, 0.5, 0.95].map(t => [element.start[0] + t * (element.end[0] - element.start[0]), element.start[1] + t * (element.end[1] - element.start[1])] as [number, number]) : [element.at];
  const floors = Object.values(s.elements).filter(el => el.kind === "boundary" && !el.slope &&
    ["architecture.floor", "structure.slab"].includes(el.category) &&
    points.some(p => pointInPolygon(p, el.outline) !== "outside" && el.holes.every(h => pointInPolygon(p, h) === "outside")));
  const lower = floors.filter(el => el.storey === element.storey);
  const upper = floors.filter(el => el.storey === topStorey);
  return {
    base: lower.length ? Math.max(...lower.map(el => (el as any).offset)) : null,
    top: upper.length ? Math.min(...upper.map(el => (el as any).offset - thickness(s.types[(el as any).type] as LayeredType))) : 0,
  };
}

/** Storey-constrained elements whose base storey or target storey is in `storeys` (sorted ids). */
export function verticallyAffected(s: BimState, storeys: Set<string>): string[] {
  return Object.values(s.elements)
    .filter((el): el is VerticalElement => isVerticalElement(el) && el.vertical?.mode === "storey" && (storeys.has(el.storey) || storeys.has(el.vertical.storey)))
    .map((el) => el.id).sort();
}

/**
 * Recomputes the derived value of the given elements against the storey elevations in `s`
 * (call it after ALL storey changes of a command are applied: the result is order independent).
 * Mutates `s` and returns the changes to record as ElementUpdated events.
 */
export function syncVertical(s: BimState, ids: Iterable<string>): { id: string; changes: Record<string, number> }[] {
  const out: { id: string; changes: Record<string, number> }[] = [];
  for (const id of ids) {
    const el = s.elements[id];
    if (!isVerticalElement(el)) continue;
    if (!s.storeys[el.storey]) continue; // resource-in-use validation owns deleted storeys
    const changes: Record<string, number> = {};
    // Fixed heights are also fitted to floors intersecting their requested extent.
    // Their fixed intent stays fixed: a shorter column/wall is never extended to a floor.
    if ((el.kind === "wall" || isFloorBoundColumn(el)) && el.vertical?.mode !== "storey") {
      const oldBase = el.baseOffset, oldTop = oldBase + el.height;
      const upper = Object.values(s.storeys).filter(st => st.elevation > s.storeys[el.storey].elevation && st.elevation - s.storeys[el.storey].elevation <= oldTop + 1e-6).sort((a,b) => a.elevation - b.elevation)[0];
      const surfaces = elementSlabSurfaces(s, el, upper?.id ?? "");
      const base = Math.max(oldBase, surfaces.base ?? oldBase);
      const top = upper ? Math.min(oldTop, upper.elevation - s.storeys[el.storey].elevation + surfaces.top) : oldTop;
      if (base !== oldBase) { el.baseOffset = base; changes.baseOffset = base; }
      if (r(top - base) !== el.height) { el.height = r(top - base); changes.height = el.height; }
    }
    if ((el.kind === "wall" || isFloorBoundColumn(el)) && el.vertical?.mode === "storey") {
      const base = elementSlabSurfaces(s, el, el.vertical.storey).base;
      if (base !== null && base !== el.baseOffset) { el.baseOffset = base; changes.baseOffset = base; }
    }
    const v = derivedValue(s, el);
    const f = derivedField(el);
    if (v !== null && (el as any)[f] !== v) { (el as any)[f] = v; changes[f] = v; }
    if (Object.keys(changes).length) out.push({ id, changes });
  }
  return out;
}

/**
 * Moves an element to another storey, keeping its relative values (baseOffset / offset / z for fixed
 * elements) — it moves vertically with the storey; XY is unchanged. A wall takes its openings and the
 * doors / windows filling them along (hosted graphs never span storeys). A storey-constrained element
 * keeps its target storey and its derived value is recomputed against the new base.
 * Hosted elements cannot be reassigned on their own.
 */
export function reassignStorey(s: BimState, id: string, storeyId: string): { id: string; changes: Record<string, unknown> }[] {
  const el = s.elements[id];
  if (!el) throw new DomainError(`Element ${id} not found.`, "ELEMENT_NOT_FOUND", { elementId: id });
  if (el.kind === "opening" || el.kind === "hosted_component")
    throw new DomainError(`${id} is hosted by wall ${el.host} and always shares its storey: reassign the wall instead.`, "INVALID_HOST_RELATION",
      { elementId: id, elementKind: el.kind, hostId: el.host });
  if (el.kind === "component") {
    const c = findCategory(categoryIdOfElement(s, el) ?? "");
    if (!c || !hasCapability(c, "levelBased"))
      throw new DomainError(`${id}: its category is not level-based and cannot be reassigned to a storey.`, "INVALID_COMPONENT_PLACEMENT", { elementId: id });
  }
  if (el.kind === "profile_member" && el.placement === "member_spatial_axis")
    throw new DomainError(`${id} has two storey-referenced endpoints: reassigning one storey would be ambiguous. Update its start / end storeys explicitly (bim_update_elements, kind brace).`, "INVALID_ENGINE_PLACEMENT", { elementId: id });
  if (el.kind === "mep_segment") {                                      // a route follows every storey it references
    const used = [...new Set(el.route.map((p) => p.storey))];
    if (used.length > 1) throw new DomainError(`${id} is a cross-storey route (${used.join(", ")}): reassigning one storey would be ambiguous. Update its route explicitly (bim_update_elements, kind mep_segment).`, "INVALID_ENGINE_PLACEMENT", { elementId: id });
    if (el.storey === storeyId) return [];
    const route = el.route.map((p) => ({ ...p, storey: storeyId }));
    el.storey = storeyId; el.route = route;
    return [{ id, changes: { storey: storeyId, route } }];
  }
  if (el.storey === storeyId) return [];
  const moved = [id];
  if (el.kind === "wall")
    for (const o of Object.values(s.elements))
      if (o.kind === "opening" && o.host === id) { moved.push(o.id); if (o.filledBy) moved.push(o.filledBy); }
  const out: { id: string; changes: Record<string, unknown> }[] = [];
  for (const m of moved) { s.elements[m].storey = storeyId; out.push({ id: m, changes: { storey: storeyId } }); }
  for (const c of syncVertical(s, [id])) Object.assign(out[0].changes, c.changes);
  return out;
}
