/**
 * Phase 3 · event schema versioning, upcasters and snapshots (Core level).
 * A test module `acc` has a real version chain: Set v1 {k, mm} -> v2 {key, mm} -> v3 {key, value (metres)}.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import {
  Platform, MemoryStores, FileStores, PostgresStores, StoreProvider, ProjectStore, Actor, ModuleDef, NewEvent,
  EventRegistry, IntegrityError, publicError, canonicalJson, encodeSnapshot, SnapshotPolicy, PlatformLogger,
} from "../src/index.js";

interface Acc { n: number; items: Record<string, number>; }
const acc: ModuleDef<Acc> = {
  id: "acc", title: "Accumulator",
  initialState: () => ({ n: 0, items: {} }),
  apply(s, e) {
    if (e.type === "Inc") s.n += e.payload.by;
    if (e.type === "Set") s.items[e.payload.key] = e.payload.value;
    return s;
  },
  eventVersions: { Inc: 1, Set: 3 },
  upcasters: [
    { type: "Set", fromVersion: 1, upcast: (p: { k: string; mm: number }) => ({ key: p.k, mm: p.mm }) },
    { type: "Set", fromVersion: 2, upcast: (p: { key: string; mm: number }) => ({ key: p.key, value: p.mm / 1000 }) },
  ],
  tools: [
    { kind: "command", effect: "write", module: "acc", name: "acc_inc", title: "", description: "", permission: "bim.write",
      input: z.object({ by: z.number().default(1) }), decide: (_s, i) => ({ events: [{ type: "Inc", payload: { by: i.by } }], summary: i }) },
    { kind: "command", effect: "write", module: "acc", name: "acc_three", title: "", description: "", permission: "bim.write",
      input: z.object({}), decide: () => ({ events: [1, 2, 3].map((by) => ({ type: "Inc", payload: { by } })), summary: {} }) },
    { kind: "command", effect: "write", module: "acc", name: "acc_set", title: "", description: "", permission: "bim.write",
      input: z.object({ key: z.string(), value: z.number() }), decide: (_s, i) => ({ events: [{ type: "Set", payload: i }], summary: i }) },
  ],
};
const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "evt";

function capture(): PlatformLogger & { lines: { level: string; event: string; d?: any }[] } {
  const lines: { level: string; event: string; d?: any }[] = [];
  return { lines, info: (event, d) => lines.push({ level: "info", event, d }), warn: (event, d) => lines.push({ level: "warn", event, d }) };
}
const mk = (stores: StoreProvider, policy: SnapshotPolicy | false = { everyEvents: 4, keep: 50 }, extra: Partial<ModuleDef> = {}, logger = capture()) =>
  new Platform({ modules: [{ ...acc, ...extra } as ModuleDef], stores, snapshotPolicy: policy, logger });
const run = (p: Platform, tool: string, input: unknown = {}) => p.execute(user, P, tool, input) as Promise<any>;
const view = async (p: Platform) => canonicalJson({ acc: await p.state(P, "acc"), history: await p.history(P, 1e6) });
/** raw legacy events (as written before Phase 3: no schemaVersion) */
function legacyCommand(cmd: string, events: { type: string; payload: unknown; schemaVersion?: number }[]): NewEvent[] {
  const base = { commandId: cmd, actor: "old", at: "2026-01-01T00:00:00.000Z" };
  return [{ ...base, module: "platform", type: "CommandApplied", payload: { tool: "acc_legacy", summary: {} } },
          ...events.map((e) => ({ ...base, module: "acc", ...e }))];
}
const append = async (st: ProjectStore, evs: NewEvent[]) => st.appendEvents(evs, await st.lastSeq());
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "insa-p3-"));

// ============================================================================ A
describe("A · event schema versions", () => {
  test("A1 · every newly written event carries the current schemaVersion (memory and file)", async () => {
    for (const stores of [new MemoryStores(), new FileStores(tmp())]) {
      const p = mk(stores);
      await run(p, "acc_set", { key: "a", value: 2 });
      await run(p, "acc_inc", {});
      await run(p, "platform_undo", {});
      const ev = await stores.project(P).readEvents();
      assert.deepEqual(ev.map((e) => [e.type, e.schemaVersion]),
        [["CommandApplied", 1], ["Set", 3], ["CommandApplied", 1], ["Inc", 1], ["CommandApplied", 1], ["CommandReverted", 1]]);
    }
  });

  test("A2-A4 · legacy (no version) and v2 events upcast through the chain to the current representation", async () => {
    const stores = new MemoryStores();
    await append(stores.project(P), legacyCommand("CMD-v1", [{ type: "Set", payload: { k: "a", mm: 2500 } }]));
    await append(stores.project(P), legacyCommand("CMD-v2", [{ type: "Set", payload: { key: "b", mm: 750 }, schemaVersion: 2 }]));
    await append(stores.project(P), legacyCommand("CMD-v3", [{ type: "Set", payload: { key: "c", value: 1.5 }, schemaVersion: 3 }]));
    const p = mk(stores);
    assert.deepEqual((await p.state<Acc>(P, "acc")).items, { a: 2.5, b: 0.75, c: 1.5 });
    const reg = p.registry;
    const [e1] = (await stores.project(P).readEvents(1));
    assert.equal(e1.schemaVersion, undefined, "stored legacy event has no version");
    assert.deepEqual(reg.upcast(e1).payload, { key: "a", value: 2.5 });
    assert.equal(reg.upcast(e1).schemaVersion, 3);
  });

  test("A5 · a future event version is refused with UNSUPPORTED_EVENT_VERSION and safe details", async () => {
    const stores = new MemoryStores();
    await append(stores.project(P), legacyCommand("CMD-f", [{ type: "Set", payload: { key: "x", value: 1, unit: "?" }, schemaVersion: 4 }]));
    const p = mk(stores);
    await assert.rejects(p.state(P, "acc"), (e: any) => {
      assert.ok(e instanceof IntegrityError);
      assert.equal(e.reason, "UNSUPPORTED_EVENT_VERSION");
      assert.deepEqual(e.details, { module: "acc", type: "Set", storedVersion: 4, seq: 2, supportedVersion: 3 });
      const pub = publicError(e);
      assert.equal(pub.status, 500); assert.equal(pub.internal, false); assert.equal(pub.reason, "UNSUPPORTED_EVENT_VERSION");
      return true;
    });
  });

  test("A6 · upcasting is pure: stored events (and the file) are unchanged; an upcaster that mutates its input fails", async () => {
    const dir = tmp(), stores = new FileStores(dir);
    await append(stores.project(P), legacyCommand("CMD-v1", [{ type: "Set", payload: { k: "a", mm: 1000 } }]));
    const file = path.join(dir, P, "events.jsonl"), before = fs.readFileSync(file, "utf8");
    const raw = await stores.project(P).readEvents();
    const copy = structuredClone(raw);
    const p = mk(stores);
    await p.state(P, "acc"); await mk(stores).state(P, "acc");
    p.registry.upcast(raw[1]); p.registry.upcast(raw[1]);
    assert.deepEqual(raw, copy); assert.equal(fs.readFileSync(file, "utf8"), before);
    const bad = new EventRegistry([{ module: "acc", eventVersions: { Set: 2 }, upcasters: [{ type: "Set", fromVersion: 1, upcast: (pl: any) => { pl.k = "x"; return pl; } }] }]);
    assert.throws(() => bad.upcast(raw[1]), (e: any) => e.reason === "EVENT_UPCAST_FAILED" && e.details.atVersion === 1);
  });

  test("A · configuration errors fail fast: missing chain step, duplicate step; unknown event types are refused", async () => {
    assert.throws(() => new EventRegistry([{ module: "m", eventVersions: { E: 3 }, upcasters: [{ type: "E", fromVersion: 1, upcast: (x) => x }] }]), /missing upcaster v2 -> v3/);
    assert.throws(() => new EventRegistry([{ module: "m", eventVersions: { E: 2 }, upcasters: [{ type: "E", fromVersion: 1, upcast: (x) => x }, { type: "E", fromVersion: 1, upcast: (x) => x }] }]), /Duplicate/);
    const reg = new EventRegistry([{ module: "acc", eventVersions: acc.eventVersions, upcasters: acc.upcasters }]);
    assert.throws(() => reg.upcast({ seq: 1, module: "acc", type: "Nope", payload: {}, commandId: "c", actor: "a", at: "" }), (e: any) => e.reason === "EVENT_UPCAST_FAILED");
    assert.throws(() => reg.currentVersion("acc", "Nope"), /not declared/);
  });
});

// ============================================================================ B
describe("B · replay", () => {
  test("B1-B3 · legacy history -> current state; repeated replays are identical; current events pass unchanged", async () => {
    const stores = new MemoryStores();
    await append(stores.project(P), legacyCommand("CMD-1", [{ type: "Inc", payload: { by: 2 } }, { type: "Set", payload: { k: "a", mm: 300 } }]));
    const p = mk(stores);
    await run(p, "acc_set", { key: "b", value: 4 });
    const views = await Promise.all([1, 2, 3].map(() => view(mk(stores, false))));
    assert.equal(new Set(views).size, 1);
    assert.equal(views[0], await view(p));
    assert.deepEqual((await p.state<Acc>(P, "acc")), { n: 2, items: { a: 0.3, b: 4 } });
    const cur = (await stores.project(P).readEvents()).at(-1)!;
    assert.deepEqual(p.registry.upcast(cur).payload, cur.payload);
  });

  test("B · the event sequence is enforced: a gap in the log is an EVENT_SEQUENCE_ERROR, never silently skipped", async () => {
    const dir = tmp(), stores = new FileStores(dir);
    await mk(stores).execute(user, P, "acc_inc", {});
    const file = path.join(dir, P, "events.jsonl");
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    const gap = { ...JSON.parse(lines[1]), seq: 4 };
    fs.writeFileSync(file, [lines[0], JSON.stringify(gap)].join("\n") + "\n");
    await assert.rejects(mk(stores).state(P, "acc"), (e: any) => e.reason === "EVENT_SEQUENCE_ERROR" && e.details.expected === 2 && e.details.found === 4);
  });

  test("B · concurrent state loads never apply the same events twice (non-idempotent events)", async () => {
    const stores = new MemoryStores();
    const p = mk(stores, false), q = mk(stores, false);
    await run(p, "acc_inc", {});
    await p.state(P, "acc");
    for (let i = 0; i < 20; i++) await run(q, "acc_inc", {});             // p's cache is now 20 commands behind
    const states = await Promise.all(Array.from({ length: 10 }, () => p.state<Acc>(P, "acc")));
    assert.ok(states.every((s) => s.n === 21), JSON.stringify(states.map((s) => s.n)));
  });
});

// ============================================================================ C
describe("C · snapshots", () => {
  test("C1-C4 · policy writes snapshots; a fresh platform loads the newest and replays exactly the events after it", async () => {
    const stores = new MemoryStores();
    const p = mk(stores, { everyEvents: 4, keep: 50 });
    for (let i = 0; i < 7; i++) await run(p, "acc_inc", { by: i });           // 2 events per command
    const st = stores.project(P);
    const snap = (await st.getSnapshot())!;
    assert.ok(p.metrics.snapshotsWritten >= 3 && snap.lastSeq === 12, `${p.metrics.snapshotsWritten} @${snap.lastSeq}`);
    await run(mk(stores, false), "acc_set", { key: "z", value: 9 });            // written without snapshotting: tail = events 13..16
    const calls: number[] = [];
    const spy: StoreProvider = { ...stores, listProjects: () => stores.listProjects(),
      project: (id) => { const s = stores.project(id); return Object.assign(Object.create(s), { readEvents: (after = 0) => { calls.push(after); return s.readEvents(after); } }); } };
    const f = mk(spy, { everyEvents: 4, keep: 50 });
    assert.equal(await view(f), await view(mk(stores, false)), "snapshot + tail == full replay");
    assert.equal(f.metrics.snapshotsLoaded, 1);
    assert.equal(calls[0], 12, "the rebuild reads only events with seq > snapshot.lastSeq");
    assert.equal(f.metrics.replayedEvents, 4, "exactly events 13..16: none twice, none skipped");
    const ms = new MemoryStores(); await ms.project(P).saveSnapshot((await st.getSnapshot())!); await ms.project(P).pruneSnapshots(0);
    assert.equal(await ms.project(P).getSnapshot(), null, "prune(0) removes every snapshot");
    const none = mk(new MemoryStores(), { everyEvents: 4, keep: 5 });
    assert.equal((await none.state<Acc>(P, "acc")).n, 0, "no snapshot, no events: empty state");
  });

  test("C5 · incompatible snapshots (module state version, future format) are ignored -> older snapshot or full replay", async () => {
    const stores = new MemoryStores();
    const p = mk(stores);
    for (let i = 0; i < 6; i++) await run(p, "acc_inc", {});
    const log = capture();
    const v2 = mk(stores, { everyEvents: 4, keep: 50 }, { stateVersion: 2 }, log);
    assert.equal((await v2.state<Acc>(P, "acc")).n, 6);
    assert.ok(log.lines.some((l) => l.event === "snapshot.ignored_incompatible"));
    assert.equal(v2.metrics.snapshotsLoaded, 0);
    const st = stores.project(P), last = (await st.getSnapshot())!;
    const env = JSON.parse(last.body); delete env.checksum; env.snapshotVersion = 2; env.lastSeq = last.lastSeq + 0;
    await st.pruneSnapshots(0);
    await st.saveSnapshot({ ...encodeSnapshot(env), snapshotVersion: 2 });
    const log2 = capture(), f = mk(stores, { everyEvents: 4, keep: 50 }, {}, log2);
    assert.equal((await f.state<Acc>(P, "acc")).n, 6);
    assert.ok(log2.lines.some((l) => l.event === "snapshot.ignored_incompatible" && l.d.reason === "UNSUPPORTED_SNAPSHOT_VERSION"));
  });

  test("C6 · corrupted snapshots (bad checksum, unreadable) fall back to an older snapshot, then to full replay", async () => {
    const stores = new MemoryStores();
    const p = mk(stores, { everyEvents: 4, keep: 50 });
    for (let i = 0; i < 6; i++) await run(p, "acc_inc", { by: 2 });
    const st = stores.project(P) as any;
    const newest = st.snapshots.at(-1), older = st.snapshots.at(-2);
    newest.body = newest.body.replace('"n":12', '"n":999');                     // tampered state
    const log = capture(), f = mk(stores, { everyEvents: 4, keep: 50 }, {}, log);
    assert.equal((await f.state<Acc>(P, "acc")).n, 12);
    assert.ok(log.lines.some((l) => l.event === "snapshot.fallback_corrupted" && l.d.reason === "SNAPSHOT_CORRUPTED" && l.d.lastSeq === newest.lastSeq));
    assert.ok(log.lines.some((l) => l.event === "snapshot.loaded" && l.d.lastSeq === older.lastSeq));
    for (const s of st.snapshots) s.body = "{not json";
    const g = mk(stores, { everyEvents: 4, keep: 50 }, {}, capture());
    assert.equal((await g.state<Acc>(P, "acc")).n, 12, "every snapshot unreadable: full replay");
    assert.equal(g.metrics.snapshotsLoaded, 0);
    assert.equal((await stores.project(P).readEvents()).length, 12, "event history untouched");
  });

  test("C7 · a failing snapshot write never fails or rolls back the committed command", async () => {
    const stores = new MemoryStores();
    const broken: StoreProvider = { ...stores, listProjects: () => stores.listProjects(),
      project: (id) => Object.assign(Object.create(stores.project(id)), { saveSnapshot: async () => { throw new Error("disk full at /var/lib/x"); } }) };
    const log = capture(), p = mk(broken, { everyEvents: 1, keep: 3 }, {}, log);
    const r = await run(p, "acc_inc", { by: 5 });
    assert.equal(r.status, "applied");
    assert.equal((await mk(stores, false).state<Acc>(P, "acc")).n, 5);
    const w = log.lines.find((l) => l.event === "snapshot.save_failed")!;
    assert.ok(w && !JSON.stringify(w.d).includes("/var/lib"), "diagnostic without internals");
  });
});

// ============================================================================ D
describe("D · undo across snapshot boundaries", () => {
  test("D1-D4 · undo after the snapshot, undo of commands baked into the snapshot, deep undo; equal to full replay", async () => {
    const stores = new MemoryStores();
    const p = mk(stores, { everyEvents: 2, keep: 2 });                         // a snapshot after every command, only 2 kept
    const ids: string[] = [];
    for (let i = 1; i <= 6; i++) ids.push((await run(p, "acc_inc", { by: 10 ** (i - 1) })).commandId);
    const full = () => mk(stores, false);
    const fresh = () => mk(stores, { everyEvents: 2, keep: 2 });
    assert.equal((await p.state<Acc>(P, "acc")).n, 111111);
    // A: target after the newest snapshot? (snapshot is at the end of command 6, so the target IS inside it)
    for (const [k, expected] of [[6, 11111], [5, 1111], [4, 111], [3, 11], [2, 1]] as const) {
      const u = await run(p, "platform_undo", {});
      assert.equal(u.summary.reverted, ids[k - 1]);
      assert.equal((await p.state<Acc>(P, "acc")).n, expected, `after undoing command ${k}`);
      assert.equal(await view(fresh()), await view(full()), `fresh snapshot-backed load == full replay after undo ${k}`);
    }
    // B: the target lies AFTER the newest snapshot (commands written without snapshotting)
    const lastSnap = (await stores.project(P).getSnapshot())!.lastSeq;
    const plain = full();
    await run(plain, "acc_inc", { by: 7 });
    const t = await run(plain, "acc_inc", { by: 100 });
    const u = await run(plain, "platform_undo", {});
    assert.equal(u.summary.reverted, t.commandId);
    const commands = await plain.history(P, 1e6);
    assert.ok(commands.find((h) => h.commandId === t.commandId)!.seq > lastSnap, "target is after the snapshot");
    const f = fresh();
    assert.equal((await f.state<Acc>(P, "acc")).n, 8);
    assert.equal(f.metrics.snapshotsLoaded, 1, "the snapshot stays usable: only the tail is replayed");
    assert.equal(await view(f), await view(full()));
    assert.equal(await view(fresh()), await view(fresh()), "repeated replay after undo is deterministic");
  });

  test("D · a legacy-version command can be replayed and later undone", async () => {
    const stores = new MemoryStores();
    await append(stores.project(P), legacyCommand("CMD-legacy", [{ type: "Set", payload: { k: "a", mm: 4200 } }, { type: "Inc", payload: { by: 3 } }]));
    const p = mk(stores, { everyEvents: 1, keep: 3 });
    assert.deepEqual(await p.state<Acc>(P, "acc"), { n: 3, items: { a: 4.2 } });
    await run(p, "acc_inc", { by: 1 });                                          // snapshot taken here contains the legacy command
    await run(p, "platform_undo", {});
    const u = await run(p, "platform_undo", {});
    assert.equal(u.summary.reverted, "CMD-legacy");
    assert.deepEqual(await p.state<Acc>(P, "acc"), { n: 0, items: {} });
    assert.equal(await view(mk(stores, { everyEvents: 1, keep: 3 })), await view(mk(stores, false)));
  });
});

// ============================================================================ E
describe("E · command boundaries", () => {
  test("E1 · snapshots are only taken at command boundaries, even for multi-event commands", async () => {
    const stores = new MemoryStores();
    const p = mk(stores, { everyEvents: 2, keep: 100 });
    for (let i = 0; i < 5; i++) { await run(p, "acc_three"); await run(p, "acc_inc"); }
    const ev = await stores.project(P).readEvents();
    const snaps = (stores.project(P) as any).snapshots as { lastSeq: number }[];
    assert.ok(snaps.length >= 5);
    for (const s of snaps) {
      const at = ev[s.lastSeq - 1], next = ev[s.lastSeq];
      assert.ok(!next || next.commandId !== at.commandId, `snapshot @${s.lastSeq} cuts command ${at.commandId}`);
    }
  });

  test("E2 · a snapshot cut inside a command (e.g. written by faulty tooling) is ignored", async () => {
    const stores = new MemoryStores();
    const p = mk(stores, false);
    await run(p, "acc_three");                                                   // events 1..4: CommandApplied, Inc 1, Inc 2, Inc 3
    const ev = await stores.project(P).readEvents();
    const forged = encodeSnapshot({ snapshotVersion: 1, project: P, lastSeq: 3, lastCommandId: ev[2].commandId, createdAt: "x",
      modules: { acc: { stateVersion: 1 }, platform: { stateVersion: 1 } }, state: { acc: { n: 3, items: {} } },
      replay: { commands: [{ commandId: ev[0].commandId, seq: 1, tool: "acc_three", actor: "taha", at: ev[0].at, summary: {} }], reverted: {} } });
    await stores.project(P).saveSnapshot(forged);
    const log = capture(), f = mk(stores, { everyEvents: 100, keep: 3 }, {}, log);
    assert.equal((await f.state<Acc>(P, "acc")).n, 6);
    assert.ok(log.lines.some((l) => l.event === "snapshot.ignored_mid_command"));
  });
});

// ============================================================================ F
const PG = process.env.INSA_PG_URL;
describe("F · storage backends", () => {
  for (const [name, mkStores] of [
    ["memory", () => new MemoryStores()],
    ["file", () => new FileStores(tmp())],
    ["postgres", () => new PostgresStores(PG!)],
  ] as [string, () => StoreProvider][]) {
    test(`F · ${name}: versions persist, snapshots save / select by sequence / prune, reload equals full replay`, { skip: name === "postgres" && !PG }, async () => {
      const stores = mkStores();
      const project = name === "postgres" ? `p3${Date.now()}` : P;
      try {
        const p = new Platform({ modules: [acc], stores, snapshotPolicy: { everyEvents: 3, keep: 2 }, logger: capture() });
        for (let i = 0; i < 6; i++) {
          if (i === 3) await p.execute(user, project, "platform_undo", {});
          await p.execute(user, project, i % 2 ? "acc_set" : "acc_inc", i % 2 ? { key: `k${i}`, value: i } : { by: i });
        }
        const st = stores.project(project);
        assert.ok((await st.readEvents()).every((e) => e.schemaVersion !== undefined));
        const latest = (await st.getSnapshot())!;
        const older = (await st.getSnapshot(latest.lastSeq - 1))!;
        assert.ok(older && older.lastSeq < latest.lastSeq);
        assert.equal(await st.getSnapshot(0), null);
        await st.pruneSnapshots(1);
        assert.equal((await st.getSnapshot(latest.lastSeq - 1)), null, "pruned to the newest");
        const a = new Platform({ modules: [acc], stores, snapshotPolicy: { everyEvents: 3, keep: 2 }, logger: capture() });
        const b = new Platform({ modules: [acc], stores, snapshotPolicy: false });
        const v = async (x: Platform) => canonicalJson({ s: await x.state(project, "acc"), h: await x.history(project, 1e6) });
        assert.equal(await v(a), await v(b));
        assert.equal(a.metrics.snapshotsLoaded, 1);
      } finally { await stores.close?.(); }
    });
  }

  test("F · postgres: upgrading a pre-Phase-3 database — the first operation is a READ; legacy rows stay untouched", { skip: !PG }, async () => {
    const pg = (await import("pg")).default;
    const schema = `legacy_${Date.now()}`;
    const admin = new pg.Client({ connectionString: PG });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.query(`SET search_path TO ${schema}`);
      // the Phase 1/2 schema, exactly as it was (no schema_version, no snapshots table)
      await admin.query(`CREATE TABLE insa_projects (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`);
      await admin.query(`CREATE TABLE insa_events (project text NOT NULL REFERENCES insa_projects(id), seq bigint NOT NULL, module text NOT NULL, type text NOT NULL,
                           payload jsonb NOT NULL, command_id text NOT NULL, actor text NOT NULL, at timestamptz NOT NULL, PRIMARY KEY (project, seq))`);
      await admin.query(`INSERT INTO insa_projects (id) VALUES ('old')`);
      await admin.query(`INSERT INTO insa_events VALUES ('old', 1, 'platform', 'CommandApplied', '{"tool":"acc_legacy","summary":{}}', 'CMD-1', 'old', now()),
                                                       ('old', 2, 'acc', 'Set', '{"k":"a","mm":1500}', 'CMD-1', 'old', now())`);
      const url = `${PG}${PG!.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
      const stores = new PostgresStores(url);
      try {
        const p = new Platform({ modules: [acc], stores, snapshotPolicy: { everyEvents: 2, keep: 2 }, logger: capture() });
        assert.deepEqual((await p.state<Acc>("old", "acc")).items, { a: 1.5 }, "first operation (a read) works on the old schema");
        await p.execute(user, "old", "acc_inc", { by: 1 });
        const rows = (await admin.query(`SELECT seq, schema_version, payload FROM insa_events WHERE project = 'old' ORDER BY seq`)).rows;
        assert.deepEqual(rows.map((r) => r.schema_version), [null, null, 1, 1], "legacy rows untouched (NULL), new rows versioned");
        assert.deepEqual(rows[1].payload, { k: "a", mm: 1500 });
        assert.equal(Number((await admin.query(`SELECT count(*) FROM insa_snapshots WHERE project = 'old'`)).rows[0].count), 1);
      } finally { await stores.close(); }
    } finally {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
      await admin.end();
    }
  });

  test("F · file: snapshots are written atomically; stray temp files and broken files are never used as snapshots", async () => {
    const dir = tmp(), stores = new FileStores(dir);
    const p = mk(stores, { everyEvents: 2, keep: 10 });
    for (let i = 0; i < 3; i++) await run(p, "acc_inc", { by: 1 });
    const sdir = path.join(dir, P, "snapshots");
    const names = fs.readdirSync(sdir);
    assert.ok(names.length && names.every((n) => /^\d{12}\.json$/.test(n)), names.join(","));
    fs.writeFileSync(path.join(sdir, ".tmp-123-crashed"), "{\"partial");                 // a crash mid-write leaves only a temp file
    fs.writeFileSync(path.join(sdir, "999999999999.json"), "{\"lastSeq\":999999999999,\"bo");  // and a truncated file
    const log = capture(), f = mk(stores, { everyEvents: 2, keep: 10 }, {}, log);
    assert.equal((await f.state<Acc>(P, "acc")).n, 3);
    assert.ok(log.lines.some((l) => l.event === "snapshot.fallback_corrupted"));
    assert.equal(f.metrics.snapshotsLoaded, 1, "fell back to the newest valid snapshot");
  });
});

// ============================================================================ H
test("H · with a snapshot, loading 10 000+ events replays only the tail through the reducers", async () => {
  const stores = new MemoryStores();
  const st = stores.project(P);
  for (let b = 0; b < 10; b++) {                                                // 5 000 commands = 10 000 events, written directly
    const batch: NewEvent[] = [];
    for (let i = 0; i < 500; i++) {
      const cmd = `CMD-${b}-${i}`, base = { commandId: cmd, actor: "bulk", at: "2026-01-01T00:00:00.000Z" };
      batch.push({ ...base, module: "platform", type: "CommandApplied", schemaVersion: 1, payload: { tool: "acc_inc", summary: {} } },
                 { ...base, module: "acc", type: "Inc", schemaVersion: 1, payload: { by: 1 } });
    }
    await st.appendEvents(batch, await st.lastSeq());
  }
  const full = mk(stores, false);
  assert.equal((await full.state<Acc>(P, "acc")).n, 5000);
  assert.equal(full.metrics.replayedEvents, 10000);
  assert.deepEqual(await full.createSnapshot(P).catch(() => "disabled"), { lastSeq: 10000, written: true }, "explicit snapshot works (and is really written) even with automatic snapshots off");
  for (let i = 0; i < 10; i++) await run(full, "acc_inc", {});
  const fast = mk(stores, { everyEvents: 1000, keep: 3 });
  assert.equal((await fast.state<Acc>(P, "acc")).n, 5010);
  assert.equal(fast.metrics.replayedEvents, 20, "only the 20 events after the snapshot");
  assert.equal(mk(stores, false).metrics.replayedEvents, 0);
});
