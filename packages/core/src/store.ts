/**
 * Persistence for projects: append-only event log, proposals and audit log.
 *
 * appendEvents(events, expectedLastSeq) implements optimistic concurrency: if
 * another writer appended in the meantime a ConcurrencyError is thrown and the
 * platform re-decides the command on the fresh state.
 *
 * Implementations: MemoryStores (tests), FileStores (single user / dev),
 * PostgresStores (see pg.ts).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ConcurrencyError } from "./errors.js";
import type { StoredSnapshot } from "./snapshots.js";
import { parseProjectId, isValidProjectId } from "./ids.js";

export { ConcurrencyError } from "./errors.js";

export interface DomainEvent {
  seq: number;
  module: string;
  type: string;
  payload: any;
  commandId: string;
  actor: string;
  at: string;
  /** event schema version; absent on events written before Phase 3 (= legacy version 1) */
  schemaVersion?: number;
}
export type NewEvent = Omit<DomainEvent, "seq">;

/**
 * Proposal lifecycle:  pending -> applying -> applied | failed ;  pending -> rejected
 * Every transition is an atomic compare-and-set (transitionProposal), so a
 * proposal is applied at most once and approve/reject cannot both win.
 */
export type ProposalStatus = "pending" | "applying" | "applied" | "rejected" | "failed";
export interface ProposalTransition { status: ProposalStatus; at: string; by: string; note?: string; }

export interface Proposal {
  id: string;
  tool: string;
  input: unknown;
  actor: string;
  createdAt: string;
  preview: unknown;
  status: ProposalStatus;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
  commandId?: string;
  history?: ProposalTransition[];
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  outcome: "applied" | "proposed" | "approved" | "rejected" | "denied" | "failed" | "reverted" | "exported";
  commandId?: string;
  proposalId?: string;
  detail?: unknown;
}

export interface ProjectStore {
  lastSeq(): Promise<number>;
  readEvents(afterSeq?: number): Promise<DomainEvent[]>;
  appendEvents(events: NewEvent[], expectedLastSeq: number): Promise<DomainEvent[]>;
  readProposals(): Promise<Proposal[]>;
  /** Stores a NEW proposal (status pending). Existing proposals change only through transitionProposal. */
  saveProposal(p: Proposal): Promise<void>;
  /**
   * Atomic compare-and-set: moves the proposal to `to` only if its current status is in `from`,
   * merging `patch` and appending a history entry. Returns the updated proposal, or null when the
   * status did not match (or the proposal does not exist).
   */
  transitionProposal(id: string, from: ProposalStatus[], to: ProposalStatus, by: string,
                     patch?: Partial<Proposal>, note?: string): Promise<Proposal | null>;
  appendAudit(e: AuditEntry): Promise<void>;
  readAudit(limit?: number): Promise<AuditEntry[]>; // newest first
  /** Stores a snapshot (opaque, verified by the platform). Never touches events. */
  saveSnapshot(s: StoredSnapshot): Promise<void>;
  /** Latest snapshot with lastSeq <= maxSeq (default: any), or null. */
  getSnapshot(maxSeq?: number): Promise<StoredSnapshot | null>;
  /** Keeps the `keep` newest snapshots. */
  pruneSnapshots(keep: number): Promise<void>;
}

export interface StoreProvider {
  project(id: string): ProjectStore;
  listProjects(): Promise<string[]>;
  /** Calls back when a project's event log grows (from any process). Returns an unsubscribe function. */
  subscribe?(project: string, cb: () => void): () => void;
  close?(): Promise<void>;
}

// ------------------------------------------------------------------ memory
class MemoryStore implements ProjectStore {
  events: DomainEvent[] = [];
  proposals = new Map<string, Proposal>();
  audit: AuditEntry[] = [];
  listeners = new Set<() => void>();
  async lastSeq() { return this.events.length; }
  async readEvents(after = 0) { return this.events.slice(after); }
  async appendEvents(evs: NewEvent[], expected: number) {
    if (expected !== this.events.length) throw new ConcurrencyError(`expected seq ${expected}, found ${this.events.length}`);
    const out = evs.map((e, i) => ({ ...e, seq: expected + i + 1 }));
    this.events.push(...out);
    this.listeners.forEach((l) => l());
    return out;
  }
  async readProposals() { return [...this.proposals.values()].map((p) => structuredClone(p)); }
  async saveProposal(p: Proposal) {
    this.proposals.set(p.id, structuredClone({ ...p, history: p.history ?? [{ status: p.status, at: p.createdAt, by: p.actor }] }));
  }
  async transitionProposal(id: string, from: ProposalStatus[], to: ProposalStatus, by: string, patch: Partial<Proposal> = {}, note?: string) {
    // synchronous check-and-set: no await between reading and writing, so it is atomic within the process
    const cur = this.proposals.get(id);
    if (!cur || !from.includes(cur.status)) return null;
    return structuredClone(transition(cur, to, by, patch, note));
  }
  async appendAudit(e: AuditEntry) { this.audit.push(e); }
  async readAudit(limit = 100) { return this.audit.slice(-limit).reverse(); }
  snapshots: StoredSnapshot[] = [];
  async saveSnapshot(x: StoredSnapshot) {
    if (!this.snapshots.some((y) => y.lastSeq === x.lastSeq)) this.snapshots.push({ ...x });
    this.snapshots.sort((a, b) => a.lastSeq - b.lastSeq);
  }
  async getSnapshot(maxSeq = Infinity) {
    const hit = [...this.snapshots].reverse().find((x) => x.lastSeq <= maxSeq);
    return hit ? { ...hit } : null;
  }
  async pruneSnapshots(keep: number) { this.snapshots = keep > 0 ? this.snapshots.slice(-keep) : []; }   // note: slice(-0) would keep everything
}

function transition(p: Proposal, to: ProposalStatus, by: string, patch: Partial<Proposal>, note?: string): Proposal {
  const at = new Date().toISOString();
  const { history: _h, status: _s, ...rest } = patch;
  Object.assign(p, rest, { status: to });
  p.history = [...(p.history ?? []), { status: to, at, by, ...(note ? { note } : {}) }];
  return p;
}

export class MemoryStores implements StoreProvider {
  private stores = new Map<string, MemoryStore>();
  project(id: string): MemoryStore {
    id = parseProjectId(id);
    let s = this.stores.get(id);
    if (!s) { s = new MemoryStore(); this.stores.set(id, s); }
    return s;
  }
  async listProjects() { return [...this.stores.keys()]; }
  subscribe(project: string, cb: () => void) {
    const s = this.project(project); // validates the id
    s.listeners.add(cb);
    return () => { s.listeners.delete(cb); };
  }
}

// ------------------------------------------------------------------ files (JSON lines)
/**
 * Advisory lock via exclusive file creation (O_EXCL), which is atomic on local
 * filesystems: gives mutual exclusion between processes on the same machine.
 * A lock older than STALE_MS (crashed holder) is broken. Not safe on network
 * filesystems that do not honour O_EXCL; use PostgreSQL for multi-user setups.
 */
const STALE_MS = 30_000;
async function withFileLock<T>(lockPath: string, fn: () => T | Promise<T>): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_MS) fs.unlinkSync(lockPath); } catch { /* raced */ }
      if (Date.now() > deadline) throw new ConcurrencyError("Store is busy (lock timeout).");
      await new Promise((r) => setTimeout(r, 3 + Math.random() * 7));
    }
  }
  try { return await fn(); } finally { try { fs.unlinkSync(lockPath); } catch { /* already gone */ } }
}

class FileStore implements ProjectStore {
  constructor(readonly dir: string) { fs.mkdirSync(dir, { recursive: true }); }
  private p(n: string) { return path.join(this.dir, n); }
  private proposalsSync(): Proposal[] {
    const f = this.p("proposals.json");
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
  }
  private writeProposalsSync(all: Proposal[]) {
    const tmp = this.p(`proposals.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(all, null, 1));
    fs.renameSync(tmp, this.p("proposals.json"));
  }
  private all(): DomainEvent[] {
    const f = this.p("events.jsonl");
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  }
  async lastSeq() { const a = this.all(); return a.length ? a[a.length - 1].seq : 0; }
  async readEvents(after = 0) { return this.all().filter((e) => e.seq > after); }
  async appendEvents(evs: NewEvent[], expected: number) {
    return withFileLock(this.p("events.lock"), async () => {
      const last = await this.lastSeq();
      if (last !== expected) throw new ConcurrencyError(`expected seq ${expected}, found ${last}`);
      const out = evs.map((e, i) => ({ ...e, seq: expected + i + 1 }));
      if (out.length) fs.appendFileSync(this.p("events.jsonl"), out.map((e) => JSON.stringify(e)).join("\n") + "\n");
      return out;
    });
  }
  async readProposals(): Promise<Proposal[]> { return this.proposalsSync(); }
  async saveProposal(p: Proposal) {
    await withFileLock(this.p("proposals.lock"), () => {
      const all = this.proposalsSync().filter((x) => x.id !== p.id);
      all.push({ ...p, history: p.history ?? [{ status: p.status, at: p.createdAt, by: p.actor }] });
      this.writeProposalsSync(all);
    });
  }
  async transitionProposal(id: string, from: ProposalStatus[], to: ProposalStatus, by: string, patch: Partial<Proposal> = {}, note?: string) {
    return withFileLock(this.p("proposals.lock"), () => {
      const all = this.proposalsSync();
      const cur = all.find((x) => x.id === id);
      if (!cur || !from.includes(cur.status)) return null;
      transition(cur, to, by, patch, note);
      this.writeProposalsSync(all);
      return cur;
    });
  }
  async appendAudit(e: AuditEntry) { fs.appendFileSync(this.p("audit.jsonl"), JSON.stringify(e) + "\n"); }

  // snapshots: <project>/snapshots/<lastSeq, 12 digits>.json — names are derived from numbers only
  private snapDir() { return this.p("snapshots"); }
  private snapFiles(): { seq: number; file: string }[] {
    const d = this.snapDir();
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).flatMap((f) => { const m = /^(\d{12})\.json$/.exec(f); return m ? [{ seq: Number(m[1]), file: path.join(d, f) }] : []; })
      .sort((a, b) => a.seq - b.seq);
  }
  /** Atomic: temp file -> fsync -> rename -> fsync(dir). A crash leaves either the old set or the new file, never a partial one. */
  async saveSnapshot(x: StoredSnapshot) {
    if (!Number.isInteger(x.lastSeq) || x.lastSeq < 1) throw new Error("invalid snapshot sequence");
    const d = this.snapDir();
    fs.mkdirSync(d, { recursive: true });
    const final = path.join(d, `${String(x.lastSeq).padStart(12, "0")}.json`);
    if (fs.existsSync(final)) return;
    const tmp = path.join(d, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fd = fs.openSync(tmp, "wx");
    try { fs.writeSync(fd, JSON.stringify(x)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, final);
    try { const dfd = fs.openSync(d, "r"); fs.fsyncSync(dfd); fs.closeSync(dfd); } catch { /* directory fsync unsupported on this platform */ }
  }
  async getSnapshot(maxSeq = Infinity) {
    const hit = this.snapFiles().reverse().find((f) => f.seq <= maxSeq);
    if (!hit) return null;
    try {
      const x = JSON.parse(fs.readFileSync(hit.file, "utf8"));
      return { lastSeq: hit.seq, snapshotVersion: Number(x?.snapshotVersion) || 0, body: typeof x?.body === "string" ? x.body : "" };
    } catch {
      return { lastSeq: hit.seq, snapshotVersion: 0, body: "" };          // unreadable file: the platform reports it and falls back
    }
  }
  async pruneSnapshots(keep: number) {
    const files = this.snapFiles();
    for (const f of files.slice(0, Math.max(files.length - Math.max(keep, 0), 0))) fs.rmSync(f.file, { force: true });
  }
  async readAudit(limit = 100) {
    const f = this.p("audit.jsonl");
    const rows: AuditEntry[] = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    return rows.slice(-limit).reverse();
  }
}

export class FileStores implements StoreProvider {
  readonly root: string;
  constructor(root: string) { fs.mkdirSync(root, { recursive: true }); this.root = path.resolve(root); }
  project(id: string) {
    const dir = path.join(this.root, parseProjectId(id));
    if (path.dirname(dir) !== path.resolve(this.root)) throw new Error("project directory escapes the store root"); // defence in depth
    return new FileStore(dir);
  }
  async listProjects() {
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isValidProjectId(d.name)
        && ["events.jsonl", "proposals.json"].some((file) => fs.existsSync(path.join(this.root, d.name, file)))).map((d) => d.name);
  }
  subscribe(project: string, cb: () => void) {
    const dir = path.join(this.root, parseProjectId(project));
    const signature = () => ["events.jsonl", "proposals.json"].map((name) => {
      try {
        const stat = fs.statSync(path.join(dir, name), { bigint: true });
        return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
        throw error;
      }
    }).join("|");
    let previous = signature();
    const t = setInterval(() => {
      const now = signature();
      if (now !== previous) { previous = now; cb(); }
    }, 700);
    return () => clearInterval(t);
  }
}
