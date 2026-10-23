/**
 * Phase 1 regression tests (Core level, no adapters):
 *   undo governance · canonical project ids · storage isolation · atomic approval
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Platform, MemoryStores, FileStores, PostgresStores, StoreProvider, Actor, DomainError, PermissionError,
  parseProjectId, isValidProjectId, ArtifactStore, publicError,
} from "../src/index.js";
import { demo, decided, DemoState } from "./fixtures/demo.js";

const ai: Actor = { id: "claude", name: "Claude", kind: "ai", roles: ["ai_agent"] };
const aiAdmin: Actor = { id: "ai:boss", name: "Asistan", kind: "ai", roles: ["admin"] };
const manager: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const manager2: Actor = { id: "ayse", name: "Ayşe", kind: "human", roles: ["bim_manager"] };
const viewer: Actor = { id: "v", name: "Viewer", kind: "human", roles: ["viewer"] };
const mk = (mode: "auto" | "ai" = "auto", stores: StoreProvider = new MemoryStores(), roles?: Record<string, string[]>) =>
  new Platform({ modules: [demo], stores, approvalMode: mode, roles });
const st = async (p: Platform, pr = "p1") => p.state<DemoState>(pr, "demo");
const reason = (r: string) => (e: unknown) => (e as any).reason === r;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "insa-gov-"));

// ======================================================================= TASK 1: undo
describe("Task 1 · platform_undo governance", () => {
  test("undo is registered as a destructive command requiring platform.undo", () => {
    const t = mk().tool("platform_undo");
    assert.equal(t.kind, "command"); assert.equal(t.effect, "destructive"); assert.equal(t.permission, "platform.undo");
  });

  test("1 · a caller without platform.undo cannot undo (viewer; and a writer whose role lacks platform.undo)", async () => {
    const p = mk("auto", new MemoryStores(), { writer: ["bim.write"], viewer: ["bim.read"] });
    const w: Actor = { id: "w", name: "Writer", kind: "human", roles: ["writer"] };
    await p.execute(w, "p1", "demo_inc", {});
    for (const who of [w, { ...viewer, roles: ["viewer"] }]) {
      await assert.rejects(p.execute(who, "p1", "platform_undo", {}), PermissionError);
      assert.equal((await st(p)).n, 1, "state unchanged");
    }
    assert.ok((await p.store("p1").readAudit()).some((a) => a.action === "platform_undo" && a.outcome === "denied"));
  });

  test("2 · an authorised human can undo a valid command", async () => {
    const p = mk("ai");
    await p.execute(manager, "p1", "demo_inc", {});
    const r: any = await p.execute(manager, "p1", "platform_undo", {});
    assert.equal(r.status, "applied");
    assert.equal((await st(p)).n, 0);
  });

  test("3 · an AI caller cannot bypass approval with undo (even with admin roles); dry run changes nothing", async () => {
    const p = mk("ai");
    await p.execute(manager, "p1", "demo_inc", {});
    for (const who of [ai, aiAdmin]) {
      assert.equal((await p.execute(who, "p1", "platform_undo", {}, { dryRun: true })).status, "preview");
      const r: any = await p.execute(who, "p1", "platform_undo", {});
      assert.equal(r.status, "proposed");
      assert.equal((await st(p)).n, 1, "committed state not mutated by the AI");
    }
    const props = await p.store("p1").readProposals();
    await assert.rejects(p.approve(aiAdmin, "p1", props[0].id), PermissionError);   // AI cannot approve its way through
    await p.approve(manager, "p1", props[0].id);                                       // a human can
    assert.equal((await st(p)).n, 0);
  });

  test("4 · a successful undo writes the expected events and audit record", async () => {
    const p = mk();
    const c: any = await p.execute(manager, "p1", "demo_inc", {});
    const u: any = await p.execute(manager, "p1", "platform_undo", {});
    const ev = await p.store("p1").readEvents();
    const mine = ev.filter((e) => e.commandId === u.commandId);
    assert.deepEqual(mine.map((e) => [e.module, e.type]), [["platform", "CommandApplied"], ["platform", "CommandReverted"]]);
    assert.equal(mine[1].payload.commandId, c.commandId);
    assert.equal(mine[0].actor, "taha");
    const audit = (await p.store("p1").readAudit())[0];
    assert.deepEqual([audit.action, audit.outcome, audit.actor, audit.commandId], ["platform_undo", "applied", "taha", u.commandId]);
  });

  test("5 · invalid undos fail with typed errors and do not touch the event log", async () => {
    const p = mk();
    await assert.rejects(p.execute(manager, "p1", "platform_undo", {}), reason("NOTHING_TO_UNDO"));
    const a: any = await p.execute(manager, "p1", "demo_inc", {});
    await p.execute(manager, "p1", "demo_inc", {});
    const before = (await p.store("p1").readEvents()).length;
    await assert.rejects(p.execute(manager, "p1", "platform_undo", { command_id: "CMD-nope" }), reason("COMMAND_NOT_FOUND"));
    await assert.rejects(p.execute(manager, "p1", "platform_undo", { command_id: a.commandId }), reason("NOT_LATEST_COMMAND"));
    assert.equal((await p.store("p1").readEvents()).length, before);
    assert.equal((await st(p)).n, 2);
  });

  test("6 · repeated undo is safe: no double revert, stack order, undo of an undo refused", async () => {
    const p = mk();
    const a: any = await p.execute(manager, "p1", "demo_inc", {});
    const b: any = await p.execute(manager, "p1", "demo_inc", {});
    const u: any = await p.execute(manager, "p1", "platform_undo", { command_id: b.commandId });
    await assert.rejects(p.execute(manager, "p1", "platform_undo", { command_id: b.commandId }), reason("COMMAND_ALREADY_REVERTED"));
    await assert.rejects(p.execute(manager, "p1", "platform_undo", { command_id: u.commandId }), reason("NOT_LATEST_COMMAND"));
    assert.equal((await st(p)).n, 1);
    await p.execute(manager, "p1", "platform_undo", {});             // next one back: a
    assert.equal((await st(p)).n, 0);
    await assert.rejects(p.execute(manager, "p1", "platform_undo", {}), reason("NOTHING_TO_UNDO"));
    const h = await p.history("p1", 100);
    assert.equal(h.find((x) => x.commandId === a.commandId)!.reverted, true);
  });

  test("7 · history stays consistent: replay from the log equals the live state; stale undo proposals cannot revert the wrong command", async () => {
    const stores = new MemoryStores();
    const p = mk("ai", stores);
    const a: any = await p.execute(manager, "p1", "demo_inc", {});
    const prop: any = await p.execute(ai, "p1", "platform_undo", {});          // proposes to revert `a`
    await p.execute(manager, "p1", "demo_inc", {});                              // ... but a newer command arrives
    await assert.rejects(p.approve(manager, "p1", prop.proposalId), reason("NOT_LATEST_COMMAND"));
    assert.equal((await st(p)).n, 2, "nothing reverted");
    assert.equal((await p.store("p1").readProposals())[0].status, "failed");
    await p.execute(manager, "p1", "platform_undo", {});
    const fresh = mk("ai", stores);                                              // rebuilt purely from the event log
    assert.deepEqual(await st(fresh), await st(p));
    assert.deepEqual(await fresh.history("p1", 100), await p.history("p1", 100));
    const h = await p.history("p1", 100);
    assert.deepEqual(h.map((x) => [x.tool, x.reverted]), [["platform_undo", false], ["demo_inc", true], ["demo_inc", false]]);
    assert.equal(h[2].commandId, a.commandId);
  });
});

// ======================================================================= TASK 3: project ids
describe("Task 3 · canonical project id validation", () => {
  const valid = ["default", "ornek-ofis", "demiryolu", "Proje_2026", "t1696", "canli", "İstanbul.v2", "örnek", "A", "a".repeat(64)];
  const invalid: unknown[] = ["", " ", "  x", "x ", "..", ".", "../x", "x/..", "a/b", "a\\b", "/abs", "C:\\x", "C:", "x\u0000y", "a\nb", "a\tb",
                             "-x", ".hidden", "_x", "x..y", "trailing.", "con", "NUL.txt", "lpt1", "a".repeat(65), 42, null, undefined];

  test("Core: parseProjectId accepts existing ids and rejects unsafe ones with INVALID_PROJECT_ID", () => {
    for (const v of valid) assert.equal(parseProjectId(v), v);
    for (const v of invalid) {
      assert.equal(isValidProjectId(v), false, JSON.stringify(v));
      assert.throws(() => parseProjectId(v), (e: any) => e instanceof DomainError && e.reason === "INVALID_PROJECT_ID", JSON.stringify(v));
    }
  });

  test("Core: every Platform entry point rejects invalid ids before storage is touched", async () => {
    const stores = new MemoryStores();
    const p = mk("ai", stores);
    for (const bad of ["../x", "..", "/etc"]) {
      await assert.rejects(p.execute(manager, bad, "demo_inc", {}), reason("INVALID_PROJECT_ID"));
      await assert.rejects(p.execute(manager, bad, "platform_history", {}), reason("INVALID_PROJECT_ID"));
      await assert.rejects(p.approve(manager, bad, "P-1"), reason("INVALID_PROJECT_ID"));
      await assert.rejects(p.reject(manager, bad, "P-1"), reason("INVALID_PROJECT_ID"));
      await assert.rejects(p.history(bad), reason("INVALID_PROJECT_ID"));
      assert.throws(() => p.store(bad), reason("INVALID_PROJECT_ID"));
    }
    assert.deepEqual(await stores.listProjects(), []);
  });

  test("Storage: FileStores cannot be driven outside their root; errors are typed, not filesystem errors", async () => {
    const base = tmp(), root = path.join(base, "root");
    const stores = new FileStores(root);
    for (const bad of ["../escape", "..", "/tmp/abs", "a/../../b", "x\u0000"]) {
      assert.throws(() => stores.project(bad), reason("INVALID_PROJECT_ID"));
      assert.throws(() => stores.subscribe(bad, () => {}), reason("INVALID_PROJECT_ID"));
    }
    const p = mk("auto", stores);
    await assert.rejects(p.execute(manager, "../escape", "demo_inc", {}), (e: any) => publicError(e).status === 400);
    assert.deepEqual(fs.readdirSync(base), ["root"], "nothing created next to the root");
    await p.execute(manager, "ok-1", "demo_inc", {});
    assert.deepEqual(fs.readdirSync(root), ["ok-1"]);
    fs.mkdirSync(path.join(root, ".hidden")); fs.writeFileSync(path.join(root, ".hidden", "events.jsonl"), "");
    assert.deepEqual(await stores.listProjects(), ["ok-1"], "invalid directory names are never listed as projects");
  });

  test("Storage: ArtifactStore and PostgresStores use the same rule", { skip: false }, async () => {
    const a = new ArtifactStore(tmp());
    assert.throws(() => a.save("../x", "ifc", "m", "data"), reason("INVALID_PROJECT_ID"));
    if (process.env.INSA_PG_URL) {
      const pg = new PostgresStores(process.env.INSA_PG_URL);
      try { assert.throws(() => pg.project("../x"), reason("INVALID_PROJECT_ID")); } finally { await pg.close(); }
    }
  });
});

// ======================================================================= TASK 4: atomic approval
async function proposeInc(p: Platform, project = "p1") {
  const r: any = await p.execute(ai, project, "demo_inc", {});
  assert.equal(r.status, "proposed");
  return r.proposalId as string;
}
const incEvents = async (p: Platform, pid: string, project = "p1") => {
  const ev = await p.store(project).readEvents();
  return { inc: ev.filter((e) => e.type === "Inc").length,
           applied: ev.filter((e) => e.type === "CommandApplied" && e.payload.proposalId === pid).length };
};

describe("Task 4 · proposal approval is at-most-once", () => {
  test("1+2+7 · approval succeeds once; a second approval fails with PROPOSAL_ALREADY_APPLIED; status history is coherent", async () => {
    const p = mk("ai");
    const pid = await proposeInc(p);
    assert.equal(((await p.approve(manager, "p1", pid)) as any).status, "applied");
    await assert.rejects(p.approve(manager2, "p1", pid), reason("PROPOSAL_ALREADY_APPLIED"));
    await assert.rejects(p.reject(manager2, "p1", pid), reason("PROPOSAL_ALREADY_APPLIED"));
    assert.deepEqual(await incEvents(p, pid), { inc: 1, applied: 1 });
    const prop = (await p.store("p1").readProposals())[0];
    assert.deepEqual(prop.history!.map((h) => h.status), ["pending", "applying", "applied"]);
    assert.equal(prop.decidedBy, "taha"); assert.ok(prop.commandId);
  });

  test("3+6 · concurrent approvals (same process): exactly one execution, no duplicate events", async () => {
    const p = mk("ai");
    const pid = await proposeInc(p);
    decided.inc = 0;
    const approvers = Array.from({ length: 8 }, (_, i) => ({ ...manager, id: `m${i}` }));
    const res = await Promise.allSettled(approvers.map((a) => p.approve(a, "p1", pid)));
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(res.filter((r) => r.status === "rejected").every((r: any) => ["PROPOSAL_NOT_PENDING", "PROPOSAL_ALREADY_APPLIED"].includes(r.reason.reason)));
    assert.equal(decided.inc, 1, "the command was decided exactly once");
    assert.deepEqual(await incEvents(p, pid), { inc: 1, applied: 1 });
  });

  test("3 · concurrent approvals from two platform instances on one file store (two 'processes', one event loop)", async () => {
    const root = tmp();
    const pA = mk("ai", new FileStores(root)), pB = mk("ai", new FileStores(root));
    const pid = await proposeInc(pA);
    const res = await Promise.allSettled([pA.approve(manager, "p1", pid), pB.approve(manager2, "p1", pid), pA.approve({ ...manager, id: "x" }, "p1", pid)]);
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
    assert.deepEqual(await incEvents(pA, pid), { inc: 1, applied: 1 });
  });

  test("3 · concurrent approvals from separate OS processes on the file store", { timeout: 120000 }, async () => {
    const root = tmp();
    const p = mk("ai", new FileStores(root));
    const pid = await proposeInc(p);
    const run = promisify(execFile);
    const child = path.resolve(import.meta.dirname, "fixtures/approve-child.ts");
    const startAt = String(Date.now() + 4000);
    const outs = await Promise.all(Array.from({ length: 4 }, (_, i) =>
      run(process.execPath, ['--import', 'tsx', child, root, "p1", pid, `human-${i}`], { env: { ...process.env, START_AT: startAt } }).then((o) => JSON.parse(o.stdout.trim().split("\n").pop()!))));
    assert.equal(outs.filter((o) => o.ok).length, 1, JSON.stringify(outs));
    assert.deepEqual(await incEvents(p, pid), { inc: 1, applied: 1 });
  });

  test("4 · approve/reject race has exactly one winner and a consistent outcome", async () => {
    for (let k = 0; k < 10; k++) {
      const p = mk("ai");
      const pid = await proposeInc(p);
      const res = await Promise.allSettled(k % 2 ? [p.approve(manager, "p1", pid), p.reject(manager2, "p1", pid, "no")]
                                                 : [p.reject(manager2, "p1", pid, "no"), p.approve(manager, "p1", pid)]);
      assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
      const status = (await p.store("p1").readProposals())[0].status;
      const ev = await incEvents(p, pid);
      assert.ok((status === "applied" && ev.applied === 1 && ev.inc === 1) || (status === "rejected" && ev.applied === 0 && ev.inc === 0), `${status} ${JSON.stringify(ev)}`);
    }
  });

  test("5 · a failing command never becomes approved; the failure is explicit, audited and final", async () => {
    const p = mk("ai");
    const pid = await proposeInc(p);
    await p.execute(manager, "p1", "demo_lock", {});                          // makes the proposal's command fail on re-decide
    await assert.rejects(p.approve(manager, "p1", pid), /locked/);
    const prop = (await p.store("p1").readProposals()).find((x) => x.id === pid)!;
    assert.equal(prop.status, "failed");
    assert.deepEqual(prop.history!.map((h) => h.status), ["pending", "applying", "failed"]);
    assert.deepEqual(await incEvents(p, pid), { inc: 0, applied: 0 });
    assert.equal((await p.store("p1").readAudit())[0].outcome, "failed");
    await assert.rejects(p.approve(manager2, "p1", pid), reason("PROPOSAL_NOT_PENDING"));
  });

  test("PostgreSQL: concurrent approvals across two pools and approve/reject races have one winner", { skip: !process.env.INSA_PG_URL }, async () => {
    const sA = new PostgresStores(process.env.INSA_PG_URL!), sB = new PostgresStores(process.env.INSA_PG_URL!);
    try {
      const pA = mk("ai", sA), pB = mk("ai", sB);
      for (let k = 0; k < 4; k++) {
        const project = `gov${Date.now()}${k}`;
        const pid = await proposeInc(pA, project);
        const res = await Promise.allSettled([pA.approve(manager, project, pid), pB.approve(manager2, project, pid),
                                              pB.approve({ ...manager, id: "z" }, project, pid), pA.reject({ ...manager, id: "r" }, project, pid)]);
        assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
        const prop = (await pA.store(project).readProposals())[0];
        const ev = await incEvents(pA, pid, project);
        assert.ok((prop.status === "applied" && ev.applied === 1 && ev.inc === 1) || (prop.status === "rejected" && ev.applied === 0), `${prop.status} ${JSON.stringify(ev)}`);
        assert.equal(prop.history!.filter((h) => h.status === "pending").length, 1);
      }
    } finally { await sA.close(); await sB.close(); }
  });
});

// ======================================================================= errors
test("unknown (filesystem/database) errors are reduced to a generic public message", () => {
  const fsErr = Object.assign(new Error("EACCES: permission denied, open '/srv/secret/file'"), { code: "EACCES" });
  const pe = publicError(fsErr);
  assert.equal(pe.status, 500); assert.equal(pe.internal, true); assert.ok(!pe.message.includes("/srv"));
  assert.equal(publicError(new DomainError("x", "INVALID_PROJECT_ID")).reason, "INVALID_PROJECT_ID");
});
