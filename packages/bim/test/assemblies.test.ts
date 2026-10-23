/** Phase 14 · assemblies (IfcElementAssembly): explicit, acyclic, single-parent aggregation; and a class without a PredefinedType attribute. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, toIfc, modelIssues } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const el = (s: BimState, id: string) => s.elements[id] as any;
async function truss(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [{ kind: "column", name: "C30", profile: { shape: "rect", b: 0.3, h: 0.3 } }, { kind: "beam", name: "B30", profile: { shape: "rect", b: 0.3, h: 0.4 } }, { kind: "wall", name: "W20", layers: [{ material: "Beton", thickness: 0.2 }] }, { kind: "door", name: "DR", width: 1, height: 2.1 }] });
  await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C30", points: [[0, 0], [6, 0]], height: 3 }, { category: "structure.framing", storey: "L0", type: "B30", start: [0, 0], end: [6, 0], z: 3 },
    { category: "structure.framing", storey: "L1", type: "B30", start: [0, 4], end: [6, 4], z: 3 }] });                       // C-0001, C-0002, B-0001 (L0), B-0002 (L1)
  return t;
}

test("assembly rules and lifecycle: members keep their identity; one parent, one storey, acyclic; deletion protection; moves with its members; undo / replay / snapshot", async () => {
  const policy = { everyEvents: 3, keep: 2 }, t = await truss(policy);
  const made = await t.run("bim_create_assemblies", { items: [{ children: ["C-0001", "C-0002", "B-0001"], name: "Frame A", predefined_type: "TRUSS" }] });          // AS-0001
  assert.deepEqual(made.summary.created, [{ id: "AS-0001", members: ["C-0001", "C-0002", "B-0001"] }]);
  let s = await t.S();
  assert.deepEqual([el(s, "AS-0001").kind, el(s, "AS-0001").storey === el(s, "C-0001").storey, quantities(s, el(s, "AS-0001")), el(s, "C-0001").category], ["assembly", true, { child_count: 3, descendant_count: 3 }, "structure.column"]);
  const q = (await t.ex("bim_query_elements", { category: "generic.element_assembly" })).result.elements;
  assert.deepEqual(q.map((e: any) => [e.id, e.engine]), [["AS-0001", "assembly"]]);
  await t.run("bim_create_assemblies", { items: [{ children: ["AS-0001"], name: "Module" }] });                                                                              // nested AS-0002
  assert.deepEqual(quantities(await t.S(), el(await t.S(), "AS-0002")), { child_count: 1, descendant_count: 4 });
  const rej = (children: string[], reason: string, extra: object = {}) => t.rejected("bim_create_assemblies", { items: [{ children, ...extra }] }, reason);
  await rej(["C-0001"], "INVALID_ASSEMBLY_RELATION");                                                                        // one parent per member
  await rej(["NOPE"], "ELEMENT_NOT_FOUND");
  await rej(["B-0002", "B-0001"], "INVALID_ASSEMBLY_RELATION");                                                                // members on different storeys (and B-0001 is taken)
  await rej(["B-0002"], "INVALID_PREDEFINED_TYPE", { predefined_type: "NOT_A_TYPE" });
  await t.run("bim_create_walls", { walls: [{ storey: "L0", type: "W20", start: [0, 9], end: [5, 9], height: 3 }] });
  await t.run("bim_place_openings", { items: [{ kind: "door", host: "W-0001", along: 2, type: "DR" }] });
  const door = (Object.values(await (async () => (await t.S()).elements)()).find((e: any) => e.kind === "hosted_component") as any).id;
  await rej([door], "INVALID_ASSEMBLY_RELATION");                                                                              // a door belongs to its wall
  await t.rejected("bim_update_elements", { items: [{ id: "AS-0001", kind: "assembly", set: { children: ["C-0001", "AS-0002"] } }] }, "INVALID_ASSEMBLY_RELATION");   // cyclic: AS-0002 contains AS-0001
  // deletion protection (no cascade) and release
  await t.rejected("bim_delete_elements", { ids: ["C-0001"] }, "ELEMENT_IN_USE");
  await t.rejected("bim_delete_elements", { ids: ["AS-0001"] }, "ELEMENT_IN_USE");                                              // it is a member of AS-0002
  // moving the OUTER assembly moves every descendant; the assemblies themselves have no geometry
  const at = el(await t.S(), "C-0001").at;
  const mv = await t.run("bim_move_elements", { ids: ["AS-0002"], vector: [1, 2] });
  assert.deepEqual(mv.summary.moved.sort(), ["AS-0001", "AS-0002", "B-0001", "C-0001", "C-0002"]);
  s = await t.S();
  assert.deepEqual([el(s, "C-0001").at, el(s, "C-0002").at, el(s, "B-0001").start], [[at[0] + 1, at[1] + 2], [7, 2], [1, 2]]);
  const live = canonicalJson(await t.S());
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live, "replay");
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot");
  await t.run("platform_undo", {});
  assert.deepEqual(el(await t.S(), "C-0001").at, at, "undo restored the members' positions");
  await t.run("bim_delete_elements", { ids: ["AS-0002"] });
  await t.run("bim_delete_elements", { ids: ["AS-0001"] });                                                                       // releases its members
  assert.deepEqual([!!(await t.S()).elements["C-0001"], !!(await t.S()).elements["B-0001"]], [true, true]);
  await t.run("bim_delete_elements", { ids: ["C-0001"] });
  assert.deepEqual(modelIssues(await t.S()), []);
  // a member's storey cannot change away from its assembly: refused atomically
  await t.run("bim_create_assemblies", { items: [{ children: ["C-0002", "B-0001"] }] });
  await t.rejected("bim_reassign_storey", { items: [{ id: "B-0001", storey: "L1" }] }, "DEPENDENT_ELEMENT_INVALID");
});

test("IFC: IfcElementAssembly aggregates its members (nested, children first); the members are parts (not separately contained); a class WITHOUT a PredefinedType attribute (IfcDeepFoundation) is written with the schema's 8 attributes (IfcOpenShell, 0 schema errors)", { skip: !hasIfc, timeout: 200000 }, async () => {
  const t = await truss();
  await t.run("bim_create_assemblies", { items: [{ children: ["C-0001", "C-0002", "B-0001"], name: "Frame A", predefined_type: "TRUSS" }] });
  await t.run("bim_create_assemblies", { items: [{ children: ["AS-0001"], name: "Module" }] });
  await t.run("bim_create_types", { types: [{ kind: "column", name: "DF", profile: { shape: "circle", d: 0.8 } }] });
  await t.run("bim_create_profile_members", { members: [{ category: "structure.deep_foundation", storey: "L0", type: "DF", at: [9, 9], length: 10 }] });
  const s = await t.S(), txt = toIfc(s, { projectKey: "as" });
  assert.match(txt, /FILE_SCHEMA\(\('IFC4X3_ADD2'\)\)/, "IfcDeepFoundation exists only in IFC4.3: auto selects it");
  assert.match(txt, /IFCDEEPFOUNDATION\(/);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-as-")), "m.ifc");
  fs.writeFileSync(f, txt);
  const out = JSON.parse(execFileSync("python3", ["-c", `
import json, sys, ifcopenshell, ifcopenshell.validate
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
asm = {a.Name: [a.PredefinedType, [o.Name or o.is_a() for o in sum([list(r.RelatedObjects) for r in a.IsDecomposedBy], [])]] for a in f.by_type("IfcElementAssembly")}
cont = sorted(e.is_a() + ":" + (e.Name or "") for r in f.by_type("IfcRelContainedInSpatialStructure") for e in r.RelatedElements)
df = [(d.is_a(), len(d.get_info(include_identifier=False)) - 1) for d in f.by_type("IfcDeepFoundation")]
print(json.dumps({"n": len(log.statements), "err": [str(x)[:200] for x in log.statements[:3]], "asm": asm, "contained": cont, "df": df}))`, f]).toString().trim().split("\n").pop()!) as { n: number; err: string[]; asm: Record<string, [string, string[]]>; contained: string[]; df: [string, number][] };
  assert.deepEqual([out.n, out.err], [0, []]);
  assert.deepEqual(out.asm["Module"], ["NOTDEFINED", ["Frame A"]]);
  assert.deepEqual([out.asm["Frame A"][0], out.asm["Frame A"][1].length], ["TRUSS", 3]);
  assert.ok(out.contained.some((c) => c.startsWith("IfcElementAssembly:Module")) && !out.contained.some((c) => ["IfcColumn:C-0001", "IfcColumn:C-0002", "IfcBeam:B-0001", "IfcElementAssembly:Frame A"].includes(c)), `only the top-level assembly is contained: ${out.contained}`);
  assert.deepEqual(out.df.map((d) => d[0]), ["IfcDeepFoundation"]);
});
