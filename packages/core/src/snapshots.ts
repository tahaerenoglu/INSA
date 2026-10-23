/**
 * Snapshots: an acceleration of replay, never a source of truth.
 *
 * A snapshot holds the reduced state of every module AFTER a complete command
 * (lastSeq is the last event of a command), plus the platform replay metadata
 * (command index with sequence numbers, reverted set) that undo needs.
 * It is stored as canonical JSON with a SHA-256 checksum, so identical event
 * logs give byte-identical snapshots and corruption is detected.
 */
import { createHash } from "node:crypto";
import { IntegrityError } from "./errors.js";

export const SNAPSHOT_VERSION = 1;

/** Central snapshot policy (one place). Tests pass a smaller everyEvents. */
export interface SnapshotPolicy {
  /** take a snapshot when at least this many events were committed since the last one */
  everyEvents: number;
  /** snapshots kept per project (older ones are pruned); more = cheaper deep undo */
  keep: number;
}
export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = { everyEvents: 1000, keep: 3 };

export interface SnapshotEnvelope {
  snapshotVersion: number;
  project: string;
  /** last event included; always the last event of a command */
  lastSeq: number;
  /** commandId of that last event (detects a snapshot cut inside a command) */
  lastCommandId: string;
  createdAt: string;
  /** state format version of each module at creation time */
  modules: Record<string, { stateVersion: number }>;
  /** reduced module states (not including the platform module) */
  state: Record<string, unknown>;
  /** platform replay metadata: command index (commandId, tool, seq, ...) and reverted set */
  replay: unknown;
  /** sha256 of the canonical JSON of every field above */
  checksum: string;
}

/** What a store persists: opaque text plus the fields it indexes by. */
export interface StoredSnapshot { lastSeq: number; snapshotVersion: number; body: string; }

/** JSON with object keys sorted recursively: identical values -> identical text. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
      : val);
}

const digest = (env: Omit<SnapshotEnvelope, "checksum">) => createHash("sha256").update(canonicalJson(env)).digest("hex");

export function encodeSnapshot(env: Omit<SnapshotEnvelope, "checksum">): StoredSnapshot {
  const full: SnapshotEnvelope = { ...env, checksum: digest(env) };
  return { lastSeq: env.lastSeq, snapshotVersion: env.snapshotVersion, body: canonicalJson(full) };
}

/**
 * Parses and verifies a stored snapshot. Throws IntegrityError with
 * SNAPSHOT_CORRUPTED (unreadable / checksum mismatch / malformed),
 * UNSUPPORTED_SNAPSHOT_VERSION (newer or older format) or
 * INVALID_SNAPSHOT (wrong project / sequence / module set).
 */
export function decodeSnapshot(raw: StoredSnapshot, project: string, modules: Record<string, number>): SnapshotEnvelope {
  const ctx = { project, lastSeq: raw.lastSeq };
  let env: SnapshotEnvelope;
  try { env = JSON.parse(raw.body); } catch { throw new IntegrityError(`Snapshot @${raw.lastSeq} is unreadable.`, "SNAPSHOT_CORRUPTED", ctx); }
  if (!env || typeof env !== "object" || typeof env.checksum !== "string")
    throw new IntegrityError(`Snapshot @${raw.lastSeq} is malformed.`, "SNAPSHOT_CORRUPTED", ctx);
  if (env.snapshotVersion !== SNAPSHOT_VERSION)
    throw new IntegrityError(`Snapshot @${raw.lastSeq} has format version ${env.snapshotVersion}; supported is ${SNAPSHOT_VERSION}.`,
      "UNSUPPORTED_SNAPSHOT_VERSION", { ...ctx, snapshotVersion: Number(env.snapshotVersion) || 0, supportedVersion: SNAPSHOT_VERSION });
  const { checksum, ...rest } = env;
  if (digest(rest) !== checksum) throw new IntegrityError(`Snapshot @${raw.lastSeq} failed its checksum.`, "SNAPSHOT_CORRUPTED", ctx);
  if (env.project !== project || env.lastSeq !== raw.lastSeq || !Number.isInteger(env.lastSeq) || env.lastSeq < 1 || typeof env.lastCommandId !== "string")
    throw new IntegrityError(`Snapshot @${raw.lastSeq} does not belong here.`, "INVALID_SNAPSHOT", ctx);
  const want = Object.keys(modules).sort().join(","), have = Object.keys(env.modules ?? {}).sort().join(",");
  if (want !== have || Object.entries(modules).some(([m, v]) => env.modules[m]?.stateVersion !== v))
    throw new IntegrityError(`Snapshot @${raw.lastSeq} was made for different module state versions.`, "UNSUPPORTED_SNAPSHOT_VERSION", ctx);
  return env;
}
