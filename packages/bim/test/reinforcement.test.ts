/** Phase 14 · reinforcement: bar sets, meshes, tendons, tendon conduits bound to explicit hosts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, toIfc, modelIssues } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
type T = Awaited<ReturnType<typeof setup>>;
const el = (s: BimState, id: string) => s.elements[id] as any;
const A = (d: number) => (Math.PI * d * d) / 4;

async function frame(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [{ kind: "column", name: "C40", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] }, { kind: "wall", name: "W20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "rebar", name: "R16", diameter: 0.016, steel_grade: "B500B" }, { kind: "rebar", name: "R8", diameter: 0.008, steel_grade: "B500B" }, { kind: "rebar", name: "STR", diameter: 0.0157 }, { kind: "rebar", name: "DUCT", diameter: 0.07, wall_thickness: 0.003 }] });
  await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C40", at: [2, 2], height: 3 }] });                       // C-0001
  await t.run("bim_create_boundaries", { boundaries: [{ category: "structure.slab", storey: "L0", type: "D20", outline: [[0, 0], [6, 0], [6, 5], [0, 5]], offset: 3 }] });   // SSL-0001
  await t.run("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "W20", start: [10, 0], end: [14, 0], height: 3 }] });                  // W-0001
  return t;
}
const bars = (t: T, host: string, o: Record<string, unknown> = {}) => t.run("bim_create_reinforcement", { items: [{ category: "structure.rebar_set", type: "R16", host, layers: [{ path: [[1.85, 1.85, 0.05], [1.85, 1.85, 2.95]], count: 4, spacing: 0.1, direction: [1, 0, 0] }], ...o }] });

test("bar set: derived bars, lengths and volume equal independent oracles; the bend radius fillets every corner; quantities", async () => {
  const t = await frame();
  await bars(t, "C-0001");                                                                                                   // RB-0001
  await t.run("bim_create_reinforcement", { items: [{ type: "R8", host: "C-0001", layers: [{ path: [[1.8, 1.8, 0.1], [2.2, 1.8, 0.1], [2.2, 2.2, 0.1], [1.8, 2.2, 0.1], [1.8, 1.8, 0.1]], count: 1 }], bend_radius: 0.016 }] });   // stirrup RB-0002
  const s = await t.S(), q = quantities(s, el(s, "RB-0001")), q2 = quantities(s, el(s, "RB-0002"));
  assert.deepEqual([el(s, "RB-0001").kind, el(s, "RB-0001").storey === el(s, "C-0001").storey, q.bar_count, q.layer_count], ["reinforcement", true, 4, 1]);
  assert.ok(Math.abs(q.bar_length - 2.9) < 1e-12 && Math.abs(q.total_length - 4 * 2.9) < 1e-12 && Math.abs(q.volume - A(0.016) * 4 * 2.9) < 1e-12, "bar = 2.9 m, 4 bars, steel volume = A x total length");
  // A closed stirrup rounds all FOUR corners, including the closure seam.
  const straight = 4 * 0.4, r = 0.016, per = (Math.PI / 2) * r - 2 * r;                                                        // an arc replaces 2 r of straight length by a quarter circle
  assert.ok(Math.abs(q2.bar_length - (straight + 4 * per)) / q2.bar_length < 0.004, `${q2.bar_length} vs ${straight + 4 * per}`);
  const rep = (await t.ex("bim_get_element", { id: "RB-0001" })).result;
  assert.deepEqual([rep.engine, rep.quantities.bar_count, rep.representation.kind, rep.representation.bars.length, rep.representation.bars[3].points[0]], ["reinforcement", 4, "bar_sweep", 4, [2.15, 1.85, 0.05]]);
  assert.deepEqual(modelIssues(s), []);
});

test("refusals: host rules, mesh / tendon layer rules, overlap, bend radius that does not fit, degenerate paths, unknown host; nothing is written", async () => {
  const t = await frame();
  await t.run("bim_create_types", { types: [{ kind: "door", name: "DR", width: 1, height: 2.1 }] });
  await t.run("bim_place_openings", { items: [{ kind: "door", host: "W-0001", along: 2, type: "DR" }] });                                 // O-... / D-... hosted
  const n = (await t.p.store(P).readEvents()).length, layer = (extra: object = {}) => ({ path: [[1.85, 1.85, 0.05], [1.85, 1.85, 2.95]], count: 2, spacing: 0.1, direction: [1, 0, 0], ...extra });
  const rej = (it: Record<string, unknown>, reason: string) => t.rejected("bim_create_reinforcement", { items: [{ category: "structure.rebar_set", type: "R16", host: "C-0001", layers: [layer()], ...it }] }, reason);
  await rej({ host: "NOPE" }, "ELEMENT_NOT_FOUND");
  await rej({ host: (Object.values((await t.S()).elements).find((e: any) => e.kind === "hosted_component") as any).id }, "INVALID_HOST_RELATION");        // a door cannot host bars
  await rej({ type: "C40" }, "INVALID_REFERENCE");                                                                                  // a column type is not a rebar type
  await rej({ layers: [layer({ spacing: 0.01 })] }, "INVALID_GEOMETRY");                                                            // bars would overlap (spacing < diameter)
  await rej({ layers: [layer({ path: [[1, 1, 1], [1, 1, 1]] })] }, "INVALID_GEOMETRY");                                              // zero-length segment
  await rej({ layers: [{ path: [[0, 0, 0], [0.01, 0, 0], [0.01, 0.01, 0]], count: 1, spacing: 0.2, direction: [0, 1, 0] }], bend_radius: 0.05 }, "INVALID_GEOMETRY");   // radius does not fit
  await rej({ category: "structure.rebar_mesh" }, "INVALID_GEOMETRY");                                                              // a mesh is two layers
  await rej({ category: "structure.tendon" }, "INVALID_GEOMETRY");                                                                  // a tendon is one path, count 1
  await rej({ category: "structure.tendon_conduit", type: "R16", layers: [layer({ count: 1 })] }, "INVALID_DIMENSION");             // a conduit type needs a wall thickness
  await rej({ category: "plumbing.pipe" }, "CATEGORY_ENGINE_MISMATCH");
  await t.rejected("bim_create_types", { types: [{ kind: "rebar", name: "BADW", diameter: 0.02, wall_thickness: 0.02 }] }, "INVALID_DIMENSION");
  assert.equal((await t.p.store(P).readEvents()).length, n, "nothing was written");
});

test("host relation: bars move WITH their host and never alone; the host cannot be deleted while it hosts bars (no cascade); undo / replay / snapshot / dry run", async () => {
  const policy = { everyEvents: 3, keep: 2 }, t = await frame(policy);
  await bars(t, "C-0001");
  await t.run("bim_create_reinforcement", { items: [{ category: "structure.rebar_mesh", type: "R8", host: "SSL-0001", layers: [{ path: [[0.2, 0.2, 2.9], [5.8, 0.2, 2.9]], count: 12, spacing: 0.4, direction: [0, 1, 0] }, { path: [[0.2, 0.2, 2.92], [0.2, 4.8, 2.92]], count: 15, spacing: 0.4, direction: [1, 0, 0] }] }] });
  const before = canonicalJson((await t.S()).elements["RB-0001"]);
  await t.rejected("bim_move_elements", { ids: ["RB-0001"], vector: [1, 0] }, "INVALID_HOST_RELATION");
  const dry = await t.ex("bim_move_elements", { ids: ["C-0001"], vector: [1, 0.5] }, { dryRun: true });
  assert.deepEqual(dry.preview.summary.moved, ["C-0001", "RB-0001"]);
  assert.equal(canonicalJson((await t.S()).elements["RB-0001"]), before, "a dry run moved nothing");
  await t.run("bim_move_elements", { ids: ["C-0001"], vector: [1, 0.5] });
  const s = await t.S();
  assert.deepEqual([el(s, "C-0001").at, el(s, "RB-0001").layers[0].path[0], el(s, "RB-0001").layers[0].path[1]], [[3, 2.5], [2.85, 2.35, 0.05], [2.85, 2.35, 2.95]], "the bars followed their host in plan, not in z");
  await t.rejected("bim_delete_elements", { ids: ["C-0001"] }, "ELEMENT_IN_USE");
  await t.rejected("bim_reassign_storey", { items: [{ id: "C-0001", storey: "L1" }] }, "DEPENDENT_ELEMENT_INVALID");                    // the bars would leave their host's storey: refused atomically
  const live = canonicalJson(await t.S());
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live, "replay");
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot");
  await t.run("platform_undo", {});
  assert.equal(el(await t.S(), "C-0001").at[0], 2, "undo restored the host and, in the same command, the bars");
  assert.equal(el(await t.S(), "RB-0001").layers[0].path[0][0], 1.85);
  await t.run("bim_delete_elements", { ids: ["RB-0001"] });
  await t.run("bim_update_elements", { items: [{ id: "RB-0002", kind: "reinforcement", set: { cover: 0.04, layers: [{ path: [[0.2, 0.2, 2.9], [5.8, 0.2, 2.9]], count: 14, spacing: 0.4, direction: [0, 1, 0] }, { path: [[0.2, 0.2, 2.92], [0.2, 4.8, 2.92]], count: 15, spacing: 0.4, direction: [1, 0, 0] }] } }] });
  assert.equal(quantities(await t.S(), el(await t.S(), "RB-0002")).bar_count, 29);
});

test("IFC: bars, mesh, tendon and hollow conduit export their real classes with swept discs, the host aggregates its bars; volumes match analytic oracles (IfcOpenShell, 0 schema errors)", { skip: !hasIfc, timeout: 200000 }, async () => {
  const t = await frame();
  await bars(t, "C-0001");                                                                                                    // RB-0001: 4 bars x 2.9 m
  await t.run("bim_create_reinforcement", { items: [
    { category: "structure.rebar_mesh", type: "R8", host: "SSL-0001", layers: [{ path: [[0.2, 0.2, 2.9], [5.8, 0.2, 2.9]], count: 3, spacing: 0.4, direction: [0, 1, 0] }, { path: [[0.2, 0.2, 2.92], [0.2, 4.8, 2.92]], count: 3, spacing: 0.4, direction: [1, 0, 0] }] },   // RB-0002
    { category: "structure.tendon", type: "STR", host: "SSL-0001", layers: [{ path: [[0.5, 2.5, 2.85], [3, 2.5, 2.8], [5.5, 2.5, 2.85]], count: 1 }] },                                                                                            // RB-0003
    { category: "structure.tendon_conduit", type: "DUCT", host: "SSL-0001", layers: [{ path: [[0.5, 3.5, 2.85], [5.5, 3.5, 2.85]], count: 1 }] }] });                                                                                              // RB-0004
  const s = await t.S(), txt = toIfc(s, { projectKey: "rb" });
  assert.match(txt, /FILE_SCHEMA\(\('IFC4X3_ADD2'\)\)/, "IfcTendonConduit exists only in IFC4.3: auto selects it (never an IFC4 header)");
  assert.throws(() => toIfc(s, { projectKey: "rb", schema: "IFC4" }), (e: any) => e.reason === "UNSUPPORTED_IFC_SCHEMA");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-rb-")), "m.ifc");
  fs.writeFileSync(f, txt);
  const raw = execFileSync("python3", ["-c", `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}
for e in f.by_type("IfcReinforcingElement"):
    g = ifcopenshell.geom.create_shape(st, e).geometry
    extra = {"BarLength": getattr(e, "BarLength", None), "NominalDiameter": getattr(e, "NominalDiameter", None), "SteelGrade": getattr(e, "SteelGrade", None)}
    out[e.Name] = [e.is_a(), us.get_volume(g), extra, [i.is_a() for i in e.Representation.Representations[0].Items][:1], e.Representation.Representations[0].RepresentationType]
agg = [(r.RelatingObject.is_a(), len(r.RelatedObjects)) for r in f.by_type("IfcRelAggregates") if any(o.is_a("IfcReinforcingElement") for o in r.RelatedObjects)]
print(json.dumps({"n": len(log.statements), "err": [str(x)[:200] for x in log.statements[:3]], "els": out, "agg": agg, "contained": [e.is_a() for r in f.by_type("IfcRelContainedInSpatialStructure") for e in r.RelatedElements if e.is_a("IfcReinforcingElement")]}))`, f]).toString().trim().split("\n");
  assert.deepEqual(raw.slice(0, -1), []);
  const out = JSON.parse(raw[raw.length - 1]) as { n: number; err: string[]; els: Record<string, [string, number, Record<string, number | string | null>, string[], string]>; agg: [string, number][]; contained: string[] };
  assert.deepEqual([out.n, out.err, out.contained], [0, [], []]);
  assert.deepEqual(Object.keys(out.els).sort(), ["RB-0001.1", "RB-0001.2", "RB-0001.3", "RB-0001.4", "RB-0002", "RB-0003", "RB-0004"], "one IfcReinforcingBar per bar; the mesh / tendon / conduit are single products");
  const classes: Record<string, number> = {};
  for (const v of Object.values(out.els)) classes[v[0]] = (classes[v[0]] ?? 0) + 1;
  assert.deepEqual(classes, { IfcReinforcingBar: 4, IfcReinforcingMesh: 1, IfcTendon: 1, IfcTendonConduit: 1 });
  const within = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * b;
  assert.ok(within(out.els["RB-0001.1"][1], A(0.016) * 2.9, 0.03), `bar ${out.els["RB-0001.1"][1]}`);
  assert.deepEqual([out.els["RB-0001.1"][2].BarLength, out.els["RB-0001.1"][2].NominalDiameter, out.els["RB-0001.1"][2].SteelGrade, out.els["RB-0001.1"][3], out.els["RB-0001.1"][4]], [2.9, 0.016, "B500B", ["IfcSweptDiskSolid"], "AdvancedSweptSolid"]);
  const meshLen = 3 * 5.6 + 3 * 4.6;
  assert.ok(within(out.els["RB-0002"][1], A(0.008) * meshLen, 0.05), `mesh ${out.els["RB-0002"][1]}`);                          // the crossing bars overlap at their joints: tolerance 5 %
  const tendon = Math.hypot(2.5, 0.05) * 2;
  assert.ok(within(out.els["RB-0003"][1], A(0.0157) * tendon, 0.05), `tendon ${out.els["RB-0003"][1]}`);
  assert.ok(within(out.els["RB-0004"][1], (Math.PI * (0.035 ** 2 - 0.032 ** 2)) * 5, 0.05), `hollow conduit ${out.els["RB-0004"][1]}`);       // an annulus, not a solid bar
  assert.deepEqual(out.agg.sort(), [["IfcColumn", 4], ["IfcSlab", 3]].sort(), "the hosts aggregate their bars (mesh, tendon, conduit on the slab)");
});
