/** Phase 14 · Milestone B (part 1): ramp flights, stair flights, landings and the rule-governed stair / ramp assemblies. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, toIfc, planSvg, modelIssues } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const el = (s: BimState, id: string) => s.elements[id] as any;
const LAYER = [{ material: "Beton", thickness: 0.2 }];
async function base(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [{ kind: "ramp", name: "R9", max_slope: 0.09, thickness: 0.2, default_width: 1.2 }, { kind: "stair", name: "ST", max_riser: 0.25, min_tread: 0.25, default_width: 1.2 }, { kind: "slab", name: "LT", layers: LAYER }, { kind: "column", name: "C30", profile: { shape: "rect", b: 0.3, h: 0.3 } }] });
  return t;
}
const flight = (t: any, kind: "stair" | "ramp", start: number[], endX: number, base: number, extra: object = {}) => kind === "stair"
  ? t.run("bim_create_stairs", { stairs: [{ category: "architecture.stair_flight", storey: "L0", type: "ST", start, end: [endX, start[1]], riser_count: 9, base_offset: base, height: 1.5, ...extra }] })
  : t.run("bim_create_ramps", { ramps: [{ category: "architecture.ramp_flight", storey: "L0", type: "R9", start, end: [endX, start[1]], rise: 0.5, base_offset: base, ...extra }] });
const landing = (t: any, x0: number, z: number, extra: object = {}) => t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.landing", storey: "L0", type: "LT", outline: [[x0, -0.6], [x0 + 1.2, -0.6], [x0 + 1.2, 1.8], [x0, 1.8]], offset: z, ...extra }] });
const ids = (s: BimState, pred: (e: any) => boolean) => Object.values(s.elements).filter(pred).map((e: any) => e.id).sort();

test("ramp flight: derived run / length / slope / volume equal independent formulas; the type's slope limit; degenerate input; update, move, undo, replay, snapshot, dry run; plan", async () => {
  const policy = { everyEvents: 3, keep: 2 }, t = await base(policy);
  await t.run("bim_create_ramps", { ramps: [{ storey: "L0", type: "R9", start: [1, 1], end: [7, 9], rise: 0.9, base_offset: 0.1 }] });                          // run = 10 m, slope 9 %
  let s = await t.S();
  const q = quantities(s, el(s, "RM-0001")), len = Math.hypot(10, 0.9);
  assert.ok(Math.abs(q.run - 10) < 1e-12 && Math.abs(q.length - len) < 1e-12 && Math.abs(q.slope_percent - 9) < 1e-9 && Math.abs(q.volume - 1.2 * len * 0.2) < 1e-12 && Math.abs(q.slope_angle - (Math.atan2(0.9, 10) * 180) / Math.PI) < 1e-9, JSON.stringify(q));
  const g = (await t.ex("bim_get_element", { id: "RM-0001" })).result;
  assert.deepEqual([g.engine, g.taxonomy.category, g.representation.kind, g.placement_info.kind], ["ramp_flight", "architecture.ramp_flight", "ramp_run", "ramp_run"]);
  // refusals: a slope above the type's limit, a zero run, a type of the wrong family; nothing is written
  const n = (await t.p.store(P).readEvents()).length;
  await t.rejected("bim_create_ramps", { ramps: [{ storey: "L0", type: "R9", start: [0, 0], end: [5, 0], rise: 0.6 }] }, "RAMP_TYPE_LIMIT_EXCEEDED");           // 12 % > 9 %
  await t.rejected("bim_create_ramps", { ramps: [{ storey: "L0", type: "R9", start: [0, 0], end: [0, 0], rise: 0.1 }] }, "INVALID_RAMP_GEOMETRY");
  await t.rejected("bim_create_ramps", { ramps: [{ storey: "L0", type: "ST", start: [0, 0], end: [5, 0], rise: 0.1 }] }, "INVALID_REFERENCE");
  await t.rejected("bim_create_types", { types: [{ kind: "ramp", name: "BAD", max_slope: 1.5, thickness: 0.2 }] }, "INVALID_DIMENSION");
  assert.equal((await t.p.store(P).readEvents()).length, n);
  // update + move + dry run + undo
  await t.rejected("bim_update_elements", { items: [{ id: "RM-0001", kind: "ramp", set: { rise: 2 } }] }, "RAMP_TYPE_LIMIT_EXCEEDED");
  const before = canonicalJson(el(await t.S(), "RM-0001"));
  const dry = await t.ex("bim_move_elements", { ids: ["RM-0001"], vector: [1, 2] }, { dryRun: true });
  assert.deepEqual(dry.preview.summary.moved, ["RM-0001"]); assert.equal(canonicalJson(el(await t.S(), "RM-0001")), before);
  await t.run("bim_move_elements", { ids: ["RM-0001"], vector: [1, 2] });
  await t.run("bim_update_elements", { items: [{ id: "RM-0001", kind: "ramp", set: { rise: 0.5, width: 1.5 } }] });
  s = await t.S();
  assert.deepEqual([el(s, "RM-0001").start, el(s, "RM-0001").end, el(s, "RM-0001").width, el(s, "RM-0001").rise], [[2, 3], [8, 11], 1.5, 0.5]);
  const live = canonicalJson(s);
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live, "replay");
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot");
  await t.run("platform_undo", {}); await t.run("platform_undo", {});
  assert.deepEqual(el(await t.S(), "RM-0001").start, [1, 1], "undo restored the original position");
  // the plan draws the flight with its slope
  const svg = planSvg(await t.S(), (await t.S()).storeys[Object.keys((await t.S()).storeys)[0]]);
  assert.match(svg, /9\.0 %/); assert.deepEqual(modelIssues(await t.S()), []);
});

test("multi-flight stair: the assembly joins flights and landings by RULE (continuity of elevation and position); quantities; moves with its members; wrong members refused", async () => {
  const policy = { everyEvents: 4, keep: 2 }, t = await base(policy);
  await flight(t, "stair", [0, 0], 3, 0); await flight(t, "stair", [3, 1.2], 0, 1.5);                                    // two U-shaped flights, 1.5 m each
  await landing(t, 3, 1.5);
  let s = await t.S();
  const fl = ids(s, (e) => e.kind === "stair"), ld = ids(s, (e) => e.category === "architecture.landing");
  assert.equal(fl.length, 2); assert.equal(ld.length, 1);
  const made = await t.run("bim_create_assemblies", { items: [{ category: "architecture.stair_assembly", children: [fl[0], ld[0], fl[1]], predefined_type: "TWO_STRAIGHT_RUN_STAIR", name: "U-stair" }] });
  const aid = made.summary.created[0].id; s = await t.S();
  const q = quantities(s, el(s, aid));
  assert.deepEqual([q.flight_count, q.landing_count, q.total_rise, q.total_run, q.total_riser_count, q.child_count], [2, 1, 3, 6, 18, 3]);
  // refusals (each leaves nothing): a column is not a stair member; a landing at the wrong elevation; a flight at another elevation; flights that do not meet
  const rej = (children: string[], reason = "INVALID_ASSEMBLY_RELATION") => t.rejected("bim_create_assemblies", { items: [{ category: "architecture.stair_assembly", children }] }, reason);
  await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C30", at: [9, 9], height: 3 }] });
  const col = ids(await t.S(), (e) => e.kind === "profile_member")[0];
  await t.rejected("bim_create_assemblies", { items: [{ category: "architecture.stair_assembly", children: [col] }] }, "INVALID_ASSEMBLY_RELATION");
  await flight(t, "stair", [20, 0], 23, 0); await flight(t, "stair", [23, 1.2], 20, 1.45);                          // elevation jump of 5 cm
  const f2 = ids(await t.S(), (e) => e.kind === "stair" && !fl.includes(e.id));
  await landing(t, 23, 1.5);
  const ld2 = ids(await t.S(), (e) => e.category === "architecture.landing" && !ld.includes(e.id));
  await rej([f2[0], ld2[0], f2[1]]);                                                                                // 1.5 vs 1.45: not continuous
  await flight(t, "stair", [30, 0], 33, 0); await flight(t, "stair", [37, 1.2], 34, 1.5);                           // gap: no landing between them
  const f3 = ids(await t.S(), (e) => e.kind === "stair" && !fl.includes(e.id) && !f2.includes(e.id));
  await rej(f3);
  assert.equal(Object.values(await t.S().then((x) => x.elements)).filter((e: any) => e.kind === "assembly").length, 1, "only the valid assembly exists");
  // the assembly moves its flights AND its landing
  const a0 = el(s, fl[0]).start;
  await t.run("bim_move_elements", { ids: [aid], vector: [2, 1] });
  s = await t.S();
  assert.deepEqual([el(s, fl[0]).start, el(s, ld[0]).outline[0]], [[a0[0] + 2, a0[1] + 1], [5, 0.4]]);
  // a member changing elevation breaks the rule: refused atomically
  await t.rejected("bim_update_elements", { items: [{ id: fl[1], kind: "stair", set: { base_offset: 1.6 } }] }, "DEPENDENT_ELEMENT_INVALID");
  const live = canonicalJson(await t.S());
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live, "replay");
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot");
});

test("IFC: IfcStair aggregates IfcStairFlight x2 + the IfcSlab LANDING; stair-flight attributes come from the schema (NumberOfRisers, RiserHeight ...); IfcStairFlightType; IfcRamp aggregates IfcRampFlight; the ramp solid's top surface reaches base + rise (IfcOpenShell, 0 schema errors)", { skip: !hasIfc, timeout: 200000 }, async () => {
  const t = await base();
  await flight(t, "stair", [0, 0], 3, 0); await flight(t, "stair", [3, 1.2], 0, 1.5); await landing(t, 3, 1.5);
  let s = await t.S();
  const fl = ids(s, (e) => e.kind === "stair"), ld = ids(s, (e) => e.category === "architecture.landing");
  await t.run("bim_create_assemblies", { items: [{ category: "architecture.stair_assembly", children: [fl[0], ld[0], fl[1]], predefined_type: "TWO_STRAIGHT_RUN_STAIR" }] });
  await flight(t, "ramp", [20, 0], 26, 0); await flight(t, "ramp", [26, 1.2], 20, 0.5); await landing(t, 26, 0.5);
  s = await t.S();
  const rf = ids(s, (e) => e.kind === "ramp"), ld2 = ids(s, (e) => e.category === "architecture.landing" && !ld.includes(e.id));
  await t.run("bim_create_assemblies", { items: [{ category: "architecture.ramp_assembly", children: [rf[0], ld2[0], rf[1]], predefined_type: "TWO_STRAIGHT_RUN_RAMP" }] });
  s = await t.S();
  const txt = toIfc(s, { projectKey: "sr" });
  assert.match(txt, /FILE_SCHEMA\(\('IFC4'\)\)/);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-sr-")), "m.ifc");
  fs.writeFileSync(f, txt);
  const raw = execFileSync("python3", ["-c", `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True)
agg = {a.is_a() + ":" + str(a.PredefinedType): sorted(o.is_a() + ":" + str(getattr(o, "PredefinedType", "")) for r in a.IsDecomposedBy for o in r.RelatedObjects) for a in list(f.by_type("IfcStair")) + list(f.by_type("IfcRamp"))}
flights = [{"n": e.NumberOfRisers, "t": e.NumberOfTreads, "rh": e.RiserHeight, "tl": e.TreadLength, "pre": e.PredefinedType, "type": (e.IsTypedBy[0].RelatingType.is_a() if e.IsTypedBy else None)} for e in f.by_type("IfcStairFlight")]
ramps = []
for e in f.by_type("IfcRampFlight"):
    g = ifcopenshell.geom.create_shape(st, e).geometry; z = g.verts[2::3]
    ramps.append({"vol": us.get_volume(g), "zmax": max(z), "zmin": min(z), "type": (e.IsTypedBy[0].RelatingType.is_a() if e.IsTypedBy else None), "pre": e.PredefinedType})
cont = sorted(e.is_a() for r in f.by_type("IfcRelContainedInSpatialStructure") for e in r.RelatedElements)
print(json.dumps({"n": len(log.statements), "err": [str(x)[:200] for x in log.statements[:3]], "agg": agg, "flights": flights, "ramps": ramps, "contained": cont}))`, f]).toString().trim().split("\n");
  assert.deepEqual(raw.slice(0, -1), []);
  const out = JSON.parse(raw[raw.length - 1]);
  assert.deepEqual([out.n, out.err], [0, []]);
  assert.deepEqual(out.agg["IfcStair:TWO_STRAIGHT_RUN_STAIR"], ["IfcSlab:LANDING", "IfcStairFlight:STRAIGHT", "IfcStairFlight:STRAIGHT"]);
  assert.deepEqual(out.agg["IfcRamp:TWO_STRAIGHT_RUN_RAMP"], ["IfcRampFlight:STRAIGHT", "IfcRampFlight:STRAIGHT", "IfcSlab:LANDING"]);
  assert.equal(out.flights.length, 2);
  for (const fl2 of out.flights) { assert.deepEqual([fl2.n, fl2.t, fl2.pre, fl2.type], [9, 8, "STRAIGHT", "IfcStairFlightType"]); assert.ok(Math.abs(fl2.rh - 1.5 / 9) < 1e-9 && Math.abs(fl2.tl - 3 / 8) < 1e-9, `riser ${fl2.rh} tread ${fl2.tl}`); }
  for (const r of out.ramps) {
    const len = Math.hypot(6, 0.5), cs = 6 / len;
    assert.ok(Math.abs(r.vol - 1.2 * len * 0.2) / (1.2 * len * 0.2) < 0.005, `ramp volume ${r.vol}`);
    assert.deepEqual([r.type, r.pre], ["IfcRampFlightType", "STRAIGHT"]); void cs;
  }
  // the walking surface reaches exactly base + rise at the high end of each flight (top face), independent of the thickness
  assert.deepEqual(out.ramps.map((r: { zmax: number }) => Math.round(r.zmax * 1e6) / 1e6).sort(), [0.5, 1], "top surface heights");
  assert.equal(out.contained.filter((c: string) => c === "IfcStair" || c === "IfcRamp").length, 2, "the parent stair and ramp are contained in the storey");
  assert.equal(out.contained.includes("IfcStairFlight") || out.contained.includes("IfcRampFlight") || out.contained.includes("IfcSlab"), false, "flights and landings are parts: not separately contained");
});
