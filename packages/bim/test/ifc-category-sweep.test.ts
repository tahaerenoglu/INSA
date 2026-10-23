/** Phase 14 · the large category sweep: one product of EVERY schema-derived / point-component category, exported and validated by IfcOpenShell. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { listCategories, toIfc } from "../src/index.js";
import { IFC_CLASS_DATA } from "../src/ifc-schema-data.js";
import { setup } from "./authoring-fixture.js";

const PYTHON = process.env.INSA_PYTHON ?? "python3";
const hasIfc = (() => { try { execFileSync(PYTHON, ["-c", "import ifcopenshell, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const PROBE = `
import json, sys, ifcopenshell, ifcopenshell.validate, collections
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
cnt = collections.Counter(); pre = {}
for e in f.by_type("IfcElement"):
    cnt[e.is_a()] += 1; pre[e.Tag] = [e.is_a(), getattr(e, "PredefinedType", None)]
print(json.dumps({"schema": f.schema_identifier, "errors": [str(x)[:200] for x in log.statements[:5]], "n_errors": len(log.statements), "counts": cnt, "pre": pre}))`;
const probe = (txt: string) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-sweep-")), "m.ifc"); fs.writeFileSync(f, txt); return JSON.parse(execFileSync(PYTHON, ["-c", PROBE, f]).toString()) as { schema: string; errors: string[]; n_errors: number; counts: Record<string, number>; pre: Record<string, [string, string | null]> }; };

/** every point-component category whose class has a schema template written natively (not the legacy furniture / proxy path) */
const cats = listCategories().filter((c) => c.engine === "point_component" && c.ifcClass && c.ifcClass !== "IfcFurniture" && c.ifcClass !== "IfcBuildingElementProxy" && IFC_CLASS_DATA[c.ifcClass]?.generic);
const tag = (c: { id: string }) => c.id.replace(/\W/g, "_");
async function model(subset: typeof cats) {
  const t = await setup();
  await t.run("bim_create_families", { families: subset.map((c) => ({ name: `F-${tag(c)}`, category: c.id, parameters: [{ key: "w", name: "w", scope: "type", dataType: "length", required: true }], representation: { kind: "box", width: "w", depth: "w", height: "w" } })) });
  const pick = (c: (typeof cats)[number]) => (c.ifcPredefinedValues ?? []).find((v) => v !== "NOTDEFINED" && v !== "USERDEFINED");
  await t.run("bim_create_types", { types: subset.map((c) => ({ kind: "component", name: `T-${tag(c)}`, family: `F-${tag(c)}`, parameters: { w: 0.4 }, ...(pick(c) ? { predefined_type: pick(c) } : {}) })) });
  await t.run("bim_create_components", { components: subset.map((c, i) => ({ type: `T-${tag(c)}`, storey: "L0", x: (i % 12) * 2, y: Math.floor(i / 12) * 2, offset: 0 })) });
  return { t, pick };
}

test("sweep: every schema-derived category exports its REAL IFC class and valid PredefinedType; the whole model validates under IFC4.3 (IfcOpenShell: 0 schema errors)", { skip: !hasIfc, timeout: 250000 }, async () => {
  assert.ok(cats.length >= 80, `${cats.length} categories swept`);
  const { t, pick } = await model(cats);
  const s = await t.S(), txt = toIfc(s, { projectKey: "sweep" });
  assert.match(txt, /FILE_SCHEMA\(\('IFC4X3_ADD2'\)\)/, "auto: the model holds IFC4.3-only classes");
  const r = probe(txt);
  assert.deepEqual([r.schema, r.n_errors, r.errors], ["IFC4X3_ADD2", 0, []]);
  const want: Record<string, number> = {};
  for (const c of cats) want[c.ifcClass!] = (want[c.ifcClass!] ?? 0) + 1;
  assert.deepEqual(r.counts, want, "one product per category, of exactly its class (no proxy)");
  const comps = Object.values(s.elements).filter((e) => e.kind === "component");
  for (const e of comps) {
    const cat = cats.find((c) => s.families[(s.types[(e as any).type] as any).family].category === c.id)!;
    assert.deepEqual(r.pre[e.id], [cat.ifcClass, pick(cat) ?? (cat.ifcPredefinedValues ? "NOTDEFINED" : null)], `${e.id} ${cat.id}`);   // a class without a PredefinedType attribute has none
  }
  assert.equal(/IFCBUILDINGELEMENTPROXY/.test(txt), false, "no category is falsely written as a proxy");
});

test("schema selection: the IFC4-valid subset exports under an IFC4 header with 0 schema errors; an explicit IFC4 export of a model with an IFC4.3-only class is refused; an invalid PredefinedType is refused", { skip: !hasIfc, timeout: 250000 }, async () => {
  const only43 = cats.filter((c) => !IFC_CLASS_DATA[c.ifcClass!].in_ifc4);
  assert.ok(only43.length >= 5, "IFC4.3-only categories exist");
  const sub = cats.filter((c) => IFC_CLASS_DATA[c.ifcClass!].in_ifc4);
  const a = await model(sub), s4 = await a.t.S(), txt4 = toIfc(s4, { projectKey: "sweep4" });
  assert.match(txt4, /FILE_SCHEMA\(\('IFC4'\)\)/);
  const r4 = probe(txt4);
  assert.deepEqual([r4.schema, r4.n_errors, r4.errors], ["IFC4", 0, []]);
  const body = (t: string) => t.split("\n").filter((l) => !l.startsWith("FILE_NAME")).join("\n");   // the header carries a time stamp
  assert.equal(body(toIfc(s4, { projectKey: "sweep4", schema: "IFC4" })), body(txt4), "explicit IFC4 == auto for an IFC4 model");
  const b = await model([...sub.slice(0, 3), only43[0]]), sb = await b.t.S();
  assert.throws(() => toIfc(sb, { projectKey: "x", schema: "IFC4" }), (e: any) => e.reason === "UNSUPPORTED_IFC_SCHEMA");
  assert.match(toIfc(sb, { projectKey: "x" }), /IFC4X3_ADD2/);
  // PredefinedType comes from the schema enumeration; nothing else is accepted
  const c = cats.find((x) => x.ifcClass === "IfcBoiler")!;
  await a.t.run("bim_create_families", { families: [{ name: "FB", category: c.id, parameters: [], representation: { kind: "box", width: 0.5, depth: 0.5, height: 0.5 } }] }).catch(() => undefined);
  await a.t.rejected("bim_create_types", { types: [{ kind: "component", name: "BadPT", family: `F-${tag(c)}`, parameters: { w: 1 }, predefined_type: "NOT_A_BOILER_TYPE" }] }, "INVALID_PREDEFINED_TYPE");
  assert.ok(c.ifcPredefinedValues!.includes("STEAM") && c.ifcPredefinedValues!.includes("WATER"), "the values are the schema's");
});
