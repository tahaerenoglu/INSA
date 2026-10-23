export type ProjectType = "infrastructure" | "superstructure";
/** Internal authoring commands stay registered and callable; assistants see one universal modeling surface. */
export function assistantToolVisible(tools: readonly { name: string; module: string }[], tool: { name: string; module: string }): boolean {
  return !tools.some(t => t.name === 'model_generate') || !['bim', 'infra'].includes(tool.module);
}

/** Platform-wide tools are shared. Discipline authoring tools follow the project type. */
const SHARED_BIM_TOOLS = new Set([
  "bim_model_summary", "bim_set_project", "bim_set_georeference", "bim_clear_georeference",
  "bim_get_coordinate_system", "bim_convert_coordinates", "bim_validate",
  "bim_export_ifc", "bim_export_frag",
]);

export function projectTypeFromState(state: { project?: { projectType?: ProjectType } }, hasInfrastructure = false): ProjectType {
  return state.project?.projectType ?? (hasInfrastructure ? "infrastructure" : "superstructure");
}

export function hasInfrastructureModel(state: Record<string, any>): boolean {
  return ["alignments", "roads", "sections", "tunnels", "terrains", "componentTypes", "cadDrawings"].some((key) => Object.keys(state[key] ?? {}).length > 0);
}

export function toolAvailableForProject(type: ProjectType, tool: { name: string; module: string }): boolean {
  if (tool.module === "files" || tool.module === "platform") return true;
  if (tool.module === "infra") return type === "infrastructure";
  if (tool.module === "bim") return type === "superstructure" || SHARED_BIM_TOOLS.has(tool.name);
  return true;
}
