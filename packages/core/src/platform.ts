/**
 * Platform kernel: the "manager" behind the manager MCP and the web API.
 *
 * - Modules register state + tools. Query tools read state; command tools
 *   *decide* domain events from (state, input) without side effects.
 * - Every write: permission -> decide -> (dry-run | proposal | apply) ->
 *   append events with optimistic concurrency (retry on conflict) -> audit.
 * - State is rebuilt from the event log and kept up to date incrementally.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Actor, RoleTable, DEFAULT_ROLES, can, permissionsOf } from "./auth.js";
import { DomainEvent, Proposal, ProjectStore, StoreProvider, AuditEntry } from "./store.js";
import { DomainError, PermissionError, ConcurrencyError, IntegrityError, publicError } from "./errors.js";
import { EventRegistry, Upcaster, CurrentEvent } from "./events.js";
import { SnapshotPolicy, SnapshotEnvelope, DEFAULT_SNAPSHOT_POLICY, SNAPSHOT_VERSION, encodeSnapshot, decodeSnapshot } from "./snapshots.js";
import { parseProjectId } from "./ids.js";
import type { ArtifactStore } from "./artifacts.js";

export type Effect = "read" | "write" | "destructive";

export interface ToolContext<S> { state: S; project: string; actor: Actor; platform: Platform; states?: ReadonlyMap<string, any>; }

interface ToolBase<I> {
  name: string; module: string; title: string; description: string; permission: string; input: z.ZodType<I>;
}
export interface QueryTool<S, I = any> extends ToolBase<I> {
  kind: "query"; effect: "read";
  run(ctx: ToolContext<S>, input: I): unknown | Promise<unknown>;
}
export interface Decision { events: { type: string; payload: unknown; module?: string }[]; summary: unknown; }
export interface CommandTool<S, I = any> extends ToolBase<I> {
  kind: "command"; effect: "write" | "destructive";
  decide(state: S, input: I, ctx: ToolContext<S>): Decision;
  /** Pure composition of registered commands. The kernel authorizes every child and commits all modules atomically. */
  expand?(ctx: ToolContext<S>, input: I): { steps: { tool: string; input: unknown }[]; summary: unknown; permissions?: string[] };
  /**
   * Optional: makes the input explicit against the current state when a
   * proposal is created, so approval later applies exactly what was previewed
   * (e.g. undo pins the target command id).
   */
  pin?(state: S, input: I, ctx?: ToolContext<S>): I;
}
export type ToolDef<S = any, I = any> = QueryTool<S, I> | CommandTool<S, I>;

export interface ModuleDef<S = any> {
  id: string;
  title: string;
  initialState(): S;
  apply(state: S, ev: DomainEvent): S;
  /**
   * Command-time invariant check on the candidate state (throw DomainError to reject the whole command).
   * `before` is the state before the command, so a module can validate only what the command touched.
   * Never called during replay: historical events are trusted.
   */
  validate?(after: S, before: S): void;
  tools: ToolDef<S>[];
  /** Current schema version of each event type this module writes (the single authoritative declaration). */
  eventVersions?: Record<string, number>;
  /** Pure upcasters for older stored versions of this module's events. */
  upcasters?: Upcaster[];
  /** Format version of the reduced state; bump it when the state shape changes so old snapshots are ignored. */
  stateVersion?: number;
}

export type ApprovalMode = "auto" | "ai" | "all";

export interface PlatformOptions {
  /** Cross-module reference invariants on the same optimistic command snapshot. */
  validateProject?(after: ReadonlyMap<string, any>, before: ReadonlyMap<string, any>, project:string): void;
  modules: ModuleDef[];
  stores: StoreProvider;
  /** Server-controlled export storage (required by export tools). */
  artifacts?: ArtifactStore;
  roles?: RoleTable;
  approvalMode?: ApprovalMode;
  /** Snapshot policy; false disables snapshots (pure event replay). Default: DEFAULT_SNAPSHOT_POLICY. */
  snapshotPolicy?: SnapshotPolicy | false;
  /** Diagnostics sink (snapshot loaded / ignored / save failed, ...). Default: warnings to stderr. */
  logger?: PlatformLogger;
}

export interface PlatformLogger {
  info(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
}
const defaultLogger: PlatformLogger = {
  info: (e, d) => { if (process.env.INSA_LOG_SNAPSHOTS) console.error(`[insa] ${e}`, d ?? ""); },
  warn: (e, d) => console.warn(`[insa] ${e}`, d ?? ""),                      // stderr: safe for the MCP stdio transport
};

export type ExecResult =
  | { status: "ok"; result: unknown }
  | { status: "preview"; preview: unknown }
  | { status: "proposed"; proposalId: string; preview: unknown; message: string }
  | { status: "applied"; commandId: string; summary: unknown; events: number; seq: number };

interface Cached {
  seq: number;
  states: Map<string, unknown>;
  reverted: Set<string>;
  lastCommandId: string;
  /** lastSeq of the snapshot this cache was built from or last wrote (0: none) */
  snapshotSeq: number;
}

// ------------------------------------------------------------------ platform state (commands & reverts)
/** `seq` is the sequence number of the command's CommandApplied event (all its events follow it contiguously). */
export interface CommandRecord { commandId: string; seq: number; tool: string; actor: string; at: string; summary: unknown; proposalId?: string; }
export interface PlatformState { commands: CommandRecord[]; reverted: Record<string, true>; }
export const PLATFORM_MODULE = "platform";

/** Internal module over the platform's own events; it is applied for every event, reverted or not. */
const platformModule: ModuleDef<PlatformState> = {
  id: PLATFORM_MODULE,
  title: "Platform",
  initialState: () => ({ commands: [], reverted: {} }),
  apply(s, e) {
    if (e.type === "CommandApplied")
      s.commands.push({ commandId: e.commandId, seq: e.seq, tool: e.payload.tool, actor: e.actor, at: e.at, summary: e.payload.summary,
                        ...(e.payload.proposalId !== undefined ? { proposalId: e.payload.proposalId } : {}) });
    if (e.type === "CommandReverted") s.reverted[e.payload.commandId] = true;
    return s;
  },
  tools: [],
  eventVersions: { CommandApplied: 1, CommandReverted: 1 },
};

/**
 * Undo is a governed, destructive command (not a query): it goes through the
 * same execute path as every other write (permission platform.undo, dry run,
 * AI proposals, optimistic concurrency, audit). Only the latest live command
 * can be undone; undo commands themselves are not undoable.
 */
const undoTool: CommandTool<PlatformState, { command_id?: string }> = {
  kind: "command", effect: "destructive", module: PLATFORM_MODULE, name: "platform_undo", title: "Undo last command",
  description: "Revert the latest applied command (event-sourced, audited). Needs platform.undo; AI callers get a proposal in approval modes.",
  permission: "platform.undo",
  input: z.object({ command_id: z.string().optional().describe("Must be the latest live command if given") }),
  decide(s, i) {
    const live = s.commands.filter((c) => c.tool !== "platform_undo" && !s.reverted[c.commandId]);
    if (i.command_id) {
      const hit = s.commands.find((c) => c.commandId === i.command_id);
      if (!hit) throw new DomainError(`Command ${i.command_id} not found.`, "COMMAND_NOT_FOUND");
      if (hit.tool === "platform_undo") throw new DomainError("An undo cannot be undone.", "NOT_LATEST_COMMAND");
      if (s.reverted[hit.commandId]) throw new DomainError(`Command ${i.command_id} is already reverted.`, "COMMAND_ALREADY_REVERTED");
    }
    if (!live.length) throw new DomainError("Nothing to undo.", "NOTHING_TO_UNDO");
    const target = live[live.length - 1];
    if (i.command_id && i.command_id !== target.commandId)
      throw new DomainError(`Only the latest command can be undone (latest is ${target.commandId}).`, "NOT_LATEST_COMMAND");
    return { events: [{ type: "CommandReverted", payload: { commandId: target.commandId } }],
             summary: { reverted: target.commandId, tool: target.tool } };
  },
  // a proposal must revert the command that was previewed, not whatever is latest at approval time
  pin(s, i) {
    if (i.command_id) return i;
    const live = s.commands.filter((c) => c.tool !== "platform_undo" && !s.reverted[c.commandId]);
    return live.length ? { command_id: live[live.length - 1].commandId } : i;
  },
};

const now = () => new Date().toISOString();
const RETRIES = 12;
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, Math.random() * 8 * attempt));

export class Platform {
  readonly roles: RoleTable;
  readonly approvalMode: ApprovalMode;
  readonly stores: StoreProvider;
  private modules = new Map<string, ModuleDef>();
  private toolMap = new Map<string, ToolDef>();
  private cache = new Map<string, Cached>();
  private validateProject?: PlatformOptions['validateProject'];

  constructor(opts: PlatformOptions) {
    this.validateProject = opts.validateProject;
    this.roles = opts.roles ?? DEFAULT_ROLES;
    this.approvalMode = opts.approvalMode ?? "auto";
    this.stores = opts.stores;
    for (const m of opts.modules) {
      this.modules.set(m.id, m);
      for (const t of m.tools) {
        if (this.toolMap.has(t.name)) throw new Error(`Duplicate tool ${t.name}`);
        this.toolMap.set(t.name, t);
      }
    }
    for (const t of platformTools()) this.toolMap.set(t.name, t);
    this.modules.set(PLATFORM_MODULE, platformModule);
    this.toolMap.set(undoTool.name, undoTool);
    this.artifacts = opts.artifacts;
    this.registry = new EventRegistry([...this.modules.values()].map((m) => ({ module: m.id, eventVersions: m.eventVersions, upcasters: m.upcasters })));
    this.policy = opts.snapshotPolicy === false ? null : (opts.snapshotPolicy ?? DEFAULT_SNAPSHOT_POLICY);
    this.logger = opts.logger ?? defaultLogger;
  }

  readonly registry: EventRegistry;
  readonly policy: SnapshotPolicy | null;
  private logger: PlatformLogger;
  /** Counters for tests and diagnostics: events passed through reducers since construction. */
  readonly metrics = { replayedEvents: 0, snapshotsLoaded: 0, snapshotsWritten: 0 };

  readonly artifacts?: ArtifactStore;
  requireArtifacts(): ArtifactStore {
    if (!this.artifacts) throw new Error("Export storage is not configured (PlatformOptions.artifacts).");
    return this.artifacts;
  }

  listTools(): ToolDef[] { return [...this.toolMap.values()]; }
  listModules() {
    return [...this.modules.values()].filter((m) => m.id !== PLATFORM_MODULE).map((m) => ({ id: m.id, title: m.title, tools: m.tools.length }));
  }
  tool(name: string): ToolDef {
    const t = this.toolMap.get(name);
    if (!t) throw new DomainError(`Unknown tool '${name}'.`, "UNKNOWN_TOOL");
    return t;
  }
  /** The only way to a project's storage; validates the id with the canonical rule. */
  store(project: string): ProjectStore { return this.stores.project(parseProjectId(project)); }

  // ---------------------------------------------------------------- state
  private fresh(): Cached {
    const states = new Map<string, unknown>();
    for (const m of this.modules.values()) states.set(m.id, m.initialState());
    return { seq: 0, states, reverted: new Set(), lastCommandId: "", snapshotSeq: 0 };
  }
  private stateVersions(): Record<string, number> {
    return Object.fromEntries([...this.modules.values()].map((m) => [m.id, m.stateVersion ?? 1]));
  }
  private diag(level: "info" | "warn", event: string, details: Record<string, unknown>) {
    try { this.logger[level](event, details); } catch { /* diagnostics never break replay */ }
  }
  private static revertTargets(events: CurrentEvent[]): string[] {
    return events.filter((e) => e.module === PLATFORM_MODULE && e.type === "CommandReverted").map((e) => e.payload.commandId as string);
  }
  private read = async (store: ProjectStore, after: number) => (await store.readEvents(after)).map((e) => this.registry.upcast(e));

  /**
   * Applies current-representation events strictly in sequence (no gaps, no repeats).
   * `c.reverted` must already contain every command reverted by these events.
   */
  private applyAll(c: Cached, events: CurrentEvent[]) {
    for (const e of events) {
      if (e.seq !== c.seq + 1)
        throw new IntegrityError(`Event sequence broken: expected #${c.seq + 1}, found #${e.seq}.`, "EVENT_SEQUENCE_ERROR", { expected: c.seq + 1, found: e.seq });
      c.seq = e.seq;
      c.lastCommandId = e.commandId;
      this.metrics.replayedEvents++;
      if (e.module === PLATFORM_MODULE) {
        c.states.set(PLATFORM_MODULE, platformModule.apply(c.states.get(PLATFORM_MODULE) as PlatformState, e));
        if (e.type === "CommandReverted") c.reverted.add(e.payload.commandId);
        continue;
      }
      if (c.reverted.has(e.commandId)) continue;
      const m = this.modules.get(e.module);
      if (m) c.states.set(m.id, m.apply(c.states.get(m.id), e));
    }
  }

  /**
   * Builds a project's state: the newest usable snapshot + the events after it, else a full replay.
   * A snapshot is skipped (falling back to an older one, then to full replay) when it is
   * unreadable, corrupted or incompatible, when it was cut inside a command, or when an
   * undo after it targets a command at or before it (that command's effects are baked in).
   */
  private async load(project: string): Promise<Cached> {
    const store = this.store(project);
    let maxSeq = Infinity;
    while (this.policy) {
      const raw = await store.getSnapshot(maxSeq);
      if (!raw) break;
      let env: SnapshotEnvelope;
      try { env = decodeSnapshot(raw, project, this.stateVersions()); }
      catch (e) {
        const reason = (e as any).reason ?? "INVALID_SNAPSHOT";
        this.diag("warn", reason === "UNSUPPORTED_SNAPSHOT_VERSION" ? "snapshot.ignored_incompatible" : "snapshot.fallback_corrupted",
                  { project, lastSeq: raw.lastSeq, reason });
        maxSeq = raw.lastSeq - 1;
        continue;
      }
      const tail = await this.read(store, env.lastSeq);
      if (tail.length && tail[0].commandId === env.lastCommandId) {
        this.diag("warn", "snapshot.ignored_mid_command", { project, lastSeq: env.lastSeq });
        maxSeq = env.lastSeq - 1;
        continue;
      }
      const meta = env.replay as PlatformState;
      const seqOf = new Map(meta.commands.map((x) => [x.commandId, x.seq]));
      const early = Platform.revertTargets(tail).map((t) => seqOf.get(t)).filter((x): x is number => x !== undefined);
      if (early.length) {
        this.diag("info", "snapshot.predates_undo_target", { project, lastSeq: env.lastSeq, targetSeq: Math.min(...early) });
        maxSeq = Math.min(...early) - 1;
        continue;
      }
      const c = this.fresh();
      for (const [m, st] of Object.entries(env.state)) c.states.set(m, st);
      c.states.set(PLATFORM_MODULE, meta);
      Object.assign(c, { seq: env.lastSeq, lastCommandId: env.lastCommandId, snapshotSeq: env.lastSeq });
      c.reverted = new Set([...Object.keys(meta.reverted), ...Platform.revertTargets(tail)]);
      this.applyAll(c, tail);
      this.metrics.snapshotsLoaded++;
      this.diag("info", "snapshot.loaded", { project, lastSeq: env.lastSeq, replayedEvents: tail.length });
      return c;
    }
    const all = await this.read(store, 0);
    const c = this.fresh();
    c.reverted = new Set(Platform.revertTargets(all));
    this.applyAll(c, all);
    return c;
  }

  /**
   * Current state of a project: incremental on new events; an undo triggers a (snapshot-assisted) rebuild.
   * Calls are serialised per project: two concurrent callers must never read the same tail and
   * apply it twice to the shared cache.
   */
  async snapshot(project: string): Promise<Cached> {
    project = parseProjectId(project);
    const run = (this.loading.get(project) ?? Promise.resolve()).then(() => this.refresh(project));
    this.loading.set(project, run.catch(() => undefined));
    return run;
  }
  private loading = new Map<string, Promise<unknown>>();

  private async refresh(project: string): Promise<Cached> {
    const cached = this.cache.get(project);
    try {
      if (cached) {
        const tail = await this.read(this.store(project), cached.seq);
        if (!Platform.revertTargets(tail).length) { this.applyAll(cached, tail); return cached; }
      }
      const c = await this.load(project);
      this.cache.set(project, c);
      return c;
    } catch (e) {
      this.cache.delete(project);                       // never keep a half-applied cache
      if (e instanceof IntegrityError) this.diag("warn", "replay.failed", { project, reason: e.reason, ...(e.details ?? {}) });
      throw e;
    }
  }

  /**
   * Writes a snapshot of the current state. Always at a command boundary: the
   * cached state is built from whole commands (each command is appended
   * atomically), and the boundary is re-checked against the log before writing.
   */
  async createSnapshot(project: string): Promise<{ lastSeq: number; written: boolean } | null> {
    project = parseProjectId(project);
    const c = await this.snapshot(project);
    if (c.seq === 0) return null;
    const store = this.store(project);
    const next = (await store.readEvents(c.seq))[0];
    if (next && next.commandId === c.lastCommandId) {
      this.diag("warn", "snapshot.skipped_not_command_boundary", { project, seq: c.seq });
      return null;
    }
    const state: Record<string, unknown> = {};
    for (const [id, st] of c.states) if (id !== PLATFORM_MODULE) state[id] = st;
    const modules = Object.fromEntries(Object.entries(this.stateVersions()).map(([m, v]) => [m, { stateVersion: v }]));
    const snap = encodeSnapshot({ snapshotVersion: SNAPSHOT_VERSION, project, lastSeq: c.seq, lastCommandId: c.lastCommandId,
      createdAt: now(), modules, state, replay: c.states.get(PLATFORM_MODULE) });
    await store.saveSnapshot(snap);
    // snapshots are write-once per sequence (Phase 3): an older-format snapshot already in this slot is kept
    // untouched, so say so instead of reporting a write that did not happen (the next command's slot is free)
    const stored = await store.getSnapshot(c.seq);
    if (!stored || stored.lastSeq !== c.seq || stored.body !== snap.body) {
      this.diag("warn", "snapshot.slot_taken", { project, seq: c.seq });
      c.snapshotSeq = c.seq;
      return { lastSeq: c.seq, written: false };
    }
    if (this.policy) await store.pruneSnapshots(this.policy.keep);
    c.snapshotSeq = c.seq;
    this.metrics.snapshotsWritten++;
    return { lastSeq: c.seq, written: true };
  }

  /** After a committed command: snapshot when the policy says so. Failures are reported, never propagated. */
  private async maybeSnapshot(project: string) {
    if (!this.policy) return;
    try {
      const c = await this.snapshot(project);
      if (c.seq - c.snapshotSeq >= this.policy.everyEvents) await this.createSnapshot(project);
    } catch (e) {
      this.diag("warn", "snapshot.save_failed", { project, reason: publicError(e).reason });
    }
  }

  async state<S>(project: string, moduleId: string): Promise<S> {
    return (await this.snapshot(project)).states.get(moduleId) as S;
  }
  async seq(project: string) { return (await this.snapshot(project)).seq; }

  // ---------------------------------------------------------------- policy
  needsApproval(actor: Actor, tool: ToolDef): boolean {
    if (tool.kind !== "command") return false;
    if (this.approvalMode === "auto") return false;
    if (actor.kind === "ai") return true; // an AI never bypasses approval, whatever roles it carries
    if (can(actor, "platform.autoapply", this.roles)) return false;
    if (this.approvalMode === "ai") return false; // humans apply directly in "ai" mode
    return true;
  }
  private audit(project: string, e: Omit<AuditEntry, "at">) {
    return this.store(project).appendAudit({ at: now(), ...e });
  }
  private async checkPermission(actor: Actor, project: string, tool: ToolDef) {
    if (tool.permission === "platform.self") return;
    if (!can(actor, tool.permission, this.roles)) {
      await this.audit(project, { actor: actor.id, action: tool.name, outcome: "denied", detail: { needs: tool.permission } });
      throw new PermissionError(`${actor.name} (${actor.roles.join(", ")}) lacks '${tool.permission}' for ${tool.name}.`);
    }
  }

  // ---------------------------------------------------------------- execute
  async execute(actor: Actor, project: string, toolName: string, rawInput: unknown,
                opts: { dryRun?: boolean } = {}): Promise<ExecResult> {
    project = parseProjectId(project);
    const tool = this.tool(toolName);
    await this.checkPermission(actor, project, tool);
    const parsed = tool.input.safeParse(rawInput ?? {});
    if (!parsed.success) throw new DomainError(`Invalid input for ${tool.name}: ${parsed.error.message}`, "INVALID_INPUT");
    const input = parsed.data;

    if (tool.kind === "query") {
      const state = tool.module === PLATFORM_MODULE ? null : await this.state(project, tool.module);
      return { status: "ok", result: await tool.run({ state, project, actor, platform: this }, input) };
    }
    if (opts.dryRun) return { status: "preview", preview: (await this.simulate(actor, project, tool, input)).preview };

    if (this.needsApproval(actor, tool)) {
      const pinSnapshot = await this.snapshot(project);
      const pinState = structuredClone(pinSnapshot.states.get(tool.module));
      const pinned = tool.pin ? tool.pin(pinState, input, { state: pinState, states: structuredClone(pinSnapshot.states), actor, project, platform: this }) : input;
      const { decision, preview } = await this.simulate(actor, project, tool, pinned);
      const p: Proposal = { id: "P-" + randomUUID().slice(0, 8), tool: tool.name, input: pinned, actor: actor.id,
                            createdAt: now(), preview, status: "pending" };
      await this.store(project).saveProposal(p);
      await this.audit(project, { actor: actor.id, action: tool.name, outcome: "proposed", proposalId: p.id, detail: decision.summary });
      return { status: "proposed", proposalId: p.id, preview,
               message: `Waiting for approval by a user with 'platform.approve' (proposal ${p.id}).` };
    }
    const { commandId, decision, seq } = await this.decideAndCommit(actor, project, tool, input);
    await this.audit(project, { actor: actor.id, action: tool.name, outcome: "applied", commandId, detail: decision.summary });
    return { status: "applied", commandId, summary: decision.summary, events: decision.events.length, seq };
  }

  /** Decide on a clone of the current state, apply to a clone, validate. Nothing is persisted. */
  private async simulate(actor: Actor, project: string, tool: ToolDef, input: unknown, approvedProposal = false) {
    if (tool.kind !== "command") throw new Error("not a command");
    const snap = await this.snapshot(project);
    const mod = this.modules.get(tool.module)!;
    const base = snap.states.get(tool.module);
    const states = structuredClone(snap.states);
    const ctx: ToolContext<any> = { state: structuredClone(base), states, project, actor, platform: this };
    let decision: Decision;
    const candidate = new Map(snap.states);
    if (tool.expand) {
      const plan = tool.expand(ctx, input);
      if (!approvedProposal) for (const permission of plan.permissions ?? []) await this.checkPermission(actor, project, { ...tool, permission });
      decision = { events: [], summary: plan.summary };
      for (const step of plan.steps) {
        const child = this.tool(step.tool);
        if (child.kind !== 'command' || child.expand || child.module === PLATFORM_MODULE)
          throw new DomainError('Composite steps must be leaf domain commands.', 'INVALID_COMPOSITION');
        // The original proposal was authorized before storage; approval revalidates its pinned input.
        if (!approvedProposal) await this.checkPermission(actor, project, child);
        const parsed = child.input.safeParse(step.input);
        if (!parsed.success) throw new DomainError(`Invalid input for ${child.name}: ${parsed.error.message}`, 'INVALID_INPUT');
        const childBase = states.get(child.module);
        const childDecision = child.decide(structuredClone(childBase), parsed.data,
          { ...ctx, state: structuredClone(childBase) });
        const childMod = this.modules.get(child.module)!;
        let childAfter = structuredClone(childBase);
        for (const e of childDecision.events) {
          if (e.module && e.module !== child.module) throw new DomainError('A leaf command cannot write another module.', 'INVALID_COMPOSITION');
          childAfter = childMod.apply(childAfter, { seq: 0, module: child.module, commandId: 'preview', actor: actor.id, at: now(), type: e.type, payload: structuredClone(e.payload) });
          decision.events.push({ ...e, module: child.module });
        }
        childMod.validate?.(childAfter, childBase);
        states.set(child.module, childAfter);
        candidate.set(child.module, childAfter);
      }
    } else {
      decision = tool.decide(ctx.state, input, ctx);
      if (decision.events.some(e => e.module && e.module !== tool.module))
        throw new DomainError('A leaf command cannot write another module.', 'INVALID_COMPOSITION');
      let after = structuredClone(base);
      const fake = { seq: 0, module: mod.id, commandId: "preview", actor: actor.id, at: now() };
      for (const e of decision.events) after = mod.apply(after, { ...fake, type: e.type, payload: structuredClone(e.payload) });
      mod.validate?.(after, base);
      candidate.set(tool.module, after);
    }
    if (!decision.events.length) throw new DomainError(`${tool.name}: nothing to do.`);
    this.validateProject?.(candidate, snap.states, ctx.project);
    return { decision, seq: snap.seq,
             preview: { tool: tool.name, summary: decision.summary, events: decision.events.map((e) => e.type) } };
  }

  /** Optimistic concurrency: re-decide on the fresh state when another writer got there first. */
  private async decideAndCommit(actor: Actor, project: string, tool: ToolDef, input: unknown, proposalId?: string) {
    for (let attempt = 1; ; attempt++) {
      if (proposalId) {
        // at-most-once guard on the event log itself (re-checked on every retry)
        const ps = (await this.snapshot(project)).states.get(PLATFORM_MODULE) as PlatformState;
        if (ps.commands.some((c) => c.proposalId === proposalId))
          throw new DomainError(`Proposal ${proposalId} has already been applied.`, "PROPOSAL_ALREADY_APPLIED");
      }
      const { decision, seq } = await this.simulate(actor, project, tool, input, !!proposalId);
      const commandId = "CMD-" + randomUUID().slice(0, 8);
      const base = { commandId, actor: actor.id, at: now() };
      try {
        const v = (module: string, type: string) => this.registry.currentVersion(module, type);
        const out = await this.store(project).appendEvents([
          { ...base, module: PLATFORM_MODULE, type: "CommandApplied", schemaVersion: v(PLATFORM_MODULE, "CommandApplied"),
            payload: { tool: tool.name, summary: decision.summary, ...(proposalId ? { proposalId } : {}) } },
          ...decision.events.map((e) => ({ ...base, module: e.module ?? tool.module, type: e.type, schemaVersion: v(e.module ?? tool.module, e.type), payload: e.payload })),
        ], seq);
        await this.maybeSnapshot(project);            // optimisation only: cannot fail the committed command
        return { commandId, decision, seq: out[out.length - 1].seq };
      } catch (e) {
        if (!(e instanceof ConcurrencyError) || attempt >= RETRIES) throw e;
        await backoff(attempt); // jittered: contending writers spread out
      }
    }
  }

  // ---------------------------------------------------------------- platform actions
  /**
   * Approves a proposal at most once: pending -> applying is an atomic
   * compare-and-set in the store, so concurrent approvals (or an approval racing
   * a rejection) have exactly one winner. The command is then re-decided on the
   * current state; success -> applied, domain failure -> failed, conflict -> back
   * to pending (retryable). Every outcome is audited.
   */
  async approve(actor: Actor, project: string, proposalId: string) {
    project = parseProjectId(project);
    if (actor.kind === "ai") throw new PermissionError("An AI actor cannot approve proposals.");
    if (!can(actor, "platform.approve", this.roles)) throw new PermissionError(`${actor.name} cannot approve.`);
    const store = this.store(project);
    const p = (await store.readProposals()).find((x) => x.id === proposalId);
    if (!p) throw new DomainError(`Proposal ${proposalId} not found.`, "PROPOSAL_NOT_FOUND");
    if (p.actor === actor.id) throw new PermissionError("Four-eyes rule: a proposal cannot be approved by its author.");
    const claimed = await store.transitionProposal(proposalId, ["pending"], "applying", actor.id, { decidedBy: actor.id, decidedAt: now() });
    if (!claimed) throw await this.notPending(store, proposalId);
    const tool = this.tool(p.tool);
    const proposer: Actor = { id: p.actor, name: p.actor, kind: "ai", roles: [] };
    try {
      const { commandId, decision } = await this.decideAndCommit(proposer, project, tool, p.input, p.id);
      await store.transitionProposal(proposalId, ["applying"], "applied", actor.id, { commandId });
      await this.audit(project, { actor: actor.id, action: "platform.approve", outcome: "approved", proposalId, commandId });
      return { status: "applied", commandId, summary: decision.summary };
    } catch (e) {
      const pe = publicError(e);
      if (e instanceof ConcurrencyError) {
        await store.transitionProposal(proposalId, ["applying"], "pending", actor.id, { decidedBy: undefined, decidedAt: undefined }, "conflict; retry");
      } else {
        await store.transitionProposal(proposalId, ["applying"], "failed", actor.id, { reason: pe.message }, pe.reason);
      }
      await this.audit(project, { actor: actor.id, action: "platform.approve", outcome: "failed", proposalId, detail: { reason: pe.reason, message: pe.message } });
      throw e;
    }
  }

  async reject(actor: Actor, project: string, proposalId: string, reason?: string) {
    project = parseProjectId(project);
    if (actor.kind === "ai") throw new PermissionError("An AI actor cannot reject proposals.");
    if (!can(actor, "platform.approve", this.roles)) throw new PermissionError(`${actor.name} cannot reject.`);
    const store = this.store(project);
    const done = await store.transitionProposal(proposalId, ["pending"], "rejected", actor.id, { decidedBy: actor.id, decidedAt: now(), reason }, reason);
    if (!done) throw await this.notPending(store, proposalId);
    await this.audit(project, { actor: actor.id, action: "platform.reject", outcome: "rejected", proposalId, detail: reason });
    return { status: "rejected", proposalId };
  }

  private async notPending(store: ProjectStore, proposalId: string): Promise<DomainError> {
    const cur = (await store.readProposals()).find((x) => x.id === proposalId);
    if (!cur) return new DomainError(`Proposal ${proposalId} not found.`, "PROPOSAL_NOT_FOUND");
    if (cur.status === "applied") return new DomainError(`Proposal ${proposalId} has already been applied.`, "PROPOSAL_ALREADY_APPLIED");
    return new DomainError(`Proposal ${proposalId} is ${cur.status}, not pending.`, "PROPOSAL_NOT_PENDING");
  }

  async history(project: string, limit = 50) {
    project = parseProjectId(project);
    const snap = await this.snapshot(project);
    const ps = snap.states.get(PLATFORM_MODULE) as PlatformState;
    const counts = new Map<string, number>();
    for (const e of await this.store(project).readEvents(0)) if (e.module !== PLATFORM_MODULE) counts.set(e.commandId, (counts.get(e.commandId) ?? 0) + 1);
    const rows = ps.commands.map((c) => ({ ...c, reverted: !!ps.reverted[c.commandId], events: counts.get(c.commandId) ?? (c.tool === "platform_undo" ? 1 : 0) }));
    return rows.slice(-limit).reverse();
  }

  whoami(actor: Actor) {
    return { actor, permissions: permissionsOf(actor, this.roles), approvalMode: this.approvalMode,
             writesNeedApproval: this.approvalMode !== "auto" &&
               (actor.kind === "ai" || (this.approvalMode === "all" && !can(actor, "platform.autoapply", this.roles))),
             modules: this.listModules() };
  }
}

// -------------------------------------------------------------------- platform tools
function platformTools(): QueryTool<null>[] {
  const q = (name: string, title: string, description: string, permission: string, input: z.ZodType<any>,
             run: (ctx: ToolContext<null>, i: any) => unknown): QueryTool<null> =>
    ({ kind: "query", effect: "read", module: "platform", name, title, description, permission, input, run });
  return [
    q("platform_whoami", "Who am I", "Current actor, roles, permissions, approval mode and installed modules.",
      "platform.self", z.object({}), (c) => c.platform.whoami(c.actor)),
    q("platform_list_proposals", "List proposals", "Proposals (changes awaiting approval) with their preview.",
      "platform.self", z.object({ status: z.enum(["pending", "applied", "rejected", "failed"]).optional() }),
      async (c, i) => (await c.platform.store(c.project).readProposals()).filter((p) => !i.status || p.status === i.status)),
    q("platform_history", "Command history", "Applied commands (newest first) with actor, summary and revert state.",
      "platform.self", z.object({ limit: z.number().int().min(1).max(500).default(30) }),
      (c, i) => c.platform.history(c.project, i.limit)),
    q("platform_audit_log", "Audit log", "Every write, proposal, approval, rejection, denial and undo with actor and time.",
      "platform.audit", z.object({ limit: z.number().int().min(1).max(1000).default(50), actor: z.string().optional() }),
      async (c, i) => (await c.platform.store(c.project).readAudit(i.actor ? 5000 : i.limit))
        .filter((a) => !i.actor || a.actor === i.actor).slice(0, i.limit)),
    q("platform_approve", "Approve proposal", "Approve and apply a pending proposal (needs platform.approve; not by its author).",
      "platform.self", z.object({ proposal_id: z.string() }), (c, i) => c.platform.approve(c.actor, c.project, i.proposal_id)),
    q("platform_reject", "Reject proposal", "Reject a pending proposal with a reason.",
      "platform.self", z.object({ proposal_id: z.string(), reason: z.string().optional() }),
      (c, i) => c.platform.reject(c.actor, c.project, i.proposal_id, i.reason)),
  ];
}
