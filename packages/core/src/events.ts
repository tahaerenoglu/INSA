/**
 * Event schema versioning.
 *
 * Every event written from Phase 3 on carries `schemaVersion`. Events stored
 * without it are LEGACY_SCHEMA_VERSION (1). The current version of each event
 * type is declared exactly once, by its module (`ModuleDef.eventVersions`);
 * EventRegistry is the only place that reads those declarations.
 *
 * Reading: stored event -> upcast step by step (v1 -> v2 -> ... -> current) ->
 * reducer. Upcasters are pure functions of the event alone (no I/O, clock,
 * randomness or project state); the stored event is never modified.
 * A stored version newer than the running code supports is refused
 * (UNSUPPORTED_EVENT_VERSION) — there is no best-effort downcasting.
 */
import type { DomainEvent } from "./store.js";
import { IntegrityError } from "./errors.js";

export const LEGACY_SCHEMA_VERSION = 1;

/**
 * One migration step of one event type: payload of version `fromVersion` -> payload of `fromVersion + 1`.
 * Pure: no I/O, clock, randomness or project state. It receives a deep-frozen copy and must return a new value.
 * The event type never changes (a renamed event is a new event type with its own reducer case).
 */
export interface Upcaster {
  type: string;
  fromVersion: number;
  upcast(payload: any): unknown;
}

export interface EventSchemaDeclaration {
  module: string;
  /** current schema version per event type (omit -> every type of the module is version 1) */
  eventVersions?: Record<string, number>;
  upcasters?: Upcaster[];
}

/** Current-representation event as reducers see it. */
export type CurrentEvent = DomainEvent & { schemaVersion: number };

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as any)[k]);
  }
  return v;
}

export class EventRegistry {
  private versions = new Map<string, Record<string, number> | undefined>();
  private steps = new Map<string, Upcaster>();          // `${module}|${type}|${fromVersion}`

  constructor(decls: EventSchemaDeclaration[]) {
    for (const d of decls) {
      this.versions.set(d.module, d.eventVersions);
      for (const u of d.upcasters ?? []) {
        const key = `${d.module}|${u.type}|${u.fromVersion}`;
        if (this.steps.has(key)) throw new Error(`Duplicate upcaster ${key}`);
        this.steps.set(key, u);
      }
      // fail fast at start-up: every declared version > 1 needs the complete chain 1 -> 2 -> ... -> current
      for (const [type, cur] of Object.entries(d.eventVersions ?? {})) {
        if (!Number.isInteger(cur) || cur < 1) throw new Error(`${d.module}.${type}: invalid current version ${cur}`);
        for (let v = 1; v < cur; v++)
          if (!this.steps.has(`${d.module}|${type}|${v}`)) throw new Error(`${d.module}.${type}: missing upcaster v${v} -> v${v + 1}`);
      }
    }
  }

  /** The version every newly written event of this type carries. */
  currentVersion(module: string, type: string): number {
    const v = this.versions.get(module);
    if (v === undefined) return LEGACY_SCHEMA_VERSION;               // module without declarations: all v1
    const cur = v[type];
    if (cur === undefined) throw new Error(`Event type ${module}.${type} is not declared in the module's eventVersions.`);
    return cur;
  }

  /** Stored event -> current representation (pure; the input is not modified). */
  upcast(e: DomainEvent): CurrentEvent {
    const stored = e.schemaVersion ?? LEGACY_SCHEMA_VERSION;
    const ctx = { module: e.module, type: e.type, storedVersion: stored, seq: e.seq };
    if (!Number.isInteger(stored) || stored < 1)
      throw new IntegrityError(`Event #${e.seq} (${e.module}.${e.type}) has an invalid schema version.`, "EVENT_UPCAST_FAILED", ctx);
    if (!this.versions.has(e.module)) return { ...e, schemaVersion: stored };    // unknown module: passed through, ignored by replay
    const cur = this.versions.get(e.module)?.[e.type] ?? (this.versions.get(e.module) ? undefined : LEGACY_SCHEMA_VERSION);
    if (cur === undefined)
      throw new IntegrityError(`Event #${e.seq}: type ${e.module}.${e.type} is unknown to this version of INSA.`, "EVENT_UPCAST_FAILED", ctx);
    if (stored > cur)
      throw new IntegrityError(`Event #${e.seq} ${e.module}.${e.type} has schema version ${stored}; this version of INSA supports up to ${cur}.`,
        "UNSUPPORTED_EVENT_VERSION", { ...ctx, supportedVersion: cur });
    let payload: unknown = e.payload, v = stored;
    while (v < cur) {
      const step = this.steps.get(`${e.module}|${e.type}|${v}`);
      if (!step) throw new IntegrityError(`No upcaster for ${e.module}.${e.type} v${v} -> v${v + 1}.`, "EVENT_UPCAST_FAILED", { ...ctx, atVersion: v });
      try { payload = step.upcast(deepFreeze(structuredClone(payload))); }
      catch { throw new IntegrityError(`Upcasting event #${e.seq} ${e.module}.${e.type} v${v} failed.`, "EVENT_UPCAST_FAILED", { ...ctx, atVersion: v }); }
      v += 1;
    }
    // reducers always get their own copy: the stored event is never shared with (or mutated through) state
    return { ...e, payload: payload === e.payload ? structuredClone(payload) : payload, schemaVersion: v };
  }
}
