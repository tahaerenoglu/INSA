/**
 * npm run bim:coverage : builds IFC_COVERAGE_MATRIX from (1) the machine-generated official-schema inventory (scripts/ifc-inventory.py) and (2) the
 * LIVE category / engine registry. Nothing is a manually maintained percentage: every figure is computed. Writes
 *   docs/coverage/ifc-coverage-matrix.json   and   docs/coverage/ifc-coverage-report.md
 * Support levels (honest): 0 not implemented; 1 semantically authorable through a reusable engine (category + type + placement + geometry + correct IFC
 * class); 2 dedicated parametric semantics; 3 advanced professional editing. A level is only reported as VERIFIED when the generated category contract
 * test (packages/bim/test/category-contracts.test.ts) has recorded a passing run for the category in packages/bim/data/category-contract-results.json.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { listCategories, listEngines, findEngine, allHandlers } from "../packages/bim/src/index.ts";
import { IFC_CLASS_DATA } from "../packages/bim/src/ifc-schema-data.ts";

const root = path.resolve(import.meta.dirname, "..");
const inv = JSON.parse(fs.readFileSync(path.join(root, "packages/bim/data/ifc-inventory.json"), "utf8"));
const resPath = path.join(root, "packages/bim/data/category-contract-results.json");
type Evidence = { passed: Record<string, string[]>; ifc_verified?: Record<string, unknown>; gaps?: Record<string, string> };
const contracts: Evidence = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, "utf8")) : { passed: {} };

const cats = listCategories();
const STEPS_LIFECYCLE = ["replay", "snapshot", "delete", "undo_delete"];
/** Per-category capability record, derived ONLY from registry declarations and the recorded contract-test results (no source probing, no engine-wide level). */
function evidenceOf(c: (typeof cats)[number]) {
  const eng = findEngine(c.engine), steps = contracts.passed[c.id] ?? [], handler = allHandlers().find((h) => h.kind === eng?.elementKind);
  const creation = steps.includes("create") && steps.includes("identity") && steps.includes("query"), lifecycle = STEPS_LIFECYCLE.every((x) => steps.includes(x)), ifcOk = steps.includes("ifc_product") && steps.includes("ifc_stable_identity");
  const geometry = steps.includes("geometry") && steps.includes("quantities"), engineLevel = eng?.status === "implemented" ? eng.authoringLevel : 0;
  const verified = creation && lifecycle && ifcOk && geometry, cap = c.authoringLevel ?? 3;
  const limitations = [...(c.limitations ?? []), ...(c.engine === "point_component" ? ["generic family box geometry: no category-specific parametric geometry"] : []), ...(!c.ifcClass ? ["declares no IFC class (exported generically)"] : []),
    ...(c.ifcClass && !ifcOk ? ["IFC export not verified by the strict contract"] : [])];
  return {
    category_id: c.id, ifc_entity: c.ifcClass ?? null, engine: c.engine,
    creation_capability: { declared: !!eng && eng.status === "implemented" && (c.placements?.length ?? 0) > 0 && eng.operations.includes("create"), verified: creation },
    geometry_capability: { representations: eng?.representations ?? [], verified: geometry },
    type_capability: { type_kinds: c.typeKinds ?? (c.engine === "point_component" ? ["component"] : []), type_families: eng?.typeFamilies ?? [] },
    lifecycle_capability: { operations: eng?.operations ?? [], verified: lifecycle, move_verified: steps.includes("move") && steps.includes("undo_move") },
    ifc_export_capability: { declared: handler ? handler.ifc.mode : null, verified: ifcOk },
    authoring_level: verified ? Math.min(engineLevel, cap) : 0, level_cap: c.authoringLevel ?? null, engine_level: engineLevel,
    known_limitations: limitations, verification_tests: steps,
    creation_verified: creation, lifecycle_verified: lifecycle, ifc_export_verified: ifcOk,
  };
}
const catEvidence = cats.map(evidenceOf);
const byClass = new Map<string, typeof cats>();
for (const c of cats) if (c.ifcClass) (byClass.get(c.ifcClass) ?? byClass.set(c.ifcClass, []).get(c.ifcClass)!).push(c);
const FAMILY_FOR_NONPHYSICAL: Record<string, { mapping: string; status: string }> = {
  IfcSpace: { mapping: "architecture.room / mechanical.space (spatial engine)", status: "authorable" }, IfcBuildingStorey: { mapping: "Storey resource", status: "resource" },
  IfcBuilding: { mapping: "project.building (name only)", status: "resource_partial" }, IfcSite: { mapping: "project.site (name only)", status: "resource_partial" }, IfcProject: { mapping: "project resource", status: "resource" },
  IfcGrid: { mapping: "Grid resource", status: "resource" }, IfcDistributionSystem: { mapping: "MepSystem resource", status: "resource" }, IfcDistributionPort: { mapping: "MEP connectors (derived)", status: "derived" },
  IfcMaterial: { mapping: "Material resource", status: "resource" }, IfcMaterialLayerSet: { mapping: "layered type layers", status: "resource" }, IfcMaterialLayerSetUsage: { mapping: "layered type usage", status: "resource" },
};
const matrix = inv.entities.map((e: any) => {
  const mapped = byClass.get(e.name) ?? [];
  const engines = [...new Set(mapped.map((c) => c.engine))];
  const impl = engines.map((id) => findEngine(id as never)).filter((x) => x && x.status === "implemented");
  const evs = mapped.map(evidenceOf);
  const authorable = evs.some((x) => x.creation_verified && x.lifecycle_verified);
  const exportCap = evs.some((x) => x.ifc_export_verified);                                   // a product of the real element was matched in a schema-valid file (contract test)
  const hasType = mapped.some((c) => (c.typeKinds?.length ?? 0) > 0 || c.engine === "point_component" || c.engine === "spatial");
  const level = Math.max(0, ...evs.map((x) => x.authoring_level));
  const tests = [...new Set(evs.flatMap((x) => x.verification_tests))];
  const verified = evs.some((x) => x.ifc_export_verified);
  const isPhysical = e.family === "physical_element" || e.family === "physical_feature";
  const np = FAMILY_FOR_NONPHYSICAL[e.name];
  return {
    ifc_entity: e.name, ifc_schema: e.in_ifc4 ? "IFC4X3_ADD2+IFC4" : "IFC4X3_ADD2", abstract: e.abstract, semantic_family: e.family, supertype: e.supertype,
    insa_mapping: mapped.length ? { categories: mapped.map((c) => c.id) } : np ? { resource: np.mapping, status: np.status } : null,
    engine: engines.length ? engines : null, placement_kind: [...new Set(mapped.flatMap((c) => c.placements ?? []))], type_family: [...new Set(mapped.flatMap((c) => c.typeKinds ?? []))],
    geometry_capability: [...new Set(impl.flatMap((x) => x!.representations))], lifecycle_capability: [...new Set(impl.flatMap((x) => x!.operations))],
    ifc_export_capability: mapped.length ? exportCap : null,                                      // non-category families: no typed export capability is declared yet (not measured, not guessed)
    predefined_types: e.predefined_type ?? null,
    support_level: isPhysical || e.family === "spatial_structure" ? level : null, level_verified: verified, tests,
    unsupported_semantics: isPhysical && !mapped.length ? ["no category: not authorable"] : isPhysical && !authorable ? ["category without a working creation path"] : [],
    ...(isPhysical ? { has_type_support: hasType } : {}),
  };
});
const concretePhys = matrix.filter((m: any) => !m.abstract && (m.semantic_family === "physical_element" || m.semantic_family === "physical_feature"));
const physElement = concretePhys.filter((m: any) => m.semantic_family === "physical_element");
const count = (xs: any[], f: (x: any) => boolean) => xs.filter(f).length;
const summary = {
  schema: "IFC4X3_ADD2", entities_total: matrix.length, abstract_total: count(matrix, (m) => m.abstract), concrete_total: count(matrix, (m) => !m.abstract),
  concrete_physical_products: concretePhys.length, concrete_physical_elements: physElement.length, concrete_physical_features: concretePhys.length - physElement.length,
  mapped: count(concretePhys, (m) => m.insa_mapping), authorable: count(concretePhys, (m) => (m.support_level ?? 0) >= 1),
  level1: count(concretePhys, (m) => m.support_level === 1), level2: count(concretePhys, (m) => m.support_level === 2), level3: count(concretePhys, (m) => m.support_level === 3),
  level_verified: count(concretePhys, (m) => (m.support_level ?? 0) >= 1 && m.level_verified), unmapped: count(concretePhys, (m) => !m.insa_mapping),
  export_capable: count(concretePhys, (m) => m.ifc_export_capability), categories_total: catEvidence.length, categories_verified: count(catEvidence, (x) => x.authoring_level >= 1), categories_ifc_strict: count(catEvidence, (x) => x.ifc_export_verified), missing_type_support: count(concretePhys, (m) => m.insa_mapping && !m.has_type_support),
  missing_representation_support: count(concretePhys, (m) => m.insa_mapping && m.geometry_capability.length === 0), missing_test_coverage: count(concretePhys, (m) => (m.support_level ?? 0) >= 1 && !m.level_verified),
  concrete_spatial_structure: count(matrix, (m) => !m.abstract && m.semantic_family === "spatial_structure"), concrete_positioning: count(matrix, (m) => !m.abstract && m.semantic_family === "positioning"),
  concrete_type_entities: count(matrix, (m) => !m.abstract && m.semantic_family === "type"), concrete_relationships: count(matrix, (m) => !m.abstract && m.semantic_family === "relationship"),
  relationships_exported: null,                            // not measured: no typed export capability for relationships yet (Milestone F)
  analysis_entities: count(matrix, (m) => m.semantic_family === "analysis"), process_control_entities: count(matrix, (m) => m.semantic_family === "process_control"),
};
const unmapped = concretePhys.filter((m: any) => !m.insa_mapping);
const group = (m: any) => { const e = inv.entities.find((x: any) => x.name === m.ifc_entity); const anc: string[] = [e.name, ...e.ancestors]; return anc.find((a) => /^(IfcBuildingElement|IfcDistributionFlowElement|IfcDistributionControlElement|IfcDistributionChamberElement|IfcElementComponent|IfcFurnishingElement|IfcTransportationDevice|IfcGeographicElement|IfcCivilElement|IfcGeotechnicalElement|IfcVirtualElement|IfcElementAssembly|IfcFeatureElement|IfcFlowFitting|IfcFlowSegment|IfcFlowTerminal|IfcFlowController|IfcFlowMovingDevice|IfcFlowStorageDevice|IfcFlowTreatmentDevice|IfcEnergyConversionDevice|IfcBuiltElement|IfcDeepFoundation|IfcReinforcingElement|IfcFastener|IfcMechanicalFastener|IfcDiscreteAccessory|IfcTendon|IfcTendonAnchor|IfcGeotechnicalStratum|IfcGeotechnicalAssembly|IfcElement)$/.test(a)) ?? "IfcElement"; };
const groups: Record<string, string[]> = {};
for (const m of unmapped) (groups[group(m)] ??= []).push(m.ifc_entity);
const doc = { _meta: { generator: "scripts/bim-coverage.mts (npm run bim:coverage)", inventory: inv._meta, categories_in_registry: cats.length, engines: listEngines().map((e) => ({ id: e.id, status: e.status, authoring_level: e.authoringLevel })), registry_ifc_classes: [...byClass.keys()].sort(),
  levels: "0 none | 1 reusable-engine semantic authoring | 2 dedicated parametric | 3 advanced editing; 'level_verified' = a generated contract test passed" }, summary, categories: catEvidence, unmapped_concrete_physical_by_group: groups, matrix };
fs.mkdirSync(path.join(root, "docs/coverage"), { recursive: true });
fs.writeFileSync(path.join(root, "docs/coverage/ifc-coverage-matrix.json"), JSON.stringify(doc, null, 1));
const fam = (f: string) => ({ total: count(matrix, (m) => m.semantic_family === f), concrete: count(matrix, (m) => m.semantic_family === f && !m.abstract) });
const L = (k: string, v: unknown) => `| ${k} | ${v} |`;
const md = [`# IFC coverage report (generated: do not edit)`, ``, `Source: **${inv._meta.normative_baseline}** (frozen official IFC4.3 release; secondary: ${inv._meta.secondary}) via the machine-readable schemas bundled with IfcOpenShell (${inv._meta.source}). ${inv._meta.attribution}`, `Registry: ${cats.length} categories, ${listEngines().length} engines. Command: \`npm run bim:coverage\`.`, ``,
  `## Physical product coverage (concrete IfcElement + IfcFeatureElement entities)`, `| metric | value |`, `|---|---|`, L("concrete physical products", summary.concrete_physical_products), L("  of which physical elements / features", `${summary.concrete_physical_elements} / ${summary.concrete_physical_features}`),
  L("mapped to an INSA category", summary.mapped), L("authorable (working creation path + IFC export)", summary.authorable), L("Level 1", summary.level1), L("Level 2", summary.level2), L("Level 3", summary.level3), L("level VERIFIED by a generated contract test", summary.level_verified),
  L("**unmapped**", `**${summary.unmapped}**`), L("export capable", summary.export_capable), L("missing type support (mapped)", summary.missing_type_support), L("missing representation support (mapped)", summary.missing_representation_support), L("missing test coverage (authorable, unverified)", summary.missing_test_coverage), ``,
  `## Other schema families (not geometry engines; reported separately, never merged into one percentage)`, `| family | total | concrete |`, `|---|---|---|`,
  ...["spatial_structure", "positioning", "annotation", "port", "type", "relationship", "group_system", "process_control", "analysis", "physical_feature"].map((f) => `| ${f} | ${fam(f).total} | ${fam(f).concrete} |`),
  ``, `Relationships the IFC writer emits: not measured (${summary.concrete_relationships} concrete relationship entities; no typed export capability is declared for them yet). Process / control (${summary.process_control_entities}) and analysis (${summary.analysis_entities}) entities are **not** implemented authoring and are not counted as coverage.`, ``,
  `## Unmapped concrete physical product classes, by schema group`, ...Object.entries(groups).sort((a, b) => b[1].length - a[1].length).flatMap(([g, ns]) => [`### ${g} (${ns.length})`, ns.sort().join(", "), ``]),
  `## Mapped physical products`, `| IFC entity | categories | engine | level | verified | export |`, `|---|---|---|---|---|---|`,
  ...concretePhys.filter((m: any) => m.insa_mapping).map((m: any) => `| ${m.ifc_entity} | ${m.insa_mapping.categories.join(", ")} | ${(m.engine ?? []).join(", ")} | ${m.support_level} | ${m.level_verified ? "yes" : "no"} | ${m.ifc_export_capability ? "yes" : "no"} |`), ``].join("\n");
const mdCats: string[] = ["", `## Per-category evidence (registry declarations + strict contract results)`, `| category | IFC entity | engine | level | cap | IFC export declared / verified | limitations |`, `|---|---|---|---|---|---|---|`,
  ...catEvidence.map((x) => `| ${x.category_id} | ${x.ifc_entity ?? "-"} | ${x.engine} | ${x.authoring_level} | ${x.level_cap ?? "-"} | ${x.ifc_export_capability.declared ?? "-"} / ${x.ifc_export_verified ? "yes" : "no"} | ${x.known_limitations.join("; ") || "-"} |`), ""];
fs.writeFileSync(path.join(root, "docs/coverage/ifc-coverage-report.md"), md + "\n" + mdCats.join("\n"));
console.log(JSON.stringify(summary, null, 1));
