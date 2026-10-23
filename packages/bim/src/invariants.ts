/**
 * BIM domain invariants — the single authority for element validity.
 *
 * Command-time only: validateCommand(after, before) runs on the candidate
 * state of every BIM command (create, update, move, delete, batch). It checks
 * everything the command touched plus the elements that depend on it
 * (Wall -> Opening -> Door/Window). Untouched elements are not re-checked, so
 * history accepted under older rules never blocks unrelated new work.
 * Replay (model.apply) never validates: historical events are trusted.
 */
import { DomainError, ErrorReason, ErrorDetails } from "@insa/core";
import { wallRoof } from './wall-roof.js';
import { isLayeredType } from "./model.js";
import type { StairType, RailingType } from "./model.js";
import { sectionProblem } from "./section.js";
import type { BimState, Element, Wall, Opening, LayeredType, ProfileType, OpeningType, Storey, Grid, Material } from "./model.js";
import { AppearanceSchema } from "./appearance.js";
import { validateModellingPolicy } from './modelling-policy.js';
import { ResourceKind, nameProblem, duplicateOf, resourceUsage, inUseError, elementReferences, elementInUseError, elementLabel } from "./resources.js";
import { validateTopology } from "./topology.js";
import { checkFamily, checkComponentType, checkComponent } from "./family.js";
import { SpatialContext, resolvePoint } from "./spatial.js";
import { findCategory } from "./taxonomy.js";
import type { SpatialElement } from "./model.js";
import type { ComponentType, MepType, RebarType, RampType, CurtainWallType } from "./model.js";
import { isVerticalElement } from "./vertical.js";
import { fail, finite, positive, point, loc, layeredThickness, checkVertical } from "./engines/kit.js";
import { checkEngineChain } from "./engines/dispatch.js";
import { validateMember } from "./engines/profile-member.js";
import { validateBoundary } from "./engines/boundary.js";
import { validateHosted } from "./engines/hosted.js";
import { validateStair } from "./engines/stair.js";
import { fittingTypeProblem } from "./engines/mep-fitting.js";
import { spatialUnitProblem } from "./spatial-units.js";
import { curtainTypeProblem } from "./engines/curtain-wall.js";
import { handlersOf, hasHandlers } from "./engines/handlers.js";
import { validatePath } from "./engines/path.js";
import { validateMepSegment, validateMepJunctions, connectorDefsProblem, mepTypeProblem, MEP_DOMAINS } from "./mep.js";

import { wallFootprint } from "./geo.js";
import { GEOMETRY_EPSILON as E, isFiniteNumber, isFinitePoint, distance, polygonProblem, holeProblem, Pt, PolygonProblem } from "./geometry.js";


type AnyType = LayeredType | ProfileType | OpeningType | StairType | RailingType | ComponentType | MepType | RebarType | RampType | CurtainWallType;



/** Total thickness of a layered type (finite, non-negative layers). */

export function checkType(t: AnyType) {
  checkName("type", t);
  const d: ErrorDetails = { typeId: t.id, typeKind: t.kind };
  if(t.kind === "window" && t.windowFrame){
    const f=t.windowFrame;
    if(![f.width,f.depth,f.glassThickness].every(v=>Number.isFinite(v)&&v>.008)||(f.sashCount!==undefined && f.sashCount!==1 && f.sashCount!==2)||((f.sashCount??1)===2?3:2)*f.width>=t.width||2*f.width>=t.height||f.glassThickness>f.depth)
      fail("INVALID_DIMENSION",`Type ${t.name}: window frame must leave a positive glass area and contain the glazing.`,d);
  }
  if (t.kind === "component") {                                              // optional MEP connector definitions (Phase 13)
    const cp = connectorDefsProblem((t as ComponentType).connectors);
    if (cp) fail("INVALID_CONNECTOR_DEFINITION", `Type ${t.name}: ${cp}.`, { ...d, field: "connectors" });
  }
  if (t.kind === "curtain_wall") {
    const cp = curtainTypeProblem(t);
    if (cp) fail("INVALID_DIMENSION", `Type ${t.name}: ${cp}.`, { ...d, field: "curtain_wall" });
    return;
  }
  if (t.kind === "ramp") {
    if (!(Number.isFinite(t.maxSlope) && t.maxSlope > 0 && t.maxSlope < 1)) fail("INVALID_DIMENSION", `Type ${t.name}: maxSlope (rise / run) must be a finite number in (0, 1).`, { ...d, field: "maxSlope" });
    if (!(Number.isFinite(t.thickness) && t.thickness > 0)) fail("INVALID_DIMENSION", `Type ${t.name}: thickness must be a finite number greater than 0.`, { ...d, field: "thickness" });
    if (t.defaultWidth !== undefined && !(Number.isFinite(t.defaultWidth) && t.defaultWidth > 0)) fail("INVALID_DIMENSION", `Type ${t.name}: defaultWidth must be greater than 0.`, { ...d, field: "defaultWidth" });
    return;
  }
  if (t.kind === "rebar") {
    if (!(typeof t.diameter === "number" && Number.isFinite(t.diameter) && t.diameter > 0)) fail("INVALID_DIMENSION", `Type ${t.name}: diameter must be a finite number greater than 0.`, { ...d, field: "diameter" });
    if (t.wallThickness !== undefined && !(Number.isFinite(t.wallThickness) && t.wallThickness > 0 && t.wallThickness * 2 < t.diameter)) fail("INVALID_DIMENSION", `Type ${t.name}: the wall thickness must be positive and below half the diameter.`, { ...d, field: "wallThickness" });
    return;
  }
  if (t.kind === "mep_fitting") {
    const fp = fittingTypeProblem(t);
    if (fp) fail("INVALID_DIMENSION", `Type ${t.name}: ${fp}.`, { ...d, field: "fitting" });
    return;
  }
  if (t.kind === "pipe" || t.kind === "duct" || t.kind === "cable_tray" || t.kind === "conduit" || t.kind === "cable") {
    const mp = mepTypeProblem(t);
    if (mp) fail("INVALID_DIMENSION", `Type ${t.name}: ${mp}.`, { ...d, field: "dimensions" });
    return;
  }
  if (isLayeredType(t)) {
    layeredThickness(t, d);
    const fk = (t as LayeredType).footingKind;
    if (t.kind === "footing" && fk !== "pad" && fk !== "strip") fail("INVALID_DIMENSION", `Footing type ${t.name}: footingKind must be "pad" or "strip".`, { ...d, field: "footingKind" });
    if (t.kind !== "footing" && fk !== undefined) fail("INVALID_DIMENSION", `Type ${t.name}: footingKind belongs to footing types only.`, { ...d, field: "footingKind" });
    return;
  }
  if (t.kind === "stair") {                                    // limits and defaults only; the geometry intent lives on the stair
    if(t.waistThickness !== undefined) positive(t.waistThickness, `Waist thickness of ${t.name}`, d);
    positive(t.maxRiser, `Maximum riser of ${t.name}`, d); positive(t.minTread, `Minimum tread of ${t.name}`, d);
    if (t.defaultWidth !== undefined) positive(t.defaultWidth, `Default width of ${t.name}`, d);
    return;
  }
  if (t.kind === "railing") {
    positive(t.height, `Height of ${t.name}`, d); positive(t.maxPostSpacing, `Post spacing of ${t.name}`, d);
    positive(t.topRail?.width, `Top rail width of ${t.name}`, d); positive(t.topRail?.depth, `Top rail depth of ${t.name}`, d); positive(t.post?.size, `Post size of ${t.name}`, d);
    return;
  }
  if (t.kind === "column" || t.kind === "beam") {
    const sp = sectionProblem(t.profile);                          // ONE section validity rule (section.ts)
    if (sp) fail("INVALID_DIMENSION", `Profile of ${t.name}: ${sp.message}.`, { ...d, field: `profile.${sp.field}` });
    return;
  }
  const o = t as OpeningType;
  positive(o.width, `Width of ${o.name}`, d);
  positive(o.height, `Height of ${o.name}`, d);
}

function checkName(kind: ResourceKind, r: { id: string; name: unknown }) {
  const pr = nameProblem(r.name);
  if (pr) fail("INVALID_RESOURCE_NAME", `${kind} ${r.id}: name ${pr}.`, { resourceKind: kind, resourceId: r.id, field: "name" });
}
export function checkStorey(st: Storey) {
  checkName("storey", st);
  finite(st.elevation, `Elevation of storey ${st.name}`, { storeyId: st.id });
}
export function checkMaterial(m: Material) {
  checkName("material", m);
  const d = { resourceKind: "material", resourceId: m.id };
  if (m.appearance != null && !AppearanceSchema.safeParse(m.appearance).success)
    fail("INVALID_RESOURCE_UPDATE", `Material ${m.name}: invalid visual appearance.`, { ...d, field: "appearance" });
  if (m.color !== undefined && !(typeof m.color === "string" && /^#[0-9a-fA-F]{6}$/.test(m.color)))
    fail("INVALID_RESOURCE_UPDATE", `Material ${m.name}: color must be '#rrggbb'.`, { ...d, field: "color" });
  if (m.category !== undefined && !(typeof m.category === "string" && m.category.trim() && m.category.length <= 60))
    fail("INVALID_RESOURCE_UPDATE", `Material ${m.name}: category must be 1-60 characters.`, { ...d, field: "category" });
}

export function checkGrid(g: Grid) {
  checkName("grid", g);
  const d = { gridId: g.id };
  const a = point(g.start, `Grid ${g.name} start`, d), b = point(g.end, `Grid ${g.name} end`, d);
  if (distance(a, b) <= E) fail("DEGENERATE_GEOMETRY", `Grid ${g.name} has zero length.`, d);
}


function wallLength(w: Wall) { return distance(w.start, w.end); }

/** Full validity of one element in the given state (references, numbers, geometry, host relation). */
export function checkElement(s: BimState, el: Element) {
  const d: ErrorDetails = { elementId: el.id, elementKind: el.kind };
  // the container: a building storey, or (infrastructure engines) a facility / facility part; never both
  const cont = hasHandlers(el.kind) ? handlersOf(el).container?.(el) : undefined;
  if (cont) { if (!s.spatialUnits?.[cont.id]) fail("INVALID_REFERENCE", `${el.id}: spatial unit ${cont.id} does not exist.`, { ...d, field: "container" }); }
  else if (!s.storeys[el.storey]) fail("INVALID_REFERENCE", `${el.id}: storey ${el.storey} does not exist.`, { ...d, field: "storey" });
  // the engine that owns this storage variant validates it (engines/handlers.ts): never a switch on kind here. An element variant no engine owns is refused.
  if (!hasHandlers(el.kind)) fail("UNKNOWN_ENGINE", `${el.id}: no engine owns element kind '${el.kind}'.`, d);
  handlersOf(el).validate(s, el, d);
}

/** wall engine: axis, layered thickness, vertical intent, unit miter hints, a simple footprint (topology: topology.ts). */
export function checkWall(s: BimState, el: Wall, d: ErrorDetails) {
      wallRoof(s, el);
      const t = s.types[el.type] as LayeredType;                 // family / kind checked by the engine chain
      const th = layeredThickness(t, d);
      checkVertical(s, el, d);
      const a = point(el.start, `${el.id} start`, { ...d, field: "start" }), b = point(el.end, `${el.id} end`, { ...d, field: "end" });
      if (distance(a, b) <= E) fail("DEGENERATE_GEOMETRY", `${el.id}: wall length ${distance(a, b)} m is not greater than ${E} m.`, { ...d, field: "end" });
      positive(el.height, `${el.id} height`, { ...d, field: "height" });
      finite(el.baseOffset, `${el.id} base offset`, { ...d, field: "base_offset" });
      for (const k of ["prevDir", "nextDir"] as const) {
        const v = el[k];
        if (v !== null && (!isFinitePoint(v) || Math.abs(Math.hypot(v[0], v[1]) - 1) > 1e-6))
          fail("INVALID_GEOMETRY", `${el.id}: ${k} must be null or a unit vector.`, { ...d, field: k });
      }
      const fp = polygonProblem(wallFootprint(el.start, el.end, th, el.prevDir, el.nextDir));
      if (fp) fail("INVALID_GEOMETRY", `${el.id}: wall footprint is invalid (${fp.message}); check the corner joins.`, { ...d, problem: fp.reason });
}

/**
 * Opening rules: the host must be an existing wall; width/height > ε; sill >= 0;
 * the opening must lie within the wall length and height (within ε);
 * openings in the same wall must not overlap (touching edges are allowed).
 */
export function checkOpening(s: BimState, el: Opening, d: ErrorDetails) {
  const w = s.elements[el.host];
  if (!w || w.kind !== "wall") fail("INVALID_HOST_RELATION", `${el.id}: host wall ${el.host} does not exist.`, { ...d, hostId: el.host });
  const wall = w as Wall;
  const hd = { ...d, hostId: wall.id };
  if (el.storey !== wall.storey)
    fail("INVALID_HOST_RELATION", `${el.id}: an opening must be on the storey of its wall ${wall.id}.`, { ...hd, field: "storey" });
  finite(el.along, `${el.id} position along the wall`, { ...hd, field: "along" });
  positive(el.width, `${el.id} width`, { ...hd, field: "width" });
  positive(el.height, `${el.id} height`, { ...hd, field: "height" });
  finite(el.sill, `${el.id} sill`, { ...hd, field: "sill" });
  if (el.sill < -E) fail("INVALID_DIMENSION", `${el.id}: sill ${el.sill} m cannot be negative.`, { ...hd, field: "sill" });
  const L = isFinitePoint(wall.start) && isFinitePoint(wall.end) ? wallLength(wall) : NaN;
  if (!(el.along - el.width / 2 >= -E && el.along + el.width / 2 <= L + E))
    fail("INVALID_HOST_RELATION", `${el.id}: opening (${el.along} ± ${el.width / 2} m) exceeds wall ${wall.id} length ${L.toFixed(3)} m.`, { ...hd, field: "along" });
  const top = wallRoof(s, wall), dx = (wall.end[0] - wall.start[0]) / L, dy = (wall.end[1] - wall.start[1]) / L;
  const availableHeight = top ? Math.min(...[-1, 1].map(sign => top.heightAt([wall.start[0] + dx * (el.along + sign * el.width / 2), wall.start[1] + dy * (el.along + sign * el.width / 2)]))) - wall.baseOffset : wall.height;
  if (!(el.sill + el.height <= availableHeight + E))
    fail("INVALID_HOST_RELATION", `${el.id}: opening top ${(el.sill + el.height).toFixed(3)} m exceeds wall ${wall.id} height ${wall.height} m.`, { ...hd, field: "height" });
  for (const o of Object.values(s.elements)) {
    if (o.kind !== "opening" || o.id === el.id || o.host !== el.host) continue;
    const ox = (o.width + el.width) / 2 - Math.abs(o.along - el.along);
    const oy = Math.min(o.sill + o.height, el.sill + el.height) - Math.max(o.sill, el.sill);
    if (ox > E && oy > E) fail("INVALID_HOST_RELATION", `${el.id} overlaps opening ${o.id} in wall ${el.host}.`, { ...hd, other: o.id });
  }
  if (el.filledBy) {
    const f = s.elements[el.filledBy];
    if (!f || f.kind !== "hosted_component" || f.opening !== el.id)
      fail("INVALID_HOST_RELATION", `${el.id}: filling element ${el.filledBy} is missing or not linked.`, { ...hd, field: "filledBy" });
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Command-time validation of a candidate state. Changed elements are checked
 * first (their own reason codes); then dependents, whose failure is reported as
 * DEPENDENT_ELEMENT_INVALID with the original reason in the details.
 */
export function validateCommand(after: BimState, before: BimState) {
  validateResources(after, before);

  // deleted elements must leave nothing referencing them (no silent cascade, no dangling relations)
  for (const [id, el] of Object.entries(before.elements)) {
    if (after.elements[id]) continue;
    const refs = elementReferences(after, id);
    if (refs.length) throw elementInUseError(after, id, elementLabel(before, el), refs);
  }
  const changed = new Set<string>();
  for (const [id, el] of Object.entries(after.elements)) if (!same(el, before.elements[id])) changed.add(id);
  const changedTypes = new Set(Object.keys(after.types).filter((id) => !same(after.types[id], before.types[id])));
  const deleted = new Set(Object.keys(before.elements).filter((id) => !after.elements[id]));

  const dependents = new Set<string>();
  const add = (id?: string) => { if (id && after.elements[id] && !changed.has(id)) dependents.add(id); };
  // an element declares what it depends on (its host, members, opening ...): a changed or deleted dependency re-checks it
  for (const el of Object.values(after.elements)) { const dep = handlersOf(el).dependsOn?.(after, el); if (dep?.some((id) => changed.has(id) || deleted.has(id))) add(el.id); }
  // storey elevation / identity changes: every element constrained to or based on those storeys is re-checked
  const changedStoreys = new Set([...Object.keys(before.storeys), ...Object.keys(after.storeys)].filter((id) => !same(before.storeys[id], after.storeys[id])));
  if (changedStoreys.size)
    for (const el of Object.values(after.elements)) {
      if (isVerticalElement(el) && el.vertical?.mode === "storey" && (changedStoreys.has(el.storey) || changedStoreys.has(el.vertical.storey))) add(el.id);
      // an engine whose world geometry follows other storeys than its own declares them (spatial-axis members, MEP routes, fittings)
      if (handlersOf(el).storeysOf?.(el).some((id) => changedStoreys.has(id))) add(el.id);
    }
  const changedFamilies = new Set(Object.keys(after.families ?? {}).filter((id) => !same(after.families[id], before.families?.[id])));
  for (const el of Object.values(after.elements)) {
    if (el.kind === 'wall' && el.topRoof) {
      const roof = after.elements[el.topRoof];
      if (roof && ('type' in roof && changedTypes.has(roof.type) || changedStoreys.has(roof.storey) || changedStoreys.has(el.storey))) add(el.id);
    }
    if ("type" in el && changedTypes.has(el.type) && !changed.has(el.id)) dependents.add(el.id);
    if (el.kind === "component" && changedFamilies.has((after.types[el.type] as ComponentType | undefined)?.family ?? "")) add(el.id);
  }
  for (const id of changed) {                 // siblings of a changed opening in the same wall
    const el = after.elements[id];
    if (el.kind === "opening") for (const o of Object.values(after.elements)) if (o.kind === "opening" && o.host === el.host) add(o.id);
  }
  if (Object.keys(after.joins ?? {}).length || Object.keys(before.joins ?? {}).length) validateTopology(after);
  // Dependency closure: roof -> wall -> opening -> insert, without rebuilding unrelated objects.
  let grew = true;
  while (grew) {
    const n = dependents.size;
    for (const el of Object.values(after.elements)) if (handlersOf(el).dependsOn?.(after, el)?.some(id => dependents.has(id))) add(el.id);
    grew = dependents.size > n;
  }
  for (const id of changed) checkElement(after, after.elements[id]);
  for (const id of dependents) {
    try { checkElement(after, after.elements[id]); }
    catch (e) {
      if (!(e instanceof DomainError)) throw e;
      throw new DomainError(`This change would make ${id} invalid: ${e.message}`, "DEPENDENT_ELEMENT_INVALID",
        { ...(e.details ?? {}), dependentId: id, cause: e.reason });
    }
  }
  // explicit MEP connectivity: no command may leave a junction broken (route edit, component move, storey / type change): the whole command is refused
  if (Object.keys(after.mepJunctions ?? {}).length) validateMepJunctions(after);
  // spatial elements last: their regions depend on the final wall topology
  validateSpatial(after, before);
  validateModellingPolicy(after, before);
}

/**
 * Resources touched by the command: field rules, name rules, uniqueness, references —
 * and deletion protection: a resource removed by the command must have no remaining users
 * in the candidate state (RESOURCE_IN_USE; nothing is ever cascaded).
 */
function validateResources(after: BimState, before: BimState) {
  const dup = (kind: ResourceKind, r: { id: string; name: string; kind?: string; family?: string; category?: string }) => {
    const other = duplicateOf(after, kind, r);
    if (other) fail("DUPLICATE_RESOURCE", `${kind === "type" ? `${r.kind} type` : kind} name '${r.name}' is already used by ${other}.`,
      { resourceKind: kind, resourceId: r.id, existingId: other, field: "name" });
  };
  for (const [id, st] of Object.entries(after.storeys)) if (!same(st, before.storeys[id])) { checkStorey(st); dup("storey", st); }
  for (const [id, g] of Object.entries(after.grids)) if (!same(g, before.grids[id])) { checkGrid(g); dup("grid", g); }
  for (const [id, m] of Object.entries(after.materials)) if (!same(m, before.materials[id])) { checkMaterial(m); dup("material", m); }
  for (const [id, f] of Object.entries(after.families ?? {})) if (!same(f, before.families?.[id])) { checkFamily(f); dup("family", f); }
  for (const [id, u] of Object.entries(after.spatialUnits ?? {})) if (!same(u, before.spatialUnits?.[id])) {
    const p = spatialUnitProblem(after, u);
    if (p) fail(p.reason, p.message, { resourceKind: "spatial_unit", resourceId: u.id, field: p.field });
  }
  for (const [id, m] of Object.entries(after.mepSystems ?? {})) if (!same(m, before.mepSystems?.[id])) {
    checkName("mep_system", m);
    if (!(MEP_DOMAINS as readonly string[]).includes(m.domain)) fail("INVALID_INPUT", `MEP system ${m.name}: unknown domain '${String(m.domain)}'.`, { resourceId: m.id, field: "domain" });
    if (typeof m.classification !== "string" || !m.classification.trim()) fail("INVALID_INPUT", `MEP system ${m.name}: a classification is required.`, { resourceId: m.id, field: "classification" });
    if (before.mepSystems?.[id] && before.mepSystems[id].domain !== m.domain) fail("INVALID_INPUT", `MEP system ${m.name}: the domain is immutable.`, { resourceId: m.id, field: "domain" });
    dup("mep_system", m);
  }
  for (const [id, t] of Object.entries(after.types)) {
    if (same(t, before.types[id])) continue;
    if (t.kind === "component") {
      checkComponentType(after, t as ComponentType);
      const cp = connectorDefsProblem((t as ComponentType).connectors);            // optional MEP connector definitions
      if (cp) fail("INVALID_CONNECTOR_DEFINITION", `Type ${t.name}: ${cp}.`, { typeId: t.id, field: "connectors" });
      const pt = (t as ComponentType).predefinedType;
      if (pt !== undefined) {                                                  // schema-derived enumeration: never a hard-coded value
        const cat = findCategory(after.families?.[(t as ComponentType).family]?.category ?? ""), vals = cat?.ifcPredefinedValues;
        if (!vals) fail("INVALID_PREDEFINED_TYPE", `Type ${t.name}: category ${cat?.id} has no IFC predefined types.`, { typeId: t.id, field: "predefined_type" });
        else if (!vals.includes(pt)) fail("INVALID_PREDEFINED_TYPE", `Type ${t.name}: '${pt}' is not a valid ${cat!.ifcClass} PredefinedType (${vals.join(", ")}).`, { typeId: t.id, field: "predefined_type" });
      }
      dup("type", t);
      continue;
    }
    checkType(t as AnyType);
    dup("type", t);
    const mats = isLayeredType(t) ? (t as LayeredType).layers.map((l) => l.material)
      : "material" in t && t.material ? [t.material] : [];
    if("finishMaterial" in t && t.finishMaterial) mats.push(t.finishMaterial);
    for (const m of mats) if (!after.materials[m]) fail("INVALID_REFERENCE", `Type ${t.name}: material ${m} does not exist.`, { typeId: t.id, field: "material" });
  }
  const removed: [ResourceKind, Record<string, { id: string; name: string }>, Record<string, unknown>][] = [
    ["storey", before.storeys, after.storeys], ["grid", before.grids, after.grids], ["material", before.materials, after.materials],
    ["type", before.types, after.types], ["family", before.families ?? {}, after.families ?? {}], ["mep_system", before.mepSystems ?? {}, after.mepSystems ?? {}], ["spatial_unit", before.spatialUnits ?? {}, after.spatialUnits ?? {}]];
  for (const [kind, was, now] of removed)
    for (const [id, r] of Object.entries(was)) {
      if (now[id]) continue;
      const u = resourceUsage(after, kind, id);
      if (u.usageCount > 0) throw inUseError(u, r.name);
    }
  // a family change must keep every type of that family valid (candidate state; nothing is adjusted to fit)
  // (after the RESOURCE_IN_USE check above: a deleted family counts as changed, so its types are re-checked too —
  //  a second line of defence should resourceUsage ever miss a reference)
  const changedFamilies = Object.keys({ ...(before.families ?? {}), ...(after.families ?? {}) })
    .filter((id) => before.families?.[id] && !same(after.families?.[id], before.families[id]));
  for (const t of Object.values(after.types)) {
    if (t.kind !== "component" || !changedFamilies.includes((t as ComponentType).family) || !same(t, before.types[t.id])) continue;
    try { checkComponentType(after, t as ComponentType); }
    catch (e) {
      if (!(e instanceof DomainError)) throw e;
      throw new DomainError(`This family change would make type ${t.name} (${t.id}) invalid: ${e.message}`, "INVALID_FAMILY_UPDATE",
        { ...(e.details ?? {}), familyId: (t as ComponentType).family, typeId: t.id, cause: e.reason });
    }
  }
}

/** A spatial element on its own: spatial category, finite point, number / name, vertical extent. */
export function checkSpatial(s: BimState, el: SpatialElement, d: ErrorDetails) {
  const c = findCategory(el.category);
  if (!c || c.engine !== "spatial")
    fail("INVALID_SPATIAL_CATEGORY", `${el.id}: '${el.category}' is not a spatial category.`, { ...d, categoryId: String(el.category) });
  if (!Array.isArray(el.point) || el.point.length !== 2 || !el.point.every((v) => typeof v === "number" && Number.isFinite(v)))
    fail("INVALID_SPATIAL_POINT", `${el.id}: the location point must be two finite numbers.`, { ...d, field: "point" });
  if (el.number != null && (typeof el.number !== "string" || nameProblem(el.number) || el.number.length > 40))
    fail("INVALID_SPATIAL_ELEMENT", `${el.id}: number must be 1-40 characters, trimmed.`, { ...d, field: "number" });
  if (el.name !== undefined && nameProblem(el.name)) fail("INVALID_SPATIAL_ELEMENT", `${el.id}: name ${nameProblem(el.name)}.`, { ...d, field: "name" });
  checkVertical(s, el, d);
  positive(el.height, `Height of ${el.id}`, { ...d, field: "height" });
}

/**
 * Cross-element spatial invariants on the candidate state, for the storeys the command touched
 * (walls, joins or spatial elements changed there): a location point never sits on a region boundary;
 * one bounded region holds at most one element of a category; numbers are unique per category.
 * Becoming unbounded is NOT a violation (ordinary editing). One context per command: each storey's
 * graph is built once.
 */
function validateSpatial(after: BimState, before: BimState) {
  const storeys = new Set<string>();
  const wallStoreys = (st: BimState, id: string) => { const w = st.elements[id]; if (w?.kind === "wall") storeys.add(w.storey); };
  for (const id of new Set([...Object.keys(before.elements), ...Object.keys(after.elements)])) {
    const a = after.elements[id], b = before.elements[id];
    if (same(a, b)) continue;
    for (const e of [a, b]) if (e && (e.kind === "wall" || e.kind === "spatial")) storeys.add(e.storey);
  }
  for (const id of new Set([...Object.keys(before.joins ?? {}), ...Object.keys(after.joins ?? {})])) {
    if (same(after.joins?.[id], before.joins?.[id])) continue;
    for (const j of [after.joins?.[id], before.joins?.[id]]) {
      if (!j) continue;
      for (const w of j.kind === "endpoint_endpoint" ? j.members.map((m) => m.wall) : [j.endpoint.wall, j.host]) { wallStoreys(after, w); wallStoreys(before, w); }
    }
  }
  const spatial = Object.values(after.elements).filter((e): e is SpatialElement => e.kind === "spatial").sort((x, y) => (x.id < y.id ? -1 : 1));
  const changed = new Set(spatial.filter((e) => !same(e, before.elements[e.id])).map((e) => e.id));
  for (const el of spatial) {
    if (!changed.has(el.id) || el.number == null) continue;
    const other = spatial.find((o) => o.id !== el.id && o.category === el.category && o.number === el.number);
    if (other) fail("DUPLICATE_SPATIAL_NUMBER", `${el.category} number '${el.number}' is already used by ${other.id}.`, { elementId: el.id, existingId: other.id, categoryId: el.category, field: "number" });
  }
  const ctx = new SpatialContext(after);
  for (const st of [...storeys].sort()) {
    const occupied = new Map<string, string>();
    const here = spatial.filter((e) => e.storey === st).sort((x, y) => Number(changed.has(x.id)) - Number(changed.has(y.id)) || (x.id < y.id ? -1 : 1));
    for (const el of here) {
      const r = resolvePoint(ctx, st, el.point);
      if (r.status === "unbounded") {
        if (r.onBoundary) fail("SPATIAL_POINT_ON_BOUNDARY", `${el.id}: its location point lies on a spatial boundary (wall ${r.wallId}); move it into a region.`,
          { elementId: el.id, storeyId: st, ...(r.wallId ? { wallId: r.wallId } : {}) });
        continue;
      }
      const key = `${el.category}|${r.region.signature}`;
      const holder = occupied.get(key);
      if (holder) fail("SPATIAL_REGION_OCCUPIED", `${el.id} and ${holder} (${el.category}) would occupy the same bounded region; delete, move or reclassify one first.`,
        { elementId: el.id, occupyingElementId: holder, categoryId: el.category, regionSignature: r.region.signature, storeyId: st });
      occupied.set(key, el.id);
    }
  }
}

/** Whole-model report (no throw) for bim_validate: every element and type, including history accepted under older rules. */
export function modelIssues(s: BimState): { id: string; reason: string; message: string }[] {
  const out: { id: string; reason: string; message: string }[] = [];
  const run = (id: string, f: () => void) => { try { f(); } catch (e) { if (e instanceof DomainError) out.push({ id, reason: e.reason, message: e.message }); else throw e; } };
  for (const f of Object.values(s.families ?? {})) run(f.id, () => checkFamily(f));
  for (const t of Object.values(s.types)) run(t.id, () => (t.kind === "component" ? checkComponentType(s, t as ComponentType) : checkType(t as AnyType)));
  for (const g of Object.values(s.grids)) run(g.id, () => checkGrid(g));
  for (const st of Object.values(s.storeys)) run(st.id, () => checkStorey(st));
  for (const m of Object.values(s.materials)) run(m.id, () => checkMaterial(m));
  for (const el of Object.values(s.elements)) run(el.id, () => checkElement(s, el));
  return out;
}
