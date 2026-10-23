/**
 * Authoring kernel (Phase 10): topology-safe wall editing on top of the Phase 9 engines.
 *
 * A split / merge / trim / extend / rehost is a COMMAND INTENT, not an event type. Each one edits the decision-local
 * candidate state and the platform then emits the canonical events that DESCRIBE THE RESULT:
 *
 *     command -> edit the candidate -> diffToEvents(before, candidate) -> (platform) reducer -> validation -> commit
 *
 * The event list is computed from a diff, so it cannot drift from the candidate; verifyPlan() re-applies the events to
 * the pre-command state and refuses to continue unless the outcome equals the candidate exactly. The plan is decision
 * infrastructure only: no second persistence model, nothing derived (miters, clipped ends, regions) is stored, and
 * nothing is committed unless the complete result passes the same validation as every other command.
 *
 * Identity policy (deterministic, documented in the README):
 *   split  — the ORIGINAL id stays on the START segment; the END segment gets the next wall id.
 *   merge  — the survivor is the caller's `primary`, else the smaller id (string order); it keeps its own direction.
 *   trim / extend — the wall keeps its id; only the chosen endpoint moves along the wall's own axis.
 * One intersection formula (geo.lineParams), one tolerance set (GEOMETRY_EPSILON, JOIN_TOLERANCE, MITER_MIN_ANGLE_DEG).
 */
import { DomainError, ErrorDetails, ErrorReason, canonicalJson } from "@insa/core";
import type { DomainEvent } from "@insa/core";
import { apply, nextId } from "./model.js";
import type { BimState, Wall, Opening, HostedComponent, WallJoin, WallEndpoint, Element } from "./model.js";
import { GEOMETRY_EPSILON as E, distance2D } from "./geometry.js";
import { P2, r, unit, sub, lineParams } from "./geo.js";
import { JOIN_TOLERANCE, MITER_MIN_SIN, createJoin, synchronizeTopology, teeRangeOk, compareEndpoints, epKey, pointOf, topologyIndex, wallOf } from "./topology.js";

const fail = (reason: ErrorReason, message: string, details: ErrorDetails = {}): never => { throw new DomainError(message, reason, details); };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a: { id: string }, b: { id: string }) => cmp(a.id, b.id);
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const len = (w: { start: P2; end: P2 }) => distance2D(w.start, w.end);
/** Distance of a point's projection from a wall's start, along the wall: tees are re-parameterised from the PHYSICAL tee point, never from the previous t (no drift). */
const posOn = (w: { start: P2; end: P2 }, p: P2) => dot(sub(p, w.start), unit(sub(w.end, w.start)));
const other = (e: "start" | "end") => (e === "start" ? "end" : "start") as "start" | "end";
const at = (a: P2, d: P2, x: number): P2 => [r(a[0] + d[0] * x), r(a[1] + d[1] * x)];

// ================================================================== event plans
export type PlanEvent = { type: string; payload: unknown };

/** Top-level fields that differ between two versions of one element (a removed field cannot be expressed: reducers only assign). */
function elementChanges(id: string, b: Element, a: Element): Record<string, unknown> | null {
  if (b.kind !== a.kind) throw new Error(`authoring: ${id} changed kind (${b.kind} -> ${a.kind}); that is not an edit`);
  const ch: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const x = (b as any)[k], y = (a as any)[k];
    if (canonicalJson(x) === canonicalJson(y)) continue;
    if (y === undefined) throw new Error(`authoring: ${id}.${k} was removed; events can only assign (use null)`);
    ch[k] = structuredClone(y);
  }
  return Object.keys(ch).length ? ch : null;
}

/**
 * Canonical events for the difference between two states: element creates, updates, deletes, then join deletes,
 * updates (membership of a junction) and creates, then the id counters. Sorted by id: deterministic.
 * A tee that changed host / parameter / endpoint is a delete + create of the SAME join id (no new event type needed).
 */
export function diffToEvents(before: BimState, after: BimState): PlanEvent[] {
  const ev: PlanEvent[] = [];
  const ids = (m: Record<string, unknown>) => Object.keys(m).sort(cmp);
  for (const id of ids(after.elements)) if (!before.elements[id]) ev.push({ type: "ElementCreated", payload: structuredClone(after.elements[id]) });
  for (const id of ids(after.elements)) {
    const b = before.elements[id];
    if (!b) continue;
    const ch = elementChanges(id, b, after.elements[id]);
    if (ch) ev.push({ type: "ElementUpdated", payload: { id, changes: ch } });
  }
  for (const id of ids(before.elements)) if (!after.elements[id]) ev.push({ type: "ElementDeleted", payload: { id } });
  const del: PlanEvent[] = [], upd: PlanEvent[] = [], add: PlanEvent[] = [];
  const jb = before.joins ?? {}, ja = after.joins ?? {};
  for (const id of ids({ ...jb, ...ja })) {
    const b = jb[id], a = ja[id];
    if (b && !a) del.push({ type: "WallJoinDeleted", payload: { id } });
    else if (!b && a) add.push({ type: "WallJoinCreated", payload: { join: structuredClone(a) } });
    else if (b && a && canonicalJson(b) !== canonicalJson(a)) {
      if (b.kind === "endpoint_endpoint" && a.kind === "endpoint_endpoint" && b.id === a.id) upd.push({ type: "WallJoinUpdated", payload: { id, members: structuredClone(a.members) } });
      else { del.push({ type: "WallJoinDeleted", payload: { id } }); add.push({ type: "WallJoinCreated", payload: { join: structuredClone(a) } }); }
    }
  }
  ev.push(...del, ...upd, ...add);
  if (canonicalJson(before.counters) !== canonicalJson(after.counters)) ev.push({ type: "CountersSet", payload: { ...after.counters } });
  return ev;
}

/** The events must reproduce the candidate exactly when applied by the reducer to the pre-command state. */
export function verifyPlan(before: BimState, events: PlanEvent[], candidate: BimState): void {
  let st = structuredClone(before);
  for (const e of events) st = apply(st, { seq: 0, module: "bim", commandId: "plan", actor: "plan", at: "", type: e.type, payload: structuredClone(e.payload) } as DomainEvent);
  if (canonicalJson(st) !== canonicalJson(candidate)) fail("AUTHORING_PLAN_MISMATCH", "The emitted events do not reproduce the edited candidate state; nothing was changed.");
}

/**
 * Runs one authoring edit on the decision-local candidate `s` and returns its canonical events with the structured result.
 * `edit` receives the untouched pre-command state (the reference for topology propagation drivers).
 */
export function runAuthoring<T>(s: BimState, edit: (before: BimState) => T): { events: PlanEvent[]; summary: T } {
  const before = structuredClone(s);
  const summary = edit(before);
  const events = diffToEvents(before, s);
  verifyPlan(before, events, s);
  return { events, summary };
}

// ================================================================== shared kernel
export type AxisIntersection = { parallel: true } | { parallel: false; tA: number; tB: number; point: P2 };
/**
 * Intersection of the axis a0->a1 with the axis b0->b1 (parameters 0..1 along each). "Parallel" includes anything within
 * MITER_MIN_ANGLE_DEG of parallel (the same limit the wall ends use): a shallower crossing is not a trustworthy target.
 */
export function axisIntersection(a0: P2, a1: P2, b0: P2, b1: P2): AxisIntersection {
  const d1 = sub(a1, a0), d2 = sub(b1, b0), n = Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]);
  const lp = lineParams(a0, a1, b0, b1);
  if (!lp || !(n > 0) || Math.abs(cross(d1, d2)) / n < MITER_MIN_SIN) return { parallel: true };
  return { parallel: false, tA: lp.tA, tB: lp.tB, point: at(a0, d1, lp.tA) };
}

const wallOr = (s: BimState, id: string, reason: ErrorReason, role: string): Wall => {
  const w = wallOf(s, id);
  if (!w) fail(reason, `${role} ${id} is not an existing wall.`, { wallId: String(id), role });
  return w!;
};
const openingsOf = (s: BimState, wallId: string): Opening[] =>
  Object.values(s.elements).filter((e): e is Opening => e.kind === "opening" && e.host === wallId).sort(byId);
const teesHostedOn = (s: BimState, wallId: string) =>
  Object.values(s.joins ?? {}).filter((j): j is Extract<WallJoin, { kind: "endpoint_segment" }> => j.kind === "endpoint_segment" && j.host === wallId).sort(byId);
/** Moves an opening (and the hosted component filling it) to a host at a position: the only place opening hosts change. */
function retarget(s: BimState, op: Opening, host: string, along: number) {
  op.host = host; op.along = r(along);
  if (op.filledBy) (s.elements[op.filledBy] as HostedComponent).host = host;
}
const touchedWalls = (s: BimState, ids: string[]): string[] => {
  const out = new Set(ids);
  for (const j of Object.values(s.joins ?? {})) {
    const ws = j.kind === "endpoint_endpoint" ? j.members.map((m) => m.wall) : [j.endpoint.wall, j.host];
    if (ws.some((w) => out.has(w))) ws.forEach((w) => out.add(w));
  }
  return [...out].filter((w) => wallOf(s, w)).sort(cmp);
};
type JoinNote = { joinId: string; change: string };

// ================================================================== split
export interface SplitInput { wall: string; t?: number; point?: P2 }
export function splitWall(s: BimState, before: BimState, i: SplitInput) {
  const W = wallOr(s, i.wall, "INVALID_SPLIT", "wall");
  if ((i.t === undefined) === (i.point === undefined)) fail("INVALID_SPLIT", "Give exactly one of t (0 < t < 1) or point.", { wallId: W.id });
  const L = len(W), dir = unit(sub(W.end, W.start));
  let t: number;
  if (i.t !== undefined) {
    if (!Number.isFinite(i.t)) fail("INVALID_SPLIT", "t must be a finite number.", { wallId: W.id });
    t = i.t;
  } else {
    const q = i.point!;
    if (!Array.isArray(q) || q.length !== 2 || !q.every(Number.isFinite)) fail("INVALID_SPLIT", "point must be a finite [x, y].", { wallId: W.id });
    if (Math.abs(cross(dir, sub(q, W.start))) > JOIN_TOLERANCE) fail("INVALID_SPLIT", `point is not on the axis of ${W.id} (within ${JOIN_TOLERANCE} m).`, { wallId: W.id });
    t = dot(sub(q, W.start), dir) / L;
  }
  t = r(t, 9);                                           // normalised immediately: the split is a wall parameter, not a coordinate guess
  if (!(t > 0 && t < 1)) fail("INVALID_SPLIT", `t = ${t} is not strictly inside the wall (0 < t < 1).`, { wallId: W.id, t });
  let P: P2 = at(W.start, sub(W.end, W.start), t);
  // a tee endpoint within JOIN_TOLERANCE of the split point makes the split magnetic: it splits exactly there
  const snapTee = teesHostedOn(s, W.id).find((j) => distance2D(pointOf(s, j.endpoint), P) <= JOIN_TOLERANCE);
  if (snapTee) P = [...pointOf(s, snapTee.endpoint)] as P2;
  const dA = distance2D(W.start, P), dB = distance2D(P, W.end);
  if (!(dA > JOIN_TOLERANCE && dB > JOIN_TOLERANCE))
    fail("INVALID_SPLIT", `a split must leave both walls longer than ${JOIN_TOLERANCE} m (got ${r(dA)} and ${r(dB)}).`, { wallId: W.id, t });

  // hosted content first: nothing is cut, a split through an opening is refused
  const staying: Opening[] = [], moving: Opening[] = [];
  for (const op of openingsOf(s, W.id)) {
    const lo = op.along - op.width / 2, hi = op.along + op.width / 2;
    if (hi <= dA + E) staying.push(op);
    else if (lo >= dA - E) moving.push(op);
    else fail("SPLIT_INTERSECTS_HOSTED_OPENING", `splitting ${W.id} at ${r(dA)} m would cut opening ${op.id} (${r(lo)} .. ${r(hi)} m).`,
      { wallId: W.id, openingId: op.id, splitDistance: r(dA), intervalStart: r(lo), intervalEnd: r(hi), t });
  }

  const oldEnd: P2 = [...W.end] as P2;
  const Bid = nextId(s, "wall");
  const Bwall: Wall = { ...structuredClone(W), id: Bid, start: P, end: [...W.end] as P2, prevDir: null, nextDir: W.nextDir };
  W.end = P; W.nextDir = null;
  s.elements[Bid] = Bwall;

  const notes: JoinNote[] = [], atSplit: WallEndpoint[] = [];
  for (const j of Object.values(s.joins ?? {}).sort(byId)) {
    if (j.kind === "endpoint_endpoint") {
      if (j.members.some((m) => m.wall === W.id && m.endpoint === "end")) {
        j.members = j.members.map((m) => (m.wall === W.id && m.endpoint === "end" ? { wall: Bid, endpoint: "end" as const } : m)).sort(compareEndpoints);
        notes.push({ joinId: j.id, change: "end member moved to the new wall" });
      }
      continue;
    }
    if (j.endpoint.wall === W.id && j.endpoint.endpoint === "end") { j.endpoint = { wall: Bid, endpoint: "end" }; notes.push({ joinId: j.id, change: "tee endpoint moved to the new wall" }); }
    if (j.host === W.id) {
      const dq = posOn({ start: W.start, end: oldEnd }, pointOf(s, j.endpoint));
      if (distance2D(pointOf(s, j.endpoint), P) <= JOIN_TOLERANCE) { atSplit.push(j.endpoint); delete s.joins[j.id]; notes.push({ joinId: j.id, change: "tee at the split point became a member of the new junction" }); }
      else if (dq < dA) { j.t = r(dq / dA, 9); notes.push({ joinId: j.id, change: "tee stays on the first wall (t renormalised)" }); }
      else { j.host = Bid; j.t = r((dq - dA) / dB, 9); notes.push({ joinId: j.id, change: "tee moved to the new wall (t renormalised)" }); }
    }
  }
  // the two halves stay explicitly joined (touching is not joining); tees at the split point join the same junction
  const jr = createJoin(s, { kind: "endpoint_endpoint", endpoints: [{ wall: W.id, endpoint: "end" }, { wall: Bid, endpoint: "start" }, ...atSplit] }, () => nextId(s, "join"));

  const moved: { opening: string; from: string; to: string; newAlong: number }[] = [];
  for (const op of moving) { retarget(s, op, Bid, op.along - dA); moved.push({ opening: op.id, from: W.id, to: Bid, newAlong: op.along }); }
  synchronizeTopology(s, before, touchedWalls(s, [W.id, Bid]));
  // splitT is the ACTUAL normalised position of splitPoint on the wall (after a snap to a T at the split point), requestedT what was asked
  return { sourceWall: W.id, walls: [W.id, Bid], splitT: r(dA / L, 9), requestedT: t, splitPoint: P, lengths: [r(dA), r(dB)], newJoin: jr.summary.joinId,
           transferredJoins: notes, transferredOpenings: moved, keptOpenings: staying.map((o) => o.id) };
}

// ================================================================== merge
export interface MergeInput { walls: string[]; primary?: string }
const PROP_SEP = ".";
function mergeProps(a?: Wall["props"], b?: Wall["props"]): Wall["props"] | undefined {
  if (!a && !b) return undefined;
  const out: NonNullable<Wall["props"]> = structuredClone(a ?? {});
  for (const [set, kv] of Object.entries(b ?? {})) {
    out[set] ??= {};
    for (const [k, v] of Object.entries(kv)) {
      if (k in out[set] && out[set][k] !== v) fail("MERGE_PROPERTY_CONFLICT", `property ${set}${PROP_SEP}${k} differs (${String(out[set][k])} vs ${String(v)}).`, { property: `${set}${PROP_SEP}${k}` });
      out[set][k] = v;
    }
  }
  return out;
}
export function mergeWalls(s: BimState, before: BimState, i: MergeInput) {
  if (!Array.isArray(i.walls) || i.walls.length !== 2 || i.walls[0] === i.walls[1]) fail("MERGE_INCOMPATIBLE", "Give two different walls.", { field: "walls" });
  const wa = wallOr(s, i.walls[0], "MERGE_INCOMPATIBLE", "wall"), wb = wallOr(s, i.walls[1], "MERGE_INCOMPATIBLE", "wall");
  if (i.primary !== undefined && i.primary !== wa.id && i.primary !== wb.id) fail("MERGE_INCOMPATIBLE", `primary ${i.primary} is not one of the walls.`, { field: "primary" });
  const S = i.primary ? (i.primary === wa.id ? wa : wb) : (cmp(wa.id, wb.id) <= 0 ? wa : wb), O = S === wa ? wb : wa;
  const dt = { survivor: S.id, other: O.id };

  // explicit topology is authoritative: a two-member endpoint junction between exactly these walls
  const joins = Object.values(s.joins ?? {}).sort(byId);
  const shared = joins.filter((j): j is Extract<WallJoin, { kind: "endpoint_endpoint" }> => j.kind === "endpoint_endpoint" && j.members.some((m) => m.wall === S.id) && j.members.some((m) => m.wall === O.id));
  if (!shared.length) fail("MERGE_NOT_CONNECTED", `${S.id} and ${O.id} are not joined end to end (touching or collinear is not enough).`, dt);
  if (shared.length > 1 || shared[0].members.length !== 2) fail("MERGE_AMBIGUOUS_JUNCTION", `${shared[0].id} joins more than these two walls; merging would destroy a semantic junction.`, { ...dt, joinId: shared[0].id });
  const J = shared[0];
  const sNode = J.members.find((m) => m.wall === S.id)!, oNode = J.members.find((m) => m.wall === O.id)!;

  // compatibility
  const inc = (field: string, message: string) => fail("MERGE_INCOMPATIBLE", message, { ...dt, field });
  if (S.storey !== O.storey) inc("storey", "walls are on different storeys.");
  if ((S.category ?? "architecture.wall") !== (O.category ?? "architecture.wall")) inc("category", `different semantic categories (${S.category ?? "architecture.wall"} vs ${O.category ?? "architecture.wall"}).`);
  if (S.type !== O.type) inc("type", `different wall types (${S.type} vs ${O.type}).`);
  if ((S.roomBounding !== false) !== (O.roomBounding !== false)) inc("roomBounding", "one wall bounds rooms and the other does not.");
  if (Math.abs(S.baseOffset - O.baseOffset) > E) inc("baseOffset", "different base offsets.");
  if (S.vertical.mode !== O.vertical.mode) inc("vertical", "one wall is fixed and the other storey-constrained.");
  if (S.vertical.mode === "storey" && O.vertical.mode === "storey" && S.vertical.storey !== O.vertical.storey) inc("vertical", "constrained to different storeys.");
  if (Math.abs(S.height - O.height) > E) inc("height", "different heights.");
  const N = pointOf(s, sNode), sFar = pointOf(s, { wall: S.id, endpoint: other(sNode.endpoint) }), oFar = pointOf(s, { wall: O.id, endpoint: other(oNode.endpoint) });
  const axis = unit(sub(N, sFar));
  if (Math.abs(cross(axis, sub(oFar, sFar))) > E || dot(sub(oFar, N), axis) <= JOIN_TOLERANCE) inc("geometry", "the walls are not collinear and continuing.");

  // properties: refuse conflicts instead of picking one
  const nodeAtSEnd = sNode.endpoint === "end", oNodeIsStart = oNode.endpoint === "start";
  const sameDir = nodeAtSEnd === oNodeIsStart;
  if (S.name !== undefined && O.name !== undefined && S.name !== O.name) fail("MERGE_PROPERTY_CONFLICT", `names differ (${S.name} vs ${O.name}).`, { ...dt, property: "name" });
  const oExterior = O.exterior === null || sameDir ? O.exterior : (O.exterior === "left" ? "right" : "left");
  if (S.exterior !== null && oExterior !== null && S.exterior !== oExterior) fail("MERGE_PROPERTY_CONFLICT", "the exterior sides disagree.", { ...dt, property: "exterior" });
  const props = mergeProps(S.props, O.props);
  // a mitre hint at the far end is only ours to carry over when NO join manages it (a legacy polyline end); managed hints are
  // recomputed from the topology after the edit
  const farManaged = topologyIndex(s).byEndpoint.has(epKey({ wall: O.id, endpoint: other(oNode.endpoint) }));
  const oFarHint = farManaged ? null : (oNodeIsStart ? O.nextDir : O.prevDir);
  if (oFarHint && !sameDir) inc("end_condition", "the far end of the other wall carries a legacy mitre hint that cannot be mapped to the reversed direction.");

  // geometry and hosted content, in the survivor's direction
  const lenS = len(S), lenO = len(O);
  const fromNodeO = (a: number) => (oNodeIsStart ? a : lenO - a);
  const mapO = (a: number) => (nodeAtSEnd ? lenS + fromNodeO(a) : lenO - fromNodeO(a));
  const mapS = (a: number) => (nodeAtSEnd ? a : a + lenO);
  const newEnd: "start" | "end" = nodeAtSEnd ? "end" : "start";
  const openings = [...openingsOf(s, S.id).map((o) => ({ o, along: mapS(o.along), from: S.id })), ...openingsOf(s, O.id).map((o) => ({ o, along: mapO(o.along), from: O.id }))];
  const teeS = teesHostedOn(s, S.id).map((j) => ({ j, pos: mapS(posOn(S, pointOf(s, j.endpoint))) })), teeO = teesHostedOn(s, O.id).map((j) => ({ j, pos: mapO(posOn(O, pointOf(s, j.endpoint))) }));
  S[newEnd] = [...oFar] as P2;
  if (nodeAtSEnd) S.nextDir = sameDir ? oFarHint : null; else S.prevDir = sameDir ? oFarHint : null;
  if (props) S.props = props;
  if (S.name === undefined && O.name !== undefined) S.name = O.name;
  if (S.exterior === null) S.exterior = oExterior;
  const lenM = len(S);

  const notes: JoinNote[] = [];
  delete s.joins[J.id]; notes.push({ joinId: J.id, change: "the internal junction disappeared" });
  for (const j of Object.values(s.joins).sort(byId)) {
    if (j.kind === "endpoint_endpoint") {
      if (j.members.some((m) => m.wall === O.id)) { j.members = j.members.map((m) => (m.wall === O.id ? { wall: S.id, endpoint: newEnd } : m)).sort(compareEndpoints); notes.push({ joinId: j.id, change: "far end member moved to the survivor" }); }
    } else {
      if (j.endpoint.wall === O.id) { j.endpoint = { wall: S.id, endpoint: newEnd }; notes.push({ joinId: j.id, change: "tee endpoint moved to the survivor" }); }
      if (j.host === S.id || j.host === O.id) {
        const pos = (teeS.find((x) => x.j.id === j.id) ?? teeO.find((x) => x.j.id === j.id))!.pos;
        j.host = S.id; j.t = r(pos / lenM, 9); notes.push({ joinId: j.id, change: "tee renormalised on the merged wall" });
      }
    }
  }
  const moved: { opening: string; from: string; to: string; newAlong: number }[] = [];
  for (const { o, along, from } of openings) { retarget(s, o, S.id, along); moved.push({ opening: o.id, from, to: S.id, newAlong: r(along) }); }
  delete s.elements[O.id];
  synchronizeTopology(s, before, touchedWalls(s, [S.id]));
  return { survivor: S.id, removed: O.id, direction: nodeAtSEnd ? "survivor start -> removed wall's far end" : "removed wall's far end -> survivor end", nodeJoin: J.id,
           mergedLength: r(lenM), transferredJoins: notes, transferredOpenings: moved };
}

// ================================================================== trim / extend
export interface TrimExtendInput { mode: "trim" | "extend"; wall: string; endpoint: "start" | "end"; target: string; join: boolean }
export function trimExtendWall(s: BimState, before: BimState, i: TrimExtendInput) {
  const reason: ErrorReason = i.mode === "trim" ? "INVALID_TRIM_TARGET" : "INVALID_EXTEND_TARGET";
  const W = wallOr(s, i.wall, reason, "wall"), T = wallOr(s, i.target, reason, "target");
  const dt = { wallId: W.id, targetId: T.id, endpoint: i.endpoint };
  if (W.id === T.id) fail(reason, "a wall cannot be its own target.", dt);
  if (W.storey !== T.storey) fail(reason, "the target is on another storey.", dt);
  if (topologyIndex(s).byEndpoint.has(epKey({ wall: W.id, endpoint: i.endpoint })))
    fail("WALL_EDIT_ENDPOINT_JOINED", `${W.id}.${i.endpoint} already takes part in a join; unjoin it first (the join would otherwise move).`, dt);
  const fixed = W[other(i.endpoint)], moving = W[i.endpoint], lenW = len(W);
  const xi = axisIntersection(fixed, moving, T.start, T.end);
  if (xi.parallel) return fail(reason, `the walls are parallel (or within the join angle limit): there is no usable intersection.`, dt);
  const x = xi;
  const tolW = JOIN_TOLERANCE / lenW, tolT = JOIN_TOLERANCE / len(T);
  if (x.tB < -tolT || x.tB > 1 + tolT) fail(reason, `the target wall does not reach the axis of ${W.id} (it meets it at ${r(x.tB, 4)} of its length).`, { ...dt, targetT: r(x.tB, 6) });
  if (i.mode === "trim") {
    if (x.tA >= 1 - tolW) fail(reason, `${W.id} does not cross the target (the intersection is at ${r(x.tA, 4)} of its length): nothing to trim.`, dt);
    if (x.tA <= tolW) fail(reason, `trimming would leave ${W.id} shorter than ${JOIN_TOLERANCE} m (or reverse it).`, dt);
  } else if (x.tA <= 1 + tolW) {
    fail(reason, x.tA < 0 ? "the target lies behind the wall (wrong direction)." : "the target lies within or at the end of the wall: use trim.", { ...dt, intersectionT: r(x.tA, 6) });
  }
  const P = x.point, newLen = distance2D(fixed, P);
  if (!(newLen > JOIN_TOLERANCE)) fail(reason, `the result would be shorter than ${JOIN_TOLERANCE} m.`, dt);

  // hosted content keeps its physical position: an end that moves at the start shifts every start-relative parameter
  const dir = unit(sub(W.end, W.start)), startMoves = i.endpoint === "start";
  const delta = startMoves ? dot(sub(P, W.start), dir) : 0;
  const openings = openingsOf(s, W.id).map((o) => ({ o, along: o.along - delta }));
  for (const { o, along } of openings)
    if (!(along - o.width / 2 >= -E && along + o.width / 2 <= newLen + E))
      fail("WALL_EDIT_HOSTED_CONFLICT", `opening ${o.id} would no longer fit ${W.id} (${r(along - o.width / 2)} .. ${r(along + o.width / 2)} m of ${r(newLen)} m).`, { ...dt, openingId: o.id });
  const tees = teesHostedOn(s, W.id).map((j) => ({ j, pos: posOn(W, pointOf(s, j.endpoint)) - delta }));
  for (const { j, pos } of tees)
    if (!(pos > JOIN_TOLERANCE && newLen - pos > JOIN_TOLERANCE)) fail("WALL_EDIT_HOSTED_CONFLICT", `the T-junction ${j.id} would fall off the edited wall.`, { ...dt, joinId: j.id });

  const oldPoint = [...moving] as P2;
  W[i.endpoint] = P;
  for (const { o, along } of openings) retarget(s, o, W.id, along);
  for (const { j, pos } of tees) j.t = r(pos / newLen, 9);
  let joined: unknown = null;
  if (i.join) {                                                // trim-and-join / extend-and-join: never touching without topology
    const tt = x.tB;
    const jr = teeRangeOk(T, tt)
      ? createJoin(s, { kind: "endpoint_segment", endpoint: { wall: W.id, endpoint: i.endpoint }, host: T.id, t: r(tt, 9) }, () => nextId(s, "join"))
      : createJoin(s, { kind: "endpoint_endpoint", endpoints: [{ wall: W.id, endpoint: i.endpoint }, { wall: T.id, endpoint: tt < 0.5 ? "start" : "end" }] }, () => nextId(s, "join"));
    joined = { joinId: jr.summary.joinId, kind: jr.summary.kind, host: T.id, hostT: r(tt, 9) };
  }
  synchronizeTopology(s, before, touchedWalls(s, [W.id, T.id]));
  return { wall: W.id, endpoint: i.endpoint, mode: i.mode, oldPoint, newPoint: P, oldLength: r(lenW), newLength: r(newLen), target: T.id,
           join: joined, movedOpenings: openings.map((x) => x.o.id), renormalisedTees: tees.map((x) => x.j.id) };
}

// ================================================================== rehost
export interface RehostInput { opening: string; host: string; along?: number; sill?: number; keep_position?: boolean }
/** Moves an opening and its fill to another wall of the same storey in ONE edit (opening host == fill host, always). */
export function rehostOpening(s: BimState, before: BimState, i: RehostInput) {
  void before;
  const op = s.elements[i.opening], host = s.elements[i.host];
  if (!op || op.kind !== "opening") fail("INVALID_REHOST", `${i.opening} is not an opening.`, { elementId: String(i.opening) });
  if (!host || host.kind !== "wall") fail("INVALID_REHOST", `${i.host} is not a wall.`, { hostId: String(i.host) });
  const O = op as Opening, H = host as Wall, old = s.elements[O.host] as Wall;
  if (O.host === H.id) fail("INVALID_REHOST", `${O.id} is already hosted by ${H.id}.`, { elementId: O.id, hostId: H.id });
  if (H.storey !== O.storey) fail("INVALID_REHOST", `${H.id} is on another storey; reassign the walls first.`, { elementId: O.id, hostId: H.id });
  if (i.keep_position && i.along !== undefined) fail("INVALID_REHOST", "give either along or keep_position, not both.", { elementId: O.id });
  const oldAlong = O.along;
  let along = i.along ?? O.along;
  if (i.keep_position) {                                         // the opening is already physically on the new wall: keep its world position
    const hd = unit(sub(H.end, H.start)), c = at(old.start, unit(sub(old.end, old.start)), O.along);
    if (Math.abs(cross(hd, sub(c, H.start))) > JOIN_TOLERANCE) fail("INVALID_REHOST", `${O.id} does not lie on the axis of ${H.id}; give along instead.`, { elementId: O.id, hostId: H.id });
    along = dot(sub(c, H.start), hd);
  }
  retarget(s, O, H.id, along);
  if (i.sill !== undefined) O.sill = i.sill;
  return { opening: O.id, from: old.id, to: H.id, fill: O.filledBy ?? null, oldAlong, newAlong: O.along, sill: O.sill };
}
