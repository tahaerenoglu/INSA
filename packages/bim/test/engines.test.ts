/**
 * Phase 9 · universal engine architecture: registry, category -> engine mapping, canonical variants,
 * compatibility tools, type compatibility, queries, event migration, snapshots, undo, the real Phase 8 fixture.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, MemoryStores, FileStores, ArtifactStore, Actor, canonicalJson, PlatformLogger, NewEvent } from "@insa/core";
import { bimModule, BimState, ifcGuid, listEngines, findEngine, listCategories, getCategory, registerCategory, PREFIX, BIM_EVENT_VERSIONS, BIM_STATE_VERSION,
         quantities, elementUsage, wallFrame, SpatialContext, resolveSpatialElement, toIfc, engineIdOfElement, resolveElementRepresentation } from "../src/index.js";

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "eng";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
async function setup(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet, artifacts: new ArtifactStore(fs.mkdtempSync(path.join(os.tmpdir(), "insa-p9-"))) });
  const run = async (tool: string, input: unknown) => { const r: any = await p.execute(user, P, tool, input); assert.ok(r.status === "applied" || r.status === "ok", JSON.stringify(r)); return r; };
  await run("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3.2 }] });
  await run("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }, { kind: "slab", name: "D", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "column", name: "C", profile: { shape: "rect", b: 0.4, h: 0.5 } }, { kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } },
    { kind: "door", name: "K", width: 1, height: 2.1 }, { kind: "window", name: "N", width: 1, height: 1.2 }] });
  return { p, stores, run, S: () => p.state<BimState>(P, "bim") };
}
const snap = async (p: Platform) => ({ e: (await p.store(P).readEvents()).length, s: JSON.stringify(await p.state(P, "bim")) });
async function rejected(p: Platform, tool: string, input: unknown, reason: string) {
  const before = await snap(p);
  let err: any;
  await assert.rejects(p.execute(user, P, tool, input), (e: any) => { err = e; return true; });
  assert.equal(err.reason, reason, `${tool}: ${err.reason} ${err.message}`);
  assert.deepEqual(await snap(p), before);
  return err;
}
const q = async (p: Platform, tool: string, input: unknown = {}) => ((await p.execute(user, P, tool, input)) as any).result;
const created = async (p: Platform) => (await p.store(P).readEvents()).filter((e) => e.type === "ElementCreated").map((e) => e.payload as any);

// ============================================================================ A + B
describe("A/B · engine registry and category mapping", () => {
  test("implemented / internal / reserved engines; deep immutability; fixed order; every production category uses an implemented engine; no 'native'", () => {
    // Phase 11 activated `path` and added `stair`: the implemented set grew, the reserved set shrank (mep_network and proxy remain reserved)
    assert.deepEqual(listEngines().map((e) => [e.id, e.status]), [["wall", "implemented"], ["point_component", "implemented"], ["hosted_component", "implemented"],
      ["profile_member", "implemented"], ["boundary", "implemented"], ["spatial", "implemented"], ["stair", "implemented"], ["path", "implemented"], ["mep_fitting", "implemented"], ["reinforcement", "implemented"], ["assembly", "implemented"], ["ramp_flight", "implemented"], ["curtain_wall", "implemented"], ["pitched_roof", "implemented"], ["void", "internal"], ["mep_network", "implemented"], ["proxy", "reserved"]]);   // Phase 14 added mep_fitting   // Phase 13 activated mep_network
    const e = findEngine("profile_member") as any;
    assert.throws(() => e.operations.push("join"), TypeError);
    assert.throws(() => { e.status = "reserved"; }, TypeError);
    assert.throws(() => (listEngines() as any).push({}), TypeError);
    assert.equal(findEngine("native"), undefined);
    for (const c of listCategories()) {
      const eng = findEngine(c.engine)!;
      assert.ok(eng && eng.status !== "reserved", c.id);
      assert.ok(c.placements.every((pl) => eng.placements.includes(pl)), c.id);
    }
    assert.deepEqual(["architecture.wall", "architecture.floor", "structure.column", "structure.framing", "architecture.door", "architecture.window", "architecture.furniture",
      "mechanical.equipment", "architecture.room", "mechanical.space"].map((id) => getCategory(id).engine),
      ["wall", "boundary", "profile_member", "profile_member", "hosted_component", "hosted_component", "point_component", "point_component", "spatial", "spatial"]);
    const reg = (engine: string) => () => registerCategory({ id: `generic.x_${engine}`, name: "x", discipline: "generic", engine: engine as any, capabilities: [], placements: ["level_point"] });
    assert.throws(reg("proxy"), (x: any) => x.reason === "INVALID_CATEGORY" && /reserved/.test(x.message));
    assert.throws(reg("teleport"), (x: any) => x.reason === "INVALID_CATEGORY" && /unknown engine/.test(x.message));
    assert.throws(() => registerCategory({ id: "generic.bad_place", name: "x", discipline: "generic", engine: "profile_member", capabilities: [], placements: ["level_point"] }), (x: any) => x.reason === "INVALID_CATEGORY");
    assert.throws(() => registerCategory({ id: "generic.bad_type", name: "x", discipline: "generic", engine: "profile_member", capabilities: [], placements: ["member_axis"], typeKinds: ["wall"] }), (x: any) => x.reason === "INVALID_CATEGORY");
    const prefixes = Object.values(PREFIX);
    assert.equal(new Set(prefixes).size, prefixes.length, "id prefixes never collide (a material is never M- next to a member M-)");
  });
});

// ============================================================================ E + F + G + I
describe("E/F/G/I · canonical variants and compatibility tools", () => {
  test("former create tools are adapters: identical canonical events to the generic engine tools", async () => {
    const a = await setup(), b = await setup();
    await a.run("bim_create_beams", { beams: [{ storey: "L0", type: "B", start: [0, 0], end: [5, 0] }, { storey: "L0", type: "B", start: [0, 2], end: [5, 2], z: 2.8 }] });
    await a.run("bim_create_columns", { columns: [{ storey: "L0", type: "C", at: [1, 1], rotation: 20 }, { storey: "L0", type: "C", points: [[2, 2], [3, 3]], height: 2.5, base_offset: 0.1 }] });
    await a.run("bim_create_slabs", { slabs: [{ storey: "L1", type: "D", outline: [[0, 0], [6, 0], [6, 4], [0, 4]], holes: [[[1, 1], [2, 1], [2, 2], [1, 2]]] }] });
    await b.run("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: [0, 0], end: [5, 0] }, { category: "structure.framing", storey: "L0", type: "B", start: [0, 2], end: [5, 2], z: 2.8 }] });
    await b.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C", at: [1, 1], rotation: 20 }, { category: "structure.column", storey: "L0", type: "C", points: [[2, 2], [3, 3]], height: 2.5, base_offset: 0.1 }] });
    await b.run("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L1", type: "D", outline: [[0, 0], [6, 0], [6, 4], [0, 4]], holes: [[[1, 1], [2, 1], [2, 2], [1, 2]]] }] });
    assert.equal(canonicalJson(await created(a.p)), canonicalJson(await created(b.p)), "same canonical ElementCreated payloads");
    assert.equal(canonicalJson(await a.S()), canonicalJson(await b.S()), "same state");
    const s = await a.S();
    assert.deepEqual(["B-0001", "C-0001", "S-0001"].map((id) => [s.elements[id].kind, (s.elements[id] as any).category, (s.elements[id] as any).placement ?? null]),
      [["profile_member", "structure.framing", "member_axis"], ["profile_member", "structure.column", "member_vertical"], ["boundary", "architecture.floor", null]]);
    assert.ok((await created(a.p)).every((e) => !("engine" in e)), "the engine is never persisted: it comes from the category");
    assert.deepEqual([(s.elements["B-0001"] as any).z, (s.elements["C-0001"] as any).height], [3.2, 3.2], "vertical intent: next storey");
  });
  test("hosted components: doors and windows are categories of one engine; Wall -> Opening -> fill, rehost and delete lifecycle unchanged", async () => {
    const { p, run, S } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0], height: 3 }, { storey: "L0", type: "W", start: [0, 5], end: [8, 5], height: 3 }] });
    await run("bim_place_openings", { items: [{ kind: "door", host: "W-0001", along: 2, type: "K" }, { kind: "window", host: "W-0001", along: 6, type: "N" }] });
    const s = await S();
    assert.deepEqual(["D-0001", "N-0001"].map((id) => [s.elements[id].kind, (s.elements[id] as any).category, engineIdOfElement(s, s.elements[id])]),
      [["hosted_component", "architecture.door", "hosted_component"], ["hosted_component", "architecture.window", "hosted_component"]]);
    await rejected(p, "bim_delete_elements", { ids: ["O-0001"] }, "ELEMENT_IN_USE");
    await rejected(p, "bim_update_elements", { items: [{ id: "D-0001", kind: "window", set: { sill: 0.1 } }] }, "INVALID_ELEMENT_UPDATE");
    await run("bim_update_elements", { items: [{ id: "N-0001", kind: "window", set: { sill: 1.0 } }] });                    // former kind still addresses it
    await run("bim_update_elements", { items: [{ id: "N-0001", kind: "hosted_component", set: { along: 5 } }] });           // canonical kind
    await run("bim_rehost_opening", { opening: "O-0001", host: "W-0002", along: 3 });
    assert.equal(((await S()).elements["D-0001"] as any).host, "W-0002");
    assert.deepEqual((await q(p, "bim_get_element", { id: "D-0001" })).relationships, [{ type: "FILLS", elementId: "O-0001" }, { type: "HOSTED_BY", elementId: "W-0002" }]);
    await rejected(p, "bim_reassign_storey", { items: [{ id: "N-0001", storey: "L1" }] }, "INVALID_HOST_RELATION");
  });
  test("generic operations: move, update (canonical and former kinds), reassign, delete; members keep their placement semantics", async () => {
    const { p, run, S } = await setup();
    await run("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: [0, 0], end: [4, 0], z: 2.7 }, { category: "structure.column", storey: "L0", type: "C", at: [1, 1], height: 2.6 }] });
    await run("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D", outline: [[0, 0], [4, 0], [4, 3]] }] });
    await run("bim_move_elements", { ids: ["B-0001", "C-0001", "S-0001"], vector: [1, 2] });
    let s = await S();
    assert.deepEqual([(s.elements["B-0001"] as any).start, (s.elements["C-0001"] as any).at, (s.elements["S-0001"] as any).outline[0]], [[1, 2], [2, 3], [1, 2]]);
    await run("bim_update_elements", { items: [{ id: "B-0001", kind: "beam", set: { z: 2.9 } }, { id: "C-0001", kind: "profile_member", set: { rotation: 45 } }, { id: "S-0001", kind: "boundary", set: { offset: 0.1 } }] });
    await rejected(p, "bim_update_elements", { items: [{ id: "C-0001", kind: "beam", set: { z: 1 } }] }, "INVALID_ELEMENT_UPDATE");          // a column is not an axis member
    await rejected(p, "bim_update_elements", { items: [{ id: "C-0001", kind: "profile_member", set: { z: 1 } }] }, "INVALID_ELEMENT_UPDATE");  // vertical members have no z
    await run("bim_reassign_storey", { items: [{ id: "C-0001", storey: "L1" }] });
    s = await S();
    assert.deepEqual([(s.elements["B-0001"] as any).z, (s.elements["C-0001"] as any).rotation, (s.elements["S-0001"] as any).offset, s.elements["C-0001"].storey],
      [2.9, 45, 0.1, Object.values(s.storeys).find((x) => x.name === "L1")!.id]);
    await run("bim_delete_elements", { ids: ["B-0001", "S-0001"] });
    assert.deepEqual(Object.keys((await S()).elements), ["C-0001"]);
  });
});

test("E · every member category goes through the one profile_member validator (no per-category path)", async () => {
  const { run, S } = await setup();
  await run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C", at: [1, 1] }, { category: "structure.framing", storey: "L0", type: "B", start: [0, 0], end: [4, 0] }] });
  const { checkElement } = await import("../src/index.js");
  const cases: [string, (e: any) => void, string][] = [
    ["C-0001", (e) => { e.at = [Number.NaN, 0]; }, "INVALID_GEOMETRY"], ["C-0001", (e) => { e.height = 0; e.vertical = { mode: "fixed" }; }, "INVALID_DIMENSION"],
    ["C-0001", (e) => { e.vertical = { mode: "storey", storey: "L-9999" }; }, "INVALID_REFERENCE"], ["C-0001", (e) => { e.height = 9; }, "INVALID_VERTICAL_CONSTRAINT"],
    ["C-0001", (e) => { e.placement = "member_axis"; }, "INVALID_ENGINE_PLACEMENT"],
    ["B-0001", (e) => { e.end = [0, 0]; }, "DEGENERATE_GEOMETRY"], ["B-0001", (e) => { e.z = 9; }, "INVALID_VERTICAL_CONSTRAINT"],
    ["B-0001", (e) => { e.placement = "member_vertical"; }, "INVALID_ENGINE_PLACEMENT"],
  ];
  for (const [id, change, reason] of cases) {
    const st: BimState = structuredClone(await S());
    change(st.elements[id]);
    assert.throws(() => checkElement(st, st.elements[id]), (e: any) => e.reason === reason, `${id}: ${reason}`);
  }
});

// ============================================================================ J + K
describe("J/K · type compatibility and queries", () => {
  test("Category -> Engine -> Type: cross-family and wrong-kind types refused at the tool and in the domain", async () => {
    const { p, run } = await setup();
    await rejected(p, "bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "D", start: [0, 0], end: [3, 0] }] }, "INVALID_REFERENCE");
    await rejected(p, "bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "B", at: [0, 0] }] }, "INVALID_REFERENCE");      // a beam profile type
    await rejected(p, "bim_create_profile_members", { members: [{ category: "architecture.floor", storey: "L0", type: "D", at: [0, 0] }] }, "CATEGORY_ENGINE_MISMATCH");
    await rejected(p, "bim_create_boundaries", { boundaries: [{ category: "structure.column", storey: "L0", type: "D", outline: [[0, 0], [1, 0], [1, 1]] }] }, "CATEGORY_ENGINE_MISMATCH");
    await rejected(p, "bim_create_profile_members", { members: [{ category: "structure.nope", storey: "L0", type: "B", at: [0, 0] }] }, "INVALID_CATEGORY");
    await run("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: [0, 0], end: [3, 0], z: 2.5 }] });
    // a patched type of another family is refused by the domain chain (tools resolve types within the category's kinds first)
    await rejected(p, "bim_update_elements", { items: [{ id: "B-0001", kind: "beam", set: { type: "D" } }] }, "INVALID_REFERENCE");
    const st: BimState = structuredClone(await p.state<BimState>(P, "bim"));
    (st.elements["B-0001"] as any).type = Object.values(st.types).find((t) => t.name === "D")!.id;
    const { checkElement } = await import("../src/index.js");
    assert.throws(() => checkElement(st, st.elements["B-0001"]), (e: any) => e.reason === "ENGINE_TYPE_MISMATCH");
    (st.elements["B-0001"] as any).type = Object.values(st.types).find((t) => t.name === "B")!.id;
    (st.elements["B-0001"] as any).category = "architecture.furniture";
    assert.throws(() => checkElement(st, st.elements["B-0001"]), (e: any) => e.reason === "CATEGORY_ENGINE_MISMATCH");
  });
  test("queries by engine (and the documented aliases), category, former kinds; rows carry category / discipline / engine; deterministic order", async () => {
    const { p, run } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0], height: 3 }] });
    await run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C", at: [1, 1] }, { category: "structure.framing", storey: "L0", type: "B", start: [0, 2], end: [5, 2] }] });
    await run("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D", outline: [[0, 0], [4, 0], [4, 3]] }] });
    const ids = async (input: unknown) => (await q(p, "bim_query_elements", input)).elements.map((e: any) => e.id);
    assert.deepEqual(await ids({ engine: "profile_member" }), ["B-0001", "C-0001"]);
    assert.deepEqual(await ids({ engine: "native" }), ["B-0001", "C-0001", "S-0001", "W-0001"], "deprecated group alias");
    assert.deepEqual(await ids({ kind: "column" }), ["C-0001"], "former kind = its category");
    assert.deepEqual(await ids({ kind: "profile_member" }), ["B-0001", "C-0001"]);
    const rows = (await q(p, "bim_query_elements", {})).elements.map((e: any) => [e.id, e.category, e.discipline, e.engine]);
    assert.deepEqual(rows, [["B-0001", "structure.framing", "structure", "profile_member"], ["C-0001", "structure.column", "structure", "profile_member"],
      ["S-0001", "architecture.floor", "architecture", "boundary"], ["W-0001", "architecture.wall", "architecture", "wall"]]);
    const eng = await q(p, "bim_get_engine", { id: "profile_member" });
    assert.deepEqual([eng.status, eng.placements, eng.typeFamilies, eng.categories], ["implemented", ["member_axis", "member_vertical", "member_spatial_axis"], ["profile"], ["structure.brace", "structure.caisson_foundation", "structure.column", "structure.deep_foundation", "structure.framing", "structure.pile"]]);
    const d = await q(p, "bim_get_element", { id: "C-0001" });
    assert.deepEqual([d.engine, d.placement_info.kind, d.representation.kind, d.representation.sweep], ["profile_member", "member_vertical", "profile_sweep", "vertical"]);
    assert.match((await q(p, "bim_resource_usage", { kind: "storey", ref: "L0" })).summary, /1 beam; 1 column; 1 slab; 1 wall/);
  });
});

// ============================================================================ L
test("L · events: legacy v2 beam / column / slab / door payloads upcast to canonical variants; future ElementCreated versions refused", async () => {
  const { p, stores, S } = await setup();
  const st = stores.project(P);
  const s0 = await S();
  const L0 = Object.values(s0.storeys).find((x) => x.name === "L0")!.id;
  const t = (n: string) => Object.values(s0.types).find((x) => x.name === n)!.id;
  const base = { commandId: "CMD-legacy", actor: "old", at: "2026-01-01T00:00:00.000Z" };
  const ev = (type: string, payload: unknown, schemaVersion: number): NewEvent => ({ ...base, module: "bim", type, payload, schemaVersion });
  await st.appendEvents([{ ...base, module: "platform", type: "CommandApplied", payload: { tool: "legacy", summary: {} }, schemaVersion: 1 },
    ev("ElementCreated", { id: "W-0090", kind: "wall", storey: L0, type: t("W"), start: [0, 0], end: [6, 0], height: 3, baseOffset: 0, prevDir: null, nextDir: null, exterior: null, vertical: { mode: "fixed" } }, 2),
    ev("ElementCreated", { id: "B-0090", kind: "beam", storey: L0, type: t("B"), start: [0, 1], end: [4, 1], z: 2.6, vertical: { mode: "fixed" } }, 2),
    ev("ElementCreated", { id: "C-0090", kind: "column", storey: L0, type: t("C"), at: [1, 1], height: 2.4, baseOffset: 0.2, rotation: 10 }, 1),          // v1: no vertical
    ev("ElementCreated", { id: "S-0090", kind: "slab", storey: L0, type: t("D"), outline: [[0, 0], [3, 0], [3, 3]], holes: [], offset: 0 }, 2),
    ev("ElementCreated", { id: "O-0090", kind: "opening", storey: L0, host: "W-0090", along: 3, width: 1, height: 2.1, sill: 0, filledBy: "D-0090" }, 2),
    ev("ElementCreated", { id: "D-0090", kind: "door", storey: L0, type: t("K"), host: "W-0090", opening: "O-0090" }, 2),
    ev("ElementUpdated", { id: "B-0090", changes: { end: [5, 1] } }, 2), ev("ElementUpdated", { id: "C-0090", changes: { height: 2.6, rotation: 15 } }, 1),
    ev("ElementUpdated", { id: "S-0090", changes: { offset: -0.1 } }, 2)], await st.lastSeq());
  const s = await new Platform({ modules: [bimModule], stores, snapshotPolicy: false }).state<BimState>(P, "bim");
  const e = (id: string) => s.elements[id] as any;
  assert.deepEqual([e("B-0090").kind, e("B-0090").category, e("B-0090").placement, e("B-0090").end, e("B-0090").z], ["profile_member", "structure.framing", "member_axis", [5, 1], 2.6]);
  assert.deepEqual([e("C-0090").category, e("C-0090").placement, e("C-0090").height, e("C-0090").rotation, e("C-0090").baseOffset, e("C-0090").vertical], ["structure.column", "member_vertical", 2.6, 15, 0.2, { mode: "fixed" }]);
  assert.deepEqual([e("S-0090").kind, e("S-0090").category, e("S-0090").offset], ["boundary", "architecture.floor", -0.1]);
  assert.deepEqual([e("D-0090").kind, e("D-0090").category, e("D-0090").opening], ["hosted_component", "architecture.door", "O-0090"]);
  assert.equal(BIM_EVENT_VERSIONS.ElementCreated, 3);
  await st.appendEvents([{ ...base, commandId: "CMD-future", module: "platform", type: "CommandApplied", payload: { tool: "x", summary: {} }, schemaVersion: 1 },
    { ...base, commandId: "CMD-future", module: "bim", type: "ElementCreated", payload: { id: "X-1", kind: "profile_member" }, schemaVersion: 4 }], await st.lastSeq());
  await assert.rejects(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }).state(P, "bim"), (x: any) => x.reason === "UNSUPPORTED_EVENT_VERSION");
});

// ============================================================================ M + N + O
const FX = path.join(import.meta.dirname, "fixtures/phase8-project");
const loadFixture = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p8fx-")); fs.cpSync(FX, path.join(dir, "phase8"), { recursive: true }); return dir; };
test("O · the real Phase 8 project migrates without semantic drift: quantities, spatial resolutions and usage equal what Phase 8 computed", async () => {
  const dir = loadFixture();
  const raw = fs.readFileSync(path.join(dir, "phase8/events.jsonl"), "utf8");
  const lines: string[] = [];
  const p = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: { everyEvents: 1000, keep: 3 }, logger: { info: (e) => lines.push(e), warn: (e) => lines.push(e) } });
  const s = await p.state<BimState>("phase8", "bim");
  assert.ok(lines.includes("snapshot.ignored_incompatible") && p.metrics.snapshotsLoaded === 0, "the v4 snapshot is ignored (state version 5)");
  const oracle = JSON.parse(fs.readFileSync(path.join(FX, "phase8-oracle/measurements.json"), "utf8"));
  const ctx = new SpatialContext(s);
  assert.deepEqual(Object.keys(s.elements).sort(), Object.keys(oracle.quantities).sort(), "same ids, nothing invented, nothing lost");
  for (const el of Object.values(s.elements)) {
    // Phase 10 closed the Phase 6 T-junction limitation: a T branch ends at its host's face, so its volume is smaller than
    // Phase 8 computed by exactly (host thickness / 2) x branch thickness x height per tee end. Everything else is unchanged.
    const teeEnds = el.kind === "wall" ? Object.values(wallFrame(s, el).ends).filter((k) => k === "tee_branch").length : 0;
    if (teeEnds) {
      const old = oracle.quantities[el.id], clipped = teeEnds * (0.2 / 2) * 0.2 * (el as any).height, q = quantities(s, el);
      assert.ok(Math.abs(q.gross_volume - (old.gross_volume - clipped)) < 1e-9 && Math.abs(q.net_volume - (old.net_volume - clipped)) < 1e-9, `T-clipped volume of ${el.id}`);
      for (const k of ["length", "thickness", "height", "side_area_net"]) assert.equal(q[k], old[k], `${el.id} ${k}`);
    } else assert.equal(canonicalJson(quantities(s, el)), canonicalJson(oracle.quantities[el.id]), `quantities of ${el.id}`);
    const { category: _c, ...usage } = elementUsage(s, el.id) as any;
    assert.equal(canonicalJson(usage), canonicalJson(oracle.usage[el.id]), `usage of ${el.id}`);
    if (el.kind === "spatial") {
      const r = resolveSpatialElement(ctx, el);
      assert.equal(canonicalJson({ status: r.status, area: r.area, perimeter: r.perimeter, volume: r.volume, signature: r.regionSignature }), canonicalJson(oracle.spatial[el.id]), el.id);
    }
  }
  assert.deepEqual(s.families && Object.keys(s.families).length, 1, "no families synthesised for native types");
  const { modelIssues } = await import("../src/index.js");
  assert.deepEqual(modelIssues(s), [], "the canonical state validates");
  assert.equal(fs.readFileSync(path.join(dir, "phase8/events.jsonl"), "utf8"), raw, "history never rewritten");
});
test("M · snapshots: the Phase 8 v4 snapshot file is untouched; a new v5 snapshot is written and reloading it equals the full replay", async () => {
  const dir = loadFixture();
  const old = fs.readFileSync(path.join(dir, "phase8/snapshots/000000000105.json"), "utf8");
  const p = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: { everyEvents: 1000, keep: 5 }, logger: quiet });
  await p.state("phase8", "bim");
  // the slot of seq 105 holds the Phase 8 snapshot: it is kept, and the platform says nothing was written
  assert.deepEqual(await p.createSnapshot("phase8"), { lastSeq: 105, written: false });
  assert.equal(fs.readFileSync(path.join(dir, "phase8/snapshots/000000000105.json"), "utf8"), old, "v4 snapshot untouched");
  await p.execute(user, "phase8", "bim_update_storeys", { items: [{ storey: "L1", set: { name: "Kat 1" } }] });
  const w = await p.createSnapshot("phase8");
  assert.equal(w?.written, true, "the next command's slot takes a v5 snapshot");
  const files = fs.readdirSync(path.join(dir, "phase8/snapshots")).sort();
  const fresh = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: { everyEvents: 1000, keep: 5 }, logger: quiet });
  const a = canonicalJson(await fresh.state("phase8", "bim"));
  assert.equal(fresh.metrics.snapshotsLoaded, 1, `v${BIM_STATE_VERSION} snapshot used (${files.join(",")})`);
  assert.equal(a, canonicalJson(await new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: false }).state("phase8", "bim")));
});
test("N · undo across the migration: legacy slab move and column update are walked back through the replay, the state stays valid", async () => {
  const dir = loadFixture();
  const p = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: false, logger: quiet });
  const S = () => p.state<BimState>("phase8", "bim");
  assert.deepEqual((((await S()).elements["S-0002"]) as any).outline[0], [15, 0]);
  let guard = 0;
  while ((((await S()).elements["S-0002"]) as any).outline[0][0] === 15 && guard++ < 20) await p.execute(user, "phase8", "platform_undo", {});
  const s = await S();
  assert.deepEqual([(s.elements["S-0002"] as any).outline[0], (s.elements["S-0001"] as any).offset, (s.elements["C-0002"] as any).height, s.elements["S-0002"].kind],
    [[14, 0], 0.05, 2.5, "boundary"], "only the commands after the move were undone");
  const { modelIssues } = await import("../src/index.js");
  assert.deepEqual(modelIssues(s), []);
  await p.execute(user, "phase8", "bim_update_elements", { items: [{ id: "C-0002", kind: "column", set: { height: 2.2 } }] });   // new canonical command on a migrated member
  await p.execute(user, "phase8", "platform_undo", {});
  assert.equal(((await S()).elements["C-0002"] as any).height, 2.5);
});

// ============================================================================ Q
const hasIfcOpenShell = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("Q · IFC of the migrated Phase 8 project equals Phase 8's own IFC element by element (class, storey, volume, Z range); schema valid (IfcOpenShell)", { skip: !hasIfcOpenShell }, async () => {
  const dir = loadFixture();
  const s = await new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: false }).state<BimState>("phase8", "bim");
  const mine = path.join(dir, "p9.ifc");
  fs.writeFileSync(mine, toIfc(s, { projectKey: "phase8" }));
  assert.equal(/NaN|Infinity/.test(fs.readFileSync(mine, "utf8")), false);
  const py = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.element as ue, ifcopenshell.util.shape as us
def probe(path):
    f = ifcopenshell.open(path); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
    st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}
    for e in f.by_type("IfcProduct"):
        if not e.Representation or e.is_a("IfcSpatialStructureElement") and not e.is_a("IfcSpace"): continue
        if e.is_a("IfcAnnotation") or e.is_a("IfcGrid"): continue
        g = ifcopenshell.geom.create_shape(st, e).geometry; zs = g.verts[2::3]
        c = ue.get_container(e) or ue.get_aggregate(e)
        out[e.GlobalId] = [e.is_a(), c.Name if c else None, round(us.get_volume(g), 6), round(min(zs), 6), round(max(zs), 6)]
    return { "errors": len(log.statements), "els": out }
print(json.dumps([probe(sys.argv[1]), probe(sys.argv[2])]))`;
  const [old, now] = JSON.parse(execFileSync("python3", ["-c", py, path.join(FX, "phase8-oracle/phase8.ifc"), mine]).toString());
  assert.equal(now.errors, 0, "schema validation");
  assert.deepEqual(Object.keys(now.els).sort(), Object.keys(old.els).sort(), "same products (stable GlobalIds)");
  // Phase 10: T branches end at the host face. Their IFC volume drops by exactly the clipped part (same for the Z range, class, storey).
  const teeClip: Record<string, number> = {};
  for (const el of Object.values(s.elements)) if (el.kind === "wall") {
    const n = Object.values(wallFrame(s, el).ends).filter((k) => k === "tee_branch").length;
    if (n) teeClip[ifcGuid(`phase8:${el.id}`)] = n * (0.2 / 2) * 0.2 * (el as any).height;
  }
  assert.equal(Object.keys(teeClip).length, 2, "the fixture's two T-branch walls");
  for (const [gid, v] of Object.entries(old.els) as [string, any][]) {
    const want = teeClip[gid] ? [v[0], v[1], v[2] - teeClip[gid], v[3], v[4]] : v;
    if (teeClip[gid]) assert.ok(Math.abs(now.els[gid][2] - want[2]) < 1e-5 && now.els[gid].filter((_: unknown, i: number) => i !== 2).every((x: unknown, i: number) => x === want.filter((_: unknown, j: number) => j !== 2)[i]), `T-clipped product ${gid}`);
    else assert.deepEqual(now.els[gid], v, `product ${gid} (${v[0]})`);
  }
  const classes = new Set(Object.values(now.els).map((v: any) => v[0]));
  for (const c of ["IfcWall", "IfcBeam", "IfcColumn", "IfcSlab", "IfcDoor", "IfcWindow", "IfcFurniture", "IfcSpace"]) assert.ok(classes.has(c), c);
});

test("representation is the single geometry contract: plan and IFC readers agree with it for members and boundaries", async () => {
  const { run, S } = await setup();
  await run("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: [1, 1], end: [4, 5], z: 2.6 }, { category: "structure.column", storey: "L0", type: "C", at: [2, 2], height: 2.4, rotation: 30 }] });
  await run("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D", outline: [[0, 0], [5, 0], [5, 4], [0, 4]], holes: [[[1, 1], [2, 1], [2, 2], [1, 2]]] }] });
  const s = await S();
  const b = resolveElementRepresentation(s, s.elements["B-0001"]) as any, c = resolveElementRepresentation(s, s.elements["C-0001"]) as any, f = resolveElementRepresentation(s, s.elements["S-0001"]) as any;
  assert.deepEqual([b.sweep, b.length, b.origin, b.profileCenter], ["axis", 5, [1, 1, 2.6], [0, -0.25]]);
  assert.ok(Math.abs(b.length * 0.3 * 0.5 - quantities(s, s.elements["B-0001"]).volume) < 1e-12);
  assert.deepEqual([c.sweep, c.length, c.origin], ["vertical", 2.4, [2, 2, 0]]);
  assert.deepEqual([f.kind, f.top, f.bottom, f.holes.length], ["boundary_extrusion", 0, -0.2, 1]);
  const ifc = toIfc(s, { projectKey: P });
  assert.match(ifc, /IFCBEAM\(/); assert.match(ifc, /IFCCOLUMN\(/); assert.match(ifc, /IFCARBITRARYPROFILEDEFWITHVOIDS/);
});
