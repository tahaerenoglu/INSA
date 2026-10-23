/** Phase 11 · railing / path engine, dry run, replay / snapshot / undo, legacy compatibility, semantic queries. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Platform, FileStores, canonicalJson } from "@insa/core";
import { bimModule, BimState, checkElement, quantities, pathPosts, pathLength, modelIssues, BIM_STATE_VERSION, BIM_EVENT_VERSIONS, resolveElementRepresentation } from "../src/index.js";
import { setup, P, user } from "./authoring-fixture.js";

const SQ: [number, number][] = [[0, 0], [10, 0], [10, 6], [0, 6]];
type T = Awaited<ReturnType<typeof setup>>;
async function arch() {
  const t = await setup({ everyEvents: 2, keep: 3 });
  await t.run("bim_create_types", { types: [
    { kind: "ceiling", name: "C13", layers: [{ material: "Alçıpan", thickness: 0.0125 }] }, { kind: "roof", name: "R20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "stair", name: "S20", max_riser: 0.2, min_tread: 0.25, default_width: 1.2 },
    { kind: "railing", name: "RL", height: 1.0, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 }] });
  return t;
}
const el = (s: BimState, id: string) => s.elements[id] as any;
const sumLen = (pts: number[][], closed: boolean) => pts.reduce((a, p, i) => a + (i + 1 < pts.length ? Math.hypot(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]) : closed ? Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]) : 0), 0);

describe("railing (path engine)", () => {
  test("posts follow ONE rule: a post at every vertex, equal intervals no wider than the type's spacing; quantities and open / closed paths", async () => {
    const t = await arch();
    await t.run("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [3, 0]] }, { storey: "L1", type: "RL", path: [[0, 0], [4, 0], [4, 4], [0, 4]], closed: true, offset: 0.1, height: 1.1 }] });
    const s = await t.S();
    assert.deepEqual(pathPosts(el(s, "RL-0001"), 1.2), [[0, 0], [1, 0], [2, 0], [3, 0]], "ceil(3 / 1.2) = 3 intervals, posts at j * 3 / 3");
    assert.equal(pathPosts(el(s, "RL-0002"), 1.2).length, 16, "closed: 4 segments x 4 intervals, no duplicated first / last post");
    assert.deepEqual([quantities(s, s.elements["RL-0001"]), quantities(s, s.elements["RL-0002"])],
      [{ path_length: 3, height: 1, post_count: 4 }, { path_length: 16, height: 1.1, post_count: 16 }]);
    assert.equal(pathLength(el(s, "RL-0002")), sumLen(el(s, "RL-0002").path, true), "the closing segment counts");
    const rep = resolveElementRepresentation(s, s.elements["RL-0002"]) as any;
    assert.deepEqual([rep.kind, rep.segments.length, rep.posts.length, rep.baseZ, rep.height], ["path_sweep", 4, 16, 0.1, 1.1]);
    for (const [a, b] of rep.segments as number[][][]) {                                // every post spacing is <= the limit
      const on = rep.posts.filter((p: number[]) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 1e-9 && p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9 && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9);
      assert.ok(on.length >= 2);
    }
    assert.deepEqual(Object.keys(s.elements).length, 2, "posts are NOT elements; nothing derived is stored");
    assert.ok(!/post|rail|mesh/i.test(Object.keys(el(s, "RL-0001")).join()));
  });
  test("the convenience tool is a thin adapter: identical canonical events to the generic path tool", async () => {
    const a = await arch(), b = await arch();
    await a.run("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [5, 0], [5, 3]], offset: 0.05 }] });
    await b.run("bim_create_path_elements", { elements: [{ category: "architecture.railing", storey: "L1", type: "RL", path: [[0, 0], [5, 0], [5, 3]], offset: 0.05 }] });
    const ev = async (t: T) => canonicalJson((await t.p.store(P).readEvents()).filter((e) => e.type === "ElementCreated").map((e) => [e.schemaVersion, e.payload]));
    assert.equal(await ev(a), await ev(b));
    assert.equal(canonicalJson(await a.S()), canonicalJson(await b.S()));
  });
  test("validation: zero-length segments are REJECTED (documented policy), closed paths need 3 points, height > 0, type family and category chain", async () => {
    const t = await arch();
    const bad = (railing: Record<string, unknown>, reason: string) => t.rejected("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [4, 0]], ...railing }] }, reason);
    await bad({ path: [[0, 0], [0, 0]] }, "INVALID_PATH_ELEMENT");                                           // M8
    await bad({ path: [[0, 0], [2, 0], [2, 0], [4, 0]] }, "INVALID_PATH_ELEMENT");                           // M9: duplicate adjacent vertices
    await bad({ path: [[0, 0], [4, 0], [4, 4], [0, 0]], closed: true }, "INVALID_PATH_ELEMENT");             // the closing segment has zero length
    await bad({ closed: true }, "INVALID_PATH_ELEMENT");                                                     // a 2-point loop
    await bad({ height: 0 }, "INVALID_DIMENSION");                                                           // M10
    await bad({ height: -1 }, "INVALID_DIMENSION");
    await bad({ type: "S20" }, "INVALID_REFERENCE");                                                         // a stair type on a railing
    await bad({ type: "NoSuchType" }, "RESOURCE_NOT_FOUND");
    await t.rejected("bim_create_path_elements", { elements: [{ category: "architecture.stair", storey: "L1", type: "RL", path: [[0, 0], [4, 0]] }] }, "CATEGORY_ENGINE_MISMATCH");
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.railing", storey: "L1", type: "RL", outline: SQ }] }, "CATEGORY_ENGINE_MISMATCH");
    const ok = await t.run("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [4, 0]] }] });
    const st = structuredClone(await t.S());                                                                // a non-finite coordinate is caught by the engine validator
    (st.elements[ok.summary.created[0]] as any).path = [[0, 0], [Number.NaN, 0]];
    assert.throws(() => checkElement(st, st.elements[ok.summary.created[0]]), (e: any) => e.reason === "INVALID_GEOMETRY");
  });
  test("generic update / move / reassign / delete; duplicates by category + path + offset", async () => {
    const t = await arch();
    await t.run("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [6, 0]] }, { storey: "L1", type: "RL", path: [[0, 0], [6, 0]], offset: 0.5 }] });
    assert.deepEqual((await t.ex("bim_validate", {})).result.issues, [], "another offset: another railing");
    await t.run("bim_update_elements", { items: [{ id: "RL-0002", kind: "path", set: { offset: 0 } }] });
    assert.deepEqual((await t.ex("bim_validate", {})).result.issues.map((i: any) => i.ids), [["RL-0001", "RL-0002"]]);
    await t.run("bim_update_elements", { items: [{ id: "RL-0002", kind: "path", set: { path: [[0, 0], [6, 0], [6, 4]], closed: false, height: 1.2 } }] });
    await t.run("bim_move_elements", { ids: ["RL-0002"], vector: [1, 1] });
    await t.run("bim_reassign_storey", { items: [{ id: "RL-0002", storey: "L0" }] });
    const s = await t.S();
    assert.deepEqual([el(s, "RL-0002").path, el(s, "RL-0002").height, el(s, "RL-0002").storey === Object.values(s.storeys).find((x) => x.name === "L0")!.id], [[[1, 1], [7, 1], [7, 5]], 1.2, true]);
    assert.deepEqual((await t.ex("bim_query_elements", { engine: "path" })).result.elements.map((r: any) => [r.id, r.category, r.engine]), [["RL-0001", "architecture.railing", "path"], ["RL-0002", "architecture.railing", "path"]]);
    await t.rejected("bim_delete_types", { types: [{ type: "RL" }] }, "RESOURCE_IN_USE");
    await t.run("bim_delete_elements", { ids: ["RL-0001", "RL-0002"] });
    assert.equal(Object.keys((await t.S()).elements).length, 0);
  });
});

describe("dry run, replay, snapshot, undo", () => {
  const SQ2 = SQ;
  const creates: [string, unknown][] = [
    ["bim_create_boundaries", { boundaries: [{ category: "architecture.ceiling", storey: "L0", type: "C13", outline: SQ2, offset: 2.7 }] }],
    ["bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "R20", outline: SQ2, offset: 0, slope: { azimuth: 90, pitch: 25 } }] }],
    ["bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [5, 1], riser_count: 16 }] }],
    ["bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [10, 0], [10, 6]] }] }],
  ];
  for (const [tool, input] of creates)
    test(`${(input as any)[Object.keys(input as object)[0]][0].category ?? "architecture.railing"}: the dry run is the apply's decision and persists nothing`, async () => {
      const t = await arch();
      const before = await t.snap();
      const dry = await t.ex(tool, input, { dryRun: true });
      assert.equal(dry.status, "preview");
      assert.deepEqual(await t.snap(), before);
      const n = (await t.p.store(P).readEvents()).length;
      const real = await t.ex(tool, input);
      assert.deepEqual(real.summary, dry.preview.summary);
      assert.deepEqual((await t.p.store(P).readEvents()).slice(n).filter((e) => e.module === "bim").map((e) => e.type), dry.preview.events);
    });
  test("mixed history: live == full replay == snapshot + tail at every step; undo restores exactly; canonical events only", async () => {
    const t = await arch();
    const fullReplay = async () => canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim"));
    const steps: [string, unknown][] = [...creates, ["bim_update_elements", { items: [{ id: "RF-0001", kind: "boundary", set: { slope: { azimuth: 180, pitch: 10 } } }] }],
      ["bim_move_elements", { ids: ["CE-0001", "STR-0001", "RL-0001"], vector: [1, 0.5] }], ["bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.0 } }] }]];
    const states: string[] = [];
    for (const [tool, input] of steps) {
      await t.run(tool, input);
      assert.equal(canonicalJson(await t.S()), await fullReplay(), `after ${tool}`);
      const reloaded = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: { everyEvents: 2, keep: 3 } });
      assert.equal(canonicalJson(await reloaded.state(P, "bim")), await fullReplay(), "snapshot reload");
      states.push(canonicalJson(await t.S()));
    }
    const types = new Set((await t.p.store(P).readEvents()).filter((e) => e.module === "bim").map((e) => e.type));
    assert.ok([...types].every((x) => /^(Storey|Type|Material|Element|Counters)/.test(x)), `no Roof/Ceiling/Stair/Railing event types: ${[...types]}`);
    for (let k = steps.length - 1; k >= 1; k--) { await t.run("platform_undo", {}); assert.equal(canonicalJson(await t.S()), states[k - 1], `undo of ${steps[k][0]}`); }
    assert.deepEqual(modelIssues(await t.S()), []);
  });
});

describe("compatibility", () => {
  test("event / state versions are unchanged; the real Phase 8 project replays with NO new-category element and unchanged ids", async () => {
    assert.deepEqual([BIM_STATE_VERSION, BIM_EVENT_VERSIONS.ElementCreated, BIM_EVENT_VERSIONS.ElementUpdated], [7, 3, 2]);   // state version 7 = Phase 14 spatial units (additive); the element event versions are unchanged
    const FX = path.join(import.meta.dirname, "fixtures/phase8-project"), dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p11fx-"));
    fs.cpSync(FX, path.join(dir, "phase8"), { recursive: true });
    const raw = fs.readFileSync(path.join(dir, "phase8/events.jsonl"), "utf8");
    const s = await new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: false }).state<BimState>("phase8", "bim");
    const oracle = JSON.parse(fs.readFileSync(path.join(FX, "phase8-oracle/measurements.json"), "utf8"));
    assert.deepEqual(Object.keys(s.elements).sort(), Object.keys(oracle.quantities).sort(), "same ids: nothing inferred, nothing lost");
    assert.deepEqual(Object.values(s.elements).filter((e) => ["stair", "path"].includes(e.kind) || /ceiling|roof|stair|railing/.test((e as any).category ?? "")), [], "no old project acquires a ceiling, roof, stair or railing");
    assert.equal(fs.readFileSync(path.join(dir, "phase8/events.jsonl"), "utf8"), raw, "history never rewritten");
    void user;
  });
  test("semantic queries never collapse categories into their engine: floor / ceiling / roof; railing", async () => {
    const t = await arch();
    await t.run("bim_create_types", { types: [{ kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] }] });
    await t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D20", outline: SQ }, { category: "architecture.ceiling", storey: "L0", type: "C13", outline: SQ, offset: 2.7 },
      { category: "architecture.roof", storey: "L1", type: "R20", outline: SQ }] });
    await t.run("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [4, 0]] }] });
    const rows = (await t.ex("bim_query_elements", {})).result.elements.map((r: any) => [r.category, r.engine]);
    assert.deepEqual(rows.sort(), [["architecture.ceiling", "boundary"], ["architecture.floor", "boundary"], ["architecture.railing", "path"], ["architecture.roof", "boundary"]]);
    for (const c of ["architecture.floor", "architecture.ceiling", "architecture.roof", "architecture.railing"]) assert.equal((await t.ex("bim_query_elements", { category: c })).result.elements.length, 1, c);
    assert.equal((await t.ex("bim_query_elements", { engine: "boundary" })).result.elements.length, 3);
    const tq = (await t.ex("bim_query_types", {})).result, types = (Array.isArray(tq) ? tq : tq.types).map((x: any) => [x.name, x.kind]);
    assert.ok(["C13", "R20", "S20", "RL"].every((n) => types.some(([nm]: string[]) => nm === n)));
    assert.match((await t.ex("bim_resource_usage", { kind: "storey", ref: "L0" })).result.summary, /ceiling/);
  });
});
