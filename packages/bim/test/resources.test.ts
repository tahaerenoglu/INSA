/**
 * Phase 4 · lifecycle of existing BIM resources: Storey, Grid, Material, Type.
 * Every rejection is checked to leave the event log and the committed state unchanged.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Platform, MemoryStores, ArtifactStore, Actor, canonicalJson, PlatformLogger, NewEvent } from "@insa/core";
import { bimModule, BimState, toIfc } from "../src/index.js";

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "res";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };

async function setup(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet,
                           artifacts: new ArtifactStore(fs.mkdtempSync(path.join(os.tmpdir(), "insa-p4-"))) });
  const run = async (tool: string, input: unknown) => {
    const r: any = await p.execute(user, P, tool, input);
    assert.ok(r.status === "applied" || r.status === "ok", JSON.stringify(r));
    return r;
  };
  await run("bim_create_storeys", { storeys: [{ name: "01", elevation: 3.5 }, { name: "00", elevation: 0 }, { name: "B1", elevation: -3 }] });
  await run("bim_create_types", { types: [
    { kind: "wall", name: "DD", layers: [{ material: "Sıva", thickness: 0.02, function: "finish" }, { material: "Tuğla", thickness: 0.2 }] },
    { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "column", name: "C40", material: "Beton", profile: { shape: "rect", b: 0.4, h: 0.4 } },
    { kind: "beam", name: "B30", profile: { shape: "rect", b: 0.3, h: 0.5 } },
    { kind: "door", name: "K100", width: 1, height: 2.1 }, { kind: "window", name: "P100", width: 1, height: 1 },
    { kind: "window", name: "P-UNUSED", width: 0.6, height: 0.6 }, { kind: "wall", name: "UNUSED-WALL", layers: [{ material: "Gazbeton", thickness: 0.25 }] }] });
  await run("bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [0, 0], end: [10, 0], height: 3 },
                                          { storey: "00", type: "DD", start: [0, 6], end: [10, 6], height: 3 }] });
  await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 8, type: "P100" }, { kind: "door", host: "W-0001", along: 2, type: "K100" }] });
  await run("bim_create_columns", { columns: [{ storey: "00", type: "C40", at: [5, 3], height: 3 }] });
  await run("bim_create_beams", { beams: [{ storey: "00", type: "B30", start: [0, 3], end: [10, 3] }] });
  await run("bim_create_slabs", { slabs: [{ storey: "01", type: "D20", outline: [[0, 0], [10, 0], [10, 6], [0, 6]] }] });
  await run("bim_create_grids", { grids: [{ name: "A", start: [0, -1], end: [0, 7] }, { name: "B", start: [10, -1], end: [10, 7] }, { name: "1", start: [-1, 0], end: [11, 0] }] });
  const s = await p.state<BimState>(P, "bim");
  const id = (rec: Record<string, { id: string; name: string; kind?: string }>, name: string, kind?: string) =>
    Object.values(rec).find((x) => x.name === name && (!kind || x.kind === kind))!.id;
  return { p, stores, run, s, id };
}
const st = (p: Platform) => p.state<BimState>(P, "bim");
const snap = async (p: Platform) => ({ events: (await p.store(P).readEvents()).length, state: JSON.stringify(await st(p)) });
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

// ============================================================================ A
describe("A · Storey", () => {
  test("query is ordered by elevation and reports usage; rename keeps every reference (ids)", async () => {
    const { p, run, id } = await setup();
    const rows = await q(p, "bim_query_storeys");
    // 01: the slab on it + (Phase 5) the beam on 00 whose top follows 01 (created without z -> storey-constrained)
    assert.deepEqual(rows.map((r: any) => [r.name, r.elevation, r.usageCount]), [["B1", -3, 0], ["00", 0, 8], ["01", 3.5, 2]]);
    const L00 = id((await st(p)).storeys, "00");
    await run("bim_update_storeys", { items: [{ storey: "00", set: { name: "Zemin Kat" } }] });
    const s = await st(p);
    assert.equal(s.storeys[L00].name, "Zemin Kat");
    assert.ok(Object.values(s.elements).filter((e) => e.storey === L00).length === 8, "elements still point to the same id");
    assert.match(toIfc(s, { projectKey: P }), /Zemin Kat/);
  });
  test("elevation update leaves FIXED element geometry unchanged; (Phase 5) storey-constrained elements follow", async () => {
    const { p, run } = await setup();
    const before = structuredClone((await st(p)).elements);
    await run("bim_update_storeys", { items: [{ storey: "01", set: { elevation: 3.8 } }] });
    const after = (await st(p)).elements;
    for (const [id, el] of Object.entries(before)) {
      if (id === "B-0001") continue;
      assert.deepEqual(after[id], el, `${id} unchanged`);              // walls (explicit height), columns, slab, openings: fixed
    }
    assert.equal((after["B-0001"] as any).z, 3.8, "the beam created without z follows storey 01");
    assert.deepEqual((after["B-0001"] as any).vertical, before["B-0001"] && (before["B-0001"] as any).vertical);
  });
  test("delete unused succeeds; delete used is refused with RESOURCE_IN_USE and bounded usage details", async () => {
    const { p, run, id } = await setup();
    await run("bim_delete_storeys", { storeys: ["B1"] });
    const L00 = id((await st(p)).storeys, "00");
    const e = await rejected(p, "bim_delete_storeys", { storeys: ["00"] }, "RESOURCE_IN_USE", { resourceKind: "storey", resourceId: L00, usageCount: 8 });
    assert.match(e.details.usageSummary, /2 wall/); assert.match(e.details.usageSummary, /2 opening/); assert.match(e.details.usageSummary, /1 column/);
    assert.ok(String(e.details.sampleIds).split(",").length <= 10);
  });
  test("names: unique (case-insensitive, trimmed), non-empty, bounded; immutable fields refused", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_storeys", { items: [{ storey: "01", set: { name: "00" } }] }, "DUPLICATE_RESOURCE");
    await rejected(p, "bim_update_storeys", { items: [{ storey: "01", set: { name: " b1 " } }] }, "DUPLICATE_RESOURCE");
    await rejected(p, "bim_create_storeys", { storeys: [{ name: "B1", elevation: 9 }] }, "DUPLICATE_RESOURCE");
    for (const name of ["", "   ", "x".repeat(101), "a\u0007b"])
      await rejected(p, "bim_update_storeys", { items: [{ storey: "01", set: { name } }] }, "INVALID_RESOURCE_NAME");
    await rejected(p, "bim_update_storeys", { items: [{ storey: "01", set: { id: "L-9" } }] }, "INVALID_RESOURCE_UPDATE", { field: "id" });
    await rejected(p, "bim_update_storeys", { items: [{ storey: "nope", set: { name: "x" } }] }, "RESOURCE_NOT_FOUND");
  });
  test("undo restores the previous name and a deleted storey", async () => {
    const { p, run } = await setup();
    await run("bim_update_storeys", { items: [{ storey: "01", set: { name: "Kat 1", elevation: 4 } }] });
    await run("platform_undo", {});
    assert.deepEqual(Object.values((await st(p)).storeys).find((x) => x.name === "01")!.elevation, 3.5);
    await run("bim_delete_storeys", { storeys: ["B1"] });
    await run("platform_undo", {});
    assert.ok(Object.values((await st(p)).storeys).some((x) => x.name === "B1"));
  });
});

// ============================================================================ B
describe("B · Grid", () => {
  test("query, geometry update, rename, delete; invalid geometry and duplicates refused", async () => {
    const { p, run } = await setup();
    assert.deepEqual((await q(p, "bim_query_grids")).map((g: any) => g.name), ["A", "B", "1"]);
    await run("bim_update_grids", { items: [{ grid: "A", set: { start: [0.5, -1], end: [0.5, 7] } }, { grid: "1", set: { name: "1'" } }] });
    const s = await st(p);
    assert.deepEqual(Object.values(s.grids).find((g) => g.name === "A")!.start, [0.5, -1]);
    await rejected(p, "bim_update_grids", { items: [{ grid: "B", set: { end: [10, -1] } }] }, "DEGENERATE_GEOMETRY");
    await rejected(p, "bim_update_grids", { items: [{ grid: "B", set: { name: "a" } }] }, "DUPLICATE_RESOURCE");
    await rejected(p, "bim_create_grids", { grids: [{ name: "C", start: [0, 0], end: [0, 5] }, { name: "c", start: [1, 0], end: [1, 5] }] }, "DUPLICATE_RESOURCE");
    await rejected(p, "bim_update_grids", { items: [{ grid: "B", set: { start: [Number.NaN, 0] } }] }, "INVALID_INPUT");
    await run("bim_delete_grids", { grids: ["B"] });
    assert.deepEqual((await q(p, "bim_query_grids", { name: "1" })).map((g: any) => g.name), ["1'"]);
    assert.equal((await q(p, "bim_resource_usage", { kind: "grid", ref: "A" })).usageCount, 0);
  });
  test("legacy duplicate grid names (accepted before Phase 4) still load; references must then use the id", async () => {
    const { p, stores } = await setup();
    const st0 = stores.project(P);
    const base = { commandId: "CMD-old", actor: "old", at: "2026-01-01T00:00:00.000Z" };
    const legacy: NewEvent[] = [{ ...base, module: "platform", type: "CommandApplied", payload: { tool: "bim_create_grids", summary: {} } },
      { ...base, module: "bim", type: "GridCreated", payload: { id: "G-0900", name: "A", start: [3, 0], end: [3, 5] } }];
    await st0.appendEvents(legacy, await st0.lastSeq());
    assert.equal((await q(p, "bim_query_grids", { name: "a" })).length, 2);
    await rejected(p, "bim_update_grids", { items: [{ grid: "A", set: { end: [3, 6] } }] }, "AMBIGUOUS_RESOURCE_REFERENCE");
    await rejected(p, "bim_update_grids", { items: [{ grid: "G-0900", set: { end: [3, 6] } }] }, "DUPLICATE_RESOURCE");   // touching it requires a unique name
    await p.execute(user, P, "bim_update_grids", { items: [{ grid: "G-0900", set: { name: "A2", end: [3, 6] } }] });
  });
});

// ============================================================================ C
describe("C · Material", () => {
  test("create, query (order, filters, usage), update, delete unused; delete used refused with type/layer details", async () => {
    const { p, run, id } = await setup();
    await run("bim_create_materials", { materials: [{ name: "Çelik S355", color: "#8899aa", category: "Metal" }, { name: "Ahşap" }] });
    const names = (await q(p, "bim_query_materials")).map((m: any) => m.name);
    assert.deepEqual(names, [...names].sort((a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)));
    assert.deepEqual((await q(p, "bim_query_materials", { category: "metal" })).map((m: any) => m.name), ["Çelik S355"]);
    await run("bim_update_materials", { items: [{ material: "Tuğla", set: { name: "Yatay Delikli Tuğla", color: "#b5651d", category: "Kagir" } }] });
    const s = await st(p);
    const DD = id(s.types, "DD", "wall");
    assert.equal(s.materials[(s.types[DD] as any).layers[1].material].name, "Yatay Delikli Tuğla", "type keeps the id, sees the new name");
    assert.match(toIfc(s, { projectKey: P }), /Yatay Delikli Tu/);
    const use = await q(p, "bim_resource_usage", { kind: "material", ref: "Beton" });
    assert.deepEqual(use.usages.map((u: any) => [u.typeKind, u.via, u.layerIndexes ?? null]), [["column", "profile", null], ["slab", "layer", [0]]]);
    const e = await rejected(p, "bim_delete_materials", { materials: ["Beton"] }, "RESOURCE_IN_USE", { resourceKind: "material", usageCount: 2 });
    assert.match(e.details.usageSummary, /slab type D20 layer 0/);
    await run("bim_delete_materials", { materials: ["Ahşap"] });
    await rejected(p, "bim_update_materials", { items: [{ material: "Beton", set: { color: "red" } }] }, "INVALID_RESOURCE_UPDATE", { field: "color" });
    await rejected(p, "bim_create_materials", { materials: [{ name: "beton" }] }, "DUPLICATE_RESOURCE");
  });
  test("deleting a type and its only material in one command is allowed (candidate state); undo restores both", async () => {
    const { p, run } = await setup();
    await run("bim_delete_types", { types: [{ type: "UNUSED-WALL", kind: "wall" }] });
    await run("platform_undo", {});
    await rejected(p, "bim_delete_materials", { materials: ["Gazbeton"] }, "RESOURCE_IN_USE");
    await p.execute(user, P, "bim_delete_types", { types: [{ type: "UNUSED-WALL" }] });
    await run("bim_delete_materials", { materials: ["Gazbeton"] });
    await run("platform_undo", {}); await run("platform_undo", {});
    const s = await st(p);
    assert.ok(Object.values(s.materials).some((m) => m.name === "Gazbeton") && Object.values(s.types).some((t) => t.name === "UNUSED-WALL"));
  });
  test("undo of a material creation removes it", async () => {
    const { p, run } = await setup();
    await run("bim_create_materials", { materials: [{ name: "Cam" }] });
    await run("platform_undo", {});
    assert.equal(Object.values((await st(p)).materials).some((m) => m.name === "Cam"), false);
  });
});

// ============================================================================ D
describe("D · Type", () => {
  test("query (ordered, usage), rename, valid layer update, kind-specific rules, delete unused / used, undo", async () => {
    const { p, run, id } = await setup();
    const rows = await q(p, "bim_query_types");
    assert.deepEqual(rows.map((t: any) => t.kind), ["beam", "column", "door", "slab", "wall", "wall", "window", "window"]);
    assert.deepEqual(rows.filter((t: any) => t.kind === "wall").map((t: any) => [t.name, t.usageCount]), [["DD", 2], ["UNUSED-WALL", 0]]);
    await run("bim_update_types", { items: [{ type: "DD", kind: "wall", set: { name: "DD-25", layers: [{ material: "Sıva", thickness: 0.02, function: "finish" }, { material: "Tuğla", thickness: 0.23 }] } }] });
    const s = await st(p);
    assert.equal((s.types[id(s.types, "DD-25", "wall")] as any).layers[1].thickness, 0.23);
    await rejected(p, "bim_update_types", { items: [{ type: "DD-25", kind: "wall", set: { width: 2 } }] }, "INVALID_RESOURCE_UPDATE", { field: "width" });
    await rejected(p, "bim_update_types", { items: [{ type: "DD-25", kind: "beam", set: { name: "x" } }] }, "RESOURCE_KIND_MISMATCH");
    await rejected(p, "bim_update_types", { items: [{ type: "DD-25", kind: "wall", set: { layers: [{ material: "Sıva", thickness: 0 }] } }] }, "INVALID_DIMENSION");
    await rejected(p, "bim_update_types", { items: [{ type: "C40", kind: "column", set: { profile: { shape: "rect", b: 0, h: 1 } } }] }, "INVALID_INPUT");
    await rejected(p, "bim_update_types", { items: [{ type: "P100", kind: "window", set: { name: "P-UNUSED" } }] }, "DUPLICATE_RESOURCE");
    await run("bim_create_types", { types: [{ kind: "slab", name: "DD-25", layers: [{ material: "Beton", thickness: 0.3 }] }] });   // same name, other kind: allowed
    await run("bim_delete_types", { types: [{ type: "P-UNUSED" }] });
    const e = await rejected(p, "bim_delete_types", { types: [{ type: "DD-25", kind: "wall" }] }, "RESOURCE_IN_USE", { usageCount: 2 });
    assert.equal(e.details.sampleIds, "W-0001,W-0002");
    await rejected(p, "bim_delete_types", { types: [{ type: "DD-25" }] }, "AMBIGUOUS_RESOURCE_REFERENCE");
    await run("platform_undo", {}); await run("platform_undo", {}); await run("platform_undo", {});        // delete, slab type, rename/layers
    const back = await st(p);
    assert.ok(Object.values(back.types).some((t) => t.name === "DD") && Object.values(back.types).some((t) => t.name === "P-UNUSED"));
    assert.equal((back.types[id(back.types, "DD", "wall")] as any).layers[1].thickness, 0.2);
  });
});

// ============================================================================ E
describe("E · type changes re-validate the elements that use them", () => {
  test("window / door resize that would break the host relation is refused; nothing changes", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_types", { items: [{ type: "P100", kind: "window", set: { width: 4.5 } }] }, "DEPENDENT_ELEMENT_INVALID",   // 8 ± 2.25 > 10 m
      { dependentId: "N-0001", cause: "INVALID_HOST_RELATION" });
    await rejected(p, "bim_update_types", { items: [{ type: "K100", kind: "door", set: { height: 3.5 } }] }, "DEPENDENT_ELEMENT_INVALID", { dependentId: "D-0001" });
    await rejected(p, "bim_update_types", { items: [{ type: "K100", kind: "door", set: { width: 5 } }] }, "DEPENDENT_ELEMENT_INVALID");
  });
  test("a valid resize is applied to the openings it fills; export still works", async () => {
    const { p, run } = await setup();
    await run("bim_update_types", { items: [{ type: "P100", kind: "window", set: { width: 1.4, height: 1.2 } }] });
    const s = await st(p);
    assert.deepEqual([(s.elements["O-0001"] as any).width, (s.elements["O-0001"] as any).height], [1.4, 1.2]);
    const ifc = toIfc(s, { projectKey: P });
    assert.equal(/NaN|Infinity/.test(ifc), false);
  });
  test("wall type thickness and beam profile changes re-validate their elements", async () => {
    const { p, run } = await setup();
    await run("bim_update_types", { items: [{ type: "B30", kind: "beam", set: { profile: { shape: "rect", b: 0.35, h: 0.7 } } }] });
    await run("bim_update_types", { items: [{ type: "DD", kind: "wall", set: { layers: [{ material: "Tuğla", thickness: 0.3 }] } }] });
    await rejected(p, "bim_update_types", { items: [{ type: "DD", kind: "wall", set: { layers: [{ material: "Tuğla", thickness: 0.00001 }] } }] }, "INVALID_DIMENSION");
  });
});

// ============================================================================ F
describe("F · batch atomicity", () => {
  test("all-valid batches commit; one invalid item or one used resource rejects the whole command", async () => {
    const { p, run } = await setup();
    await run("bim_update_materials", { items: [{ material: "Sıva", set: { color: "#eeeeee" } }, { material: "Beton", set: { category: "Beton" } }] });
    await rejected(p, "bim_update_storeys", { items: [{ storey: "B1", set: { name: "Bodrum" } }, { storey: "01", set: { name: "00" } }] }, "DUPLICATE_RESOURCE");
    await rejected(p, "bim_delete_types", { types: [{ type: "P-UNUSED" }, { type: "UNUSED-WALL" }, { type: "K100" }] }, "RESOURCE_IN_USE");
    await rejected(p, "bim_delete_materials", { materials: ["Gazbeton", "Tuğla"] }, "RESOURCE_IN_USE");
    await rejected(p, "bim_update_types", { items: [{ type: "P-UNUSED", kind: "window", set: { width: 0.7 } }, { type: "P100", kind: "window", set: { width: 9 } }] }, "DEPENDENT_ELEMENT_INVALID");
    const s = await st(p);
    assert.ok(Object.values(s.types).some((t) => t.name === "P-UNUSED") && Object.values(s.storeys).some((x) => x.name === "B1"));
  });
});

// ============================================================================ H + I
test("H/I · resource history: full replay == snapshot + tail == live after every step; IFC exports at the end", async () => {
  const { p, stores } = await setup({ everyEvents: 3, keep: 2 });
  const steps: [string, unknown][] = [
    ["bim_create_materials", { materials: [{ name: "Cam", color: "#aaddff" }] }],
    ["bim_update_storeys", { items: [{ storey: "00", set: { name: "Zemin" } }] }],
    ["bim_update_types", { items: [{ type: "P100", kind: "window", set: { width: 1.2 } }] }],
    ["bim_delete_types", { types: [{ type: "K100" }] }],                                 // rejected: in use
    ["bim_delete_types", { types: [{ type: "P-UNUSED" }] }],
    ["bim_update_materials", { items: [{ material: "Beton", set: { name: "Beton C30/37" } }] }],
    ["platform_undo", {}],
    ["bim_update_grids", { items: [{ grid: "A", set: { name: "A1" } }] }],
    ["bim_delete_storeys", { storeys: ["B1"] }],
    ["platform_undo", {}],
    ["platform_undo", {}],
  ];
  for (const [tool, input] of steps) {
    await p.execute(user, P, tool, input).catch((e) => assert.equal(e.reason, "RESOURCE_IN_USE"));
    const v = async (x: Platform) => canonicalJson({ s: await x.state(P, "bim"), h: await x.history(P, 1e6) });
    const full = await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
    assert.equal(await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: { everyEvents: 3, keep: 2 }, logger: quiet })), full, `after ${tool}`);
    assert.equal(await v(p), full);
  }
  assert.ok(p.metrics.snapshotsWritten > 0);
  const ev = await stores.project(P).readEvents();
  for (const t of ["StoreyUpdated", "TypeUpdated", "TypeDeleted", "MaterialUpdated", "GridUpdated", "StoreyDeleted"])
    assert.ok(ev.some((e) => e.type === t && e.schemaVersion === 1), `${t} written with schemaVersion 1`);
  const s = await st(p);
  assert.equal(Object.values(s.storeys).find((x) => x.name === "Zemin") !== undefined, true);
  const res: any = (await p.execute(user, P, "bim_export_ifc", { name: "p4" }) as any).result;
  const ifc = fs.readFileSync(p.requireArtifacts().resolve(P, res.artifact.id).path, "utf8");
  assert.equal(/NaN|Infinity/.test(ifc), false);
  assert.match(ifc, /Zemin/); assert.match(ifc, /IFCWINDOW\(/);
});
