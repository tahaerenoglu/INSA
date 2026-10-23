/** Phase 13 · property-based tests (fast-check). Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, routeWorld, routeLength, registerCategory, listEngines, modelIssues } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
registerCategory({ id: "plumbing.test_gutter", name: "Test Gutters", discipline: "plumbing", engine: "mep_network", placements: ["mep_route"], typeKinds: ["pipe"], idKey: "mep_segment", mepDomain: "piping",
  capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "systemConnectable"] });
type T = Awaited<ReturnType<typeof setup>>;
const el = (s: BimState, id: string) => s.elements[id] as any;
const R = (x: number, y: number, offset: number, storey = "L0") => ({ storey, at: [x, y], offset });
const ref = (element: string, connector: string) => ({ element, connector });
const replayState = async (t: T, policy: any = false) => new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state<BimState>(P, "bim");
async function mep(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [{ kind: "pipe", name: "P25", diameter: 0.025 }, { kind: "duct", name: "DR", shape: "rectangular", width: 0.4, height: 0.2 }, { kind: "cable_tray", name: "TR", width: 0.3, height: 0.1 }, { kind: "conduit", name: "CN", diameter: 0.02 }] });
  await t.run("bim_create_mep_systems", { systems: [{ name: "DCW", domain: "piping", classification: "domestic_cold_water" }, { name: "SA", domain: "hvac", classification: "supply_air" }, { name: "PWR", domain: "electrical", classification: "power" }] });
  return t;
}
const coord = fc.integer({ min: -20, max: 20 }).map((v) => v / 2);
const off = fc.integer({ min: -2, max: 8 }).map((v) => v / 2);
const pointArb = fc.record({ x: coord, y: coord, o: off, up: fc.boolean() });
const routeArb = fc.array(pointArb, { minLength: 2, maxLength: 5 }).filter((r) => r.every((p, i) => i === 0 || !(p.x === r[i - 1].x && p.y === r[i - 1].y && p.o + (p.up ? 3.2 : 0) === r[i - 1].o + (r[i - 1].up ? 3.2 : 0))));
const toRoute = (r: { x: number; y: number; o: number; up: boolean }[]) => r.map((p) => R(p.x, p.y, p.o, p.up ? "L1" : "L0"));
const CATS = { plumbing: ["bim_create_pipes", "pipes", "P25", "DCW"], duct: ["bim_create_ducts", "ducts", "DR", "SA"], tray: ["bim_create_cable_trays", "cable_trays", "TR", "PWR"], conduit: ["bim_create_conduits", "conduits", "CN", "PWR"] } as const;
const cover = { routes: 0, graphs: 0, cycles: 0, junctions: 0 };

test("P1 / P2 / P3-P5 · world route points = storey elevation + offset; length = the independent polyline oracle; live == replay (pipe, duct, cable tray, conduit)", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.constantFrom("plumbing", "duct", "tray", "conduit"), routeArb, async (cat, r) => {
    const [tool, key, type, system] = CATS[cat];
    const t = await mep({ everyEvents: 3, keep: 2 });
    await t.run(tool, { [key]: [{ type, system, route: toRoute(r) }] });
    const s = await t.S(), e = el(s, "ME-0001");
    const world = r.map((p) => [p.x, p.y, (p.up ? 3.2 : 0) + p.o]);
    assert.deepEqual(routeWorld(s, e), world);
    const oracle = world.slice(1).reduce((a, p, i) => a + Math.sqrt((p[0] - world[i][0]) ** 2 + (p[1] - world[i][1]) ** 2 + (p[2] - world[i][2]) ** 2), 0);
    assert.ok(Math.abs(routeLength(s, e) - oracle) < 1e-9);
    cover.routes++;
    assert.equal(canonicalJson(await replayState(t)), canonicalJson(s), "live == replay");
    assert.equal(canonicalJson(await replayState(t, { everyEvents: 3, keep: 2 })), canonicalJson(s), "snapshot reload");
  }), { seed: SEED, numRuns: runs(40) });
  assert.ok(cover.routes >= 10);
});

test("P6 · a storey elevation change re-derives the route and the connector positions without rewriting the route intent (no MEP event)", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(routeArb, fc.integer({ min: 28, max: 50 }).map((v) => v / 10), async (r, e1) => {
    const t = await mep();
    await t.run("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: toRoute(r) }] });
    const n = (await t.p.store(P).readEvents()).length, intent = canonicalJson(el(await t.S(), "ME-0001").route);
    const res = await t.ex("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: e1 } }] }).catch((e: any) => ({ status: "error", reason: e.reason }));
    const s = await t.S();
    if (res.status === "error") { assert.equal(res.reason, "DEPENDENT_ELEMENT_INVALID"); return; }          // a collapsed segment is refused
    assert.deepEqual(routeWorld(s, el(s, "ME-0001")), r.map((p) => [p.x, p.y, (p.up ? e1 : 0) + p.o]));
    assert.equal(canonicalJson(el(s, "ME-0001").route), intent, "the route intent is byte-identical: storey-relative, never rewritten");
    assert.ok((await t.p.store(P).readEvents()).slice(n).filter((e) => e.module === "bim").every((e) => e.type === "StoreyUpdated"));
    const c = (await t.ex("bim_query_mep_connectors", { element: "ME-0001" })).result;
    assert.deepEqual([c[0].position, c[1].position], [[r[0].x, r[0].y, (r[0].up ? e1 : 0) + r[0].o], [r[r.length - 1].x, r[r.length - 1].y, (r[r.length - 1].up ? e1 : 0) + r[r.length - 1].o]]);
  }), { seed: SEED, numRuns: runs(40) });
});

test("P7 / P13 · component connector world transform = the independent rotation oracle (deterministic)", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  const loc = fc.integer({ min: -10, max: 10 }).map((v) => v / 4);
  await fc.assert(fc.asyncProperty(coord, coord, off, fc.integer({ min: 0, max: 359 }), loc, loc, loc, fc.boolean(), async (x, y, o, rot, px, py, pz, up) => {
    fc.pre(Math.hypot(px, py) > 0 || pz !== 0);
    const t = await mep();
    await t.run("bim_create_families", { families: [{ name: "Tap", category: "plumbing.fixture", parameters: [{ key: "w", name: "w", scope: "type", dataType: "length", required: true }], representation: { kind: "box", width: "w", depth: "w", height: "w" } }] });
    await t.run("bim_create_types", { types: [{ kind: "component", name: "T1", family: "Tap", parameters: { w: 0.3 }, connectors: [{ key: "k", domain: "piping", position: [px, py, pz], direction: [py || 1, px || 0, 0.5], flow: "in", shape: "round", diameter: 0.025 }] }] });
    await t.run("bim_create_components", { components: [{ type: "T1", storey: up ? "L1" : "L0", x, y, offset: o, rotation: rot }] });
    const run = async () => (await t.ex("bim_query_mep_connectors", { element: "CO-0001" })).result[0];
    const c = await run(), a = (rot * Math.PI) / 180, z0 = up ? 3.2 : 0, d: [number, number, number] = [py || 1, px || 0, 0.5];
    const close = (u: number[], v: number[]) => u.every((q, i) => Math.abs(q - v[i]) < 1e-6);
    assert.ok(close(c.position, [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a), z0 + o + pz]), `pos ${c.position}`);
    assert.ok(close(c.direction, [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a), 0.5]));
    assert.deepEqual(await run(), c, "deterministic");
  }), { seed: SEED, numRuns: runs(40) });
});

/** random pipe graphs on a node grid; connect a random subset of nodes; compare with an independent union-find / BFS oracle */
const NODE = (i: number) => [Math.floor(i / 3) * 3, (i % 3) * 3] as const;
const graphArb = fc.record({
  edges: fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 8 })).filter(([a, b]) => a < b), { minLength: 1, maxLength: 9, selector: ([a, b]) => `${a}-${b}` }),
  connected: fc.uniqueArray(fc.integer({ min: 0, max: 8 }), { maxLength: 9 }), start: fc.nat({ max: 8 }) });
test("P8 · touching stays disconnected until connect; P9 / P10 · junctions survive replay and snapshot; P11 / P12 · network components, junction kinds, open connectors and the BFS traversal equal an independent graph oracle (cycles terminate)", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(graphArb, async (g) => {
    const t = await mep({ everyEvents: 2, keep: 2 });
    await t.run("bim_create_pipes", { pipes: g.edges.map(([a, b]) => ({ type: "P25", system: "DCW", route: [R(NODE(a)[0], NODE(a)[1], 0.5), R(NODE(b)[0], NODE(b)[1], 0.5)] })) });
    const ids = g.edges.map((_, i) => `ME-${String(i + 1).padStart(4, "0")}`), n = g.edges.length;
    const comps = async () => (await t.ex("bim_query_mep_network", { system: "DCW" })).result.components.map((c: any) => c.elements);
    assert.deepEqual(await comps(), ids.map((id) => [id]), "P8: coincident ends are NOT connected");
    const touching = (node: number) => g.edges.flatMap(([a, b], i) => [...(a === node ? [ref(ids[i], "start")] : []), ...(b === node ? [ref(ids[i], "end")] : [])]);
    const made = g.connected.filter((nd) => touching(nd).length >= 2);
    for (const nd of made) await t.run("bim_connect_mep", { connectors: touching(nd) });
    cover.graphs++; cover.junctions += made.length;
    // oracle: union-find over edges sharing a connected node
    const parent = ids.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const adj: number[][] = ids.map(() => []);
    for (const nd of made) { const es = g.edges.flatMap(([a, b], i) => (a === nd || b === nd ? [i] : [])); for (const i of es) for (const j of es) if (i !== j) { adj[i].push(j); parent[find(i)] = find(j); } }
    const groups = new Map<number, number[]>();
    ids.forEach((_, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(i));
    const want = [...groups.values()].map((v) => v.sort((a, b) => a - b).map((i) => ids[i])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    assert.deepEqual(await comps(), want, "P11: connected components");
    if (made.some((nd) => g.edges.filter(([a, b]) => a === nd || b === nd).length >= 2) && want.some((c) => c.length > 1)) { /* cycles possible */ }
    const net = (await t.ex("bim_query_mep_network", { system: "DCW" })).result;
    assert.deepEqual(net.junctions.map((j: any) => j.members.length).sort(), made.map((nd) => touching(nd).length).sort(), "junction member counts");
    const connectedRefs = new Set(made.flatMap((nd) => touching(nd).map((r) => `${r.element}#${r.connector}`)));
    assert.equal(net.openConnectors.length, 2 * n - connectedRefs.size, "open connectors");
    if (want.some((c) => c.length >= 3) && made.length >= 3) cover.cycles++;
    // P12: traversal from a random pipe = an INDEPENDENT connector-graph oracle: nodes = connectors; edges = start<->end of a route and the members of a junction
    const start = g.start % n, cadj = new Map<string, string[]>();
    const link = (x: string, y: string) => { (cadj.get(x) ?? cadj.set(x, []).get(x)!).push(y); };
    ids.forEach((id) => { link(`${id}#start`, `${id}#end`); link(`${id}#end`, `${id}#start`); });
    for (const nd of made) { const ms = touching(nd).map((r) => `${r.element}#${r.connector}`); for (const x of ms) for (const y of ms) if (x !== y) link(x, y); }
    const cseen = new Set([`${ids[start]}#end`, `${ids[start]}#start`]), corder: string[] = [];
    for (const q = [`${ids[start]}#end`, `${ids[start]}#start`]; q.length; ) { const v = q.shift()!; corder.push(v); for (const w of [...(cadj.get(v) ?? [])].sort()) if (!cseen.has(w)) { cseen.add(w); q.push(w); } }
    const eorder = [...new Set(corder.map((c) => c.split("#")[0]))];
    const res = (await t.ex("bim_query_mep_network", { element: ids[start] })).result;
    assert.deepEqual(res.connectorTraversal, corder, "P12: connector traversal");
    assert.deepEqual(res.traversal, eorder, "P12: element traversal (first visit)");
    assert.equal(new Set(res.connectorTraversal).size, res.connectorTraversal.length, "no connector twice");
    // P9 / P10: membership survives replay and snapshot reload
    const live = canonicalJson(await t.S());
    assert.equal(canonicalJson(await replayState(t)), live);
    assert.equal(canonicalJson(await replayState(t, { everyEvents: 2, keep: 2 })), live);
    assert.deepEqual(modelIssues(await t.S()), []);
  }), { seed: SEED, numRuns: runs(30) });
  assert.ok(cover.graphs >= 8 && cover.junctions >= 5, JSON.stringify(cover));
});

test("P14 · dry run == apply for random pipe routes, without persistence; P15 · a test-only MEP category on mep_network needs no new element kind or lifecycle branch", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  const kinds = new Set(listEngines().map((e) => e.elementKind));
  await fc.assert(fc.asyncProperty(routeArb, async (r) => {
    const t = await mep();
    const input = { pipes: [{ type: "P25", system: "DCW", route: toRoute(r) }] };
    const before = await t.snap(), dry = await t.ex("bim_create_pipes", input, { dryRun: true });
    assert.deepEqual(await t.snap(), before);
    assert.deepEqual((await t.run("bim_create_pipes", input)).summary, dry.preview.summary);
    // P15: the test category goes through the SAME canonical creation, query, update, move, delete
    // A different category is not permission to duplicate an existing physical pipe.
    const separateRoute=toRoute(r).map(q=>({...q,at:[q.at[0]+10,q.at[1]]}));
    await t.run("bim_create_mep_segments", { segments: [{ category: "plumbing.test_gutter", type: "P25", system: "DCW", route: separateRoute }] });
    const s = await t.S(), g = el(s, "ME-0002");
    assert.deepEqual([g.kind, g.category], ["mep_segment", "plumbing.test_gutter"]);
    assert.deepEqual((await t.ex("bim_query_elements", { category: "plumbing.test_gutter" })).result.elements.map((e: any) => [e.id, e.engine]), [["ME-0002", "mep_network"]]);
    await t.run("bim_move_elements", { ids: ["ME-0002"], vector: [1, 1] });
    await t.run("bim_update_elements", { items: [{ id: "ME-0002", kind: "mep_segment", set: { name: "x" } }] });
    await t.run("bim_delete_elements", { ids: ["ME-0002"] });
    assert.deepEqual(new Set(listEngines().map((e) => e.elementKind)), kinds);
  }), { seed: SEED, numRuns: runs(20) });
});
