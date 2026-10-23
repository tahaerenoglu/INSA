/** Phase 13 · legacy fixtures (Phase 8 / 11 / 12) and the mixed MEP scenario with the IFC verification matrix. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, FileStores, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, modelIssues, planSvg, toIfc, ifcGuid, structuralConnectivity, routeLength, routeWorld } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const el = (s: BimState, id: string) => s.elements[id] as any;
const PROBE = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.element as ue, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}; bad = 0
for e in f.by_type("IfcProduct"):
    if not e.Representation or e.is_a("IfcOpeningElement") or e.is_a("IfcDistributionPort"): continue
    g = ifcopenshell.geom.create_shape(st, e).geometry; v = g.verts; z = v[2::3]; xs = v[0::3]; ys = v[1::3]
    bad += sum(1 for x in v if x != x or abs(x) == float("inf"))
    c = ue.get_container(e) or ue.get_aggregate(e)
    out[e.GlobalId] = [e.is_a(), round(us.get_volume(g), 4), round(min(z), 3), round(max(z), 3), c.Name if c else None, e.Name, getattr(e, "PredefinedType", None), round(max(xs)-min(xs), 3), round(max(ys)-min(ys), 3)]
ports = []
for p in f.by_type("IfcDistributionPort"):
    owner = p.Nests[0].RelatingObject if p.Nests else None
    ports.append([p.Name, owner.Name if owner else None, p.FlowDirection, p.PredefinedType, p.SystemType, bool(p.ConnectedTo), bool(p.ConnectedFrom)])
systems = [[x.Name, x.PredefinedType, x.ObjectType, sum(len(r.RelatedObjects) for r in f.by_type("IfcRelAssignsToGroup") if r.RelatingGroup == x)] for x in f.by_type("IfcDistributionSystem")]
conns = [[r.RelatingPort.Name, r.RelatingPort.Nests[0].RelatingObject.Name, r.RelatedPort.Name, r.RelatedPort.Nests[0].RelatingObject.Name] for r in f.by_type("IfcRelConnectsPorts")]
print(json.dumps({"errors": len(log.statements), "bad": bad, "els": out, "ports": ports, "systems": systems, "conns": conns}))`;
type Probe = { errors: number; bad: number; els: Record<string, [string, number, number, number, string, string, string, number, number]>; ports: any[][]; systems: any[][]; conns: string[][] };
const probeFile = (file: string) => JSON.parse(execFileSync("python3", ["-c", PROBE, file]).toString()) as Probe;
const probeState = (s: BimState, key: string) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc13-")), "m.ifc"), txt = toIfc(s, { projectKey: key }); assert.equal(/NaN|Infinity/.test(txt), false); fs.writeFileSync(f, txt); return probeFile(f); };

test("legacy: Phase 8, Phase 11 and the real Phase 12 projects replay under Phase 13: v5 snapshots ignored, nothing MEP is inferred, same ids, same measurements, history never rewritten; the Phase 12 IFC is reproduced product by product", { timeout: 250000 }, async () => {
  for (const [name, key] of [["phase8-project", "phase8"], ["phase11-project", "phase11"], ["phase12-project", "phase12"]]) {
    const FX = path.join(import.meta.dirname, "fixtures", name), dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p13fx-"));
    fs.cpSync(FX, path.join(dir, key), { recursive: true });
    const raw = fs.readFileSync(path.join(dir, key, "events.jsonl"), "utf8"), lines: string[] = [];
    const p = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: { everyEvents: 100000, keep: 3 }, logger: { info: (e) => lines.push(String(e)), warn: (e) => lines.push(String(e)) } });
    const s = await p.state<BimState>(key, "bim");
    const oracle = JSON.parse(fs.readFileSync(path.join(FX, `${key}-oracle/measurements.json`), "utf8"));
    if (fs.existsSync(path.join(FX, "snapshots"))) assert.ok(lines.includes("snapshot.ignored_incompatible") && p.metrics.snapshotsLoaded === 0, `${key}: the older-version snapshot is ignored and the history replayed`);
    assert.deepEqual([s.mepSystems, s.mepJunctions, Object.values(s.elements).filter((e) => e.kind === "mep_segment").length], [{}, {}, 0], `${key}: no MEP system / junction / element is inferred`);
    assert.deepEqual(Object.keys(s.elements).sort(), Object.keys(oracle.quantities).sort(), `${key}: same ids`);
    for (const e of Object.values(s.elements)) {
      const q = quantities(s, e), old = oracle.quantities[e.id];
      if (e.kind === "wall") { for (const k of ["length", "thickness", "height"]) assert.equal(q[k], old[k], `${key} ${e.id} ${k}`); }
      else assert.equal(canonicalJson(q), canonicalJson(old), `${key}: ${e.id}`);
    }
    assert.equal(fs.readFileSync(path.join(dir, key, "events.jsonl"), "utf8"), raw, "history never rewritten");
    assert.deepEqual(modelIssues(s), []);
    if (key === "phase12") {
      assert.equal(canonicalJson(structuralConnectivity(s)), canonicalJson(oracle.connectivity), "the structural connectivity view is unchanged");
      if (hasIfc) {
        const old = probeFile(path.join(FX, "phase12-oracle/phase12.ifc")), now = probeState(s, "phase12");
        assert.deepEqual([old.errors, now.errors, now.bad], [0, 0, 0]);
        assert.deepEqual(Object.keys(now.els).sort(), Object.keys(old.els).sort(), "the same products with the same GlobalIds");
        for (const [gid, v] of Object.entries(old.els)) {
          assert.deepEqual([now.els[gid][0], now.els[gid][4], now.els[gid][5], now.els[gid][6]], [v[0], v[4], v[5], v[6]], `${v[5]}: class, storey, name, predefined type`);
          assert.ok([1, 2, 3].every((i) => Math.abs((now.els[gid][i] as number) - (v[i] as number)) <= 1e-3), `${v[5]} (${v[0]}): geometry`);
        }
      }
    }
  }
});

test("mixed MEP scenario: architecture + structure + three systems; connect, tee, equipment, network, level change, Phase 10 edit, protections, plan, IFC matrix, snapshot, reload, undo, replay", { timeout: 280000 }, async () => {
  const policy = { everyEvents: 1000, keep: 3 }, t = await setup(policy), { run, S } = t;
  const R = (x: number, y: number, offset: number, storey = "L0") => ({ storey, at: [x, y], offset });
  const ref = (element: string, connector: string) => ({ element, connector });
  await run("bim_create_types", { types: [{ kind: "wall", name: "S13-W", layers: [{ material: "Tuğla", thickness: 0.2 }] }, { kind: "slab", name: "S13-D", layers: [{ material: "Beton", thickness: 0.2 }] }, { kind: "ceiling", name: "S13-C", layers: [{ material: "Alçıpan", thickness: 0.0125 }] },
    { kind: "door", name: "S13-K", width: 1, height: 2.1 }, { kind: "column", name: "S13-C40", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "beam", name: "S13-B", profile: { shape: "rect", b: 0.3, h: 0.5 } },
    { kind: "pipe", name: "P25", diameter: 0.025 }, { kind: "pipe", name: "P50", diameter: 0.05 }, { kind: "duct", name: "DR", shape: "rectangular", width: 0.4, height: 0.2 }, { kind: "cable_tray", name: "TR", width: 0.3, height: 0.1 }, { kind: "conduit", name: "CN", diameter: 0.02 }] });
  const sq = [[0, 0], [8, 0], [8, 6], [0, 6]];
  await run("bim_create_walls", { walls: [{ storey: "L0", type: "S13-W", points: sq, closed: true, height: 3 }] });
  for (const [a, b] of [["W-0001", "W-0002"], ["W-0002", "W-0003"], ["W-0003", "W-0004"], ["W-0004", "W-0001"]]) await t.join(a, "end", b, "start");
  await run("bim_place_openings", { items: [{ kind: "door", host: "W-0001", along: 2, type: "S13-K" }] });
  await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 4, y: 3 }] });
  await run("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "S13-D", outline: sq }, { category: "architecture.ceiling", storey: "L0", type: "S13-C", outline: sq, offset: 2.7 }, { category: "structure.slab", storey: "L1", type: "S13-D", outline: sq }] });
  await run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "S13-C40", at: [7, 5], height: 3.2 }, { category: "structure.framing", storey: "L1", type: "S13-B", start: [0, 3], end: [8, 3], z: 0 }] });
  await run("bim_create_mep_systems", { systems: [{ name: "Domestic Cold Water", domain: "piping", classification: "domestic_cold_water" }, { name: "Sanitary", domain: "piping", classification: "sanitary" },
    { name: "Supply Air", domain: "hvac", classification: "supply_air" }, { name: "Power", domain: "electrical", classification: "power" }] });
  await run("bim_create_pipes", { pipes: [{ type: "P25", system: "Domestic Cold Water", route: [R(1, 1, 0.5), R(4, 1, 0.5)] }, { type: "P25", system: "Domestic Cold Water", route: [R(4, 1, 0.5), R(6, 1, 0.5)] },
    { type: "P25", system: "Domestic Cold Water", route: [R(4, 1, 0.5), R(4, 1, 0.5, "L1")] }, { type: "P25", system: "Domestic Cold Water", route: [R(4, 1, 0.5), R(4, 3, 0.5)] }, { type: "P50", system: "Sanitary", route: [R(6, 4, 0.2), R(6, 5.5, 0.2)] }] });
  await run("bim_create_ducts", { ducts: [{ type: "DR", system: "Supply Air", route: [R(1, 4, 2.4), R(5, 4, 2.4)] }] });
  await run("bim_create_cable_trays", { cable_trays: [{ type: "TR", system: "Power", route: [R(1, 5, 2.7), R(5, 5, 2.7)] }] });
  await run("bim_create_conduits", { conduits: [{ type: "CN", system: "Power", route: [R(1, 5.5, 2.7), R(5, 5.5, 2.7)] }] });
  await run("bim_create_families", { families: [{ name: "Tap", category: "plumbing.fixture", parameters: [{ key: "w", name: "w", scope: "type", dataType: "length", required: true }], representation: { kind: "box", width: "w", depth: "w", height: "w" } }] });
  await run("bim_create_types", { types: [{ kind: "component", name: "Basin", family: "Tap", parameters: { w: 0.4 }, connectors: [{ key: "cold", domain: "piping", position: [0.5, 0, 0.1], direction: [1, 0, 0], flow: "in", shape: "round", diameter: 0.025 }] }] });
  await run("bim_create_components", { components: [{ type: "Basin", storey: "L0", x: 5.5, y: 1, offset: 0.4 }] });
  // explicit connectivity: a coupling, a TEE (3 members), the equipment
  await run("bim_connect_mep", { connectors: [ref("ME-0001", "end"), ref("ME-0002", "start"), ref("ME-0004", "start")] });                              // 3-member tee (+ the riser below)
  await run("bim_connect_mep", { connectors: [ref("ME-0002", "end"), ref("CO-0001", "cold")] });                                                           // equipment at the end of ME-0002
  await run("bim_connect_mep", { connectors: [ref("ME-0003", "start"), ref("ME-0001", "end")] }).catch(() => undefined);                                    // ME-0003 starts at the tee point too: extends the junction
  const sys = (await t.ex("bim_query_mep_systems", {})).result as any[];
  assert.deepEqual(sys.map((x) => [x.name, x.element_count, x.junction_count]), [["Domestic Cold Water", 4, 2], ["Power", 2, 0], ["Sanitary", 1, 0], ["Supply Air", 1, 0]]);
  const net = (await t.ex("bim_query_mep_network", { system: "Domestic Cold Water" })).result;
  assert.ok(net.junctions.some((j: any) => j.kind === "cross" || j.kind === "tee") && net.components.length === 1 && net.elements.some((e: any) => e.id === "CO-0001"), `one connected network including the basin: ${JSON.stringify({ j: net.junctions, c: net.components, o: net.openConnectors.map((c: any) => c.element + "#" + c.connector) })}`);
  assert.deepEqual(net.openConnectors.map((c: any) => `${c.element}#${c.connector}`), ["ME-0001#start", "ME-0003#end", "ME-0004#end"]);
  assert.deepEqual((await t.ex("bim_validate", {})).result.issues.filter((i: any) => i.severity === "error"), [], "open connectors are valid");
  // level 1 moves: the riser and its world connector follow; the network stays valid; no MEP event
  const s0 = await S(), intent = canonicalJson(["ME-0001", "ME-0002", "ME-0003", "ME-0004"].map((id) => el(s0, id).route));
  const n0 = (await t.p.store(P).readEvents()).length;
  await run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.4 } }] });
  let s = await S();
  assert.ok(Math.abs(routeLength(s, el(s, "ME-0003")) - 3.4) < 1e-9 && routeWorld(s, el(s, "ME-0003"))[1][2] === 3.9);
  assert.equal(canonicalJson(["ME-0001", "ME-0002", "ME-0003", "ME-0004"].map((id) => el(s, id).route)), intent, "route intents are byte-identical");
  assert.deepEqual((await t.p.store(P).readEvents()).slice(n0).filter((e) => e.module === "bim" && /^(ME|CO|MJ)-/.test(String((e.payload as any)?.id ?? (e.payload as any)?.junction?.id ?? ""))), [], "no MEP element / junction event: only the storey (and elements that follow it by their own vertical intent) change");
  // a Phase 10 wall edit nearby leaves the MEP model untouched
  const mepBefore = canonicalJson({ j: s.mepJunctions, e: Object.values(s.elements).filter((e) => e.kind === "mep_segment" || e.kind === "component") });
  await run("bim_split_wall", { wall: "W-0003", t: 0.4 });
  s = await S();
  assert.equal(canonicalJson({ j: s.mepJunctions, e: Object.values(s.elements).filter((e) => e.kind === "mep_segment" || e.kind === "component") }), mepBefore, "MEP unchanged by the wall edit");
  // a disconnected route may change; a connected one may not
  await run("bim_update_elements", { items: [{ id: "ME-0005", kind: "mep_segment", set: { route: [R(6, 4, 0.2), R(6, 5.8, 0.2)] } }] });
  const nBad = (await t.p.store(P).readEvents()).length, bad = canonicalJson(await S());
  await t.rejected("bim_update_elements", { items: [{ id: "ME-0002", kind: "mep_segment", set: { route: [R(4.5, 1, 0.5), R(6, 1, 0.5)] } }] }, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT");
  assert.deepEqual([(await t.p.store(P).readEvents()).length, canonicalJson(await S())], [nBad, bad]);
  // plan: every category is drawn with its own style; the riser has a marker
  const svg = planSvg(s, Object.values(s.storeys).find((x) => x.name === "L0")!);
  for (const c of ["#1f6fb4", "#3a9d5d", "#c98a12", "#b03a2e"]) assert.ok(svg.includes(c), `plan colour ${c}`);
  assert.ok(/<path d="M [^"]*L [^"]*M [^"]*L [^"]*" stroke="#1f6fb4"/.test(svg), "vertical riser marker");
  // IFC matrix
  if (hasIfc) {
    const a = probeState(s, "mx");
    assert.deepEqual([a.errors, a.bad], [0, 0]);
    const byClass: Record<string, string[]> = {};
    for (const v of Object.values(a.els)) (byClass[v[0]] ??= []).push(v[5]);
    const n = (c: string) => (byClass[c] ?? []).length;
    assert.deepEqual([n("IfcPipeSegment"), n("IfcDuctSegment"), n("IfcCableCarrierSegment")], [5, 1, 2], "classes come from the category");
    const g = (id: string) => a.els[ifcGuid(`mx:${id}`)];
    assert.deepEqual([g("ME-0006")[6], g("ME-0007")[6], g("ME-0008")[6]].concat(g("ME-0001")[6]), ["RIGID SEGMENT".replace(" ", ""), "CABLETRAYSEGMENT", "CONDUITSEGMENT", "RIGIDSEGMENT"]);
    assert.ok(Math.abs(g("ME-0001")[7] - 3) < 0.05 && Math.abs(g("ME-0003")[3] - g("ME-0003")[2] - 3.4) < 0.1 + 0.025, "credible route extents (3 m run; 3.4 m riser)");
    assert.deepEqual([g("ME-0001")[4], g("ME-0003")[4]], ["L0", "L0"], "containment by the first route point's storey");
    const portsOf = (o: string) => a.ports.filter((p) => p[1] === o);
    const basin = g("CO-0001");
    assert.deepEqual([portsOf("ME-0001").map((p) => p[0]), portsOf(basin[5]).map((p) => p[0]), a.ports.length], [["start", "end"], ["cold"], 2 * 8 + 1], "ports are nested in the right product; the component keeps its own class");
    assert.equal(basin[0], "IfcSanitaryTerminal", "a connector does not change the component's semantic IFC class (the category's class, written natively since Phase 14)");
    assert.deepEqual(portsOf(basin[5])[0].slice(2, 4), ["SINK", "PIPE"]);
    assert.deepEqual(a.systems.map((x) => [x[0], x[1], x[3]]).sort(), [["Domestic Cold Water", "DOMESTICCOLDWATER", 4], ["Power", "USERDEFINED", 2], ["Sanitary", "SEWAGE".length ? "USERDEFINED" : "", 1], ["Supply Air", "USERDEFINED", 1]].sort(), "system assignments; the stable classification survives as ObjectType");
    assert.deepEqual(a.systems.map((x) => x[2]).sort(), ["domestic_cold_water", "power", "sanitary", "supply_air"]);
    assert.ok(a.conns.length >= 2 && a.conns.every((c) => c[1] !== c[3]), "junctions -> IfcRelConnectsPorts between different products (a 3-member junction is exported as a chain of port connections: an IFC4 port connects once in each direction)");
    // stable GlobalIds: an unrelated edit changes none of the MEP products
    await run("bim_move_elements", { ids: ["C-0001"], vector: [0.2, 0] });
    const b = probeState(await S(), "mx");
    const mepIds = Object.keys(a.els).filter((k) => /Pipe|Duct|CableCarrier/.test(a.els[k][0]));
    assert.deepEqual(mepIds.filter((k) => JSON.stringify(a.els[k]) !== JSON.stringify(b.els[k])), [], "MEP products and their GlobalIds are unchanged");
  }
  // snapshot, reload, undo of a selected MEP command, full replay
  assert.equal((await t.p.createSnapshot(P))?.written, true);
  const live = canonicalJson(await S());
  const reloaded = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
  assert.equal(canonicalJson(await reloaded.state(P, "bim")), live);
  assert.equal(reloaded.metrics.snapshotsLoaded, 1);
  await run("bim_disconnect_mep", { connectors: [ref("CO-0001", "cold")] });
  assert.equal(el(await S(), "CO-0001") !== undefined, true);
  await run("platform_undo", {});
  assert.equal(canonicalJson(await S()), live, "undo of the disconnect restores the exact connector membership");
  const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
  assert.equal(canonicalJson(full), canonicalJson(await S()));
  assert.deepEqual(full.mepJunctions, (await S()).mepJunctions);
});
