import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Platform, MemoryStores, PostgresStores, StoreProvider, ModuleDef, Actor, DomainError, PermissionError, can } from "../src/index.js";

interface S { items: Record<string, number>; }
const demo: ModuleDef<S> = {
  id: "demo", title: "Demo",
  initialState: () => ({ items: {} }),
  apply(s, e) {
    if (e.type === "Set") s.items[e.payload.key] = e.payload.value;
    if (e.type === "Add") s.items[e.payload.key] = (s.items[e.payload.key] ?? 0) + e.payload.by;
    return s;
  },
  validate(s) { if (Object.values(s.items).some((v) => v < 0)) throw new DomainError("negative"); },
  tools: [
    { kind: "command", effect: "write", module: "demo", name: "demo_set", title: "", description: "", permission: "bim.write",
      input: z.object({ key: z.string(), value: z.number() }), decide: (_s, i) => ({ events: [{ type: "Set", payload: i }], summary: i }) },
    // a decision that depends on the current state (to test re-decide on conflict)
    { kind: "command", effect: "write", module: "demo", name: "demo_increment", title: "", description: "", permission: "bim.write",
      input: z.object({ key: z.string() }), decide: (s, i) => ({ events: [{ type: "Set", payload: { key: i.key, value: (s.items[i.key] ?? 0) + 1 } }], summary: i }) },
    { kind: "query", effect: "read", module: "demo", name: "demo_get", title: "", description: "", permission: "bim.read",
      input: z.object({}), run: (c) => c.state.items },
  ],
};
const ai: Actor = { id: "claude", name: "Claude", kind: "ai", roles: ["ai_agent"] };
const human: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const viewer: Actor = { id: "v", name: "Viewer", kind: "human", roles: ["viewer"] };
const mk = (mode: "auto" | "ai" = "auto", stores: StoreProvider = new MemoryStores()) => new Platform({ modules: [demo], stores, approvalMode: mode });
const items = async (p: Platform, pr = "p1") => (await p.state<S>(pr, "demo")).items;

test("wildcard permissions", () => {
  assert.ok(can(human, "bim.delete")); assert.ok(!can(ai, "platform.approve")); assert.ok(can({ ...ai, roles: ["admin"] }, "x.y"));
});

test("auto mode applies; state is event-sourced", async () => {
  const p = mk();
  assert.equal((await p.execute(ai, "p1", "demo_set", { key: "a", value: 2 })).status, "applied");
  assert.deepEqual(((await p.execute(ai, "p1", "demo_get", {})) as any).result, { a: 2 });
});

test("dry run changes nothing; invariant violations are rejected", async () => {
  const p = mk();
  assert.equal((await p.execute(ai, "p1", "demo_set", { key: "a", value: 1 }, { dryRun: true })).status, "preview");
  assert.deepEqual(await items(p), {});
  await assert.rejects(p.execute(ai, "p1", "demo_set", { key: "a", value: -1 }), /negative/);
});

test("permissions are enforced and denials audited", async () => {
  const p = mk();
  await assert.rejects(p.execute(viewer, "p1", "demo_set", { key: "a", value: 1 }), PermissionError);
  assert.equal((await p.store("p1").readAudit())[0].outcome, "denied");
});

test("ai mode: proposal -> four-eyes -> approval re-validates and applies", async () => {
  const p = mk("ai");
  const r: any = await p.execute(ai, "p1", "demo_set", { key: "a", value: 5 });
  assert.equal(r.status, "proposed");
  assert.deepEqual(await items(p), {});
  await assert.rejects(p.approve(ai, "p1", r.proposalId), PermissionError);
  assert.equal(((await p.approve(human, "p1", r.proposalId)) as any).status, "applied");
  assert.deepEqual(await items(p), { a: 5 });
  const h = await p.history("p1");
  assert.equal(h[0].actor, "claude"); assert.equal(h[0].proposalId, r.proposalId);
  const r2: any = await p.execute(ai, "p1", "demo_set", { key: "b", value: 1 });
  await p.reject(human, "p1", r2.proposalId, "not needed");
  assert.equal((await p.store("p1").readProposals()).find((x) => x.id === r2.proposalId)!.status, "rejected");
});

test("undo reverts only the latest command", async () => {
  const p = mk();
  const a: any = await p.execute(ai, "p1", "demo_set", { key: "a", value: 1 });
  const b: any = await p.execute(ai, "p1", "demo_set", { key: "a", value: 9 });
  await assert.rejects(p.execute(ai, "p1", "platform_undo", { command_id: a.commandId }), /latest/);
  await p.execute(ai, "p1", "platform_undo", {});
  assert.deepEqual(await items(p), { a: 1 });
  const h = await p.history("p1");
  assert.equal(h[0].tool, "platform_undo");                               // the undo is itself a recorded command
  assert.equal(h.find((x) => x.commandId === b.commandId)!.reverted, true);
});

test("optimistic concurrency: two platforms (= two processes) never lose an update", async () => {
  const stores = new MemoryStores();
  const p1 = mk("auto", stores), p2 = mk("auto", stores);
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? p1 : p2).execute(ai, "p1", "demo_increment", { key: "n" })));
  assert.equal((await items(p1)).n, 20);
  assert.equal((await items(p2)).n, 20);
});

const PG = process.env.INSA_PG_URL;
test("PostgreSQL store: persistence, concurrency across pools, NOTIFY", { skip: !PG }, async () => {
  const sA = new PostgresStores(PG!), sB = new PostgresStores(PG!);
  const project = "t" + Date.now();
  try {
    const pA = mk("ai", sA), pB = mk("ai", sB);
    let notified = 0;
    const unsub = sB.subscribe!(project, () => notified++);
    await new Promise((r) => setTimeout(r, 300));
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? pA : pB).execute(human, project, "demo_increment", { key: "n" })));
    assert.equal((await items(pA, project)).n, 12);
    assert.equal((await items(pB, project)).n, 12);
    const r: any = await pA.execute(ai, project, "demo_set", { key: "z", value: 7 });
    await pB.approve(human, project, r.proposalId);              // approved from "another process"
    assert.equal((await items(pA, project)).z, 7);
    await pA.execute(human, project, "platform_undo", {});
    assert.equal((await items(pB, project)).z, undefined);
    assert.ok((await sA.listProjects()).includes(project));
    assert.ok((await pB.store(project).readAudit(5)).some((a) => a.outcome === "approved"));
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(notified >= 12, `notifications: ${notified}`);
    unsub();
  } finally {
    await sA.close(); await sB.close();
  }
});

test("an AI never approves and never bypasses approval, even with admin roles", async () => {
  const p = mk("ai");
  const aiAdmin: Actor = { id: "ai:boss", name: "Asistan", kind: "ai", roles: ["admin"] };
  const r: any = await p.execute(aiAdmin, "p1", "demo_set", { key: "a", value: 1 });
  assert.equal(r.status, "proposed");
  const r2: any = await p.execute(ai, "p1", "demo_set", { key: "b", value: 2 });
  await assert.rejects(p.approve(aiAdmin, "p1", r2.proposalId), /AI actor cannot approve/);
  await assert.rejects(p.reject(aiAdmin, "p1", r2.proposalId), /AI actor cannot reject/);
});
