/** Phase 14 · A1-A3: connector-scoped and system-isolated MEP network queries (the two Phase 13 closure defects). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform } from "@insa/core";
import { bimModule, BimState } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

type T = Awaited<ReturnType<typeof setup>>;
const R = (x: number, y: number, offset = 0.5, storey = "L0") => ({ storey, at: [x, y], offset });
const ref = (element: string, connector: string) => ({ element, connector });
const connect = (t: T, ...c: [string, string][]) => t.run("bim_connect_mep", { connectors: c.map(([e, k]) => ref(e, k)) });

/** Equipment E (CO-0001) at (10, 0): water_in (piping, 10.5, 0), power_in (electrical, 9.5, 0), drain (piping, 10, 0.5), spare (piping, unconnected). */
async function build(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [{ kind: "pipe", name: "P25", diameter: 0.025 }, { kind: "conduit", name: "CN", diameter: 0.02 }] });
  await t.run("bim_create_mep_systems", { systems: [{ name: "WATER", domain: "piping", classification: "domestic_cold_water" }, { name: "SAN", domain: "piping", classification: "sanitary" }, { name: "POWER", domain: "electrical", classification: "power" }] });
  await t.run("bim_create_families", { families: [{ name: "Unit", category: "plumbing.fixture", parameters: [{ key: "w", name: "w", scope: "type", dataType: "length", required: true }], representation: { kind: "box", width: "w", depth: "w", height: "w" } }] });
  const pipe = (k: string, x: number, y: number, d: "in" | "out" | "bidirectional", dom = "piping", shape = "round", size = 0.025) =>
    ({ key: k, domain: dom, position: [x, y, 0.1], direction: [x || 0.001, y || 0.001, 0], flow: d, shape, diameter: size });
  await t.run("bim_create_types", { types: [{ kind: "component", name: "UnitT", family: "Unit", parameters: { w: 0.3 }, connectors: [pipe("water_in", 0.5, 0, "in"), pipe("power_in", -0.5, 0, "in", "electrical", "round", 0.02), pipe("drain", 0, 0.5, "out"), pipe("spare", 0, -0.5, "bidirectional")] }] });
  await t.run("bim_create_components", { components: [{ type: "UnitT", storey: "L0", x: 10, y: 0, offset: 0.4 }] });
  // WATER: a tee (ME-0001/2/3) feeding E.water_in with ME-0001; a separate TRIANGLE cycle (ME-0004/5/6)
  await t.run("bim_create_pipes", { pipes: [{ type: "P25", system: "WATER", route: [R(6.5, 0), R(10.5, 0)] }, { type: "P25", system: "WATER", route: [R(6.5, 0), R(6.5, -3)] }, { type: "P25", system: "WATER", route: [R(6.5, 0), R(2, 0)] },
    { type: "P25", system: "WATER", route: [R(20, 0), R(24, 0)] }, { type: "P25", system: "WATER", route: [R(24, 0), R(22, 3)] }, { type: "P25", system: "WATER", route: [R(22, 3), R(20, 0)] },
    { type: "P25", system: "SAN", route: [R(10, 0.5), R(10, 5)] }] });
  await t.run("bim_create_conduits", { conduits: [{ type: "CN", system: "POWER", route: [R(3, 0), R(9.5, 0)] }, { type: "CN", system: "POWER", route: [R(3, 0), R(3, -4)] }] });
  await connect(t, ["ME-0001", "start"], ["ME-0002", "start"], ["ME-0003", "start"]);
  await connect(t, ["ME-0001", "end"], ["CO-0001", "water_in"]);
  await connect(t, ["ME-0004", "end"], ["ME-0005", "start"]); await connect(t, ["ME-0005", "end"], ["ME-0006", "start"]); await connect(t, ["ME-0006", "end"], ["ME-0004", "start"]);
  await connect(t, ["ME-0007", "start"], ["CO-0001", "drain"]);
  await connect(t, ["ME-0008", "end"], ["CO-0001", "power_in"]);
  await connect(t, ["ME-0008", "start"], ["ME-0009", "start"]);
  return t;
}

/** INDEPENDENT oracle: a connector graph rebuilt from the raw state (junction member lists + the known connector keys), no use of mepNetwork. */
function oracle(s: BimState, scope: { system?: string; element?: string; connector?: [string, string] }) {
  const keys = (id: string) => { const e: any = s.elements[id]; return e.kind === "mep_segment" ? ["start", "end"] : (s.types[e.type] as any).connectors.map((c: any) => c.key); };
  const isRoute = (id: string) => (s.elements[id] as any).kind === "mep_segment";
  const jOf = new Map<string, any>();
  for (const j of Object.values(s.mepJunctions)) for (const m of j.members) jOf.set(`${m.element}#${m.connector}`, j);
  const sysId = scope.system ? Object.values(s.mepSystems).find((x) => x.name === scope.system)?.id : undefined;
  const jsys = (j: any) => j.members.map((m: any) => s.elements[m.element] as any).find((e: any) => e.kind === "mep_segment")?.system;
  const ok = (j: any) => !sysId || jsys(j) === sysId;
  let start: string[];
  if (scope.connector) start = [scope.connector.join("#")];
  else if (scope.element) start = keys(scope.element).map((k: string) => `${scope.element}#${k}`);
  else start = Object.values(s.elements).filter((e: any) => e.kind === "mep_segment" && e.system === sysId).flatMap((e: any) => ["start", "end"].map((k) => `${e.id}#${k}`));
  const seen = new Set(start), q = [...start], junctions = new Set<string>();
  while (q.length) {
    const k = q.shift()!, [id, key] = k.split("#"), nb: string[] = [];
    if (isRoute(id)) nb.push(`${id}#${key === "start" ? "end" : "start"}`);
    const j = jOf.get(k);
    if (j && ok(j)) { junctions.add(j.id); for (const m of j.members) nb.push(`${m.element}#${m.connector}`); }
    for (const n of nb) if (!seen.has(n)) { seen.add(n); q.push(n); }
  }
  const elements = [...new Set([...seen].map((k) => k.split("#")[0]))].sort();
  const open = [...seen].filter((k) => !jOf.get(k) && (scope.system ? isRoute(k.split("#")[0]) : true)).sort();
  return { elements, junctions: [...junctions].sort(), open };
}
const view = async (t: T, input: Record<string, unknown>) => { const r = (await t.ex("bim_query_mep_network", input)).result; return { elements: r.elements.map((e: any) => e.id).sort(), junctions: r.junctions.map((j: any) => j.id).sort(), open: r.openConnectors.map((c: any) => `${c.element}#${c.connector}`).sort(), raw: r }; };

test("A2: one equipment, two domains, three systems: a system query never leaks into another system through the shared equipment; the oracle agrees in every mode", async () => {
  const t = await build();
  const s = await t.S();
  const water = await view(t, { system: "WATER" }), power = await view(t, { system: "POWER" }), san = await view(t, { system: "SAN" });
  // WATER: its routes + the shared device; ONLY its junctions; the cycle is a separate component; the power / sanitary networks are absent
  assert.deepEqual(water.elements, ["CO-0001", "ME-0001", "ME-0002", "ME-0003", "ME-0004", "ME-0005", "ME-0006"]);
  assert.deepEqual(water.junctions, ["MJ-0001", "MJ-0002", "MJ-0003", "MJ-0004", "MJ-0005"]);
  assert.ok(!water.junctions.includes("MJ-0006") && !water.junctions.includes("MJ-0007"), "the SAN and POWER junctions are not WATER's");
  assert.deepEqual(water.raw.components.map((c: any) => c.elements), [["CO-0001", "ME-0001", "ME-0002", "ME-0003"], ["ME-0004", "ME-0005", "ME-0006"]]);
  assert.deepEqual(water.open, ["ME-0002#end", "ME-0003#end"], "no equipment connector is listed as an open WATER connector");
  assert.deepEqual(power.elements, ["CO-0001", "ME-0008", "ME-0009"]);
  assert.deepEqual(power.open, ["ME-0009#end"]);
  assert.deepEqual(san.elements, ["CO-0001", "ME-0007"]);
  assert.deepEqual(san.open, ["ME-0007#end"]);
  for (const [name, v] of [["WATER", water], ["POWER", power], ["SAN", san]] as const) {
    const o = oracle(s, { system: name });
    assert.deepEqual([v.elements, v.junctions, v.open], [o.elements, o.junctions, o.open], `${name}: independent connector-graph oracle`);
  }
  // system summaries follow the same isolation
  const sums = Object.fromEntries(((await t.ex("bim_query_mep_systems", {})).result as any[]).map((x) => [x.name, [x.element_count, x.junction_count, x.connected_component_count, x.open_connector_count]]));
  assert.deepEqual(sums, { POWER: [2, 2, 1, 1], SAN: [1, 1, 1, 1], WATER: [6, 5, 2, 2] });
});

test("A1: connector-scoped and element-scoped queries are distinct modes; equipment ports of other domains / systems are NOT followed", async () => {
  const t = await build();
  const s = await t.S();
  const fromWater = await view(t, { connector: ref("CO-0001", "water_in") });
  assert.equal(fromWater.raw.mode, "connector");
  assert.deepEqual(fromWater.elements, ["CO-0001", "ME-0001", "ME-0002", "ME-0003"], "only the WATER tee network: not the power conduits, not the sanitary pipe");
  assert.deepEqual(fromWater.raw.connectorTraversal[0], "CO-0001#water_in");
  assert.ok(!fromWater.raw.connectorTraversal.some((k: string) => ["CO-0001#power_in", "CO-0001#drain", "CO-0001#spare"].includes(k)), "the equipment's other connectors are not traversed");
  const fromPower = await view(t, { connector: ref("CO-0001", "power_in") });
  assert.deepEqual(fromPower.elements, ["CO-0001", "ME-0008", "ME-0009"]);
  const spare = await view(t, { connector: ref("CO-0001", "spare") });
  assert.deepEqual([spare.elements, spare.open, spare.junctions], [["CO-0001"], ["CO-0001#spare"], []], "an unconnected port reaches nothing");
  // element scope from a route: its own system's network; from the equipment: ALL its networks
  const fromPipe = await view(t, { element: "ME-0002" });
  assert.equal(fromPipe.raw.mode, "element");
  assert.deepEqual(fromPipe.elements, ["CO-0001", "ME-0001", "ME-0002", "ME-0003"]);
  const fromE = await view(t, { element: "CO-0001" });
  assert.deepEqual(fromE.elements, ["CO-0001", "ME-0001", "ME-0002", "ME-0003", "ME-0007", "ME-0008", "ME-0009"], "whole equipment: every network it participates in, but not unrelated networks (the WATER cycle)");
  for (const [scope, v] of [[{ connector: ["CO-0001", "water_in"] }, fromWater], [{ connector: ["CO-0001", "power_in"] }, fromPower], [{ element: "ME-0002" }, fromPipe], [{ element: "CO-0001" }, fromE], [{ connector: ["CO-0001", "spare"] }, spare]] as const) {
    const o = oracle(s, scope as any);
    assert.deepEqual([v.elements, v.junctions, v.open], [o.elements, o.junctions, o.open], JSON.stringify(scope));
  }
  // system + start: restricts the walk to that system's junctions; equipment start with a system = that system's part only
  const eWater = await view(t, { system: "WATER", element: "CO-0001" });
  assert.deepEqual(eWater.elements, ["CO-0001", "ME-0001", "ME-0002", "ME-0003"]);
  assert.deepEqual(eWater.open, ["CO-0001#drain", "CO-0001#power_in", "CO-0001#spare", "ME-0002#end", "ME-0003#end"].filter((k) => eWater.open.includes(k)), "the device's own ports are open from its side; but nothing of POWER / SAN is traversed");
  assert.ok(!eWater.elements.some((e: string) => ["ME-0007", "ME-0008", "ME-0009"].includes(e)));
  // selector validation: combined semantics are explicit, nothing is silently ignored
  await t.rejected("bim_query_mep_network", { element: "ME-0001", connector: ref("ME-0002", "start") }, "INVALID_INPUT");
  await t.rejected("bim_query_mep_network", { connector: ref("CO-0001", "nope") }, "MEP_CONNECTOR_NOT_FOUND");
  await t.rejected("bim_query_mep_network", { connector: ref("ME-9999", "start") }, "ELEMENT_NOT_FOUND");
  await t.rejected("bim_query_mep_network", { system: "POWER", element: "ME-0001" }, "INVALID_INPUT");
  await t.rejected("bim_query_mep_network", { system: "NOPE" }, "RESOURCE_NOT_FOUND");
  await t.rejected("bim_query_mep_network", {}, "INVALID_INPUT");
  const both = await view(t, { element: "ME-0001", connector: ref("ME-0001", "end") });
  assert.equal(both.raw.mode, "connector", "element + connector naming the same element: the connector is the start");
});

test("A3: two ports of one domain on different systems, branches and cycles; query results survive replay and snapshot reload", async () => {
  const policy = { everyEvents: 3, keep: 2 };
  const t = await build(policy);
  const scopes: Record<string, unknown>[] = [{ system: "WATER" }, { system: "SAN" }, { system: "POWER" }, { element: "CO-0001" }, { element: "ME-0004" }, { connector: ref("CO-0001", "drain") }, { connector: ref("ME-0005", "end") }];
  const run = async (tt: T) => Promise.all(scopes.map(async (sc) => { const r = (await tt.ex("bim_query_mep_network", sc)).result; delete r.raw; return r; }));
  const live = await run(t);
  assert.deepEqual((await view(t, { system: "SAN" })).junctions.length, 1);
  assert.ok(live[0].components.some((c: any) => c.elements.length === 3 && c.junctions.length === 3), "the cycle component has 3 elements and 3 junctions");
  const replay = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false });
  const snap = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
  for (const pl of [replay, snap]) {
    const tt = { ...t, ex: async (tool: string, input: unknown) => pl.execute({ id: "t", name: "t", kind: "human", roles: ["admin"] }, P, tool, input) } as unknown as T;
    assert.deepEqual(await run(tt), live, "the same answers after replay / snapshot reload");
  }
  // an independent oracle also holds after a disconnect (state changes -> answers change)
  await t.run("bim_disconnect_mep", { connectors: [ref("CO-0001", "power_in")] });
  const s = await t.S();
  const power = await view(t, { system: "POWER" });
  assert.deepEqual([power.elements, power.open], [["ME-0008", "ME-0009"], ["ME-0008#end", "ME-0009#end"]]);
  const o = oracle(s, { system: "POWER" });
  assert.deepEqual([power.elements, power.junctions, power.open], [o.elements, o.junctions, o.open]);
});
