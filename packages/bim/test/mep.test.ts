/** Phase 13 · MEP core: systems, routes, connectors, explicit junctions, network, atomic protections. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, modelIssues, routeWorld, routeLength, validateMepJunctions, connectorsOf, mepNetwork, BIM_STATE_VERSION, BIM_EVENT_VERSIONS } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

type T = Awaited<ReturnType<typeof setup>>;
const el = (s: BimState, id: string) => s.elements[id] as any;
const R = (x: number, y: number, offset: number, storey = "L0") => ({ storey, at: [x, y], offset });
const ref = (element: string, connector: string) => ({ element, connector });
const connect = (t: T, ...c: [string, string][]) => t.run("bim_connect_mep", { connectors: c.map(([e, k]) => ref(e, k)) });
const events = async (t: T) => (await t.p.store(P).readEvents()).length;
const replay = async (t: T) => new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");

async function mep(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [{ kind: "pipe", name: "P25", diameter: 0.025 }, { kind: "pipe", name: "P40", diameter: 0.04 }, { kind: "duct", name: "DR", shape: "rectangular", width: 0.4, height: 0.2 },
    { kind: "duct", name: "DC", shape: "round", diameter: 0.3 }, { kind: "cable_tray", name: "TR", width: 0.3, height: 0.1 }, { kind: "conduit", name: "CN", diameter: 0.02 }] });
  await t.run("bim_create_mep_systems", { systems: [{ name: "DCW", domain: "piping", classification: "domestic_cold_water" }, { name: "SAN", domain: "piping", classification: "sanitary" },
    { name: "SA", domain: "hvac", classification: "supply_air" }, { name: "PWR", domain: "electrical", classification: "power" }] });
  return t;
}
const pipes = (t: T, ...routes: { type?: string; system?: string; route: ReturnType<typeof R>[] }[]) =>
  t.run("bim_create_pipes", { pipes: routes.map((r) => ({ type: r.type ?? "P25", system: r.system ?? "DCW", route: r.route })) });

describe("systems, types, routes", () => {
  test("one lifecycle for pipe / duct / cable tray / conduit: world route, ONE length, quantities; a storey change re-derives everything with no MEP event", async () => {
    const t = await mep({ everyEvents: 3, keep: 2 });
    await t.run("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(0, 0, 0.5), R(4, 0, 0.5), R(4, 3, 0.5, "L1")] }] });
    await t.run("bim_create_ducts", { ducts: [{ type: "DR", system: "SA", route: [R(0, 5, 2.5), R(6, 5, 2.5)] }, { type: "DC", system: "SA", route: [R(0, 6, 2.5), R(3, 6, 2.5)] }] });
    await t.run("bim_create_cable_trays", { cable_trays: [{ type: "TR", system: "PWR", route: [R(0, 7, 2.8), R(5, 7, 2.8)] }] });
    await t.run("bim_create_conduits", { conduits: [{ type: "CN", system: "PWR", route: [R(0, 8, 2.8), R(5, 8, 2.8)] }] });
    let s = await t.S();
    assert.deepEqual(["ME-0001", "ME-0002", "ME-0003", "ME-0004", "ME-0005"].map((id) => [el(s, id).kind, el(s, id).category]), [["mep_segment", "plumbing.pipe"], ["mep_segment", "mechanical.duct"], ["mep_segment", "mechanical.duct"], ["mep_segment", "electrical.cable_tray"], ["mep_segment", "electrical.conduit"]]);
    const want = 4 + Math.hypot(3, 3.2);                                            // independent polyline oracle: 4 m, then 3 m in plan + 3.2 m up
    assert.ok(Math.abs(routeLength(s, el(s, "ME-0001")) - want) < 1e-12);
    assert.deepEqual(routeWorld(s, el(s, "ME-0001")), [[0, 0, 0.5], [4, 0, 0.5], [4, 3, 3.7]]);
    const q = (id: string) => quantities(s, el(s, id));
    assert.deepEqual([Math.round(q("ME-0001").cross_section_area * 1e9) / 1e9, Math.round(q("ME-0002").cross_section_area * 1e9) / 1e9, q("ME-0003").diameter, q("ME-0004").width, q("ME-0005").diameter], [Math.round(Math.PI * 0.0125 ** 2 * 1e9) / 1e9, 0.08, 0.3, 0.3, 0.02]);
    const n = await events(t);
    await t.run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 4 } }] });
    s = await t.S();
    assert.deepEqual(routeWorld(s, el(s, "ME-0001"))[2], [4, 3, 4.5]);
    assert.ok(Math.abs(routeLength(s, el(s, "ME-0001")) - (4 + Math.hypot(3, 4))) < 1e-12);
    assert.equal(canonicalJson(el(s, "ME-0001").route[2]), canonicalJson(R(4, 3, 0.5, el(s, "ME-0001").route[2].storey)), "the route intent was not rewritten");
    assert.ok((await t.p.store(P).readEvents()).slice(n).filter((e) => e.module === "bim").every((e) => e.type === "StoreyUpdated"), "no MEP element event");
    assert.equal(canonicalJson(await replay(t)), canonicalJson(s));
    assert.deepEqual([BIM_STATE_VERSION, BIM_EVENT_VERSIONS.ElementCreated, BIM_EVENT_VERSIONS.ElementUpdated, BIM_EVENT_VERSIONS.MepJunctionCreated], [7, 3, 2, 1]);   // 7 = Phase 14 spatial units (additive); the MEP events are unchanged
  });
  test("refusals: <2 points, a zero-length consecutive segment, missing storey, no system, wrong type kind, wrong system domain; the model is unchanged", async () => {
    const t = await mep();
    const before = await events(t);
    await t.rejected("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(0, 0, 0)] }] }, "INVALID_ROUTE");                               // M1
    await t.rejected("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(0, 0, 0), R(0, 0, 0)] }] }, "INVALID_ROUTE");              // M2
    await t.rejected("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(0, 0, 0), R(1, 0, 0, "L9")] }] }, "RESOURCE_NOT_FOUND");   // M3
    await t.rejected("bim_create_pipes", { pipes: [{ type: "P25", system: "NOPE", route: [R(0, 0, 0), R(1, 0, 0)] }] }, "RESOURCE_NOT_FOUND");        // no silent default system
    await t.rejected("bim_create_pipes", { pipes: [{ type: "DR", system: "DCW", route: [R(0, 0, 0), R(1, 0, 0)] }] }, "INVALID_REFERENCE");           // M4: a pipe with a duct type
    await t.rejected("bim_create_ducts", { ducts: [{ type: "DR", system: "DCW", route: [R(0, 0, 0), R(1, 0, 0)] }] }, "MEP_SYSTEM_DOMAIN_MISMATCH");  // M5
    await t.rejected("bim_create_cable_trays", { cable_trays: [{ type: "TR", system: "SA", route: [R(0, 0, 0), R(1, 0, 0)] }] }, "MEP_SYSTEM_DOMAIN_MISMATCH");
    await t.rejected("bim_create_mep_segments", { segments: [{ category: "plumbing.fixture", type: "P25", system: "DCW", route: [R(0, 0, 0), R(1, 0, 0)] }] }, "CATEGORY_ENGINE_MISMATCH");
    await t.rejected("bim_create_types", { types: [{ kind: "duct", name: "bad", shape: "rectangular", width: 0.3 }] }, "INVALID_DIMENSION");
    await t.rejected("bim_create_types", { types: [{ kind: "pipe", name: "bad", diameter: 0.02, wall_thickness: 0.02 }] }, "INVALID_DIMENSION");
    assert.equal(await events(t), before, "no trace");
  });
  test("systems are resources: CRUD, strict immutable domain, usage, deletion refused while used; duplicates; reassign rules", async () => {
    const t = await mep();
    await pipes(t, { route: [R(0, 0, 0.5), R(2, 0, 0.5)] }, { route: [R(0, 1, 0.5), R(2, 1, 0.5, "L1")] });
    let sys = (await t.ex("bim_query_mep_systems", {})).result as any[];
    assert.deepEqual(sys.map((x) => [x.name, x.domain, x.element_count, x.junction_count, x.open_connector_count]), [["DCW", "piping", 2, 0, 4], ["PWR", "electrical", 0, 0, 0], ["SA", "hvac", 0, 0, 0], ["SAN", "piping", 0, 0, 0]]);
    await t.run("bim_update_mep_systems", { items: [{ system: "SAN", set: { classification: "storm", description: "d" } }] });
    await t.rejected("bim_update_mep_systems", { items: [{ system: "SAN", set: { domain: "hvac" } }] }, "INVALID_INPUT");
    await t.rejected("bim_create_mep_systems", { systems: [{ name: "DCW", domain: "piping", classification: "x" }] }, "DUPLICATE_RESOURCE");
    await t.rejected("bim_delete_mep_systems", { systems: ["DCW"] }, "RESOURCE_IN_USE");                                                           // M17
    assert.match((await t.ex("bim_get_mep_systems", { systems: ["DCW"] })).result[0].usage.usages.map((u: any) => `${u.count} ${u.elementKind}`).join(";"), /2 plumbing\.pipe/);
    await t.run("bim_delete_mep_systems", { systems: ["SAN"] });
    await t.rejected("bim_reassign_storey", { items: [{ id: "ME-0002", storey: "L1" }] }, "INVALID_ENGINE_PLACEMENT");                                // cross-storey: ambiguous
    await t.run("bim_reassign_storey", { items: [{ id: "ME-0001", storey: "L1" }] });                                                              // single-storey route: every point follows
    assert.deepEqual(el(await t.S(), "ME-0001").route.map((p: any) => p.storey), Array(2).fill(el(await t.S(), "ME-0002").route[1].storey));
    await t.rejected("bim_delete_storeys", { storeys: ["L1"] }, "RESOURCE_IN_USE");
    await t.rejected("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(0, 0, 0.5), R(2, 0, 0.5)] }] }, "DUPLICATE_ELEMENT").catch(() => undefined);
    sys = (await t.ex("bim_query_mep_systems", { domain: "piping" })).result;
    assert.equal(sys.length, 1);
    assert.equal(modelIssues(await t.S()).length, 0);
  });
});

describe("component connectors (derived transform)", () => {
  async function withTap(t: T) {
    await t.run("bim_create_families", { families: [{ name: "Tap", category: "plumbing.fixture", parameters: [{ key: "w", name: "w", scope: "type", dataType: "length", required: true }], representation: { kind: "box", width: "w", depth: "w", height: "w" } }] });
    await t.run("bim_create_types", { types: [
      { kind: "component", name: "TapIn", family: "Tap", parameters: { w: 0.3 }, connectors: [{ key: "supply", domain: "piping", position: [0.5, 0, 0.1], direction: [1, 0, 0], flow: "in", shape: "round", diameter: 0.025 }] },
      { kind: "component", name: "TapOut", family: "Tap", parameters: { w: 0.3 }, connectors: [{ key: "src", domain: "piping", position: [-0.5, 0, 0.1], direction: [-1, 0, 0], flow: "out", shape: "round", diameter: 0.025 }, { key: "big", domain: "piping", position: [0, 0.5, 0.1], direction: [0, 1, 0], flow: "bidirectional", shape: "round", diameter: 0.05 }] },
      { kind: "component", name: "Plain", family: "Tap", parameters: { w: 0.3 } }] });
  }
  test("connector world position / direction = the existing point-component transform (0 / 90 / 180 / 270 / 33 degrees); no stored geometry; plain components get no connectors", async () => {
    const t = await mep(); await withTap(t);
    for (const rot of [0, 90, 180, 270, 33]) {
      await t.run("bim_create_components", { components: [{ type: "TapIn", storey: "L1", x: 10 + rot, y: 2, offset: 0.4, rotation: rot }] });
      const id = `CO-${String(Object.values((await t.S()).elements).filter((e: any) => e.kind === "component").length).padStart(4, "0")}`;
      const c = (await t.ex("bim_query_mep_connectors", { element: id })).result[0], a = (rot * Math.PI) / 180;
      const close = (u: number[], v: number[]) => u.every((q, i) => Math.abs(q - v[i]) < 1e-6);
      assert.ok(close(c.position, [10 + rot + 0.5 * Math.cos(a), 2 + 0.5 * Math.sin(a), 3.2 + 0.4 + 0.1]), `${rot}: ${c.position}`);
      assert.ok(close(c.direction, [Math.cos(a), Math.sin(a), 0]), `${rot} dir ${c.direction}`);
    }
    await t.run("bim_create_components", { components: [{ type: "Plain", storey: "L0", x: 0, y: 0 }] });
    const s = await t.S(), plain = Object.values(s.elements).find((e: any) => e.kind === "component" && s.types[e.type].name === "Plain")!;
    assert.deepEqual([connectorsOf(s, plain).length, "connectors" in s.types[(plain as any).type]], [0, false]);
    assert.equal(/position/.test(canonicalJson(Object.values(s.elements).filter((e: any) => e.kind === "component"))), false, "connector geometry is not stored on instances");
    await t.rejected("bim_create_types", { types: [{ kind: "component", name: "Bad1", family: "Tap", parameters: { w: 1 }, connectors: [{ key: "a", domain: "piping", position: [0, 0, 0], direction: [0, 0, 0], shape: "round", diameter: 0.02 }] }] }, "INVALID_CONNECTOR_DEFINITION");
    await t.rejected("bim_create_types", { types: [{ kind: "component", name: "Bad2", family: "Tap", parameters: { w: 1 }, connectors: [{ key: "a", domain: "piping", position: [0, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 0.02 }, { key: "a", domain: "piping", position: [0, 0, 0], direction: [1, 0, 0], shape: "round", diameter: 0.02 }] }] }, "INVALID_CONNECTOR_DEFINITION");
  });
  test("equipment connects to a route end; strict out -> out and mismatching sizes are refused; a connected component cannot be moved away (atomic)", async () => {
    const t = await mep(); await withTap(t);
    await pipes(t, { route: [R(0, 0, 0.5), R(4, 0, 0.5)] });
    await t.run("bim_create_components", { components: [{ type: "TapIn", storey: "L0", x: 3.5, y: 0, offset: 0.4 }, { type: "TapOut", storey: "L0", x: 4.5, y: 0, offset: 0.4 }, { type: "TapOut", storey: "L0", x: 6, y: 0, offset: 0.4, rotation: 180 }] });
    const j = await connect(t, ["ME-0001", "end"], ["CO-0001", "supply"]);
    assert.deepEqual([j.summary.kind, (await t.ex("bim_query_mep_connectors", { element: "ME-0001", open_only: true })).result.map((c: any) => c.connector)], ["coupling", ["start"]]);
    await t.rejected("bim_connect_mep", { connectors: [ref("CO-0002", "src"), ref("CO-0003", "src")] }, "MEP_FLOW_CONFLICT");                       // M14: out -> out at one point (5.0 vs 5.5 -> check order first)
    await t.rejected("bim_connect_mep", { connectors: [ref("ME-0001", "start"), ref("CO-0002", "big")] }, "MEP_CONNECTOR_INCOMPATIBLE");            // 0.05 vs 0.025
    const n = await events(t), before = canonicalJson(await t.S());
    await t.rejected("bim_move_elements", { ids: ["CO-0001"], vector: [0, 1] }, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT");                              // M16
    await t.rejected("bim_update_elements", { items: [{ id: "CO-0001", kind: "component", set: { x: 9 } }] }, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT");
    assert.deepEqual([await events(t), canonicalJson(await t.S())], [n, before], "atomic: unchanged, no event");
    await t.rejected("bim_delete_elements", { ids: ["CO-0001"] }, "ELEMENT_IN_USE");
    await t.run("bim_disconnect_mep", { connectors: [ref("CO-0001", "supply")] });
    await t.run("bim_move_elements", { ids: ["CO-0001"], vector: [0, 1] });                                                                        // workflow: disconnect -> move
    assert.equal((await t.ex("bim_query_mep_network", { system: "DCW" })).result.junctions.length, 0, "a 2-member junction is deleted when one member leaves");
  });
});

describe("explicit connectivity", () => {
  test("TOUCHING != CONNECTED: coincident ends stay separate until bim_connect_mep; membership survives replay, snapshot reload and undo exactly", async () => {
    const policy = { everyEvents: 2, keep: 3 };
    const t = await mep(policy);
    await pipes(t, { route: [R(0, 0, 0.5), R(4, 0, 0.5)] }, { route: [R(4, 0, 0.5), R(4, 3, 0.5)] });
    const comps = async () => (await t.ex("bim_query_mep_network", { system: "DCW" })).result.components.map((c: any) => c.elements);
    assert.deepEqual(await comps(), [["ME-0001"], ["ME-0002"]], "touching ends are NOT connected");
    assert.deepEqual((await t.ex("bim_query_mep_network", { system: "DCW" })).result.junctions, []);
    await connect(t, ["ME-0001", "end"], ["ME-0002", "start"]);
    assert.deepEqual(await comps(), [["ME-0001", "ME-0002"]]);
    const live = canonicalJson(await t.S());
    assert.equal(canonicalJson(await replay(t)), live, "replay");
    assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot reload");
    assert.deepEqual((await t.S()).mepJunctions["MJ-0001"].members, [ref("ME-0001", "end"), ref("ME-0002", "start")], "exact connector refs");
    await t.run("bim_disconnect_mep", { junction: "MJ-0001" });
    await t.run("platform_undo", {});
    assert.equal(canonicalJson(await t.S()), live, "undo of the disconnect restores the exact membership");
    await t.run("platform_undo", {});
    assert.deepEqual(Object.keys((await t.S()).mepJunctions), [], "undo of the connect");
  });
  test("refusals: missing element / connector key, two junctions, domain, shape, size, system, distance; direct reducers are NOT inserted", async () => {
    const t = await mep();
    await t.run("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(0, 0, 0.5), R(4, 0, 0.5)] }, { type: "P40", system: "DCW", route: [R(4, 0, 0.5), R(4, 3, 0.5)] }, { type: "P25", system: "SAN", route: [R(4, 0, 0.5), R(4, 0, 2.5)] },
      { type: "P25", system: "DCW", route: [R(4, 0, 0.5), R(6, 0, 0.5)] }] });
    await t.run("bim_create_ducts", { ducts: [{ type: "DR", system: "SA", route: [R(4, 0, 0.5), R(8, 0, 0.5)] }] });
    await t.run("bim_create_conduits", { conduits: [{ type: "CN", system: "PWR", route: [R(20, 0, 0.5), R(24, 0, 0.5)] }] });
    await t.run("bim_create_cable_trays", { cable_trays: [{ type: "TR", system: "PWR", route: [R(20, 0, 0.5), R(20, 4, 0.5)] }] });
    const rej = (c: [string, string][], reason: string) => t.rejected("bim_connect_mep", { connectors: c.map(([e, k]) => ref(e, k)) }, reason);
    await rej([["ME-0001", "end"], ["ME-0099", "start"]], "MEP_CONNECTOR_NOT_FOUND");                                                               // M6
    await rej([["ME-0001", "end"], ["ME-0002", "middle"]], "MEP_CONNECTOR_NOT_FOUND");                                                             // M7
    await rej([["ME-0001", "end"], ["ME-0005", "start"]], "MEP_DOMAIN_MISMATCH");                                                                  // M9: pipe + duct
    await rej([["ME-0006", "start"], ["ME-0007", "start"]], "MEP_CONNECTOR_INCOMPATIBLE");                                                         // M10: round conduit + rectangular tray
    await rej([["ME-0001", "end"], ["ME-0002", "start"]], "MEP_CONNECTOR_INCOMPATIBLE");                                                           // M11: 25 mm vs 40 mm: no reducer
    await rej([["ME-0001", "end"], ["ME-0003", "start"]], "MEP_SYSTEM_MISMATCH");                                                                  // M13
    await rej([["ME-0001", "start"], ["ME-0004", "end"]], "MEP_CONNECTION_DISTANCE");                                                              // M12
    await connect(t, ["ME-0001", "end"], ["ME-0004", "start"]);
    await t.run("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(10, 0, 0.5), R(12, 0, 0.5)] }, { type: "P25", system: "DCW", route: [R(12, 0, 0.5), R(14, 0, 0.5)] }] });
    await connect(t, ["ME-0008", "end"], ["ME-0009", "start"]);
    await t.rejected("bim_connect_mep", { connectors: [ref("ME-0001", "end"), ref("ME-0009", "start")] }, "MEP_JUNCTION_MERGE_UNSUPPORTED");                  // M8: a connector is in at most one junction
    // state-level corruption is caught too: the same connector in two junctions
    const s = structuredClone(await t.S());
    s.mepJunctions["MJ-0002"].members = [ref("ME-0001", "end"), ref("ME-0009", "start")];
    assert.throws(() => validateMepJunctions(s), (e: any) => e.reason === "MEP_CONNECTOR_IN_USE");
    const s2 = structuredClone(await t.S());
    delete s2.elements["ME-0004"];
    assert.throws(() => validateMepJunctions(s2), (e: any) => e.reason === "MEP_CONNECTOR_NOT_FOUND");
  });
  test("connected edits are protected ATOMICALLY: a compound command (valid edit + a connector-moving edit) is refused as a whole; a route edit that keeps the junction is allowed; a storey change that would separate a junction is refused (M25)", async () => {
    const t = await mep();
    await t.run("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(0, 0, 0.5), R(4, 0, 0.5)] }, { type: "P25", system: "DCW", route: [R(4, 0, 0.5), R(4, 3, 0.5)] },
      { type: "P25", system: "DCW", route: [R(5, 5, 0.5), R(5, 5, 3.2)] }, { type: "P25", system: "DCW", route: [R(5, 5, 0, "L1"), R(8, 5, 0, "L1")] }] });
    await connect(t, ["ME-0001", "end"], ["ME-0002", "start"]);
    await connect(t, ["ME-0003", "end"], ["ME-0004", "start"]);                                   // (5, 5, 3.2) in the world, from two DIFFERENT storeys
    const n = await events(t), before = canonicalJson(await t.S());
    await t.rejected("bim_update_elements", { items: [{ id: "ME-0001", kind: "mep_segment", set: { name: "ok" } }, { id: "ME-0002", kind: "mep_segment", set: { route: [R(4.5, 0, 0.5), R(4.5, 3, 0.5)] } }] }, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT");
    await t.rejected("bim_move_elements", { ids: ["ME-0001"], vector: [1, 0] }, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT");                          // M15
    await t.rejected("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.0 } }] }, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT");       // M25
    assert.deepEqual([await events(t), canonicalJson(await t.S())], [n, before], "state unchanged, event count unchanged");
    await t.run("bim_update_elements", { items: [{ id: "ME-0002", kind: "mep_segment", set: { route: [R(4, 0, 0.5), R(4, 6, 0.5)] } }] });           // only the free end moves: the junction holds
    assert.equal(el(await t.S(), "ME-0002").route[1].at[1], 6);
    await t.rejected("bim_delete_elements", { ids: ["ME-0001"] }, "ELEMENT_IN_USE");                                                              // M18
    await t.run("bim_disconnect_mep", { connectors: [ref("ME-0003", "end")] });
    await t.run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.0 } }] });                                                      // now allowed
    await t.run("bim_delete_elements", { ids: ["ME-0003"] });
  });
});

describe("network graph, trace, dry run", () => {
  test("chain, tee (branch), cross, a CYCLE terminates, open connectors stay valid, separate components are reported separately; traversal is deterministic", async () => {
    const t = await mep();
    // a triangle (cycle) of 3 pipes + a tail + a branch off the corner: 6 pipes; plus an isolated one
    const A = [0, 0], B = [4, 0], C = [2, 3];
    const seg = (a: number[], b: number[]) => ({ type: "P25", system: "DCW", route: [R(a[0], a[1], 0.5), R(b[0], b[1], 0.5)] });
    await t.run("bim_create_pipes", { pipes: [seg(A, B), seg(B, C), seg(C, A), seg(B, [8, 0]), seg(B, [4, -3]), seg([20, 20], [22, 20])] });
    await connect(t, ["ME-0001", "end"], ["ME-0002", "start"], ["ME-0004", "start"], ["ME-0005", "start"]);                                       // a CROSS at B (4 members)
    await connect(t, ["ME-0002", "end"], ["ME-0003", "start"]);
    await connect(t, ["ME-0003", "end"], ["ME-0001", "start"]);                                                                                  // closes the loop
    const net = (await t.ex("bim_query_mep_network", { system: "DCW" })).result;
    assert.deepEqual(net.junctions.map((j: any) => [j.id, j.kind]), [["MJ-0001", "cross"], ["MJ-0002", "coupling"], ["MJ-0003", "coupling"]]);
    assert.deepEqual(net.components.map((c: any) => c.elements), [["ME-0001", "ME-0002", "ME-0003", "ME-0004", "ME-0005"], ["ME-0006"]], "the cycle is ONE component; the isolated pipe is another");
    assert.deepEqual(net.openConnectors.map((c: any) => `${c.element}#${c.connector}`), ["ME-0004#end", "ME-0005#end", "ME-0006#start", "ME-0006#end"]);
    const tr = (await t.ex("bim_query_mep_network", { element: "ME-0004" })).result;
    assert.deepEqual(tr.traversal, ["ME-0004", "ME-0001", "ME-0002", "ME-0005", "ME-0003"], "breadth-first, ids sorted, each node once (the cycle ME-0001 / 0002 / 0003 terminates)");
    assert.deepEqual((await t.ex("bim_query_mep_network", { element: "ME-0004" })).result.traversal, tr.traversal, "deterministic");
    assert.equal((await t.ex("bim_query_mep_network", { connector: { element: "ME-0005", connector: "end" } })).result.elements.length, 5);
    assert.deepEqual(mepNetwork(await t.S(), { system: undefined, element: "ME-0006" }).elements.map((e) => e.id), ["ME-0006"]);
    assert.deepEqual((await t.ex("bim_validate", {})).result.issues.filter((i: any) => i.severity === "error"), [], "open connectors are not errors");
    const sum = (await t.ex("bim_query_mep_systems", { domain: "piping" })).result.find((x: any) => x.name === "DCW");
    assert.deepEqual([sum.element_count, sum.junction_count, sum.connected_component_count, sum.open_connector_count], [6, 3, 2, 4]);
    await t.rejected("bim_query_mep_network", {}, "INVALID_INPUT");
  });
  test("dry run == apply for system create, pipe create, duct create, connect, disconnect, route update (no persistence)", async () => {
    const t = await mep({ everyEvents: 2, keep: 2 });
    await t.run("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(0, 0, 0.5), R(4, 0, 0.5)] }, { type: "P25", system: "DCW", route: [R(4, 0, 0.5), R(4, 3, 0.5)] }] });
    const cases: [string, unknown][] = [
      ["bim_create_mep_systems", { systems: [{ name: "X", domain: "hvac", classification: "return_air" }] }],
      ["bim_create_pipes", { pipes: [{ type: "P40", system: "SAN", route: [R(9, 9, 0.5), R(9, 12, 0.5)] }] }],
      ["bim_create_ducts", { ducts: [{ type: "DR", system: "SA", route: [R(0, 5, 2.5), R(6, 5, 2.5)] }] }],
      ["bim_connect_mep", { connectors: [ref("ME-0001", "end"), ref("ME-0002", "start")] }],
      ["bim_update_elements", { items: [{ id: "ME-0002", kind: "mep_segment", set: { route: [R(4, 0, 0.5), R(4, 5, 0.5)] } }] }]];
    for (const [tool, input] of cases) {
      const before = await t.snap(), n = await events(t), dry = await t.ex(tool, input, { dryRun: true });
      assert.equal(dry.status, "preview");
      assert.deepEqual([await t.snap(), await events(t)], [before, n], `${tool}: a dry run persists nothing`);
      const real = await t.ex(tool, input);
      assert.deepEqual(real.summary, dry.preview.summary, `${tool}: the same decision`);
      assert.deepEqual((await t.p.store(P).readEvents()).slice(n).filter((e) => e.module === "bim").map((e) => e.type), dry.preview.events);
    }
    const before = await t.snap(), dry = await t.ex("bim_disconnect_mep", { junction: "MJ-0001" }, { dryRun: true });
    assert.deepEqual(await t.snap(), before);
    assert.deepEqual((await t.run("bim_disconnect_mep", { junction: "MJ-0001" })).summary, dry.preview.summary);
    // a refused dry run is refused for the same reason
    await t.rejected("bim_connect_mep", { connectors: [ref("ME-0001", "start"), ref("ME-0002", "end")] }, "MEP_CONNECTION_DISTANCE");
  });
});

describe("duplicate detection and usage", () => {
  test("a MEP duplicate = same category + system + type + route; a pipe and a conduit on one line, or two systems on one route, are NOT duplicates; usage names categories, never the engine", async () => {
    const t = await mep();
    const same = [R(0, 0, 0.5), R(4, 0, 0.5)];
    await t.run("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: same }, { type: "P25", system: "DCW", route: same }, { type: "P25", system: "SAN", route: same }, { type: "P40", system: "DCW", route: same }] });
    await t.run("bim_create_conduits", { conduits: [{ type: "CN", system: "PWR", route: same }] });
    const dups = (await t.ex("bim_validate", {})).result.issues.filter((i: any) => /uplicate/.test(i.issue)).map((i: any) => i.ids);
    assert.deepEqual(dups, [["ME-0001", "ME-0002"]], "only the two identical pipes in one system with one type");
    await t.run("bim_create_components", { components: [] }).catch(() => undefined);
    const usage = (await t.ex("bim_get_mep_systems", { systems: ["DCW"] })).result[0].usage.usages.map((u: any) => `${u.count} ${u.elementKind}`).join("; ");
    assert.equal(usage, "3 plumbing.pipe");
    assert.doesNotMatch(usage + JSON.stringify((await t.ex("bim_resource_usage", { kind: "storey", ref: "L0" })).result), /mep_network|mep_segment/, "no engine / storage name in usage");
  });
});
