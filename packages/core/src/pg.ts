/**
 * PostgreSQL persistence. One table set for all projects; (project, seq) is the
 * primary key of the event log, so concurrent appends cannot interleave: the
 * loser gets a unique violation -> ConcurrencyError -> the platform re-decides.
 * Every append sends NOTIFY insa_events so other processes (web server, MCP
 * server) see changes immediately.
 */
import pg from "pg";
import type { DomainEvent, NewEvent, Proposal, ProposalStatus, AuditEntry, ProjectStore, StoreProvider } from "./store.js";
import type { StoredSnapshot } from "./snapshots.js";
import { ConcurrencyError } from "./errors.js";
import { parseProjectId } from "./ids.js";

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS insa_projects (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS insa_events (
     project text NOT NULL REFERENCES insa_projects(id), seq bigint NOT NULL, module text NOT NULL, type text NOT NULL,
     payload jsonb NOT NULL, command_id text NOT NULL, actor text NOT NULL, at timestamptz NOT NULL,
     PRIMARY KEY (project, seq))`,
  `CREATE INDEX IF NOT EXISTS insa_events_command ON insa_events (project, command_id)`,
  `CREATE TABLE IF NOT EXISTS insa_proposals (
     project text NOT NULL REFERENCES insa_projects(id), id text NOT NULL, status text NOT NULL,
     created_at timestamptz NOT NULL, data jsonb NOT NULL, PRIMARY KEY (project, id))`,
  `CREATE TABLE IF NOT EXISTS insa_audit (
     id bigserial PRIMARY KEY, project text NOT NULL REFERENCES insa_projects(id), at timestamptz NOT NULL,
     actor text NOT NULL, action text NOT NULL, outcome text NOT NULL, data jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS insa_audit_project ON insa_audit (project, id DESC)`,
  // Phase 3: event schema version (NULL on legacy rows = version 1; history is never rewritten) and snapshots
  `ALTER TABLE insa_events ADD COLUMN IF NOT EXISTS schema_version integer`,
  `CREATE TABLE IF NOT EXISTS insa_snapshots (
     project text NOT NULL REFERENCES insa_projects(id), last_seq bigint NOT NULL, snapshot_version integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(), body text NOT NULL, PRIMARY KEY (project, last_seq))`,
];

class PgStore implements ProjectStore {
  /** `migrated` resolves once the schema migrations ran: EVERY query waits for it (reads included). */
  constructor(private pool: pg.Pool, private project: string, private ensure: () => Promise<void>, private migrated: () => Promise<void>) {}

  async lastSeq() {
    await this.migrated();
    const r = await this.pool.query(`SELECT coalesce(max(seq), 0) AS s FROM insa_events WHERE project = $1`, [this.project]);
    return Number(r.rows[0].s);
  }
  async readEvents(after = 0): Promise<DomainEvent[]> {
    await this.migrated();
    const r = await this.pool.query(
      `SELECT seq, module, type, payload, command_id, actor, at, schema_version FROM insa_events WHERE project = $1 AND seq > $2 ORDER BY seq`,
      [this.project, after]);
    return r.rows.map((x) => ({ seq: Number(x.seq), module: x.module, type: x.type, payload: x.payload,
                                commandId: x.command_id, actor: x.actor, at: new Date(x.at).toISOString(),
                                ...(x.schema_version === null ? {} : { schemaVersion: Number(x.schema_version) }) }));
  }
  async appendEvents(evs: NewEvent[], expected: number): Promise<DomainEvent[]> {
    await this.ensure();
    const out = evs.map((e, i) => ({ ...e, seq: expected + i + 1 }));
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const last = Number((await c.query(`SELECT coalesce(max(seq), 0) AS s FROM insa_events WHERE project = $1`, [this.project])).rows[0].s);
      if (last !== expected) throw new ConcurrencyError(`expected seq ${expected}, found ${last}`);
      await c.query(
        `INSERT INTO insa_events (project, seq, module, type, payload, command_id, actor, at, schema_version)
         SELECT $1, * FROM unnest($2::bigint[], $3::text[], $4::text[], $5::jsonb[], $6::text[], $7::text[], $8::timestamptz[], $9::integer[])`,
        [this.project, out.map((e) => e.seq), out.map((e) => e.module), out.map((e) => e.type),
         out.map((e) => JSON.stringify(e.payload)), out.map((e) => e.commandId), out.map((e) => e.actor), out.map((e) => e.at),
         out.map((e) => e.schemaVersion ?? null)]);
      await c.query(`SELECT pg_notify('insa_events', $1)`, [this.project]);
      await c.query("COMMIT");
      return out;
    } catch (e: any) {
      await c.query("ROLLBACK").catch(() => {});
      if (e?.code === "23505") throw new ConcurrencyError("concurrent append");
      throw e;
    } finally {
      c.release();
    }
  }
  async readProposals(): Promise<Proposal[]> {
    await this.migrated();
    const r = await this.pool.query(`SELECT data FROM insa_proposals WHERE project = $1 ORDER BY created_at`, [this.project]);
    return r.rows.map((x) => x.data);
  }
  async saveProposal(p: Proposal) {
    await this.ensure();
    const rec = { ...p, history: p.history ?? [{ status: p.status, at: p.createdAt, by: p.actor }] };
    const r = await this.pool.query(
      `INSERT INTO insa_proposals (project, id, status, created_at, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (project, id) DO NOTHING`,
      [this.project, p.id, p.status, p.createdAt, JSON.stringify(rec)]);
    if (r.rowCount !== 1) throw new ConcurrencyError(`Proposal ${p.id} already exists.`);
  }
  /** Atomic CAS: the row lock of UPDATE ... WHERE status = ANY(from) lets exactly one caller win. */
  async transitionProposal(id: string, from: ProposalStatus[], to: ProposalStatus, by: string, patch: Partial<Proposal> = {}, note?: string) {
    await this.ensure();
    const { history: _h, status: _s, ...rest } = patch;
    const entry = [{ status: to, at: new Date().toISOString(), by, ...(note ? { note } : {}) }];
    const r = await this.pool.query(
      `UPDATE insa_proposals
          SET status = $4,
              data = (data || $5::jsonb) || jsonb_build_object('status', $4::text, 'history', coalesce(data->'history', '[]'::jsonb) || $6::jsonb)
        WHERE project = $1 AND id = $2 AND status = ANY($3::text[])
        RETURNING data`,
      [this.project, id, from, to, JSON.stringify(rest), JSON.stringify(entry)]);
    return r.rowCount === 1 ? (r.rows[0].data as Proposal) : null;
  }
  async appendAudit(e: AuditEntry) {
    await this.ensure();
    await this.pool.query(`INSERT INTO insa_audit (project, at, actor, action, outcome, data) VALUES ($1, $2, $3, $4, $5, $6)`,
      [this.project, e.at, e.actor, e.action, e.outcome, JSON.stringify(e)]);
  }
  async saveSnapshot(x: StoredSnapshot) {
    await this.ensure();
    await this.pool.query(
      `INSERT INTO insa_snapshots (project, last_seq, snapshot_version, body) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [this.project, x.lastSeq, x.snapshotVersion, x.body]);
  }
  async getSnapshot(maxSeq = Infinity): Promise<StoredSnapshot | null> {
    await this.migrated();
    const r = await this.pool.query(
      `SELECT last_seq, snapshot_version, body FROM insa_snapshots WHERE project = $1 AND last_seq <= $2 ORDER BY last_seq DESC LIMIT 1`,
      [this.project, Number.isFinite(maxSeq) ? maxSeq : Number.MAX_SAFE_INTEGER]);
    if (!r.rowCount) return null;
    const x = r.rows[0];
    return { lastSeq: Number(x.last_seq), snapshotVersion: Number(x.snapshot_version), body: x.body };
  }
  async pruneSnapshots(keep: number) {
    await this.migrated();
    await this.pool.query(
      `DELETE FROM insa_snapshots WHERE project = $1 AND last_seq NOT IN
         (SELECT last_seq FROM insa_snapshots WHERE project = $1 ORDER BY last_seq DESC LIMIT $2)`, [this.project, Math.max(keep, 0)]);
  }
  async readAudit(limit = 100): Promise<AuditEntry[]> {
    await this.migrated();
    const r = await this.pool.query(`SELECT data FROM insa_audit WHERE project = $1 ORDER BY id DESC LIMIT $2`, [this.project, limit]);
    return r.rows.map((x) => x.data);
  }
}

export class PostgresStores implements StoreProvider {
  readonly pool: pg.Pool;
  private listener: pg.Client | null = null;
  private subs = new Map<string, Set<() => void>>();
  private known = new Set<string>();
  private ready: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
    this.ready = this.migrate();
  }
  private async migrate() {
    for (const m of MIGRATIONS) await this.pool.query(m);
  }
  project(id: string): ProjectStore {
    id = parseProjectId(id);
    return new PgStore(this.pool, id, async () => {
      await this.ready;
      if (this.known.has(id)) return;
      await this.pool.query(`INSERT INTO insa_projects (id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
      this.known.add(id);
    }, () => this.ready);
  }
  async listProjects() {
    await this.ready;
    return (await this.pool.query(`SELECT id FROM insa_projects ORDER BY created_at`)).rows.map((r) => r.id as string);
  }
  subscribe(project: string, cb: () => void) {
    project = parseProjectId(project);
    let set = this.subs.get(project);
    if (!set) { set = new Set(); this.subs.set(project, set); }
    set.add(cb);
    if (!this.listener) {
      const c = new pg.Client({ connectionString: (this.pool as any).options.connectionString });
      this.listener = c;
      c.on("notification", (n) => this.subs.get(n.payload ?? "")?.forEach((f) => f()));
      void c.connect().then(() => c.query("LISTEN insa_events"));
    }
    return () => { set!.delete(cb); };
  }
  async close() {
    await this.ready.catch(() => {});        // never end the pool under a running migration
    await this.listener?.end().catch(() => {});
    await this.pool.end();
  }
}
