import { z } from "zod";
import { DomainError, parseArtifactBaseName, safeBaseName } from "@insa/core";
import type { ModuleDef, QueryTool } from "@insa/core";
import { BimState, initialState, apply, BIM_EVENT_VERSIONS, BIM_UPCASTERS, BIM_STATE_VERSION } from "./model.js";
import { validateCommand } from "./invariants.js";
import { commandTools, queryTools } from "./tools.js";
import {assemblyTypeTools} from './assembly-types.js';
export * from './assembly-types.js';
import { attachWallsToRoof } from './wall-roof.js';
export { wallRoof } from './wall-roof.js';
export { coordinateModel } from './coordination.js';
export type { CoordinationIssue, CoordinationKind, CoordinationOptions, SafeRepair } from './coordination.js';
export { elementSolid, bounds3, convexContact, convexDistance, pointInCell, segmentCellInterval, segmentDistance3, triangulatePlan } from './solid-geometry.js';
export type { ConvexCell, Bounds3 } from './solid-geometry.js';
export { rebarCoverProblem } from './engines/reinforcement.js';
export {columnRebarGeometry} from './column-rebar-layout.js';
export * from './semantic-model.js';
export * from './family-resolution.js';
import { toIfc } from "./ifc.js";
import { ifcToFrag } from "./frag.js";
import { planSvg, svgToPng } from "./plan.js";
import { materialSearch, materialImport } from "./polyhaven.js";
export * from "./appearance.js";

export * from "./model.js";
export * from "./geometry.js";
export * from "./invariants.js";
export * from "./resources.js";
export * from "./vertical.js";
export * from "./topology.js";
export * from "./authoring.js";
export * from "./taxonomy.js";
export * from "./family.js";
export * from "./spatial.js";
export * from "./geo.js";
export { toIfc, stepString, ifcClassFor } from "./ifc.js";
export { ifcToFrag } from "./frag.js";
export { planSvg, svgToPng } from "./plan.js";

/** Export inputs: an optional plain file name; filesystem paths are refused explicitly (not silently ignored). */
const ExportInput = z.object({
  name: z.string().optional().describe("Artifact file name without folders, e.g. 'Ornek Ofis rev02' (default: project name)"),
  path: z.unknown().optional().describe("REMOVED: exports are written to the project's export storage; passing a path is an error"),
  schema: z.enum(["auto", "IFC4", "IFC4X3_ADD2"]).default("auto").describe("IFC schema of the file: auto = IFC4, or IFC4X3_ADD2 when the model holds a class that exists only in IFC4.3; an explicit IFC4 export of such a model is refused (UNSUPPORTED_IFC_SCHEMA)"),
});
function exportBaseName(i: { name?: string; path?: unknown }, projectName: string): string {
  if (i.path !== undefined)
    throw new DomainError("The 'path' argument is no longer supported: exports are stored in the project's export storage. Use 'name' for the file name.", "INVALID_EXPORT_PATH");
  return i.name !== undefined ? parseArtifactBaseName(i.name) : safeBaseName(projectName);
}

const exportIfc: QueryTool<BimState> = {
  kind: "query", effect: "read", module: "bim", name: "bim_export_ifc", title: "Export IFC", permission: "bim.export",
  description: "Write the model as IFC (IFC4, or IFC4.3 ADD2 when a category requires it) into the project's export storage and return the artifact (id, size, sha256). Element GlobalIds are stable between exports.",
  input: ExportInput,
  run: ({ state, project, platform }, i) => {
    const base = exportBaseName(i, state.project.name);
    const text = toIfc(state, { projectKey: project, application: "INSA Platform", schema: i.schema });
    const artifact = platform.requireArtifacts().save(project, "ifc", base, text);
    return { artifact, entities: text.split("\n").filter((l) => l.startsWith("#")).length };
  },
};

const exportFrag: QueryTool<BimState> = {
  kind: "query", effect: "read", module: "bim", name: "bim_export_frag", title: "Export Fragments", permission: "bim.export",
  description: "Write the model as a ThatOpen .frag file (converted from the same IFC) into the project's export storage and return the artifact.",
  input: ExportInput,
  run: async ({ state, project, platform }, i) => {
    const base = exportBaseName(i, state.project.name);
    const frag = await ifcToFrag(toIfc(state, { projectKey: project, spaceGeometry: false }));   // rooms / spaces never hide the building in 3D
    return { artifact: platform.requireArtifacts().save(project, "frag", base, frag) };
  },
};

const renderPlan: QueryTool<BimState> = {
  kind: "query", effect: "read", module: "bim", name: "bim_render_plan", title: "Render plan", permission: "bim.read",
  description: "Plan image of a storey: walls layer by layer, openings and door swings, columns, beams, slabs, grid axes and a labelled metre grid.",
  input: z.object({ storey: z.string(), show_ids: z.boolean().default(true), width: z.number().int().min(600).max(2400).default(1400) }),
  run: ({ state }, i) => {
    const st = state.storeys[i.storey] ?? Object.values(state.storeys).find((x) => x.name.toLowerCase() === i.storey.toLowerCase());
    if (!st) throw new DomainError(`Storey '${i.storey}' not found.`);
    const png = svgToPng(planSvg(state, st, { showIds: i.show_ids, width: i.width }));
    return { __image: { base64: Buffer.from(png).toString("base64"), mimeType: "image/png" }, storey: st.name };
  },
};

export const bimModule: ModuleDef<BimState> = {
  id: "bim",
  title: "BIM modelling",
  initialState,
  apply,
  validate: validateCommand,
  eventVersions: BIM_EVENT_VERSIONS,
  upcasters: BIM_UPCASTERS,
  stateVersion: BIM_STATE_VERSION,
  tools: [...commandTools, ...assemblyTypeTools, ...queryTools, attachWallsToRoof, renderPlan, exportIfc, exportFrag, materialSearch, materialImport],
};
// Phase 9: universal engine architecture
export * from "./engines/registry.js";
export * from "./engines/dispatch.js";
export { validateMember, memberRepresentation, memberPlacement, memberWorldEnds, memberLength, memberFrame } from "./engines/profile-member.js";
export { validateBoundary, boundaryRepresentation, boundaryPlacement } from "./engines/boundary.js";
export { validateHosted, hostedRepresentation, hostedPlacement } from "./engines/hosted.js";
export * from "./arch.js";
export * from "./section.js";
export * from "./connectivity.js";
export * from "./mep.js";
export { toMap, toLocal, spatialUnitProblem, unitPath, unitsOf, georefProblem, georefRotationDegrees, FACILITY_CLASSES, PART_CLASSES } from "./spatial-units.js";
// Engine extension API (Phase 14): register an engine + its element handlers; the lifecycle modules need no edit.
export { defineHandlers, undefineHandlers, handlersOf, hasHandlers, allHandlers, registeredKinds } from "./engines/handlers.js";
export type { ElementHandlers, ElementLike, IfcCapability, PlanCapability, PlanDrawContext } from "./engines/handlers.js";
export { registerEngine, unregisterEngine } from "./engines/registry.js";
export type { IfcWriteContext } from "./ifc.js";
// Registers the built-in engines' capabilities (engines/handlers.ts). LAST: every module it depends on is fully evaluated first.
import "./engines/builtin.js";
