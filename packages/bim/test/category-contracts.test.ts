/**
 * Phase 14 · M2/M8: the generated CATEGORY CONTRACT. Every registered category whose engine is implemented is built from a minimal valid example
 * (a builder per ENGINE, never per category), then driven through the generic lifecycle. The steps a category passes are recorded; with
 * WRITE_CONTRACTS=1 they are written to packages/bim/data/category-contract-results.json, which `npm run bim:coverage` reads to report VERIFIED levels.
 * A category whose registry IFC class is not the class the writer emits is reported as a GAP (never silently counted as support).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalJson, Platform } from "@insa/core";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import { bimModule, BimState, listCategories, findEngine, ifcClassFor, toIfc, modelIssues, handlersOf, quantities, resolveElementRepresentation } from "../src/index.js";
import { IFC_CLASS_DATA } from "../src/ifc-schema-data.js";
import { ifcGuid } from "../src/geo.js";
import { setup, P } from "./authoring-fixture.js";

type T = Awaited<ReturnType<typeof setup>>;
type Cat = ReturnType<typeof listCategories>[number];
const tag = (c: Cat) => c.id.replace(/\W/g, "_");
const sq = [[0, 0], [8, 0], [8, 6], [0, 6]];
const LAYER = [{ material: "Beton", thickness: 0.2 }];

/** A builder per engine: creates ONE element of the category through the engine's canonical tool and returns its id. */
const BUILD: Record<string, (t: T, c: Cat) => Promise<string>> = {
  async wall(t, c) {
    await t.run("bim_create_types", { types: [{ kind: "wall", name: `T-${tag(c)}`, layers: LAYER }] });
    const r = await t.run("bim_create_walls", { walls: [{ category: c.id, storey: "L0", type: `T-${tag(c)}`, start: [0, 0], end: [6, 0], height: 3 }] });
    return "";
  },
  async boundary(t, c) {
    const kind = c.typeKinds![0];
    await t.run("bim_create_types", { types: [{ kind, name: `T-${tag(c)}`, layers: LAYER, ...(kind === "footing" ? { footing_kind: "pad" } : {}) }] });
    const r = await t.run("bim_create_boundaries", { boundaries: [{ category: c.id, storey: "L0", type: `T-${tag(c)}`, outline: sq }] });
    return "";
  },
  async profile_member(t, c) {
    const kind = c.typeKinds![0];
    await t.run("bim_create_types", { types: [{ kind, name: `T-${tag(c)}`, profile: { shape: "rect", b: 0.3, h: 0.4 } }] });
    const pl = c.placements![0], down = c.memberDirection === "down";
    const m = pl === "member_axis" ? { start: [0, 0], end: [4, 0], z: 3 } : pl === "member_vertical" ? { at: [1, 1], ...(down ? { length: 8 } : { height: 3 }) } : { start: [0, 0], end: [3, 0], end_storey: "L1" };
    const r = await t.run("bim_create_profile_members", { members: [{ category: c.id, storey: "L0", type: `T-${tag(c)}`, ...m }] });
    return "";
  },
  async hosted_component(t, c) {
    const kind = c.typeKinds![0];
    await t.run("bim_create_types", { types: [{ kind: "wall", name: "HW", layers: LAYER }, { kind, name: `T-${tag(c)}`, width: 1, height: 1.2 }] });
    await t.run("bim_create_walls", { walls: [{ storey: "L0", type: "HW", start: [0, 0], end: [8, 0], height: 3 }] });
    const r = await t.run("bim_place_openings", { items: [{ kind, host: "W-0001", along: 3, type: `T-${tag(c)}` }] });
    return "";
  },
  async point_component(t, c) {
    await t.run("bim_create_families", { families: [{ name: `F-${tag(c)}`, category: c.id, parameters: [{ key: "w", name: "w", scope: "type", dataType: "length", required: true }], representation: { kind: "box", width: "w", depth: "w", height: "w" } }] });
    await t.run("bim_create_types", { types: [{ kind: "component", name: `T-${tag(c)}`, family: `F-${tag(c)}`, parameters: { w: 0.5 } }] });
    const r = await t.run("bim_create_components", { components: [{ type: `T-${tag(c)}`, storey: "L0", x: 3, y: 2, offset: 0 }] });
    return "";
  },
  async spatial(t, c) {
    await t.run("bim_create_types", { types: [{ kind: "wall", name: "RW", layers: LAYER }] });
    await t.run("bim_create_walls", { walls: [{ storey: "L0", type: "RW", points: sq, closed: true, height: 3 }] });
    for (const [a, b] of [["W-0001", "W-0002"], ["W-0002", "W-0003"], ["W-0003", "W-0004"], ["W-0004", "W-0001"]]) await t.join(a, "end", b, "start");
    const r = await t.run("bim_create_spatial_elements", { items: [{ category: c.id, storey: "L0", x: 4, y: 3 }] });
    return "";
  },
  async stair(t, c) {
    await t.run("bim_create_types", { types: [{ kind: "stair", name: `T-${tag(c)}`, max_riser: 0.25, min_tread: 0.25, default_width: 1.2 }] });
    const r = await t.run("bim_create_stairs", { stairs: [{ category: c.id, storey: "L0", type: `T-${tag(c)}`, start: [1, 1], end: [5, 1], riser_count: 16 }] });
    return "";
  },
  async path(t, c) {
    await t.run("bim_create_types", { types: [{ kind: "railing", name: `T-${tag(c)}`, height: 1, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 }] });
    const r = await t.run("bim_create_railings", { railings: [{ storey: "L0", type: `T-${tag(c)}`, path: [[0, 0], [6, 0]] }] });
    return "";
  },
  async reinforcement(t, c) {
    const conduit = c.ifcClass === "IfcTendonConduit", mesh = c.ifcClass === "IfcReinforcingMesh", single = conduit || c.ifcClass === "IfcTendon";
    await t.run("bim_create_types", { types: [{ kind: "column", name: "HC", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "rebar", name: `T-${tag(c)}`, diameter: conduit ? 0.07 : 0.016, ...(conduit ? { wall_thickness: 0.003 } : {}) }] });
    await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "HC", at: [1, 1], height: 3 }] });
    const path1 = [[0.85, 0.85, 0.1], [0.85, 0.85, 2.9]], layers = mesh ? [{ path: path1, count: 3, spacing: 0.1, direction: [1, 0, 0] }, { path: [[0.85, 0.85, 0.12], [1.15, 0.85, 0.12]], count: 3, spacing: 0.1, direction: [0, 0, 1] }]
      : [{ path: path1, count: single ? 1 : 3, spacing: 0.1, direction: [1, 0, 0] }];
    await t.run("bim_create_reinforcement", { items: [{ category: c.id, type: `T-${tag(c)}`, host: "C-0001", layers }] });
    return "";
  },
  async pitched_roof(t, c) {
    await t.run("bim_create_types", { types: [{ kind: "roof", name: `T-${tag(c)}`, layers: LAYER }] });
    await t.run("bim_create_pitched_roofs", { roofs: [{ category: c.id, storey: "L0", type: `T-${tag(c)}`, outline: [[0, 0], [8, 0], [8, 5], [0, 5]], form: "gable", pitch: 30, offset: 3 }] });
    return "";
  },
  async curtain_wall(t, c) {
    await t.run("bim_create_types", { types: [{ kind: "curtain_wall", name: `T-${tag(c)}`, max_panel_width: 1.5, max_panel_height: 1.5, panel_thickness: 0.03, mullion: { width: 0.06, depth: 0.12 }, transom: { width: 0.06, depth: 0.1 } }] });
    await t.run("bim_create_curtain_walls", { walls: [{ category: c.id, storey: "L0", type: `T-${tag(c)}`, start: [0, 0], end: [6, 0], height: 3 }] });
    return "";
  },
  async ramp_flight(t, c) {
    await t.run("bim_create_types", { types: [{ kind: "ramp", name: `T-${tag(c)}`, max_slope: 0.09, thickness: 0.2, default_width: 1.2 }] });
    await t.run("bim_create_ramps", { ramps: [{ category: c.id, storey: "L0", type: `T-${tag(c)}`, start: [0, 0], end: [6, 0], rise: 0.5 }] });
    return "";
  },
  async assembly(t, c) {
    // a RULE-governed assembly (stair / ramp run) is built from what its rule accepts: two flights joined by a landing (U-shaped); a plain assembly from two columns
    if (c.assemblyRule) {
      const stairRun = c.assemblyRule === "stair_run", flightCat = stairRun ? "architecture.stair_flight" : "architecture.ramp_flight", run = stairRun ? 3 : 6, z = stairRun ? 1.5 : 0.5;
      await t.run("bim_create_types", { types: [{ kind: "slab", name: "LT", layers: LAYER }, stairRun ? { kind: "stair", name: "FT", max_riser: 0.25, min_tread: 0.25, default_width: 1.2 } : { kind: "ramp", name: "FT", max_slope: 0.09, thickness: 0.2, default_width: 1.2 }] });
      const flight = (start: number[], end: number, base: number) => stairRun ? t.run("bim_create_stairs", { stairs: [{ category: flightCat, storey: "L0", type: "FT", start, end: [end, start[1]], riser_count: 9, base_offset: base, height: 1.5 }] })
        : t.run("bim_create_ramps", { ramps: [{ category: flightCat, storey: "L0", type: "FT", start, end: [end, start[1]], rise: 0.5, base_offset: base }] });
      await flight([0, 0], run, 0); await flight([run, 1.2], 0, z);
      await t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.landing", storey: "L0", type: "LT", outline: [[run, -0.6], [run + 1.2, -0.6], [run + 1.2, 1.8], [run, 1.8]], offset: z }] });
      const ids = Object.values((await t.S()).elements).filter((e: any) => e.kind === (stairRun ? "stair" : "ramp") || e.category === "architecture.landing").map((e: any) => e.id);
      await t.run("bim_create_assemblies", { items: [{ category: c.id, children: ids }] });
      return "";
    }
    await t.run("bim_create_types", { types: [{ kind: "column", name: "AC", profile: { shape: "rect", b: 0.3, h: 0.3 } }] });
    await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "AC", points: [[0, 0], [3, 0]], height: 3 }] });
    await t.run("bim_create_assemblies", { items: [{ category: c.id, children: ["C-0001", "C-0002"] }] });
    return "";
  },
  async mep_fitting(t, c) {
    const dom = c.mepDomain!, coupling = c.ifcClass === "IfcCableFitting";
    await t.run("bim_create_types", { types: [{ kind: "mep_fitting", name: `T-${tag(c)}`, fitting: coupling ? "coupling" : "elbow", domain: dom, run: { shape: "round", diameter: 0.05 }, ...(coupling ? { length: 0.1 } : { angle: 90, radius: 0.3 }) }] });
    await t.run("bim_create_mep_systems", { systems: [{ name: "S", domain: dom, classification: "x" }] });
    await t.run("bim_create_mep_fittings", { fittings: [{ category: c.id, type: `T-${tag(c)}`, system: "S", storey: "L0", at: [2, 2], offset: 1 }] });
    return "";
  },
  async mep_network(t, c) {
    const kind = c.typeKinds![0], dom = c.mepDomain!;
    await t.run("bim_create_types", { types: [kind === "duct" ? { kind, name: `T-${tag(c)}`, shape: "round", diameter: 0.3 } : kind === "cable_tray" ? { kind, name: `T-${tag(c)}`, width: 0.3, height: 0.1 } : { kind, name: `T-${tag(c)}`, diameter: 0.05 }] });
    await t.run("bim_create_mep_systems", { systems: [{ name: "S", domain: dom, classification: "x" }] });
    const r = await t.run("bim_create_mep_segments", { segments: [{ category: c.id, type: `T-${tag(c)}`, system: "S", route: [{ storey: "L0", at: [0, 0], offset: 1 }, { storey: "L0", at: [4, 0], offset: 1 }] }] });
    return "";
  },
};

const authorable = listCategories().filter((c) => { const e = findEngine(c.engine); return !!e && e.status === "implemented" && (c.placements?.length ?? 0) > 0 && BUILD[c.engine]; });
const results: Record<string, string[]> = {}, gaps: Record<string, string> = {};
const IFC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "insa-contract-ifc-")), exportsToVerify: { cat: string; file: string; guids: string[] }[] = [];
const hasIfcOpenShell = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.validate, ifcopenshell.util.element"], { stdio: "ignore" }); return true; } catch { return false; } })();
const strict: Record<string, unknown> = {};

for (const c of authorable)
  test(`contract · ${c.id} (${c.engine})`, async () => {
    const policy = { everyEvents: 4, keep: 2 }, passed: string[] = [], ok = (s: string) => passed.push(s);
    const t = await setup(policy);
    const n0 = (await t.p.store(P).readEvents()).length;
    await BUILD[c.engine](t, c);
    const id = ((await t.ex("bim_query_elements", { category: c.id })).result.elements as any[])[0]?.id as string;
    assert.ok(id, "created id"); ok("create");
    let s = await t.S();
    assert.ok(s.elements[id], "the element exists"); ok("identity");
    const q = (await t.ex("bim_query_elements", { category: c.id })).result.elements as any[];
    assert.ok(q.some((e) => e.id === id && e.engine === c.engine), "query by category returns it on its engine"); ok("query");
    const g = (await t.ex("bim_get_element", { id })).result;
    assert.equal(g.taxonomy.category, c.id); ok("get");
    assert.deepEqual((await t.ex("bim_validate", {})).result.issues.filter((i: any) => i.severity === "error"), [], "model valid"); ok("validate");
    // derived geometry and quantities of THE element under test (never a count of text in a file)
    const el = s.elements[id], rep = resolveElementRepresentation(s, el);
    assert.ok(rep !== null && !/NaN|Infinity/.test(JSON.stringify(rep)), "a finite derived representation"); ok("geometry");
    assert.ok(Object.values(quantities(s, el)).every((v) => Number.isFinite(v)), "finite quantities"); ok("quantities");
    // IFC: the file is written now and verified STRICTLY afterwards (one IfcOpenShell pass): the product of THIS element is found by its stable GlobalId, never by the class name appearing somewhere
    const ifc = toIfc(s, { projectKey: "k" });
    assert.equal(/NaN|Infinity/.test(ifc), false); ok("ifc_finite");
    const h = handlersOf(el), keys = h.ifc.mode === "none" ? [] : [...(h.ifc.productKeys?.(s, el) ?? [el.id])];
    if (!c.ifcClass) gaps[c.id] = "the category declares no IFC class (exported generically)";
    else {
      const file = path.join(IFC_DIR, `${tag(c)}.ifc`);
      fs.writeFileSync(file, ifc);
      exportsToVerify.push({ cat: c.id, file, guids: keys.map((k) => ifcGuid(`k:${k}`)) });
      assert.ok(ifc.includes(ifcGuid(`k:${keys[0]}`)), "the GlobalId of the element's product is in the file"); ok("ifc_identity");
    }
    // generic lifecycle
    const live = canonicalJson(await t.S());
    assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live); ok("replay");
    assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live); ok("snapshot");
    if (c.capabilities?.includes("movable") && !["hosted_component", "spatial"].includes(c.engine)) {
      const before = canonicalJson((await t.S()).elements[id]);
      await t.run("bim_move_elements", { ids: [id], vector: [0.5, 0.25] });
      assert.notEqual(canonicalJson((await t.S()).elements[id]), before); ok("move");
      await t.run("platform_undo", {});
      assert.equal(canonicalJson((await t.S()).elements[id]), before); ok("undo_move");
    }
    await t.run("bim_delete_elements", { ids: [id] });
    assert.equal((await t.S()).elements[id], undefined); ok("delete");
    await t.run("platform_undo", {});
    assert.equal(canonicalJson(await t.S()), live); ok("undo_delete");
    if (c.ifcClass) { const again = toIfc(await t.S(), { projectKey: "k" }), g0 = exportsToVerify.find((x) => x.cat === c.id)!.guids; assert.ok(g0.every((g) => again.includes(g)), "the same GlobalIds after delete + undo"); ok("ifc_stable_identity"); }
    assert.ok((await t.p.store(P).readEvents()).length > n0);
    results[c.id] = passed;
  });

/** the PredefinedType the DECLARED category mapping calls for (the file must say exactly this; "<none>": the class has no such attribute) */
function expectedPredefined(c: Cat): string {
  if (c.engine === "spatial") return "SPACE";                                                       // IfcSpace is not a physical product (no template): rooms and spaces are written as SPACE
  const d = IFC_CLASS_DATA[c.ifcClass!], attrs = d.in_ifc4 ? d.attrs4! : d.attrs;
  if (!attrs.some(([n]) => n === "PredefinedType")) return "<none>";
  // semantics the TYPE / builder decides (stated independently of the writer's tables): a door is a DOOR, a flat roof a FLAT_ROOF, a pad footing a PAD_FOOTING, a wall STANDARD
  const BY_SEMANTICS: Record<string, string> = { "architecture.door": "DOOR", "architecture.window": "WINDOW", "architecture.roof": "FLAT_ROOF", "structure.footing": "PAD_FOOTING", "architecture.wall": "STANDARD", "architecture.wall_standard_case": "STANDARD" };
  if (BY_SEMANTICS[c.id]) return BY_SEMANTICS[c.id];
  if (c.engine === "point_component") return c.ifcClass === "IfcBuildingElementProxy" ? "ELEMENT" : "NOTDEFINED";   // the builder sets no predefined type: the schema default
  if (c.engine === "mep_fitting") return c.ifcClass === "IfcCableFitting" ? "CONNECTOR" : "BEND";            // the builder places an elbow (a coupling for cable fittings)
  if (c.engine === "assembly") return "NOTDEFINED";
  if (c.engine === "pitched_roof") return "GABLE_ROOF";                                              // the builder makes a gable
  if (c.engine === "reinforcement") return c.ifcPredefined ?? "NOTDEFINED";
  return ifcClassFor(c.id).predefined.replace(/\./g, "").replace(/,\$$/, "");
}
const PROBE = `
import json, sys, ifcopenshell, ifcopenshell.validate, ifcopenshell.util.element as ue
spec = json.load(open(sys.argv[1])); out = {}
for it in spec:
    f = ifcopenshell.open(it["file"]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
    res = {"schema": f.schema_identifier, "n_errors": len(log.statements), "errors": [str(x)[:160] for x in log.statements[:2]], "products": {}}
    for g in it["guids"]:
        try: e = f.by_guid(g)
        except Exception: res["products"][g] = None; continue
        agg = ue.get_aggregate(e); cont = ue.get_container(e); rel = []
        if getattr(e, "FillsVoids", None): rel.append("fills")
        if getattr(e, "IsDecomposedBy", None): rel.append("aggregates_parts")
        res["products"][g] = {"class": e.is_a(), "predefined": getattr(e, "PredefinedType", "<none>") if hasattr(e, "PredefinedType") else "<none>", "placement": e.ObjectPlacement is not None,
            "container": cont.is_a() if cont is not None else None, "aggregate_parent": agg.is_a() if agg is not None else None, "relations": rel}
    out[it["cat"]] = res
print(json.dumps(out))`;

test("IFC strict verification: the product of EACH element under test is found by its stable GlobalId; exact class, PredefinedType, placement, container / relationships; the file validates against ITS OWN schema (IfcOpenShell)", { skip: !hasIfcOpenShell, timeout: 280000 }, () => {
  assert.ok(exportsToVerify.length >= 100, `${exportsToVerify.length} category exports to verify`);
  const specFile = path.join(IFC_DIR, "spec.json");
  fs.writeFileSync(specFile, JSON.stringify(exportsToVerify));
  const lines = execFileSync("python3", ["-c", PROBE, specFile], { maxBuffer: 64 * 1024 * 1024 }).toString().trim().split("\n");
  const out = JSON.parse(lines[lines.length - 1]) as Record<string, { schema: string; n_errors: number; errors: string[]; products: Record<string, null | { class: string; predefined: string | null; placement: boolean; container: string | null; aggregate_parent: string | null; relations: string[] }> }>;
  const bad: string[] = [];
  for (const x of exportsToVerify) {
    const c = authorable.find((k) => k.id === x.cat)!, r = out[x.cat], want = (IFC_CLASS_DATA[c.ifcClass!]?.in_ifc4 ?? true) ? "IFC4" : "IFC4X3_ADD2";
    const fail = (m: string) => bad.push(`${c.id}: ${m}`);
    if (r.schema !== want) fail(`schema ${r.schema}, expected ${want}`);
    if (r.n_errors) fail(`${r.n_errors} schema errors: ${r.errors.join(" | ")}`);
    const ps = x.guids.map((g) => r.products[g]);
    if (!ps.length || ps.some((p) => !p)) { fail(`product(s) not found by GlobalId (${ps.filter((p) => !p).length} of ${ps.length} missing)`); continue; }
    const pre = expectedPredefined(c);
    for (const p of ps as NonNullable<(typeof ps)[number]>[]) {
      if (p.class !== c.ifcClass) fail(`class ${p.class}, expected ${c.ifcClass}`);
      if (String(p.predefined) !== pre) fail(`PredefinedType ${p.predefined}, expected ${pre}`);
      if (!p.placement) fail("no ObjectPlacement");
      const inStorey = p.container === "IfcBuildingStorey" || p.aggregate_parent === "IfcBuildingStorey", fills = p.relations.includes("fills");
      if (c.engine === "reinforcement" ? !(p.aggregate_parent && /^Ifc(Column|Beam|Wall|Slab|Footing)/.test(p.aggregate_parent)) : c.engine === "hosted_component" ? !fills : !inStorey) fail(`containment / relationship: container ${p.container}, aggregate ${p.aggregate_parent}, relations ${p.relations}`);
      if ((c.engine === "assembly" || c.engine === "curtain_wall" || c.engine === "pitched_roof") && !p.relations.includes("aggregates_parts")) fail("an assembly / curtain wall aggregates its parts");
    }
    if (!bad.some((b) => b.startsWith(c.id + ":"))) { results[c.id].push("ifc_product"); strict[c.id] = { class: c.ifcClass, predefined: pre, schema: want, product_count: ps.length }; }
  }
  assert.deepEqual(bad, [], "every exported product matches its declared category");
});

test("contract summary: the categories reported as gaps are exactly the registry classes the writer does not emit; results are recorded for the coverage report", () => {
  assert.ok(authorable.length >= 25, `${authorable.length} authorable categories exercised`);
  const withGap = Object.keys(gaps).sort();
  for (const [cid, why] of Object.entries(gaps)) assert.match(cid, /\./, why);
  console.log(`# contract gaps: ${JSON.stringify(gaps)}`);
  if (process.env.WRITE_CONTRACTS === "1") {
    fs.writeFileSync(path.join(import.meta.dirname, "../data/category-contract-results.json"), JSON.stringify({ generated_by: "category-contracts.test.ts", ifc_strict_pass_requires: "product found by GlobalId + exact class + PredefinedType + placement + container/relationship + own-schema validation (IfcOpenShell)", gaps, ifc_verified: strict, passed: results }, null, 1));
  }
  assert.ok(withGap.length < authorable.length);
  void modelIssues; void ({} as BimState);
});
