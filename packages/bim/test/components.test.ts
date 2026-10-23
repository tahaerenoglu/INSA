/**
 * Phase 7 · taxonomy, families, generic component types and components.
 * Every rejection is checked to leave the event log and the committed state unchanged.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, MemoryStores, FileStores, ArtifactStore, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { LEGACY_KIND_V3, BIM_EVENT_VERSIONS } from "../src/index.js";
import { bimModule, BimState, Component, toIfc, listCategories, listDisciplines, getCategory, registerCategory, categoryIdOfElement, componentBox } from "../src/index.js";

/** The Phase 9 representation of a stored pre-Phase-9 state: the documented migration table, applied to the snapshot's own data. */
const toCanonical = (st: any) => ({ ...st, elements: Object.fromEntries(Object.entries(st.elements).map(([id, el]: [string, any]) => {
  const m = (LEGACY_KIND_V3 as any)[el.kind];
  if (!m) return [id, el];
  const { kind: _k, ...rest } = el;
  return [id, { ...rest, kind: m.kind, category: m.category, ...(m.placement ? { placement: m.placement } : {}) }];
})) });

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "comp";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
const L = (key: string, name: string, extra: Record<string, unknown> = {}) => ({ key, name, scope: "type", dataType: "length", required: true, ...extra });
const BOX = { kind: "box", width: "width", depth: "depth", height: "height" };

async function setup(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet,
                           artifacts: new ArtifactStore(fs.mkdtempSync(path.join(os.tmpdir(), "insa-p7-"))) });
  const run = async (tool: string, input: unknown) => {
    const r: any = await p.execute(user, P, tool, input);
    assert.ok(r.status === "applied" || r.status === "ok", JSON.stringify(r));
    return r;
  };
  await run("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3.2 }] });
  await run("bim_create_materials", { materials: [{ name: "Meşe" }, { name: "Çelik" }] });
  await run("bim_create_families", { families: [
    { name: "Office Chair", category: "architecture.furniture", parameters: [L("width", "Width", { min: 0.3 }), L("depth", "Depth"), L("height", "Height"),
      { key: "asset_tag", name: "Asset tag", scope: "instance", dataType: "string", required: false }, { key: "swivel", name: "Swivel", scope: "type", dataType: "boolean", required: false, default: true }],
      representation: BOX },
    { name: "AHU", category: "mechanical.equipment", parameters: [L("width", "Width"), L("depth", "Depth"), L("height", "Height"),
      { key: "airflow", name: "Airflow", scope: "type", dataType: "number", required: true, min: 0, unit: "m3/h" }], representation: BOX },
    { name: "Panel Light", category: "electrical.lighting_fixture", parameters: [L("width", "Width"), L("depth", "Depth"), L("height", "Height", { required: false, default: 0.05 }),
      { key: "circuit", name: "Circuit", scope: "instance", dataType: "string", required: true }], representation: BOX }] });
  await run("bim_create_types", { types: [
    { kind: "component", name: "Standard", family: "Office Chair", parameters: { width: 0.6, depth: 0.6, height: 1.0 }, material: "Meşe" },
    { kind: "component", name: "AHU-1", family: "AHU", parameters: { width: 2, depth: 1, height: 1.5, airflow: 4000 }, material: "Çelik" },
    { kind: "component", name: "600", family: "Panel Light", parameters: { width: 0.6, depth: 0.6 } }] });
  return { p, stores, run };
}
const S = (p: Platform) => p.state<BimState>(P, "bim");
const snap = async (p: Platform) => ({ e: (await p.store(P).readEvents()).length, s: JSON.stringify(await S(p)) });
async function rejected(p: Platform, tool: string, input: unknown, reason: string, details: Record<string, unknown> = {}) {
  const before = await snap(p);
  let err: any;
  await assert.rejects(p.execute(user, P, tool, input), (e: any) => { err = e; return true; });
  assert.equal(err.reason, reason, `${tool}: ${err.reason} ${err.message}`);
  for (const [k, v] of Object.entries(details)) assert.equal(err.details?.[k], v, `details.${k} = ${err.details?.[k]}`);
  assert.deepEqual(await snap(p), before, "no event and no state change");
  return err;
}
const q = async (p: Platform, tool: string, input: unknown = {}) => ((await p.execute(user, P, tool, input)) as any).result;
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

// ============================================================================ A
describe("A · category registry", () => {
  test("disciplines and categories: stable ids, deterministic order, capabilities, native and component mappings", async () => {
    assert.deepEqual(listDisciplines().map((d) => d.id), ["architecture", "structure", "mechanical", "electrical", "plumbing", "fire", "site", "spatial", "generic"]);
    const ids = listCategories().map((c) => c.id);
    assert.deepEqual(ids, listCategories().map((c) => c.id), "stable order");
    for (const id of ["architecture.wall", "architecture.floor", "architecture.door", "architecture.window", "architecture.furniture", "architecture.casework",
      "architecture.generic_model", "structure.column", "structure.framing", "mechanical.equipment", "plumbing.fixture", "electrical.lighting_fixture",
      "electrical.equipment", "site.component"]) assert.ok(ids.includes(id), id);
    assert.deepEqual(getCategory("architecture.furniture").capabilities, ["hasMaterial", "hasType", "levelBased", "movable", "pointPlaced", "rotatable"]);
    assert.ok(getCategory("mechanical.equipment").capabilities.includes("systemConnectable"));
    assert.equal(getCategory("architecture.wall").engine, "wall");                  // Phase 9: concrete engines (was "native")
    assert.equal(getCategory("mechanical.equipment").ifcClass, undefined, "no invented IFC mapping");
    assert.throws(() => getCategory("architecture.nope"), (e: any) => e.reason === "INVALID_CATEGORY");
    assert.throws(() => registerCategory({ ...getCategory("architecture.furniture") }), (e: any) => e.reason === "INVALID_CATEGORY", "ids can never be redefined");
    assert.throws(() => registerCategory({ id: "Furniture", name: "x", discipline: "architecture", engine: "component", capabilities: [], placements: ["level_point"] }), (e: any) => e.reason === "INVALID_CATEGORY");
  });
  test("native elements map to categories by kind (nothing persisted); the bim tools list them", async () => {
    const { p, run } = await setup();
    await run("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }] });
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [5, 0], height: 3 }] });
    const s = await S(p);
    assert.equal(categoryIdOfElement(s, s.elements["W-0001"]), "architecture.wall");
    assert.equal("category" in s.elements["W-0001"], false);
    const elec = (await q(p, "bim_list_categories", { engine: "component", discipline: "electrical" })).map((c: any) => c.id);   // Phase 14 added schema-derived electrical categories on the same engine
  assert.deepEqual(elec.filter((id: string) => ["electrical.equipment", "electrical.lighting_fixture"].includes(id)), ["electrical.equipment", "electrical.lighting_fixture"]);
  assert.ok(elec.length > 2 && elec.every((id: string) => id.startsWith("electrical.")));
    assert.equal((await q(p, "bim_get_category", { id: "plumbing.fixture" })).ifcClass, "IfcSanitaryTerminal");
    await rejected(p, "bim_create_families", { families: [{ name: "X", category: "architecture.nope", representation: BOX }] }, "INVALID_CATEGORY");
    await rejected(p, "bim_create_families", { families: [{ name: "X", category: "architecture.wall", parameters: [L("width", "W"), L("depth", "D"), L("height", "H")], representation: BOX }] }, "CATEGORY_ENGINE_MISMATCH");
  });
});

// ============================================================================ B
describe("B · families", () => {
  test("query order and filters, rename, duplicates per category, schema errors, immutable category, schema update validated against types, delete, undo", async () => {
    const { p, run } = await setup();
    assert.deepEqual((await q(p, "bim_query_families")).map((f: any) => [f.category, f.name, f.usageCount]),
      [["architecture.furniture", "Office Chair", 1], ["electrical.lighting_fixture", "Panel Light", 1], ["mechanical.equipment", "AHU", 1]]);
    assert.deepEqual((await q(p, "bim_query_families", { discipline: "electrical" })).map((f: any) => f.id), ["F-0003"]);
    await run("bim_update_families", { items: [{ family: "Office Chair", set: { name: "Task Chair", description: "ergonomic" } }] });
    await run("bim_create_families", { families: [{ name: "AHU", category: "architecture.generic_model", parameters: [L("width", "W"), L("depth", "D"), L("height", "H")], representation: BOX }] });   // other category: fine
    await rejected(p, "bim_create_families", { families: [{ name: "task chair", category: "architecture.furniture", parameters: [L("width", "W"), L("depth", "D"), L("height", "H")], representation: BOX }] }, "DUPLICATE_RESOURCE");
    const fam = (params: unknown[], rep: unknown = BOX) => ({ families: [{ name: "Z", category: "architecture.casework", parameters: params, representation: rep }] });
    await rejected(p, "bim_create_families", fam([L("width", "W"), L("width", "W2"), L("depth", "D"), L("height", "H")]), "INVALID_PARAMETER_SCHEMA", { parameterKey: "width" });
    await rejected(p, "bim_create_families", fam([L("Width", "W"), L("depth", "D"), L("height", "H")]), "INVALID_PARAMETER_SCHEMA");
    await rejected(p, "bim_create_families", fam([L("width", "W", { min: 2, max: 1 }), L("depth", "D"), L("height", "H")]), "INVALID_PARAMETER_SCHEMA");
    await rejected(p, "bim_create_families", fam([L("width", "W", { default: -1 }), L("depth", "D"), L("height", "H")]), "INVALID_PARAMETER_SCHEMA");
    await rejected(p, "bim_create_families", fam([L("width", "W"), L("depth", "D"), { ...L("height", "H"), scope: "instance" }]), "INVALID_FAMILY", { parameterKey: "height" });
    await rejected(p, "bim_create_families", fam([L("width", "W"), L("depth", "D"), { key: "height", name: "H", scope: "type", dataType: "number", required: true }]), "INVALID_FAMILY");
    await rejected(p, "bim_update_families", { items: [{ family: "F-0002", set: { category: "electrical.equipment" } }] }, "INVALID_FAMILY_UPDATE", { field: "category" });
    // schema change that would invalidate an existing type: rejected, nothing adjusted
    const chair = (await S(p)).families["F-0001"];
    const tighter = chair.parameters.map((x) => (x.key === "width" ? { ...x, min: 1.0 } : x));
    const e = await rejected(p, "bim_update_families", { items: [{ family: "F-0001", set: { parameters: tighter } }] }, "INVALID_FAMILY_UPDATE", { familyId: "F-0001", typeId: "COT-0001" });
    assert.equal(e.details.parameterKey, "width");
    await rejected(p, "bim_update_families", { items: [{ family: "F-0001", set: { parameters: chair.parameters.filter((x) => x.key !== "swivel" && x.key !== "depth") } }] }, "INVALID_FAMILY");
    const looser = chair.parameters.map((x) => (x.key === "width" ? { ...x, min: 0.4, name: "Seat width" } : x));
    await run("bim_update_families", { items: [{ family: "F-0001", set: { parameters: looser } }] });
    // lifecycle
    await rejected(p, "bim_delete_families", { families: ["F-0002"] }, "RESOURCE_IN_USE", { resourceKind: "family", usageCount: 1, sampleIds: "COT-0002" });
    await run("bim_delete_families", { families: ["F-0004"] });
    for (let k = 0; k < 4; k++) await run("platform_undo", {});
    const s = await S(p);
    assert.equal(s.families["F-0001"].name, "Office Chair", "undo restores the name");
    assert.equal(s.families["F-0004"], undefined, "undo removes the created family");
  });
});

// ============================================================================ C
describe("C · component types", () => {
  test("query by family / category / discipline / engine; parameter validation; immutable family; duplicates per family; in-use delete", async () => {
    const { p, run } = await setup();
    assert.deepEqual((await q(p, "bim_query_types", { category: "mechanical.equipment" })).map((t: any) => [t.id, t.name, t.category, t.discipline, t.engine, t.family_name]),
      [["COT-0002", "AHU-1", "mechanical.equipment", "mechanical", "point_component", "AHU"]]);
    assert.deepEqual((await q(p, "bim_query_types", { family: "Panel Light" })).map((t: any) => t.id), ["COT-0003"]);
    assert.equal((await q(p, "bim_query_types", { engine: "component" })).length, 3);
    const T = (parameters: Record<string, unknown>, family = "AHU") => ({ types: [{ kind: "component", name: "T", family, parameters }] });
    await rejected(p, "bim_create_types", T({ width: 2, depth: 1, height: 1 }), "MISSING_REQUIRED_PARAMETER", { parameterKey: "airflow" });
    await rejected(p, "bim_create_types", T({ width: "2", depth: 1, height: 1, airflow: 1 }), "INVALID_PARAMETER_VALUE", { parameterKey: "width" });
    await rejected(p, "bim_create_types", T({ width: 2, depth: 1, height: 1, airflow: -5 }), "INVALID_PARAMETER_VALUE", { parameterKey: "airflow" });
    await rejected(p, "bim_create_types", T({ width: 2, depth: 1, height: 1, airflow: 1, color: "red" }), "UNKNOWN_PARAMETER", { parameterKey: "color" });
    await rejected(p, "bim_create_types", T({ width: 2, depth: 1, height: 0, airflow: 1 }), "INVALID_PARAMETER_VALUE", { parameterKey: "height" });
    await rejected(p, "bim_create_types", T({ width: 0.6, depth: 0.6, circuit: "C1" }, "Panel Light"), "UNKNOWN_PARAMETER", { parameterKey: "circuit" });
    await rejected(p, "bim_create_types", T({ width: Infinity, depth: 1, height: 1, airflow: 1 }), "INVALID_INPUT");          // refused at the boundary (domain check: property P1)
    await rejected(p, "bim_create_types", T({ width: Number.NaN, depth: 1, height: 1, airflow: 1 }), "INVALID_INPUT");
    await rejected(p, "bim_create_types", { types: [{ kind: "component", name: "AHU-1", family: "AHU", parameters: { width: 1, depth: 1, height: 1, airflow: 1 } }] }, "DUPLICATE_RESOURCE");
    await run("bim_create_types", { types: [{ kind: "component", name: "AHU-1", family: "Office Chair", parameters: { width: 0.6, depth: 0.6, height: 1 } }] });   // same name, other family
    await rejected(p, "bim_update_types", { items: [{ type: "COT-0002", kind: "component", set: { family: "F-0001" } }] }, "INVALID_RESOURCE_UPDATE", { field: "family" });
    await rejected(p, "bim_update_types", { items: [{ type: "COT-0002", kind: "component", set: { parameters: { width: -1 } } }] }, "INVALID_PARAMETER_VALUE");
    await run("bim_create_components", { components: [{ type: "COT-0002", storey: "L0", x: 1, y: 1 }] });
    await rejected(p, "bim_delete_types", { types: [{ type: "COT-0002" }] }, "RESOURCE_IN_USE", { usageCount: 1, sampleIds: "CO-0001" });
  });
});

// ============================================================================ D + E
describe("D/E · components and their geometry", () => {
  test("furniture, mechanical and lighting are the SAME element kind; category derived from type -> family; placement, move, reassign, rotate", async () => {
    const { p, run } = await setup();
    const r = await run("bim_create_components", { components: [
      { type: "Standard", storey: "L0", x: 2, y: 3, rotation: -90, parameters: { asset_tag: "CH-01" } },
      { type: "AHU-1", storey: "L1", x: 10, y: 2, offset: 0.1 },
      { type: "600", storey: "L1", x: 4, y: 4, offset: 2.9, parameters: { circuit: "L1-03" } }] });
    assert.deepEqual(r.summary.created.map((c: any) => [c.id, c.category, c.discipline, c.family.name, c.type.name]),
      [["CO-0001", "architecture.furniture", "architecture", "Office Chair", "Standard"], ["CO-0002", "mechanical.equipment", "mechanical", "AHU", "AHU-1"],
       ["CO-0003", "electrical.lighting_fixture", "electrical", "Panel Light", "600"]]);
    const s = await S(p);
    assert.ok(Object.values(s.elements).every((e) => e.kind === "component"), "one generic element kind");
    assert.equal((s.elements["CO-0001"] as Component).placement.rotation, 270, "rotation normalised to [0, 360)");
    const ev = (await p.store(P).readEvents()).filter((e) => e.type === "ElementCreated").map((e) => Object.keys(e.payload as object).sort());
    assert.deepEqual(ev[0], ["id", "kind", "parameters", "placement", "storey", "type"], "no category, no geometry persisted");
    // geometry: bottom-centre origin, rotation, storey elevation + offset
    const g = (await q(p, "bim_get_element", { id: "CO-0002" })).geometry;
    assert.ok(near([g.width, g.depth, g.height, g.zBottom, g.zTop], [2, 1, 1.5, 3.3, 4.8]), "derived (never stored): compared within 1e-9");
    assert.ok(near(g.corners.flat(), [9, 1.5, 11, 1.5, 11, 2.5, 9, 2.5]));
    const chair = componentBox(s, s.elements["CO-0001"] as Component);
    assert.ok(near(chair.corners.flat(), [1.7, 3.3, 1.7, 2.7, 2.3, 2.7, 2.3, 3.3]), "270°: local X points to -Y");
    // move: only the placement
    const before = structuredClone((await S(p)).elements["CO-0002"]) as Component;
    await run("bim_move_elements", { ids: ["CO-0002"], vector: [1, -1] });
    const after = (await S(p)).elements["CO-0002"] as Component;
    assert.deepEqual({ ...after, placement: { ...after.placement, x: 10, y: 2 } }, before);
    // reassign: only the storey (relative offset kept)
    await run("bim_reassign_storey", { items: [{ id: "CO-0001", storey: "L1" }] });
    const ch = (await S(p)).elements["CO-0001"] as Component;
    assert.deepEqual([ch.placement, ch.type, ch.parameters], [{ kind: "level_point", x: 2, y: 3, offset: 0, rotation: 270 }, "COT-0001", { asset_tag: "CH-01" }]);
    // instance parameters / type rules
    await run("bim_update_elements", { items: [{ id: "CO-0001", kind: "component", set: { parameters: { asset_tag: "CH-99" }, rotation: 450 } }] });
    assert.deepEqual([(await S(p)).elements["CO-0001"].parameters, ((await S(p)).elements["CO-0001"] as Component).placement.rotation], [{ asset_tag: "CH-99" }, 90]);
    await rejected(p, "bim_update_elements", { items: [{ id: "CO-0001", kind: "component", set: { parameters: { width: 2 } } }] }, "UNKNOWN_PARAMETER", { parameterKey: "width" });
    await rejected(p, "bim_create_components", { components: [{ type: "600", storey: "L1", x: 0, y: 0 }] }, "MISSING_REQUIRED_PARAMETER", { parameterKey: "circuit" });
    await rejected(p, "bim_update_elements", { items: [{ id: "CO-0001", kind: "component", set: { type: "AHU-1" } }] }, "INCOMPATIBLE_COMPONENT_TYPE");
    await rejected(p, "bim_update_elements", { items: [{ id: "CO-0001", kind: "component", set: { placement: { kind: "level_point" } } }] }, "INVALID_ELEMENT_UPDATE", { field: "placement" });
    await run("bim_create_types", { types: [{ kind: "component", name: "Wide", family: "Office Chair", parameters: { width: 0.8, depth: 0.7, height: 1.1 } }] });
    await run("bim_update_elements", { items: [{ id: "CO-0001", kind: "component", set: { type: "Wide" } }] });     // same category
    await run("bim_delete_elements", { ids: ["CO-0003"] });
    for (let k = 0; k < 6; k++) await run("platform_undo", {});
    const back = await S(p);
    assert.deepEqual([back.elements["CO-0001"].storey, (back.elements["CO-0002"] as Component).placement.x], [Object.values(back.storeys).find((x) => x.name === "L0")!.id, 10]);
    assert.ok(back.elements["CO-0003"], "undo restores the deleted component");
  });
  test("a type dimension change re-shapes every instance (type parameters are the source of truth); invalid change rejected", async () => {
    const { p, run } = await setup();
    await run("bim_create_components", { components: [0, 1, 2].map((k) => ({ type: "Standard", storey: "L0", x: k * 2, y: 0 })) });
    await run("bim_update_types", { items: [{ type: "COT-0001", kind: "component", set: { parameters: { width: 0.9, height: 1.2 } } }] });
    for (const id of ["CO-0001", "CO-0002", "CO-0003"]) {
      const g = (await q(p, "bim_get_element", { id })).geometry;
      assert.deepEqual([g.width, g.depth, g.height], [0.9, 0.6, 1.2], id);
    }
    await rejected(p, "bim_update_types", { items: [{ type: "COT-0001", kind: "component", set: { parameters: { width: 0.2 } } }] }, "INVALID_PARAMETER_VALUE", { parameterKey: "width" });
    await rejected(p, "bim_update_types", { items: [{ type: "COT-0001", kind: "component", set: { parameters: { depth: null } } }] }, "MISSING_REQUIRED_PARAMETER");
  });
});

// ============================================================================ F + G + H
describe("F/G/H · native coexistence, taxonomy queries, lifecycle", () => {
  test("native and component elements query together by category / discipline / capability / engine / family; usage per category; material protection", async () => {
    const { p, run } = await setup();
    await run("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }, { kind: "column", name: "C", profile: { shape: "rect", b: 0.4, h: 0.4 } }] });
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [6, 0] }] });                  // constrained to L1
    await run("bim_create_columns", { columns: [{ storey: "L0", type: "C", at: [3, 3] }] });
    await run("bim_create_components", { components: [{ type: "Standard", storey: "L0", x: 1, y: 1 }, { type: "AHU-1", storey: "L0", x: 4, y: 1 }, { type: "600", storey: "L0", x: 2, y: 2, offset: 2.9, parameters: { circuit: "A" } }] });
    const ids = async (input: unknown) => (await q(p, "bim_query_elements", input)).elements.map((e: any) => e.id).sort();
    assert.deepEqual(await ids({ category: "architecture.furniture" }), ["CO-0001"]);
    assert.deepEqual(await ids({ discipline: "architecture" }), ["CO-0001", "W-0001"]);
    assert.deepEqual(await ids({ capability: "pointPlaced" }), ["C-0001", "CO-0001", "CO-0002", "CO-0003"]);
    assert.deepEqual(await ids({ capability: "systemConnectable" }), ["CO-0002", "CO-0003"]);
    assert.deepEqual(await ids({ engine: "native" }), ["C-0001", "W-0001"]);
    assert.deepEqual(await ids({ family: "AHU" }), ["CO-0002"]);
    assert.deepEqual(await ids({ kind: "wall" }), ["W-0001"], "kind filters unchanged");
    const row = (await q(p, "bim_query_elements", { ids: ["CO-0002"] })).elements[0];
    assert.deepEqual([row.category, row.discipline, row.engine, row.family, row.type], ["mechanical.equipment", "mechanical", "point_component", { id: "F-0002", name: "AHU" }, { id: "COT-0002", name: "AHU-1" }]);
    const usage = await q(p, "bim_category_usage");
    assert.deepEqual(usage.map((u: any) => [u.category, u.families, u.types, u.instances]), [
      ["architecture.furniture", 1, 1, 1], ["architecture.wall", 0, 1, 1], ["structure.column", 0, 1, 1],
      ["mechanical.equipment", 1, 1, 1], ["electrical.lighting_fixture", 1, 1, 1]]);
    assert.deepEqual((await S(p)).elements["W-0001"].kind, "wall");
    assert.equal(Object.keys((await S(p)).families).length, 3, "no family created for the native wall / column types");
    assert.equal(((await S(p)).elements["W-0001"] as any).vertical.mode, "storey", "vertical intent untouched");
    const e = await rejected(p, "bim_delete_materials", { materials: ["Çelik"] }, "RESOURCE_IN_USE");
    assert.match(e.details.usageSummary, /component type AHU-1/);
    const f = await rejected(p, "bim_delete_families", { families: ["AHU"] }, "RESOURCE_IN_USE");
    assert.match(f.details.usageSummary, /1 component instances through those types/);
  });
});

// ============================================================================ I
test("I · mixed history (walls, topology, vertical constraints, families, components, moves, reassign, type / family updates, undo): live == full == snapshot + tail", async () => {
  const { p, stores, run } = await setup({ everyEvents: 4, keep: 2 });
  await run("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }] });
  const steps: [string, unknown, string?][] = [
    ["bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [6, 0] }, { storey: "L0", type: "W", start: [6, 0], end: [6, 5] }] }],
    ["bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0001", endpoint: "end" }, { wall: "W-0002", endpoint: "start" }] }],
    ["bim_create_components", { components: [{ type: "Standard", storey: "L0", x: 1, y: 1 }, { type: "Standard", storey: "L0", x: 2, y: 1, rotation: 45 }, { type: "AHU-1", storey: "L1", x: 3, y: 3 }] }],
    ["bim_move_elements", { ids: ["CO-0001", "W-0002"], vector: [0.5, 0] }],
    ["bim_reassign_storey", { items: [{ id: "CO-0002", storey: "L1" }] }],
    ["bim_update_types", { items: [{ type: "COT-0001", kind: "component", set: { parameters: { width: 0.7 } } }] }],
    ["bim_update_families", { items: [{ family: "AHU", set: { name: "Air Handling Unit" } }] }],
    ["bim_update_families", { items: [{ family: "Office Chair", set: { parameters: [L("width", "W", { min: 0.9 }), L("depth", "D"), L("height", "H")] } }] }, "INVALID_FAMILY_UPDATE"],
    ["bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.5 } }] }],
    ["platform_undo", {}], ["platform_undo", {}], ["platform_undo", {}],
  ];
  for (const [tool, input, expect] of steps) {
    if (expect) await rejected(p, tool, input, expect); else await run(tool, input);
    const v = async (x: Platform) => canonicalJson({ s: await x.state(P, "bim"), h: await x.history(P, 1e6) });
    const full = await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
    assert.equal(await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: { everyEvents: 4, keep: 2 }, logger: quiet })), full, `after ${tool}`);
    assert.equal(await v(p), full);
  }
  assert.ok(p.metrics.snapshotsWritten > 0);
  const ev = await stores.project(P).readEvents();
  assert.ok(ev.some((e) => e.type === "FamilyCreated" && e.schemaVersion === 1) && ev.some((e) => e.type === "FamilyUpdated" && e.schemaVersion === 1));
  assert.ok(ev.filter((e) => e.type === "ElementCreated").every((e) => e.schemaVersion === BIM_EVENT_VERSIONS.ElementCreated), "ElementCreated at the current version");
  assert.ok(ev.filter((e) => e.type === "ElementUpdated").every((e) => e.schemaVersion === 2), "ElementUpdated unchanged at v2");
});

// ============================================================================ J
test("J · a real Phase 6 project: old snapshots ignored, no inferred families or components, replayed state == the state Phase 6 stored", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p6fx-"));
  const src = path.join(import.meta.dirname, "fixtures/phase6-project");
  fs.cpSync(src, path.join(dir, "phase6"), { recursive: true });
  const lines: string[] = [];
  const p = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: { everyEvents: 1000, keep: 3 }, logger: { info: (e) => lines.push(e), warn: (e) => lines.push(e) } });
  const s = await p.state<BimState>("phase6", "bim");
  assert.ok(lines.includes("snapshot.ignored_incompatible") && p.metrics.snapshotsLoaded === 0);
  assert.deepEqual(s.families, {}, "no families inferred for native types");
  assert.equal(Object.values(s.elements).some((e) => e.kind === "component"), false);
  const stored = JSON.parse(JSON.parse(fs.readFileSync(path.join(src, "snapshots/000000000053.json"), "utf8")).body);
  assert.equal(stored.modules.bim.stateVersion, 3);
  assert.deepEqual([s.mepSystems, s.mepJunctions], [{}, {}], "Phase 13: no MEP system / junction is ever inferred for an old project");
  assert.deepEqual(s.spatialUnits, {}, "Phase 14: no facility / facility part is ever inferred for an old project");
  const { families: _f, mepSystems: _ms, mepJunctions: _mj, spatialUnits: _su, ...mine } = s;
  assert.equal(canonicalJson(mine), canonicalJson(toCanonical(stored.state.bim)), "geometry, topology, vertical intent, types: identical to Phase 6 (Phase 9 representation)");
  for (const f of fs.readdirSync(path.join(src, "snapshots")))
    assert.equal(fs.readFileSync(path.join(dir, "phase6/snapshots", f), "utf8"), fs.readFileSync(path.join(src, "snapshots", f), "utf8"), "old snapshots untouched");
});

// ============================================================================ L
const hasIfcOpenShell = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("L · IFC: native wall + furniture + mechanical + lighting — valid schema, containment, finite geometry (IfcOpenShell)", { skip: !hasIfcOpenShell }, async () => {
  const { p, run } = await setup();
  await run("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }] });
  await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [6, 0], height: 3 }] });
  await run("bim_create_components", { components: [{ type: "Standard", storey: "L0", x: 1, y: 2, rotation: 30, parameters: { asset_tag: "A1" } },
    { type: "AHU-1", storey: "L1", x: 4, y: 3, offset: 0.2 }, { type: "600", storey: "L1", x: 2, y: 2, offset: 2.9, parameters: { circuit: "C1" } }] });
  const ifc = toIfc(await S(p), { projectKey: P });
  assert.equal(/NaN|Infinity/.test(ifc), false);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc7-")), "m.ifc");
  fs.writeFileSync(file, ifc);
  const py = `
import json, sys, logging, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.element as ue, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1])
log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}
for e in f.by_type("IfcElement"):
    if e.is_a("IfcOpeningElement"): continue
    g = ifcopenshell.geom.create_shape(st, e).geometry; zs = g.verts[2::3]
    ps = ue.get_psets(e)
    out[e.Tag] = { "cls": e.is_a(), "storey": ue.get_container(e).Name, "vol": round(us.get_volume(g), 6), "zmin": round(min(zs), 6), "zmax": round(max(zs), 6),
                   "cat": ps.get("INSA_Component", {}).get("Category"), "hint": ps.get("INSA_Component", {}).get("IfcClassHint"), "params": ps.get("INSA_Parameters") }
print(json.dumps({ "errors": len(log.statements), "els": out }))`;
  const res = JSON.parse(execFileSync("python3", ["-c", py, file]).toString());
  assert.equal(res.errors, 0, "IfcOpenShell schema validation");
  const e = res.els;
  assert.deepEqual([e["CO-0001"].cls, e["CO-0001"].storey, e["CO-0001"].vol, e["CO-0001"].zmin, e["CO-0001"].zmax, e["CO-0001"].cat], ["IfcFurniture", "L0", 0.36, 0, 1, "architecture.furniture"]);
  assert.deepEqual([e["CO-0002"].cls, e["CO-0002"].storey, e["CO-0002"].vol, e["CO-0002"].zmin, e["CO-0002"].zmax, e["CO-0002"].cat], ["IfcBuildingElementProxy", "L1", 3, 3.4, 4.9, "mechanical.equipment"]);
  assert.deepEqual([e["CO-0003"].cls, e["CO-0003"].hint, e["CO-0003"].params.circuit, e["CO-0003"].params.height], ["IfcLightFixture", null, "C1", 0.05]);   // Phase 14: the class is now written natively (it was a proxy + a class hint before)
  assert.equal(e["W-0001"].cls, "IfcWall");
});
