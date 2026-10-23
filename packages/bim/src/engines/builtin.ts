/**
 * Capability registrations of the BUILT-IN engines (one `defineHandlers` per element variant). The lifecycle modules never switch on element.kind:
 * they ask engines/handlers.ts. Nothing here changes behaviour: each handler is the code that used to sit in a central switch (moved, not rewritten).
 * `ifc: central` / `plan: central` mark the legacy blocks of ifc.ts / plan.ts (declared and ENFORCED: toIfc throws for an element without a product).
 */
import type { ErrorDetails } from "@insa/core";
import type { Wall, Opening, Component, SpatialElement, ProfileMember, Boundary, HostedComponent, StairElement, PathElement, MepSegment, MepFitting, Reinforcement, Assembly, RampElement, CurtainWall, PitchedRoof } from "../model.js";
import type { P2 } from "../geo.js";
import { wallFrame, builtinQuantities } from "../model.js";
import { wallRoof } from '../wall-roof.js';
import { defineHandlers } from "./handlers.js";
import { checkEngineChain } from "./dispatch.js";
import { fail } from "./kit.js";
import { checkWall, checkOpening, checkSpatial } from "../invariants.js";
import { checkComponent, componentBox } from "../family.js";
import { SpatialContext, resolveSpatialElement } from "../spatial.js";
import { mepPlacement, mepRepresentation, validateMepSegment } from "../mep.js";
import { fittingPlacement, fittingRepresentation, validateFitting, fittingQuantities, writeFittingsIfc } from "./mep-fitting.js";
import { rebarPlacement, rebarRepresentation, validateReinforcement, rebarQuantities, rebarProductKeys, writeReinforcementIfc } from "./reinforcement.js";
import { validateAssembly, assemblyDescendants, writeAssembliesIfc, assemblyRuleQuantities } from "./assembly.js";
import { validateCurtainWall, curtainPlacement, curtainRepresentation, curtainQuantities, writeCurtainWallsIfc, drawCurtainWallsPlan } from "./curtain-wall.js";
import { validatePitchedRoof, pitchedRoofPlacement, pitchedRoofRepresentation, pitchedRoofQuantities, writePitchedRoofsIfc, drawPitchedRoofsPlan } from "./pitched-roof.js";
import { validateRamp, rampPlacement, rampRepresentation, rampQuantities, writeRampsIfc, drawRampsPlan } from "./ramp.js";
import { memberPlacement, memberRepresentation, validateMember } from "./profile-member.js";
import { boundaryPlacement, boundaryRepresentation, validateBoundary } from "./boundary.js";
import { hostedPlacement, hostedRepresentation, validateHosted } from "./hosted.js";
import { stairPlacement, stairRepresentation, validateStair } from "./stair.js";
import { pathPlacement, pathRepresentation, validatePath } from "./path.js";

const sig = (...parts: unknown[]) => JSON.stringify(parts);
const central = { mode: "central" as const };
const mvp = (dx: number, dy: number, r: (n: number) => number) => (p: P2): P2 => [r(p[0] + dx), r(p[1] + dy)];

defineHandlers<Wall>({
  dependsOn: (_s, el) => el.topRoof ? [el.topRoof] : [],
  references: el => el.topRoof ? [{ target: el.topRoof, ref: { kind: 'roof_attachment' as const, id: el.id } }] : [],
  kind: "wall", placementKind: () => "wall_axis", ifc: central, plan: central,
  placement: (_s, el) => ({ kind: "wall_axis" as const, storey: el.storey, start: el.start, end: el.end, baseOffset: el.baseOffset }),
  representation: (s, el) => { const f = wallFrame(s, el), top = wallRoof(s, el); return { kind: "wall_extrusion" as const, footprint: f.footprint, bottom: el.baseOffset, height: top?.maxHeight ?? el.height, ...(top ? { topRoof: el.topRoof, topProfile: f.footprint.map(p => top.heightAt(p)), topPatches: top.patches } : {}), thickness: f.t, ends: { start: f.ends.start, end: f.ends.end } }; },
  signature: (_s, el, cat) => sig(cat, el.storey, el.start, el.end, el.baseOffset, el.height, el.topRoof ?? null),
  validate: (s, el, d) => { checkEngineChain(s, el, d); checkWall(s, el, d); },
  quantities: builtinQuantities, label: (_s, el) => el.category,                                   // structure.shear_wall: its category, not "wall"
  translate: (el, dx, dy, r) => { const m = mvp(dx, dy, r); return { start: m(el.start), end: m(el.end) }; },
});
defineHandlers<ProfileMember>({
  kind: "profile_member", placementKind: (el) => el.placement, semanticLabel: true, ifc: central, plan: central,
  placement: (_s, el) => memberPlacement(el), representation: (s, el) => memberRepresentation(s, el),
  signature: (_s, el, cat) => el.placement === "member_axis" ? sig(cat, el.storey, el.placement, el.start, el.end, el.z)
    : el.placement === "member_vertical" ? sig(cat, el.storey, el.placement, el.at, el.baseOffset, el.height, el.rotation, el.direction ?? "up")
    : sig(cat, el.placement, el.start, el.end, el.rotation),                                         // storey-aware ends are part of the identity
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateMember(s, el, d); },
  quantities: builtinQuantities,
  storeysOf: (el) => (el.placement === "member_spatial_axis" ? [el.start.storey, el.end.storey] : []),   // world geometry follows the storeys it references
  translate: (el, dx, dy, r) => { const m = mvp(dx, dy, r);
    return el.placement === "member_axis" ? { start: m(el.start), end: m(el.end) }
      : el.placement === "member_spatial_axis" ? { start: { ...el.start, at: m(el.start.at) }, end: { ...el.end, at: m(el.end.at) } } : { at: m(el.at) }; },
});
defineHandlers<Boundary>({
  kind: "boundary", placementKind: (el) => (el.slope ? "boundary_plane" : "boundary"), semanticLabel: true, ifc: central, plan: central,
  placement: (_s, el) => boundaryPlacement(el), representation: (s, el) => boundaryRepresentation(s, el),
  signature: (_s, el, cat) => sig(cat, el.storey, el.outline, el.holes, el.offset, el.slope ?? null),   // a sloped plane is never its flat footprint
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateBoundary(s, el, d); }, quantities: builtinQuantities,
  translate: (el, dx, dy, r) => { const m = mvp(dx, dy, r); return { outline: el.outline.map(m), holes: el.holes.map((h) => h.map(m)) }; },
});
defineHandlers<Opening>({
  kind: "opening", placementKind: () => "host", ifc: central, plan: central,
  placement: (_s, el) => ({ kind: "host" as const, storey: el.storey, host: el.host, along: el.along, sill: el.sill }),
  representation: (_s, el) => ({ kind: "host_cut" as const, host: el.host, along: el.along, sill: el.sill, width: el.width, height: el.height }),
  signature: (_s, el, cat) => sig(cat, el.host, el.along, el.width, el.height, el.sill),
  validate: (s, el, d) => { checkEngineChain(s, el, d); checkOpening(s, el, d); }, quantities: builtinQuantities,
  dependsOn: (_s, el) => [el.host, ...(el.filledBy ? [el.filledBy] : [])],
  references: (el) => [{ target: el.host, ref: { kind: "hosted_opening", id: el.id } }, ...(el.filledBy ? [{ target: el.filledBy, ref: { kind: "filled_opening" as const, id: el.id } }] : [])],
  translate: () => null,                                                                          // it moves with its wall
});
defineHandlers<HostedComponent>({
  kind: "hosted_component", placementKind: () => "host", semanticLabel: true, ifc: central, plan: central,
  placement: (s, el) => hostedPlacement(s, el), representation: (s, el) => hostedRepresentation(s, el),
  signature: () => null,                                                                           // it only references an opening: the fill / overlap invariants govern it
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateHosted(s, el, d); }, quantities: builtinQuantities,
  dependsOn: (_s, el) => [el.opening, el.host], references: (el) => [{ target: el.opening, ref: { kind: "fill", id: el.id } }], translate: () => null,
});
defineHandlers<Component>({
  kind: "component", placementKind: () => "level_point", ifc: central, plan: central,
  placement: (_s, el) => ({ ...el.placement, storey: el.storey }), representation: (s, el) => ({ kind: "box" as const, ...componentBox(s, el) }),
  signature: (_s, el, cat) => sig(cat, el.storey, el.placement),
  validate: (s, el, d) => { checkComponent(s, el); checkEngineChain(s, el, d); }, quantities: builtinQuantities,
  translate: (el, dx, dy, r) => ({ placement: { ...el.placement, x: r(el.placement.x + dx), y: r(el.placement.y + dy) } }),        // only the placement changes
});
defineHandlers<SpatialElement>({
  kind: "spatial", placementKind: () => "spatial_point", ifc: central, plan: central,
  placement: (_s, el) => ({ kind: "spatial_point" as const, storey: el.storey, point: el.point }),
  representation: (s, el, ctx) => { const r = resolveSpatialElement((ctx as SpatialContext | undefined) ?? new SpatialContext(s), el); return r.region ? { kind: "spatial_prism" as const, outer: r.region.outer, holes: r.region.holes, bottom: 0, height: el.height } : null; },
  signature: () => null,                                                                           // its boundary is derived: the spatial invariants enforce occupancy
  validate: (s, el, d) => { checkSpatial(s, el, d); checkEngineChain(s, el, d); }, quantities: builtinQuantities,
  translate: (el, dx, dy, r) => ({ point: mvp(dx, dy, r)(el.point) }),
});
defineHandlers<StairElement>({
  kind: "stair", placementKind: () => "stair_run", semanticLabel: true, ifc: central, plan: central,
  placement: (_s, el) => stairPlacement(el), representation: (s, el) => stairRepresentation(s, el),
  signature: (_s, el, cat) => sig(cat, el.storey, el.start, el.end, el.baseOffset, el.height, el.riserCount),
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateStair(s, el, d); }, quantities: builtinQuantities,
  translate: (el, dx, dy, r) => { const m = mvp(dx, dy, r); return { start: m(el.start), end: m(el.end) }; },
});
defineHandlers<PathElement>({
  kind: "path", placementKind: () => "path", semanticLabel: true, ifc: central, plan: central,
  placement: (_s, el) => pathPlacement(el), representation: (s, el) => pathRepresentation(s, el),
  signature: (_s, el, cat) => sig(cat, el.storey, el.path, el.closed, el.offset),
  validate: (s, el, d) => { checkEngineChain(s, el, d); validatePath(s, el, d); }, quantities: builtinQuantities,
  translate: (el, dx, dy, r) => ({ path: el.path.map(mvp(dx, dy, r)) }),
});
defineHandlers<MepSegment>({
  kind: "mep_segment", placementKind: () => "mep_route", semanticLabel: true, ifc: central, plan: central,
  placement: (_s, el) => mepPlacement(el), representation: (s, el) => mepRepresentation(s, el),
  signature: (_s, el, cat) => sig(cat, el.system, el.type, el.route),                              // a pipe and a conduit on one line are not duplicates
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateMepSegment(s, el, (r, m, x) => fail(r, m, { ...d, ...(x ?? {}) } as ErrorDetails)); }, quantities: builtinQuantities,
  storeysOf: (el) => el.route.map((p) => p.storey),
  translate: (el, dx, dy, r) => { const m = mvp(dx, dy, r); return { route: el.route.map((q) => ({ ...q, at: m(q.at) })) }; },
});

// ---- Phase 14 engines: they carry their own writers, quantities and plan extents
defineHandlers<PitchedRoof>({
  kind: "pitched_roof", placementKind: () => "boundary", semanticLabel: true,
  ifc: { mode: "writer", write: writePitchedRoofsIfc }, plan: { mode: "draw", draw: drawPitchedRoofsPlan },
  placement: (_s, el) => pitchedRoofPlacement(el), representation: (s, el) => pitchedRoofRepresentation(s, el),
  signature: (_s, el, cat) => sig(cat, el.storey, el.outline, el.form, el.ridge, el.pitch, el.overhang, el.offset),
  validate: (s, el, d) => { checkEngineChain(s, el, d); validatePitchedRoof(s, el, d); }, quantities: pitchedRoofQuantities,
  planBounds: (_s, el) => el.outline,
  translate: (el, dx, dy, r) => ({ outline: el.outline.map(mvp(dx, dy, r)) }),
});
defineHandlers<CurtainWall>({
  kind: "curtain_wall", placementKind: () => "wall_axis", semanticLabel: true,
  ifc: { mode: "writer", write: writeCurtainWallsIfc }, plan: { mode: "draw", draw: drawCurtainWallsPlan },
  placement: (_s, el) => curtainPlacement(el), representation: (s, el) => curtainRepresentation(s, el),
  signature: (_s, el, cat) => sig(cat, el.storey, el.start, el.end, el.baseOffset, el.height, el.uDivisions ?? null, el.vDivisions ?? null),
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateCurtainWall(s, el, d); }, quantities: curtainQuantities,
  planBounds: (_s, el) => [el.start, el.end],
  translate: (el, dx, dy, r) => { const m = mvp(dx, dy, r); return { start: m(el.start), end: m(el.end) }; },
});
defineHandlers<RampElement>({
  kind: "ramp", placementKind: () => "ramp_run", semanticLabel: true,
  ifc: { mode: "writer", write: writeRampsIfc }, plan: { mode: "draw", draw: drawRampsPlan },
  placement: (_s, el) => rampPlacement(el), representation: (s, el) => rampRepresentation(s, el),
  signature: (_s, el, cat) => sig(cat, el.storey, el.start, el.end, el.baseOffset, el.rise),
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateRamp(s, el, d); }, quantities: rampQuantities,
  planBounds: (_s, el) => [el.start, el.end],
  translate: (el, dx, dy, r) => { const m = mvp(dx, dy, r); return { start: m(el.start), end: m(el.end) }; },
});
defineHandlers<MepFitting>({
  kind: "mep_fitting", placementKind: () => "fitting_point", semanticLabel: true, plan: central,
  ifc: { mode: "writer", write: writeFittingsIfc },
  placement: (_s, el) => fittingPlacement(el), representation: (s, el) => fittingRepresentation(s, el),
  signature: (_s, el, cat) => sig(cat, el.system, el.type, el.storey, el.at, el.offset, el.rotation, el.pitch, el.roll),
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateFitting(s, el, d); }, quantities: fittingQuantities,
  storeysOf: (el) => [el.storey], planBounds: (_s, el) => [el.at],
  translate: (el, dx, dy, r) => ({ at: mvp(dx, dy, r)(el.at) }),
});
defineHandlers<Reinforcement>({
  kind: "reinforcement", placementKind: () => "host_layout", semanticLabel: true, plan: central,
  ifc: { mode: "writer", write: writeReinforcementIfc, productKeys: (s, el) => rebarProductKeys(s, el) },
  placement: (_s, el) => rebarPlacement(el), representation: (s, el) => rebarRepresentation(s, el),
  signature: (_s, el, cat) => sig(cat, el.host, el.type, el.layers, el.bendRadius ?? null),
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateReinforcement(s, el, d); }, quantities: rebarQuantities,
  dependsOn: (_s, el) => [el.host], references: (el) => [{ target: el.host, ref: { kind: "reinforcement", id: el.id } }],
  planBounds: (_s, el) => el.layers.flatMap((L) => L.path.map((q) => [q[0], q[1]] as P2)),
  translate: (el, dx, dy, r) => ({ layers: el.layers.map((L) => ({ ...L, path: L.path.map((q) => [r(q[0] + dx), r(q[1] + dy), q[2]]) })) }),
});
defineHandlers<Assembly>({
  kind: "assembly", placementKind: () => "aggregate", semanticLabel: true, plan: { mode: "none", reason: "an assembly has no geometry of its own; its members are drawn" },
  ifc: { mode: "writer", phase: "relationship", write: writeAssembliesIfc },
  placement: (_s, el) => ({ kind: "aggregate" as const, storey: el.storey, children: el.children }), representation: (_s, el) => ({ kind: "aggregate" as const, children: el.children }),
  signature: (_s, el, cat) => sig(cat, [...el.children].sort()),
  validate: (s, el, d) => { checkEngineChain(s, el, d); validateAssembly(s, el, d); },
  quantities: (s, el) => ({ child_count: el.children.length, descendant_count: assemblyDescendants(s, el.id).length, ...assemblyRuleQuantities(s, el) }),
  dependsOn: (_s, el) => el.children, references: (el) => el.children.map((c) => ({ target: c, ref: { kind: "assembly_member" as const, id: el.id } })),
  translate: () => ({}),                                                                           // no geometry of its own (the tool moves the members)
});
