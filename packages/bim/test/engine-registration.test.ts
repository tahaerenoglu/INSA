/**
 * Phase 14 · Milestone A: a NEW engine plugs in through the typed registry alone. The test engine below registers an engine, a category and its handlers
 * (validation, derived placement / representation, signature, quantities, references, dependencies, translation, plan extent, IFC writer) and is then
 * validated, queried, quantified, referenced, moved and exported by the EXISTING lifecycle modules without a single edit to dispatch / invariants /
 * resources / model / tools / plan / ifc. A registered engine whose element kind has no handlers fails loudly (mutation: registration omission).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "@insa/core";
import { registerEngine, unregisterEngine, registerCategory, defineHandlers, undefineHandlers, handlersOf, quantities, toIfc, elementReferences, elementLabel,
         placementOf, resolveElementRepresentation, duplicateSignature, checkElement, BimState, Element } from "../src/index.js";
import { ifcGuid } from "../src/geo.js";
import { setup } from "./authoring-fixture.js";

declare module "../src/engines/registry.js" {
  interface ExtensionEngines { test_marker: true; test_orphan: true }
  interface ExtensionPlacements { marker_point: true }
}
interface Marker { kind: "test_marker"; id: string; storey: string; category: string; at: [number, number]; target?: string; name?: string }
const asEl = (m: Marker) => m as unknown as Element;

registerEngine({ id: "test_marker", name: "Test marker", status: "implemented", elementKind: "test_marker", placements: ["marker_point"], representations: ["marker"], typeFamilies: [], authoringLevel: 1,
  operations: ["create", "move", "delete"], description: "test-only engine" });
registerCategory({ id: "generic.test_marker", name: "Test markers", discipline: "generic", engine: "test_marker", placements: ["marker_point"], capabilities: ["levelBased", "movable"], ifcClass: "IfcBuildingElementProxy" });
defineHandlers<Marker>({
  kind: "test_marker", placementKind: () => "marker_point", semanticLabel: true,
  placement: (_s, el) => ({ kind: "marker_point", storey: el.storey, at: el.at }), representation: (_s, el) => ({ kind: "marker", at: el.at }),
  signature: (_s, el, cat) => JSON.stringify([cat, el.storey, el.at]),
  validate: (s, el, d) => {
    if (!el.at.every(Number.isFinite)) throw new DomainError(`${el.id}: at must be finite`, "INVALID_GEOMETRY", d);
    if (el.target && !s.elements[el.target]) throw new DomainError(`${el.id}: target ${el.target} does not exist`, "INVALID_REFERENCE", d);
  },
  quantities: () => ({ marker: 1 }),
  dependsOn: (_s, el) => (el.target ? [el.target] : []),
  references: (el) => (el.target ? [{ target: el.target, ref: { kind: "dependent" as const, id: el.id } }] : []),
  translate: (el, dx, dy, r) => ({ at: [r(el.at[0] + dx), r(el.at[1] + dy)] }),
  planBounds: (_s, el) => [el.at],
  plan: { mode: "none", reason: "test engine" },
  ifc: { mode: "writer", write: (c, els) => { for (const el of els) { const ref = c.add("IFCBUILDINGELEMENTPROXY", `${c.gid(el.id)},$,${c.str(el.id)},$,$,${c.placement(c.storeyPlacement(el.storey), c.identity)},$,${c.str(el.id)},.ELEMENT.`); c.elRef[el.id] = ref; c.contain(el as unknown as Element, ref); } } },
});
after(() => { unregisterEngine("test_marker"); undefineHandlers("test_marker"); });

async function state(): Promise<{ s: BimState; wallId: string }> {
  const t = await setup();
  await t.run("bim_create_types", { types: [{ kind: "wall", name: "W20", layers: [{ material: "Beton", thickness: 0.2 }] }] });
  await t.run("bim_create_walls", { walls: [{ storey: "L0", type: "W20", start: [0, 0], end: [5, 0], height: 3 }] });
  const s = await t.S();
  return { s, wallId: Object.values(s.elements).find((e) => e.kind === "wall")!.id };
}

test("a registered engine is validated, quantified, labelled, referenced, signed, moved and exported by the EXISTING lifecycle modules", async () => {
  const { s, wallId } = await state();
  const m: Marker = { kind: "test_marker", id: "TM-1", storey: Object.values(s.storeys)[0].id, category: "generic.test_marker", at: [2, 3], target: wallId };
  s.elements[m.id] = asEl(m);
  assert.doesNotThrow(() => checkElement(s, asEl(m)));
  assert.deepEqual(quantities(s, asEl(m)), { marker: 1 });
  assert.equal(elementLabel(s, asEl(m)), "generic.test_marker");                                                             // semantic label: never the storage variant
  assert.deepEqual([placementOf(s, asEl(m)).kind, (resolveElementRepresentation(s, asEl(m)) as { kind: string }).kind], ["marker_point", "marker"]);
  assert.deepEqual(elementReferences(s, wallId).map((r) => [r.kind, r.id]), [["dependent", "TM-1"]], "delete protection sees the engine's references");
  // duplicate detection (bim_validate) reads the engine's signature: same place = same key, another place = another key
  const twin = asEl({ ...m, id: "TM-2" }), other = asEl({ ...m, id: "TM-5", at: [9, 9] });
  assert.equal(duplicateSignature(s, twin), duplicateSignature(s, asEl(m)));
  assert.notEqual(duplicateSignature(s, other), duplicateSignature(s, asEl(m)));
  // the engine's own validation rule is enforced by the generic path
  s.elements["TM-3"] = asEl({ ...m, id: "TM-3", at: [8, 8], target: "NOPE" });
  assert.throws(() => checkElement(s, s.elements["TM-3"]), (e: any) => e.reason === "INVALID_REFERENCE");
  assert.throws(() => checkElement(s, asEl({ ...m, id: "TM-4", at: [NaN, 1] })), (e: any) => e.reason === "INVALID_GEOMETRY");
  delete s.elements["TM-3"];
  // translation and plan extent come from the handlers
  assert.deepEqual(handlersOf(asEl(m)).translate!(asEl(m), 1, 1, (n) => n), { at: [3, 4] });
  assert.deepEqual(handlersOf(asEl(m)).planBounds!(s, asEl(m)), [[2, 3]]);
  // IFC: the engine's writer ran, and the enforced export contract holds
  const txt = toIfc(s, { projectKey: "reg" });
  assert.ok(txt.includes(ifcGuid("reg:TM-1")), "the engine's product carries the stable GlobalId");
  assert.match(txt, /IFCBUILDINGELEMENTPROXY\('[^']+',\$,'TM-1'/);
});

test("mutation: an engine registered WITHOUT handlers fails loudly (never a silent default); a duplicate registration is refused; unregistering removes the engine", async () => {
  registerEngine({ id: "test_orphan", name: "Orphan", status: "implemented", elementKind: "test_orphan", placements: ["marker_point"], representations: [], typeFamilies: [], authoringLevel: 0, operations: ["create"], description: "no handlers" });
  try {
    const { s } = await state();
    const orphan = { kind: "test_orphan", id: "TO-1", storey: Object.values(s.storeys)[0].id } as unknown as Element;
    assert.throws(() => handlersOf(orphan), /no engine handlers registered for element kind 'test_orphan'/);
    s.elements["TO-1"] = orphan;
    assert.throws(() => checkElement(s, orphan), (e: any) => e.reason === "UNKNOWN_ENGINE" || /no engine/i.test(String(e.message)));
    assert.throws(() => registerEngine({ id: "test_orphan", name: "x", status: "implemented", elementKind: "other", placements: [], representations: [], typeFamilies: [], authoringLevel: 0, operations: [], description: "" }), /already registered/);
    assert.throws(() => registerEngine({ id: "test_marker", name: "x", status: "implemented", elementKind: "wall", placements: [], representations: [], typeFamilies: [], authoringLevel: 0, operations: [], description: "" }), /already registered|already owned/);
    assert.throws(() => defineHandlers<Marker>({ ...(handlersOf(asEl({ kind: "test_marker", id: "x", storey: "s", category: "c", at: [0, 0] })) as never) }), /already registered/);
  } finally { assert.equal(unregisterEngine("test_orphan"), true); }
  assert.equal(unregisterEngine("wall"), false, "a built-in engine can never be unregistered");
});
