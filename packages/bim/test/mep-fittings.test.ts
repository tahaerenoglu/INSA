/** Phase 14 · MEP fitting products: derived connectors / geometry oracles, IFC (IfcOpenShell), explicit connectivity, refusals. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { toIfc, connectorsOf, BimState, systemSummary } from "../src/index.js";
import { setup } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
type T = Awaited<ReturnType<typeof setup>>;
const R = (x: number, y: number, offset = 0.5, storey = "L0") => ({ storey, at: [x, y], offset });
const ref = (element: string, connector: string) => ({ element, connector });
const close = (a: number[], b: number[], tol = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const rnd = (v: number[]) => v.map((x) => Math.round(x * 1e6) / 1e6);

async function base() {
  const t = await setup();
  await t.run("bim_create_types", { types: [
    { kind: "pipe", name: "P50", diameter: 0.05 }, { kind: "pipe", name: "P25", diameter: 0.025 },
    { kind: "mep_fitting", name: "EL90", fitting: "elbow", domain: "piping", run: { shape: "round", diameter: 0.05 }, angle: 90, radius: 0.3 },
    { kind: "mep_fitting", name: "RED", fitting: "reducer", domain: "piping", run: { shape: "round", diameter: 0.05 }, outlet: { shape: "round", diameter: 0.025 }, length: 0.2 },
    { kind: "mep_fitting", name: "TEE", fitting: "tee", domain: "piping", run: { shape: "round", diameter: 0.05 }, outlet: { shape: "round", diameter: 0.025 }, length: 0.4, branch_length: 0.15 },
    { kind: "mep_fitting", name: "CRS", fitting: "cross", domain: "piping", run: { shape: "round", diameter: 0.05 }, length: 0.4, branch_length: 0.15 },
    { kind: "mep_fitting", name: "CPL", fitting: "coupling", domain: "piping", run: { shape: "round", diameter: 0.05 }, length: 0.1 }] });
  await t.run("bim_create_mep_systems", { systems: [{ name: "W", domain: "piping", classification: "domestic_cold_water" }, { name: "S", domain: "piping", classification: "sanitary" }] });
  return t;
}
const fit = (t: T, o: Record<string, unknown>) => t.run("bim_create_mep_fittings", { fittings: [{ category: "plumbing.pipe_fitting", system: "W", storey: "L0", ...o }] });

test("derived connectors: elbow, reducer, tee, cross, coupling follow the type parameters and the yaw / pitch / roll placement (independent oracles)", async () => {
  const t = await base();
  await fit(t, { type: "EL90", at: [10, 0], offset: 1, rotation: 90 });                                   // FIT-0001
  await fit(t, { type: "TEE", at: [0, 0], offset: 0.5 });                                                // FIT-0002
  await fit(t, { type: "CRS", at: [0, 10], offset: 0.5 });                                               // FIT-0003
  await fit(t, { type: "RED", at: [0, 20], offset: 0.5 });                                               // FIT-0004
  await fit(t, { type: "TEE", at: [0, 30], offset: 2, pitch: 90 });                                       // FIT-0005 (run points DOWN)
  await fit(t, { type: "CPL", at: [0, 40], offset: 0.5, roll: 45 });                                      // FIT-0006
  const s = await t.S();
  const cx = (id: string) => Object.fromEntries(connectorsOf(s, s.elements[id]).map((c) => [c.ref.connector, { p: rnd(c.position), d: rnd(c.direction), shape: c.shape, dia: c.diameter }]));
  // elbow R = 0.3, 90 deg, yaw 90: local outlet (0.3, 0.3, 0) -> Rz(90) -> (-0.3, 0.3, 0); direction (0,1,0) -> (-1, 0, 0)
  const el = cx("FIT-0001");
  assert.deepEqual([el.inlet.p, el.inlet.d, el.outlet.p, el.outlet.d], [[10, 0, 1], [0, -1, 0], [9.7, 0.3, 1], [-1, 0, 0]]);
  // tee: run 0.4 along +X, branch 0.15 stub at the run mid-point toward +Y, section 0.025
  const te = cx("FIT-0002");
  assert.deepEqual([te.inlet.p, te.outlet.p, te.branch.p, te.branch.d, te.branch.dia, te.outlet.dia], [[0, 0, 0.5], [0.4, 0, 0.5], [0.2, 0.15, 0.5], [0, 1, 0], 0.025, 0.05]);
  const cr = cx("FIT-0003");
  assert.deepEqual([cr.branch_a.p, cr.branch_b.p, cr.branch_b.d], [[0.2, 10.15, 0.5], [0.2, 9.85, 0.5], [0, -1, 0]]);
  const rd = cx("FIT-0004");
  assert.deepEqual([rd.inlet.dia, rd.outlet.dia, rd.outlet.p], [0.05, 0.025, [0.2, 20, 0.5]]);
  // pitch 90 about Y: local +X -> world -Z: the run points DOWN (outlet 0.4 below), the branch (local +Y) stays +Y
  const tp = cx("FIT-0005");
  assert.deepEqual([tp.outlet.p, tp.outlet.d, tp.branch.p], [[0, 30, 1.6], [0, 0, -1], [0, 30.15, 1.8]]);
  const cp = cx("FIT-0006");
  assert.deepEqual([cp.outlet.p, cp.outlet.d], [[0.1, 40, 0.5], [1, 0, 0]], "a roll about the run axis does not move a straight coupling's connectors");
  // quantities: independent oracles
  const q = (id: string) => (s.elements[id] && (Object.values(s.elements).length, 0), id);
  void q;
  const { quantities } = await import("../src/index.js");
  assert.ok(Math.abs(quantities(s, s.elements["FIT-0001"]).centerline_length - 0.3 * (Math.PI / 2)) < 1e-12, "elbow centre line = R x angle");
  assert.equal(quantities(s, s.elements["FIT-0002"]).centerline_length, 0.4 + 0.15);
  assert.equal(quantities(s, s.elements["FIT-0003"]).centerline_length, 0.4 + 0.3);
  assert.equal(quantities(s, s.elements["FIT-0001"]).connector_count, 2);
});

test("refusals: tiny elbow radius, reducer that changes the shape, transition that keeps it, a kind the IFC class cannot express, domain mismatch, wrong category / type; nothing is written", async () => {
  const t = await base();
  await t.run("bim_create_mep_systems", { systems: [{ name: "AIR", domain: "hvac", classification: "supply_air" }, { name: "PWR", domain: "electrical", classification: "power" }] });
  const n = (await t.p.store("p").readEvents().catch(() => [])).length;
  void n;
  await t.rejected("bim_create_types", { types: [{ kind: "mep_fitting", name: "BAD1", fitting: "elbow", domain: "piping", run: { shape: "round", diameter: 0.1 }, angle: 90, radius: 0.04 }] }, "INVALID_DIMENSION");
  await t.rejected("bim_create_types", { types: [{ kind: "mep_fitting", name: "BAD2", fitting: "reducer", domain: "hvac", run: { shape: "round", diameter: 0.3 }, outlet: { shape: "rectangular", width: 0.3, height: 0.2 }, length: 0.3 }] }, "INVALID_DIMENSION");
  await t.rejected("bim_create_types", { types: [{ kind: "mep_fitting", name: "BAD3", fitting: "transition", domain: "hvac", run: { shape: "round", diameter: 0.3 }, outlet: { shape: "round", diameter: 0.2 }, length: 0.3 }] }, "INVALID_DIMENSION");
  await t.rejected("bim_create_types", { types: [{ kind: "mep_fitting", name: "BAD4", fitting: "tee", domain: "piping", run: { shape: "round", diameter: 0.1 }, length: 0.4 }] }, "INVALID_DIMENSION");        // no branchLength
  await t.run("bim_create_types", { types: [{ kind: "mep_fitting", name: "CELB", fitting: "elbow", domain: "electrical", run: { shape: "round", diameter: 0.02 }, angle: 90, radius: 0.1 }, { kind: "mep_fitting", name: "DELB", fitting: "elbow", domain: "hvac", run: { shape: "round", diameter: 0.3 }, angle: 90, radius: 0.5 }] });
  await t.rejected("bim_create_mep_fittings", { fittings: [{ category: "electrical.cable_fitting", type: "CELB", system: "PWR", storey: "L0", at: [0, 0] }] }, "INVALID_PREDEFINED_TYPE");   // a cable fitting is a coupling / transition, never a bend
  await t.rejected("bim_create_mep_fittings", { fittings: [{ category: "plumbing.pipe_fitting", type: "EL90", system: "AIR", storey: "L0", at: [0, 0] }] }, "MEP_SYSTEM_DOMAIN_MISMATCH");
  await t.rejected("bim_create_mep_fittings", { fittings: [{ category: "plumbing.pipe_fitting", type: "DELB", system: "W", storey: "L0", at: [0, 0] }] }, "MEP_SYSTEM_DOMAIN_MISMATCH");
  await t.rejected("bim_create_mep_fittings", { fittings: [{ category: "plumbing.pipe_fitting", type: "P25", system: "W", storey: "L0", at: [0, 0] }] }, "INVALID_REFERENCE");
  await t.rejected("bim_create_mep_fittings", { fittings: [{ category: "plumbing.pipe", type: "EL90", system: "W", storey: "L0", at: [0, 0] }] }, "CATEGORY_ENGINE_MISMATCH");
  await t.rejected("bim_create_mep_fittings", { fittings: [{ category: "plumbing.pipe_fitting", type: "EL90", system: "W", storey: "L9", at: [0, 0] }] }, "RESOURCE_NOT_FOUND");
  assert.equal(Object.values((await t.S()).elements).length, 0);
});

test("segment -> fitting -> segment: explicit junctions, the network passes THROUGH the fitting, sizes must match (no silent reducers), connected fittings are protected", async () => {
  const t = await base();
  await t.run("bim_create_pipes", { pipes: [{ type: "P50", system: "W", route: [R(-2, 0), R(0, 0)] }, { type: "P25", system: "W", route: [R(0.2, 0), R(2, 0)] }, { type: "P50", system: "S", route: [R(5, 5), R(6, 5)] }] });   // ME-0001 -> RED -> ME-0002
  await fit(t, { type: "RED", at: [0, 0], offset: 0.5 });                                                                      // FIT-0001: inlet (0,0) outlet (0.2, 0)
  await t.run("bim_connect_mep", { connectors: [ref("ME-0001", "end"), ref("FIT-0001", "inlet")] });
  await t.run("bim_connect_mep", { connectors: [ref("ME-0002", "start"), ref("FIT-0001", "outlet")] });
  await t.rejected("bim_connect_mep", { connectors: [ref("ME-0002", "end"), ref("FIT-0001", "outlet")] }, "MEP_CONNECTION_DISTANCE");
  const net = (await t.ex("bim_query_mep_network", { element: "ME-0001" })).result;
  assert.deepEqual([net.elements.map((e: any) => e.id), net.traversal], [["FIT-0001", "ME-0001", "ME-0002"], ["ME-0001", "FIT-0001", "ME-0002"]], "the walk passes through the fitting");
  assert.equal(net.components.length, 1);
  const sum = systemSummary(await t.S(), Object.values((await t.S()).mepSystems).find((x) => x.name === "W")!.id);
  assert.deepEqual([sum.element_count, sum.junction_count, sum.connected_component_count], [3, 2, 1]);
  // a size mismatch is refused: the reducer's inlet is 50 mm; a 25 mm pipe cannot join it
  await t.run("bim_create_pipes", { pipes: [{ type: "P25", system: "W", route: [R(-0.5, 3), R(0, 3)] }] });
  await fit(t, { type: "CPL", at: [0, 3], offset: 0.5 });                                                                     // FIT-0002 (50 mm coupling) at (0, 3)
  await t.rejected("bim_connect_mep", { connectors: [ref("ME-0004", "end"), ref("FIT-0002", "inlet")] }, "MEP_CONNECTOR_INCOMPATIBLE");
  await t.rejected("bim_connect_mep", { connectors: [ref("ME-0003", "start"), ref("FIT-0002", "inlet")] }, "MEP_SYSTEM_MISMATCH");
  // a connected fitting cannot be moved away; moved together with the junction broken -> atomic refusal; after disconnecting it moves
  const before = JSON.stringify(await t.S());
  await t.rejected("bim_move_elements", { ids: ["FIT-0001"], vector: [0, 1] }, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT");
  await t.rejected("bim_update_elements", { items: [{ id: "FIT-0001", kind: "mep_fitting", set: { rotation: 30 } }] }, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT");
  await t.rejected("bim_delete_elements", { ids: ["FIT-0001"] }, "ELEMENT_IN_USE");
  assert.equal(JSON.stringify(await t.S()), before, "atomic: nothing changed");
  await t.run("bim_disconnect_mep", { junction: "MJ-0001" });
  await t.run("bim_disconnect_mep", { junction: "MJ-0002" });
  await t.run("bim_update_elements", { items: [{ id: "FIT-0001", kind: "mep_fitting", set: { rotation: 30 } }] });
  await t.run("bim_delete_elements", { ids: ["FIT-0002"] });
});

test("IFC: every fitting kind exports its class, PredefinedType and TRUE solids; elbow = IfcRevolvedAreaSolid (round and rectangular), reducer = tapered solid; volumes match analytic oracles (IfcOpenShell, 0 schema errors)", { skip: !hasIfc, timeout: 200000 }, async () => {
  const t = await base();
  await t.run("bim_create_mep_systems", { systems: [{ name: "AIR", domain: "hvac", classification: "supply_air" }, { name: "PWR", domain: "electrical", classification: "power" }] });
  await t.run("bim_create_types", { types: [
    { kind: "mep_fitting", name: "DELB", fitting: "elbow", domain: "hvac", run: { shape: "rectangular", width: 0.4, height: 0.2 }, angle: 60, radius: 0.5 },
    { kind: "mep_fitting", name: "DTRN", fitting: "transition", domain: "hvac", run: { shape: "round", diameter: 0.3 }, outlet: { shape: "rectangular", width: 0.4, height: 0.2 }, length: 0.4 },
    { kind: "mep_fitting", name: "DRED", fitting: "reducer", domain: "hvac", run: { shape: "rectangular", width: 0.4, height: 0.2 }, outlet: { shape: "rectangular", width: 0.3, height: 0.2 }, length: 0.3 },
    { kind: "mep_fitting", name: "CTEE", fitting: "tee", domain: "electrical", run: { shape: "rectangular", width: 0.3, height: 0.1 }, length: 0.6, branch_length: 0.3 },
    { kind: "mep_fitting", name: "CCRS", fitting: "cross", domain: "electrical", run: { shape: "rectangular", width: 0.3, height: 0.1 }, length: 0.6, branch_length: 0.3 },
    { kind: "mep_fitting", name: "CRED", fitting: "reducer", domain: "electrical", run: { shape: "rectangular", width: 0.3, height: 0.1 }, outlet: { shape: "rectangular", width: 0.2, height: 0.1 }, length: 0.3 },
    { kind: "mep_fitting", name: "CELB", fitting: "elbow", domain: "electrical", run: { shape: "rectangular", width: 0.3, height: 0.1 }, angle: 90, radius: 0.4 },
    { kind: "mep_fitting", name: "KCPL", fitting: "coupling", domain: "electrical", run: { shape: "round", diameter: 0.02 }, length: 0.08 }] });
  const mk = (category: string, type: string, system: string, x: number, extra: Record<string, unknown> = {}) => ({ category, type, system, storey: "L0", at: [x, 0], offset: 1, ...extra });
  await t.run("bim_create_mep_fittings", { fittings: [
    mk("plumbing.pipe_fitting", "EL90", "W", 0), mk("plumbing.pipe_fitting", "RED", "W", 2), mk("plumbing.pipe_fitting", "TEE", "W", 4), mk("plumbing.pipe_fitting", "CRS", "W", 6), mk("plumbing.pipe_fitting", "CPL", "W", 8),
    mk("mechanical.duct_fitting", "DELB", "AIR", 10), mk("mechanical.duct_fitting", "DTRN", "AIR", 12), mk("mechanical.duct_fitting", "DRED", "AIR", 14),
    mk("electrical.cable_carrier_fitting", "CTEE", "PWR", 16), mk("electrical.cable_carrier_fitting", "CCRS", "PWR", 18), mk("electrical.cable_carrier_fitting", "CRED", "PWR", 20), mk("electrical.cable_carrier_fitting", "CELB", "PWR", 22),
    mk("electrical.cable_fitting", "KCPL", "PWR", 24)] });
  const s = await t.S(), txt = toIfc(s, { projectKey: "fit" });
  assert.match(txt, /FILE_SCHEMA\(\('IFC4'\)\)/);
  assert.ok(/IFCREVOLVEDAREASOLID/.test(txt) && /IFCEXTRUDEDAREASOLIDTAPERED/.test(txt), "true bend and taper primitives");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-fit-")), "m.ifc");
  fs.writeFileSync(f, txt);
  const raw = execFileSync("python3", ["-c", `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); res = {}
for e in f.by_type("IfcFlowFitting"):
    g = ifcopenshell.geom.create_shape(st, e).geometry; v = g.verts
    res[e.Tag] = [e.is_a(), e.PredefinedType, us.get_volume(g), min(v[0::3]), max(v[0::3]), min(v[1::3]), max(v[1::3]), min(v[2::3]), max(v[2::3])]
print(json.dumps({"n": len(log.statements), "err": [str(x)[:180] for x in log.statements[:3]], "res": res, "ports": len(f.by_type("IfcDistributionPort"))}))`, f]).toString().trim().split("\n");
  assert.deepEqual(raw.slice(0, -1), [], "the geometry kernel reported no problem while building any fitting");
  const out = JSON.parse(raw[raw.length - 1]) as { n: number; err: string[]; res: Record<string, [string, string, number, number, number, number, number, number, number]>; ports: number };
  assert.deepEqual([out.n, out.err], [0, []]);
  const cls = Object.fromEntries(Object.entries(out.res).map(([k, v]) => [k, `${v[0]}:${v[1]}`]));
  assert.deepEqual(cls, { "FIT-0001": "IfcPipeFitting:BEND", "FIT-0002": "IfcPipeFitting:TRANSITION", "FIT-0003": "IfcPipeFitting:JUNCTION", "FIT-0004": "IfcPipeFitting:JUNCTION", "FIT-0005": "IfcPipeFitting:CONNECTOR",
    "FIT-0006": "IfcDuctFitting:BEND", "FIT-0007": "IfcDuctFitting:TRANSITION", "FIT-0008": "IfcDuctFitting:TRANSITION", "FIT-0009": "IfcCableCarrierFitting:TEE", "FIT-0010": "IfcCableCarrierFitting:CROSS",
    "FIT-0011": "IfcCableCarrierFitting:REDUCER", "FIT-0012": "IfcCableCarrierFitting:BEND", "FIT-0013": "IfcCableFitting:CONNECTOR" });
  const A = (d: number) => (Math.PI * d * d) / 4, within = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * b;
  // oracles: elbow volume = A x R x theta (Pappus, circular section); coupling = A x L; round frustum; rectangular elbow = (w x h) x R x theta
  assert.ok(within(out.res["FIT-0001"][2], A(0.05) * 0.3 * (Math.PI / 2), 0.02), `elbow ${out.res["FIT-0001"][2]}`);
  assert.ok(within(out.res["FIT-0005"][2], A(0.05) * 0.1, 0.02), `coupling ${out.res["FIT-0005"][2]}`);
  assert.ok(within(out.res["FIT-0002"][2], (Math.PI * 0.2 / 3) * (0.025 ** 2 + 0.025 * 0.0125 + 0.0125 ** 2), 0.05), `reducer frustum ${out.res["FIT-0002"][2]}`);
  assert.ok(within(out.res["FIT-0006"][2], 0.4 * 0.2 * 0.5 * (Math.PI / 3), 0.02), `rectangular elbow ${out.res["FIT-0006"][2]}`);
  assert.ok(within(out.res["FIT-0013"][2], A(0.02) * 0.08, 0.02));
  // rectangular reducers (exact polyhedra) and the transition (a round half + a rectangular half): analytic oracles; this caught a mis-built tapered extrusion
  assert.ok(within(out.res["FIT-0008"][2], 0.2 * 0.3 * (0.4 + 0.3) / 2, 0.005), `rect reducer ${out.res["FIT-0008"][2]}`);
  assert.ok(within(out.res["FIT-0011"][2], 0.1 * 0.3 * (0.3 + 0.2) / 2, 0.005), `carrier reducer ${out.res["FIT-0011"][2]}`);
  assert.ok(within(out.res["FIT-0007"][2], Math.PI * 0.15 ** 2 * 0.2 + 0.4 * 0.2 * 0.2, 0.01), `transition ${out.res["FIT-0007"][2]}`);
  assert.ok(within(out.res["FIT-0012"][2], 0.3 * 0.1 * 0.4 * (Math.PI / 2), 0.02), `carrier elbow ${out.res["FIT-0012"][2]}`);
  // elbow 90 (R 0.3, d 0.05): the extent in x is R + r, in y is R + r (a quarter arc plus half the section)
  assert.ok(Math.abs((out.res["FIT-0001"][4] - out.res["FIT-0001"][3]) - (0.3 + 0.025)) < 0.01 && Math.abs((out.res["FIT-0001"][6] - out.res["FIT-0001"][5]) - (0.3 + 0.025)) < 0.01, "arc extent");
  assert.equal(out.ports, 2 + 2 + 3 + 4 + 2 + 2 + 2 + 2 + 3 + 4 + 2 + 2 + 2, "every derived connector is an IfcDistributionPort");
});
