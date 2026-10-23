/** Phase 10 · the web layer after authoring edits: model tree, element detail, plan, IFC, undo. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores } from "@insa/core";
import { bimModule } from "@insa/bim";
import { buildApp } from "../src/app.js";

test("split / merge / trim over HTTP keep the model tree, the element detail, the plan and the IFC consistent", async () => {
  const platform = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  const app = buildApp({ platform });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { user: "taha" } })).json().token as string;
  const call = (method: "GET" | "POST", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
  const tool = async (name: string, input: unknown) => { const r = await call("POST", `/api/projects/ofis/tools/${name}`, { input }); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const tree = async () => (await call("GET", "/api/projects/ofis/tree")).json();
  const wallIds = async () => ((await tree())[0].groups.wall as { id: string }[]).map((w) => w.id).sort();

  await tool("bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
  await tool("bim_create_types", { types: [{ kind: "wall", name: "DD", layers: [{ material: "Tuğla", thickness: 0.2 }] }, { kind: "window", name: "P", width: 1, height: 1.2 }] });
  await tool("bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [0, 0], end: [10, 0], height: 3 }, { storey: "00", type: "DD", start: [4, -1], end: [4, 5], height: 3 }] });
  await tool("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 8, type: "P" }] });
  assert.deepEqual(await wallIds(), ["W-0001", "W-0002"]);
  const tools = (await call("GET", "/api/tools")).json();
  for (const n of ["bim_split_wall", "bim_merge_walls", "bim_trim_wall", "bim_extend_wall"]) assert.ok(tools.some((x: any) => x.name === n), `${n} is in the tool catalogue`);

  await tool("bim_split_wall", { wall: "W-0001", t: 0.5 });
  assert.deepEqual(await wallIds(), ["W-0001", "W-0002", "W-0003"], "the new half appears in the model tree");
  const moved = (await call("GET", "/api/projects/ofis/elements/O-0001")).json();
  assert.equal(moved.host, "W-0003", "the selected element is still queryable and now hosted by the new half");
  assert.equal((await call("GET", "/api/projects/ofis/elements/W-0003")).statusCode, 200);
  await tool("bim_merge_walls", { walls: ["W-0001", "W-0003"] });
  assert.deepEqual(await wallIds(), ["W-0001", "W-0002"], "the merged-away wall disappears from the tree");
  assert.equal((await call("GET", "/api/projects/ofis/elements/W-0003")).statusCode >= 400, true);
  await tool("bim_trim_wall", { wall: "W-0002", endpoint: "start", target: "W-0001" });
  const w2 = (await call("GET", "/api/projects/ofis/elements/W-0002")).json();
  assert.deepEqual(w2.start, [4, 0]);
  assert.equal(w2.representation.ends.start, "tee_branch", "the derived end condition is part of the element detail");
  const plan = await call("GET", "/api/projects/ofis/plan/00.png");
  assert.equal(plan.statusCode, 200);
  const ifc = await call("GET", "/api/projects/ofis/model.ifc");
  assert.equal(ifc.statusCode, 200);
  assert.equal(((ifc.body.match(/IFCWALL\(/g) ?? []).length), 2);
  const undo = await call("POST", "/api/projects/ofis/undo");
  assert.equal(undo.statusCode, 200, undo.body);
  assert.equal((await call("GET", "/api/projects/ofis/elements/W-0002")).json().start[1], -1, "undo of the trim restored the wall");
});
