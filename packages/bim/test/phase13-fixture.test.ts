/** Phase 14 · the real Phase 13 project (built from the corrected closure code) replays unchanged under the Phase 14 code. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, FileStores, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, modelIssues, toIfc, structuralConnectivity, mepNetwork, systemSummary, connectorsOf } from "../src/index.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const PROBE = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.element as ue, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}
for e in f.by_type("IfcProduct"):
    if not e.Representation or e.is_a("IfcOpeningElement") or e.is_a("IfcDistributionPort"): continue
    g = ifcopenshell.geom.create_shape(st, e).geometry; v = g.verts; z = v[2::3]
    c = ue.get_container(e) or ue.get_aggregate(e)
    out[e.GlobalId] = [e.is_a(), round(us.get_volume(g), 4), round(min(z), 3), round(max(z), 3), c.Name if c else None, e.Name, getattr(e, "PredefinedType", None)]
print(json.dumps({"errors": len(log.statements), "els": out, "ports": len(f.by_type("IfcDistributionPort")), "connects": len(f.by_type("IfcRelConnectsPorts")), "systems": len(f.by_type("IfcDistributionSystem"))}))`;
const probe = (file: string) => JSON.parse(execFileSync("python3", ["-c", PROBE, file]).toString()) as { errors: number; els: Record<string, any[]>; ports: number; connects: number; systems: number };

test("phase13 fixture: the version-6 snapshots are ignored (state version 7) and the replay gives the same ids and measurements, MEP network views equal the oracle (system isolation + connector scope), history untouched, IFC product by product", { timeout: 200000 }, async () => {
  const FX = path.join(import.meta.dirname, "fixtures/phase13-project"), dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p14fx-"));
  fs.cpSync(FX, path.join(dir, "phase13"), { recursive: true });
  const raw = fs.readFileSync(path.join(dir, "phase13", "events.jsonl"), "utf8"), lines: string[] = [];
  const p = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: { everyEvents: 100000, keep: 3 }, logger: { info: (e) => lines.push(String(e)), warn: (e) => lines.push(String(e)) } });
  const s = await p.state<BimState>("phase13", "bim");
  assert.ok(p.metrics.snapshotsLoaded === 0 && lines.includes("snapshot.ignored_incompatible"), "Phase 14 (state version 7): the version-6 snapshots are ignored and the state is rebuilt from the events");
  assert.deepEqual(s.spatialUnits, {}, "Phase 14: no facility / facility part is ever inferred for an old project");
  const o = JSON.parse(fs.readFileSync(path.join(FX, "phase13-oracle/measurements.json"), "utf8"));
  assert.deepEqual(Object.keys(s.elements).sort(), Object.keys(o.quantities).sort(), "same ids");
  for (const e of Object.values(s.elements)) {
    const q = quantities(s, e), old = o.quantities[e.id];
    if (e.kind === "wall") for (const k of ["length", "thickness", "height"]) assert.equal(q[k], old[k], `${e.id} ${k}`); else assert.equal(canonicalJson(q), canonicalJson(old), e.id);
  }
  assert.equal(canonicalJson(structuralConnectivity(s)), canonicalJson(o.connectivity));
  // the two closure corrections, frozen in the oracle: system isolation and connector scope
  for (const sys of Object.values(s.mepSystems)) {
    assert.equal(canonicalJson(mepNetwork(s, { system: sys.id })), canonicalJson(o.mep.systems[sys.name].network), `system ${sys.name}`);
    assert.equal(canonicalJson(systemSummary(s, sys.id)), canonicalJson(o.mep.systems[sys.name].summary));
  }
  assert.equal(canonicalJson(mepNetwork(s, { connector: { element: "CO-0002", connector: "water_in" } })), canonicalJson(o.mep.equipment.water_in));
  assert.equal(canonicalJson(mepNetwork(s, { element: "CO-0002" })), canonicalJson(o.mep.equipment.whole));
  assert.equal(canonicalJson(s.mepJunctions), canonicalJson(o.mep.junctions));
  for (const e of Object.values(s.elements)) if (e.kind === "mep_segment" || e.kind === "component") assert.equal(canonicalJson(connectorsOf(s, e)), canonicalJson(o.mep.connectors[e.id]));
  const water = o.mep.systems.WATER.network.junctions.map((j: any) => j.id);
  assert.ok(!water.some((id: string) => ["MJ-0006", "MJ-0007", "MJ-0008"].includes(id)), "the WATER view holds no SAN / POWER junction");
  assert.equal(fs.readFileSync(path.join(dir, "phase13", "events.jsonl"), "utf8"), raw, "history never rewritten");
  assert.deepEqual(modelIssues(s), []);
  if (hasIfc) {
    const f1 = path.join(dir, "o.ifc"), f2 = path.join(dir, "n.ifc");
    fs.writeFileSync(f1, fs.readFileSync(path.join(FX, "phase13-oracle/phase13.ifc"))); fs.writeFileSync(f2, toIfc(s, { projectKey: "phase13" }));
    const a = probe(f1), b = probe(f2);
    assert.deepEqual([a.errors, b.errors, b.ports, b.connects, b.systems], [0, 0, a.ports, a.connects, a.systems]);
    assert.deepEqual(Object.keys(b.els).sort(), Object.keys(a.els).sort(), "the same products and GlobalIds");
    // ONE deliberate correction (Phase 14): plumbing.fixture has always DECLARED IfcSanitaryTerminal but the Phase 13 writer exported it as a proxy; the writer now
    // emits the declared class natively. Every other product keeps its class, storey, name and predefined type; geometry and GlobalIds never change.
    const changed: string[] = [];
    for (const [gid, v] of Object.entries(a.els)) {
      if (b.els[gid][0] !== v[0]) { changed.push(`${v[5]}: ${v[0]} -> ${b.els[gid][0]}`); assert.deepEqual([v[0], b.els[gid][0]], ["IfcBuildingElementProxy", "IfcSanitaryTerminal"]); assert.deepEqual([b.els[gid][4], b.els[gid][5]], [v[4], v[5]]); }
      else assert.deepEqual([b.els[gid][4], b.els[gid][5], b.els[gid][6]], [v[4], v[5], v[6]]);
      assert.ok([1, 2, 3].every((i) => Math.abs(b.els[gid][i] - v[i]) <= 1e-3), `${v[5]} geometry`);
    }
    assert.equal(changed.length, 1, `exactly the one corrected product: ${changed}`);
  }
});
