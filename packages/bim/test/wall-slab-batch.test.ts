import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores, type Actor } from "@insa/core";
import { bimModule, type BimState } from "../src/index.js";

const human: Actor = { id: "test", name: "Test", kind: "human", roles: ["bim_manager"] };
async function fixture(approvalMode: "auto" | "ai" = "auto", detach = true) {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores(), approvalMode, logger: { info() {}, warn() {} } });
  const run = (tool: string, input: unknown) => p.execute(human, "test", tool, input);
  await run("bim_create_storeys", { storeys: [{ name: "Base", elevation: 0 }, { name: "Top", elevation: 3.2 }] });
  await run("bim_create_types", { types: [{ kind: "wall", name: "Wall", layers: [{ material: "Brick", thickness: .2 }] }, { kind: "slab", name: "Slab", layers: [{ material: "Concrete", thickness: .2 }] }] });
  await run("bim_create_walls", { walls: [{ storey: "Base", type: "Wall", start: [0,0], end: [3,0] }, { storey: "Base", type: "Wall", start: [3,0], end: [3,3] }, { storey: "Base", type: "Wall", start: [3,3], end: [0,3] }] });
  if (detach) for (const join of Object.keys((await p.state<BimState>("test", "bim")).joins)) await run("bim_unjoin_walls", { join });
  return { p, run, state: () => p.state<BimState>("test", "bim") };
}
test("new walls join automatically inside their creation transaction", async () => {
  const { state } = await fixture("auto", false);
  assert.equal(Object.keys((await state()).joins).length, 2);
});
test("new crossing walls reject the entire creation transaction", async () => {
  const { run, state } = await fixture();
  const before = JSON.stringify(await state());
  await assert.rejects(run("bim_create_walls", { walls: [{ storey: "Base", type: "Wall", start: [2,1], end: [4,1] }] }), (e: any) => e.reason === "WALL_INTERSECTION");
  assert.equal(JSON.stringify(await state()), before);
});
test("fixed-height walls and columns fit floors during creation in fresh projects", async () => {
  const { run, state } = await fixture();
  await run("bim_create_slabs", { slabs: [{ storey: "Base", type: "Slab", offset: .1, outline: [[-1,-1],[4,-1],[4,4],[-1,4]] }, { storey: "Top", type: "Slab", outline: [[-1,-1],[4,-1],[4,4],[-1,4]] }] });
  await run("bim_create_types", { types: [{ kind: "column", name: "Column", profile: { shape: "rect", b: .2, h: .2 } }] });
  await run("bim_create_columns", { columns: [{ storey: "Base", type: "Column", at: [1,1], height: 3.2 }] });
  await run("bim_create_walls", { walls: [{ storey: "Base", type: "Wall", start: [0,1], end: [3,1], height: 3.2 }] });
  const s = await state();
  for (const e of [s.elements["W-0004"], ...Object.values(s.elements).filter(e => e.kind === "profile_member")]) {
    assert.equal((e as any).baseOffset, .1); assert.equal((e as any).height, 2.9);
  }
});
test("slabs created after walls bound heights, and removal restores storey constraint", async () => {
  const { run, state } = await fixture();
  await run("bim_create_slabs", { slabs: [{ storey: "Base", type: "Slab", outline: [[-1,-1],[4,-1],[4,4],[-1,4]], offset: .1 }, { storey: "Top", type: "Slab", outline: [[-1,-1],[4,-1],[4,4],[-1,4]] }] });
  const w: any = (await state()).elements["W-0001"];
  assert.equal(w.baseOffset, .1); assert.equal(w.height, 2.9);
  await run("bim_delete_elements", { ids: ["S-0002"] });
  assert.equal(((await state()).elements["W-0001"] as any).height, 3.1);
});
test("columns follow slab top/underside and later slab edits, excluding slab holes", async () => {
  const { run, state } = await fixture();
  await run("bim_create_types", { types: [{ kind: "column", name: "Column", profile: { shape: "rect", b: .2, h: .2 } }] });
  await run("bim_create_columns", { columns: [{ storey: "Base", type: "Column", at: [1,1], top_storey: "Top" }, { storey: "Base", type: "Column", at: [2,2], top_storey: "Top" }] });
  await run("bim_create_slabs", { slabs: [{ storey: "Base", type: "Slab", offset: .1, outline: [[-1,-1],[4,-1],[4,4],[-1,4]] }, { storey: "Top", type: "Slab", outline: [[-1,-1],[4,-1],[4,4],[-1,4]], holes: [[[1.5,1.5],[2.5,1.5],[2.5,2.5],[1.5,2.5]]] }] });
  const columns = () => state().then(s => Object.values(s.elements).filter(e => e.kind === "profile_member") as any[]);
  assert.equal((await columns())[0].baseOffset, .1);
  assert.equal((await columns())[0].height, 2.9);
  assert.equal((await columns())[1].height, 3.1);
  await run("bim_update_elements", { items: [{ kind: "slab", id: "S-0002", set: { offset: .3 } }] });
  assert.equal((await columns())[0].height, 3.2);
});
test("AI batch produces one proposal and one approval applies every join", async () => {
  const { p, state } = await fixture("ai");
  const ai: Actor = { id: "codex", name: "Codex", kind: "ai", roles: ["ai_agent"] };
  const result: any = await p.execute(ai, "test", "bim_join_walls_batch", { joins: [
    { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0001", endpoint: "end" }, { wall: "W-0002", endpoint: "start" }] },
    { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0002", endpoint: "end" }, { wall: "W-0003", endpoint: "start" }] },
  ] });
  assert.equal(result.status, "proposed");
  assert.equal((await p.store("test").readProposals()).length, 1);
  assert.equal(Object.keys((await state()).joins).length, 0);
  await p.approve(human, "test", result.proposalId);
  assert.equal(Object.keys((await state()).joins).length, 2);
});
test("batch wall joins apply together and invalid batch changes nothing", async () => {
  const { run, state } = await fixture();
  const join = (a: string, b: string) => ({ kind: "endpoint_endpoint", endpoints: [{ wall: a, endpoint: "end" }, { wall: b, endpoint: "start" }] });
  const before = JSON.stringify(await state());
  await assert.rejects(run("bim_join_walls_batch", { joins: [join("W-0001", "W-0002"), join("W-0002", "missing")] }));
  assert.equal(JSON.stringify(await state()), before);
  await run("bim_join_walls_batch", { joins: [join("W-0001", "W-0002"), join("W-0002", "W-0003")] });
  assert.equal(Object.keys((await state()).joins).length, 2);
});
