/**
 * Explicit wall topology (Phase 6).
 *
 * Touching is not joining. Persistent relations exist only when created on purpose:
 *   junction (endpoint_endpoint): 2+ wall endpoints that always share ONE coordinate;
 *   tee      (endpoint_segment):  one endpoint that always lies on a host wall at parameter t.
 * Every wall endpoint takes part in at most one relation, so propagation is a simple, acyclic
 * walk (tee cycles are refused when a tee is created).
 *
 * Synchronisation pipeline inside a command (see synchronizeTopology):
 *   requested changes (already applied to the candidate state)
 *   -> junction propagation (moved members drive the junction; all members follow)
 *   -> tee propagation (tee endpoints follow their host at t, transitively through host chains)
 *   -> constrained-endpoint check (a tee endpoint moved on its own is refused)
 *   -> miter synchronisation of every affected wall
 * The validator (validateTopology) then checks the complete candidate state.
 */
import { DomainError, ErrorDetails, ErrorReason } from "@insa/core";
import type { BimState, Wall, WallJoin, WallEndpoint } from "./model.js";
import type { P2 } from "./geo.js";
import { GEOMETRY_EPSILON, distance2D, orient, pointSegmentDistance, segmentRelation } from "./geometry.js";
import { r, unit, sub, lineParams } from "./geo.js";

/** Joining distance: endpoints this close are one junction candidate (a small, documented multiple of ε: 1 mm). */
export const JOIN_TOLERANCE = 10 * GEOMETRY_EPSILON;
/** Default distance up to which detection reports a near miss (a gap or overshoot the user may want to close). */
export const NEAR_MISS_DISTANCE = 0.05;
/** Below this angle between two joined walls no miter is drawn (straight / near-parallel continuation: square ends). */
export const MITER_MIN_ANGLE_DEG = 10;
export const MITER_MIN_SIN = Math.sin((MITER_MIN_ANGLE_DEG * Math.PI) / 180);

const fail = (reason: ErrorReason, message: string, details: ErrorDetails = {}): never => { throw new DomainError(message, reason, details); };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const z = (v: number) => (v === 0 ? 0 : v);                                    // never store -0
const samePt = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];

export const epKey = (e: WallEndpoint) => `${e.wall}:${e.endpoint}`;
export const compareEndpoints = (a: WallEndpoint, b: WallEndpoint) => cmp(a.wall, b.wall) || cmp(a.endpoint, b.endpoint);
export const wallOf = (s: BimState, id: string): Wall | undefined => { const w = s.elements[id]; return w?.kind === "wall" ? (w as Wall) : undefined; };
export const pointOf = (s: BimState, e: WallEndpoint): P2 => { const w = wallOf(s, e.wall)!; return e.endpoint === "start" ? w.start : w.end; };
const otherOf = (s: BimState, e: WallEndpoint): P2 => { const w = wallOf(s, e.wall)!; return e.endpoint === "start" ? w.end : w.start; };
export const membersOf = (j: WallJoin): WallEndpoint[] => (j.kind === "endpoint_endpoint" ? j.members : [j.endpoint]);
export const wallsOf = (j: WallJoin): string[] =>
  [...new Set([...membersOf(j).map((m) => m.wall), ...(j.kind === "endpoint_segment" ? [j.host] : [])])].sort(cmp);

/** The point at parameter t on the host, rounded like every stored coordinate (1e-6 m). */
export const teePoint = (host: Wall, t: number): P2 =>
  [r(host.start[0] + t * (host.end[0] - host.start[0])), r(host.start[1] + t * (host.end[1] - host.start[1]))];
/** A tee must stay clear of the host's ends (closer than JOIN_TOLERANCE it is an endpoint junction). */
export function teeRangeOk(host: Wall, t: number): boolean {
  const L = distance2D(host.start, host.end);
  return Number.isFinite(t) && t * L > JOIN_TOLERANCE && (1 - t) * L > JOIN_TOLERANCE;
}

// ------------------------------------------------------------------ index
export interface TopologyIndex {
  byEndpoint: Map<string, WallJoin>;           // endpoint -> its (single) relation
  byWall: Map<string, WallJoin[]>;             // wall -> relations it takes part in (as member, tee or host)
  teesByHost: Map<string, WallJoin[]>;         // host wall -> tees on it
}
export function topologyIndex(s: BimState): TopologyIndex {
  const idx: TopologyIndex = { byEndpoint: new Map(), byWall: new Map(), teesByHost: new Map() };
  const push = (m: Map<string, WallJoin[]>, k: string, j: WallJoin) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(j); };
  for (const j of Object.values(s.joins ?? {}).sort((a, b) => cmp(a.id, b.id))) {
    for (const m of membersOf(j)) if (!idx.byEndpoint.has(epKey(m))) idx.byEndpoint.set(epKey(m), j);
    for (const w of wallsOf(j)) push(idx.byWall, w, j);
    if (j.kind === "endpoint_segment") push(idx.teesByHost, j.host, j);
  }
  return idx;
}

// ------------------------------------------------------------------ change tracking
/** Records the original geometry of every wall it touches, to emit exactly the changed fields. */
export class WallTracker {
  private orig = new Map<string, Pick<Wall, "start" | "end" | "prevDir" | "nextDir">>();
  constructor(private s: BimState) {}
  touch(id: string) {
    if (this.orig.has(id)) return;
    const w = wallOf(this.s, id)!;
    this.orig.set(id, structuredClone({ start: w.start, end: w.end, prevDir: w.prevDir, nextDir: w.nextDir }));
  }
  setPoint(e: WallEndpoint, p: P2) { this.touch(e.wall); (wallOf(this.s, e.wall) as any)[e.endpoint] = [p[0], p[1]]; }
  setHint(id: string, field: "prevDir" | "nextDir", v: P2 | null) { this.touch(id); (wallOf(this.s, id) as any)[field] = v; }
  touched(): string[] { return [...this.orig.keys()].sort(cmp); }
  changes(): { id: string; changes: Record<string, unknown> }[] {
    return this.touched().flatMap((id) => {
      const w = wallOf(this.s, id)!, o = this.orig.get(id)!;
      const ch: Record<string, unknown> = {};
      for (const k of ["start", "end", "prevDir", "nextDir"] as const) if (JSON.stringify(w[k]) !== JSON.stringify(o[k])) ch[k] = w[k];
      return Object.keys(ch).length ? [{ id, changes: ch }] : [];
    });
  }
}

// ------------------------------------------------------------------ miters
/**
 * Miter hint of one endpoint. undefined: the endpoint is not in any relation (its hint is not
 * managed by topology — e.g. a legacy polyline corner). null: square end. A direction: mitred
 * against the single neighbour of a two-wall junction (prevDir = direction INTO the start,
 * nextDir = direction OUT of the end, as for polyline corners).
 */
export function miterHint(s: BimState, idx: TopologyIndex, e: WallEndpoint): P2 | null | undefined {
  const j = idx.byEndpoint.get(epKey(e));
  if (!j) return undefined;
  if (j.kind !== "endpoint_endpoint" || j.members.length !== 2) return null;       // tees and multi-wall junctions: square ends
  const nb = j.members.find((m) => epKey(m) !== epKey(e))!;
  const J = pointOf(s, e);
  const a = unit(sub(otherOf(s, e), J)), b = unit(sub(otherOf(s, nb), J));
  if (!(Math.abs(a[0] * b[1] - a[1] * b[0]) >= MITER_MIN_SIN)) return null;        // straight / near-parallel: no extreme miter
  return e.endpoint === "start" ? [z(-b[0]), z(-b[1])] : [z(b[0]), z(b[1])];
}

function syncMiters(s: BimState, idx: TopologyIndex, walls: Iterable<string>, released: Set<string>, tr: WallTracker) {
  for (const id of [...new Set(walls)].sort(cmp)) {
    const w = wallOf(s, id);
    if (!w) continue;
    for (const endpoint of ["start", "end"] as const) {
      const e = { wall: id, endpoint }, field = endpoint === "start" ? "prevDir" : "nextDir";
      let want = miterHint(s, idx, e);
      if (want === undefined) { if (!released.has(epKey(e))) continue; want = null; }
      if (JSON.stringify(w[field]) !== JSON.stringify(want)) tr.setHint(id, field, want);
    }
  }
}

// ------------------------------------------------------------------ propagation
/**
 * Brings topology back in sync after requested geometry changes (already applied to `s`).
 * `before` is the state at the start of the command: endpoints that differ from it are the drivers.
 * Returns the extra ElementUpdated changes (propagated coordinates and miter hints).
 */
export function synchronizeTopology(s: BimState, before: BimState, seeds: Iterable<string>,
                                    released: Set<string> = new Set(), tr: WallTracker = new WallTracker(s)) {
  const idx = topologyIndex(s);
  const beforePt = (e: WallEndpoint): P2 | undefined => { const b = wallOf(before, e.wall); return b ? (e.endpoint === "start" ? b.start : b.end) : undefined; };
  const movedByRequest = (e: WallEndpoint) => { const b = beforePt(e); return !b || !samePt(pointOf(s, e), b); };
  const seedList = [...new Set(seeds)].filter((id) => wallOf(s, id)).sort(cmp);
  const queue = [...seedList], queued = new Set(queue), doneJunctions = new Set<string>();
  const enqueue = (w: string) => { if (!queued.has(w)) { queued.add(w); queue.push(w); } };
  let guard = 0;
  const limit = 8 * (Object.keys(s.elements).length + Object.keys(s.joins ?? {}).length + 1);
  while (queue.length) {
    if (++guard > limit) fail("TOPOLOGY_INCONSISTENT", "Topology propagation did not converge.", {});
    const w = queue.shift()!;
    queued.delete(w);
    for (const endpoint of ["start", "end"] as const) {
      const j = idx.byEndpoint.get(epKey({ wall: w, endpoint }));
      if (!j || j.kind !== "endpoint_endpoint" || doneJunctions.has(j.id)) continue;
      const moved = j.members.filter(movedByRequest);
      if (!moved.length) continue;
      doneJunctions.add(j.id);
      const target = pointOf(s, moved[0]);
      const clash = moved.find((m) => !samePt(pointOf(s, m), target));
      if (clash) fail("WALL_JOIN_CONFLICT", `Junction ${j.id}: ${epKey(moved[0])} and ${epKey(clash)} were moved to different points in one command.`,
        { joinId: j.id, wallId: clash.wall, endpoint: clash.endpoint });
      for (const m of j.members) if (!samePt(pointOf(s, m), target)) { tr.setPoint(m, target); enqueue(m.wall); }
    }
    for (const tee of idx.teesByHost.get(w) ?? []) {
      if (tee.kind !== "endpoint_segment") continue;
      const p = teePoint(wallOf(s, tee.host)!, tee.t), cur = pointOf(s, tee.endpoint);
      if (samePt(cur, p)) continue;
      if (movedByRequest(tee.endpoint) && distance2D(cur, p) > JOIN_TOLERANCE)
        fail("CONSTRAINED_ENDPOINT", `${epKey(tee.endpoint)} is fixed on wall ${tee.host} at t=${tee.t}; it cannot also be moved on its own. Unjoin it first, or move only the host.`,
          { joinId: tee.id, wallId: tee.endpoint.wall, endpoint: tee.endpoint.endpoint, hostWallId: tee.host, hostT: tee.t });
      tr.setPoint(tee.endpoint, p);
      enqueue(tee.endpoint.wall);
    }
  }
  // a tee endpoint whose host did not move must not have moved either
  const involved = new Set([...seedList, ...tr.touched()]);
  for (const j of Object.values(s.joins ?? {}).sort((a, b) => cmp(a.id, b.id))) {
    if (j.kind !== "endpoint_segment" || !involved.has(j.endpoint.wall)) continue;
    const p = teePoint(wallOf(s, j.host)!, j.t), cur = pointOf(s, j.endpoint);
    if (samePt(cur, p)) continue;
    if (distance2D(cur, p) <= JOIN_TOLERANCE) { tr.setPoint(j.endpoint, p); continue; }        // moved together with its host (rounding)
    fail("CONSTRAINED_ENDPOINT", `${epKey(j.endpoint)} is fixed on wall ${j.host} at t=${j.t}; it cannot be moved on its own. Unjoin it first, or move the host.`,
      { joinId: j.id, wallId: j.endpoint.wall, endpoint: j.endpoint.endpoint, hostWallId: j.host, hostT: j.t });
  }
  // miters: every touched / seed wall and the other members of their junctions
  const mit = new Set([...seedList, ...tr.touched()]);
  for (const id of [...mit]) for (const j of idx.byWall.get(id) ?? []) for (const m of membersOf(j)) mit.add(m.wall);
  for (const k of released) mit.add(k.slice(0, k.lastIndexOf(":")));
  syncMiters(s, idx, mit, released, tr);
  return tr.changes();
}

// ------------------------------------------------------------------ create / remove relations
type JoinInput =
  | { kind: "endpoint_endpoint"; endpoints: WallEndpoint[] }
  | { kind: "endpoint_segment"; endpoint: WallEndpoint; host: string; t?: number };

export interface JoinResult {
  joinEvents: { type: string; payload: unknown }[];
  wallChanges: { id: string; changes: Record<string, unknown> }[];
  summary: { joinId: string; kind: string; affectedWalls: string[]; propagated: string[]; merged?: string[] };
}

function needWall(s: BimState, id: string, d: ErrorDetails = {}): Wall {
  const w = wallOf(s, id);
  if (!w) fail("INVALID_WALL_JOIN", `${id} is not an existing wall.`, { ...d, wallId: id });
  return w!;
}

/** Creates or extends a relation on the decision-local candidate state `s` (ids via `nextId`). */
export function createJoin(s: BimState, input: JoinInput, nextId: () => string): JoinResult {
  const before = structuredClone(s);
  const tr = new WallTracker(s);
  const idx = topologyIndex(s);
  const events: { type: string; payload: unknown }[] = [];
  if (input.kind === "endpoint_endpoint") {
    const refs = [...input.endpoints].sort(compareEndpoints);
    for (const e of refs) needWall(s, e.wall, { endpoint: e.endpoint });
    const keys = refs.map(epKey);
    if (new Set(keys).size !== keys.length) fail("INVALID_WALL_JOIN", "An endpoint cannot be joined to itself.", { endpoint: keys.find((k, i) => keys.indexOf(k) !== i)! });
    const existing = new Map<string, WallJoin>();
    for (const e of refs) {
      const j = idx.byEndpoint.get(epKey(e));
      if (j?.kind === "endpoint_segment")
        fail("WALL_ENDPOINT_ALREADY_CONSTRAINED", `${epKey(e)} is already a tee on wall ${j.host} (${j.id}).`, { joinId: j.id, wallId: e.wall, endpoint: e.endpoint });
      if (j) existing.set(j.id, j);
    }
    if (existing.size === 1 && refs.every((e) => idx.byEndpoint.get(epKey(e))?.id === [...existing.keys()][0]))
      fail("DUPLICATE_WALL_JOIN", `These endpoints are already joined (${[...existing.keys()][0]}).`, { joinId: [...existing.keys()][0] });
    const union = new Map<string, WallEndpoint>();
    for (const j of existing.values()) for (const m of membersOf(j)) union.set(epKey(m), m);
    for (const e of refs) union.set(epKey(e), { wall: e.wall, endpoint: e.endpoint });
    const members = [...union.values()].sort(compareEndpoints);
    const walls = members.map((m) => m.wall);
    if (new Set(walls).size !== walls.length) fail("INVALID_WALL_JOIN", "A wall cannot join its own other end.", { wallId: walls.find((w, i) => walls.indexOf(w) !== i)! });
    const storeys = new Set(walls.map((w) => wallOf(s, w)!.storey));
    if (storeys.size > 1) fail("WALL_JOIN_CONFLICT", "Joined walls must be on the same storey.", { wallIds: walls.join(",") });
    const keep = [...existing.keys()].sort(cmp)[0];
    const anchor = keep ? pointOf(s, membersOf(existing.get(keep)!)[0]) : pointOf(s, members[0]);
    for (const m of members) {
      const d = distance2D(pointOf(s, m), anchor);
      if (d > JOIN_TOLERANCE)
        fail("INVALID_WALL_JOIN", `${epKey(m)} is ${r(d, 6)} m from the junction; endpoints must be within ${JOIN_TOLERANCE} m (move the wall first).`,
          { wallId: m.wall, endpoint: m.endpoint, distance: r(d, 6), tolerance: JOIN_TOLERANCE });
    }
    for (const m of members) if (!samePt(pointOf(s, m), anchor)) tr.setPoint(m, anchor);
    let id: string;
    if (keep) {
      id = keep;
      (s.joins[keep] as { members: WallEndpoint[] }).members = members;
      events.push({ type: "WallJoinUpdated", payload: { id: keep, members } });
      for (const other of [...existing.keys()].sort(cmp).slice(1)) { delete s.joins[other]; events.push({ type: "WallJoinDeleted", payload: { id: other } }); }
    } else {
      id = nextId();
      s.joins[id] = { id, kind: "endpoint_endpoint", members };
      events.push({ type: "WallJoinCreated", payload: { join: s.joins[id] } });
    }
    const wallChanges = synchronizeTopology(s, before, walls, new Set(), tr);
    return { joinEvents: events, wallChanges, summary: { joinId: id, kind: input.kind, affectedWalls: [...new Set(walls)].sort(cmp),
      propagated: wallChanges.map((c) => c.id), ...(existing.size ? { merged: [...existing.keys()].sort(cmp) } : {}) } };
  }
  // ---- tee
  const e = input.endpoint;
  const w = needWall(s, e.wall, { endpoint: e.endpoint });
  const host = needWall(s, input.host, { role: "host" });
  if (e.wall === input.host) fail("INVALID_WALL_JOIN", "A wall cannot be teed onto itself.", { wallId: e.wall });
  const cur = idx.byEndpoint.get(epKey(e));
  if (cur?.kind === "endpoint_segment" && cur.host === input.host) fail("DUPLICATE_WALL_JOIN", `${epKey(e)} is already teed onto ${input.host} (${cur.id}).`, { joinId: cur.id });
  if (cur) fail("WALL_ENDPOINT_ALREADY_CONSTRAINED", `${epKey(e)} already takes part in ${cur.id}.`, { joinId: cur.id, wallId: e.wall, endpoint: e.endpoint });
  if (w.storey !== host.storey) fail("WALL_JOIN_CONFLICT", "Joined walls must be on the same storey.", { wallIds: [e.wall, input.host].join(",") });
  const P = pointOf(s, e), A = host.start, B = host.end;
  const L2 = (B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2;
  const t = input.t !== undefined ? input.t : r(((P[0] - A[0]) * (B[0] - A[0]) + (P[1] - A[1]) * (B[1] - A[1])) / L2, 9);
  if (!Number.isFinite(t) || t <= 0 || t >= 1) fail("INVALID_WALL_JOIN", `Tee parameter t=${t} must be strictly between 0 and 1.`, { hostWallId: input.host, hostT: Number.isFinite(t) ? t : -1 });
  if (!teeRangeOk(host, t))
    fail("INVALID_WALL_JOIN", `The point is within ${JOIN_TOLERANCE} m of an end of ${input.host}: join the endpoints instead (endpoint_endpoint).`, { hostWallId: input.host, hostT: t });
  const p = teePoint(host, t);
  const d = distance2D(P, p);
  if (d > JOIN_TOLERANCE)
    fail("INVALID_WALL_JOIN", `${epKey(e)} is ${r(d, 6)} m from wall ${input.host}; it must be within ${JOIN_TOLERANCE} m (move the wall first).`,
      { wallId: e.wall, endpoint: e.endpoint, hostWallId: input.host, distance: r(d, 6), tolerance: JOIN_TOLERANCE });
  if (orient(A, B, otherOf(s, e)) === 0) fail("INVALID_WALL_JOIN", `${e.wall} lies along ${input.host}; a tee needs a wall that leaves the host.`, { wallId: e.wall, hostWallId: input.host });
  // no cycles through host chains (A teed on B teed on ... A)
  const seen = new Set<string>(), stack = [input.host];
  while (stack.length) {
    const h = stack.pop()!;
    if (h === e.wall) fail("WALL_JOIN_CONFLICT", `Teeing ${e.wall} onto ${input.host} would create a cycle of tees.`, { wallId: e.wall, hostWallId: input.host });
    if (seen.has(h)) continue;
    seen.add(h);
    for (const ep of ["start", "end"] as const) { const j = idx.byEndpoint.get(epKey({ wall: h, endpoint: ep })); if (j?.kind === "endpoint_segment") stack.push(j.host); }
  }
  if (!samePt(P, p)) tr.setPoint(e, p);
  const id = nextId();
  s.joins[id] = { id, kind: "endpoint_segment", endpoint: { wall: e.wall, endpoint: e.endpoint }, host: input.host, t };
  events.push({ type: "WallJoinCreated", payload: { join: s.joins[id] } });
  const wallChanges = synchronizeTopology(s, before, [e.wall, input.host], new Set(), tr);
  return { joinEvents: events, wallChanges, summary: { joinId: id, kind: input.kind, affectedWalls: [e.wall, input.host].sort(cmp), propagated: wallChanges.map((c) => c.id) } };
}

/** Removes a relation (by id) or detaches one endpoint. Wall coordinates never change; miters are recomputed. */
export function removeJoin(s: BimState, by: { join?: string; endpoint?: WallEndpoint }) {
  const before = structuredClone(s);
  const idx = topologyIndex(s);
  let j: WallJoin | undefined;
  if (by.join) { j = s.joins[by.join]; if (!j) fail("JOIN_NOT_FOUND", `Join ${by.join} not found.`, { joinId: by.join }); }
  else if (by.endpoint) { j = idx.byEndpoint.get(epKey(by.endpoint)); if (!j) fail("JOIN_NOT_FOUND", `${epKey(by.endpoint)} is not joined.`, { wallId: by.endpoint.wall, endpoint: by.endpoint.endpoint }); }
  else fail("INVALID_WALL_JOIN", "Give a join id or an endpoint.", {});
  const events: { type: string; payload: unknown }[] = [];
  const released = new Set<string>();
  const seeds = wallsOf(j!);
  if (j!.kind === "endpoint_endpoint" && by.endpoint && j!.members.length > 2) {
    const members = j!.members.filter((m) => epKey(m) !== epKey(by.endpoint!));
    (s.joins[j!.id] as { members: WallEndpoint[] }).members = members;
    events.push({ type: "WallJoinUpdated", payload: { id: j!.id, members } });
    released.add(epKey(by.endpoint));
  } else {
    delete s.joins[j!.id];
    events.push({ type: "WallJoinDeleted", payload: { id: j!.id } });
    for (const m of membersOf(j!)) released.add(epKey(m));
  }
  const wallChanges = synchronizeTopology(s, before, seeds, released);
  return { joinEvents: events, wallChanges, summary: { joinId: j!.id, removed: !s.joins[j!.id], released: [...released].sort(cmp), affectedWalls: seeds } };
}

// ------------------------------------------------------------------ validation (candidate state)
/** Central topology invariants; run by the BIM validator on every command's candidate state. */
export function validateTopology(s: BimState) {
  const joins = Object.entries(s.joins ?? {}).sort((a, b) => cmp(a[0], b[0]));
  const owner = new Map<string, string>();
  for (const [key, j] of joins) {
    const d: ErrorDetails = { joinId: key };
    if (j.id !== key) fail("TOPOLOGY_INCONSISTENT", `Join ${key} has a mismatching id.`, d);
    for (const m of membersOf(j)) {
      if (m.endpoint !== "start" && m.endpoint !== "end") fail("INVALID_WALL_JOIN", `Join ${key}: invalid endpoint.`, d);
      if (!wallOf(s, m.wall)) fail("TOPOLOGY_INCONSISTENT", `Join ${key} references missing wall ${m.wall}.`, { ...d, wallId: m.wall });
      const prev = owner.get(epKey(m));
      if (prev) fail("WALL_ENDPOINT_ALREADY_CONSTRAINED", `${epKey(m)} takes part in both ${prev} and ${key}.`, { ...d, wallId: m.wall, endpoint: m.endpoint });
      owner.set(epKey(m), key);
    }
    if (j.kind === "endpoint_endpoint") {
      if (j.members.length < 2) fail("TOPOLOGY_INCONSISTENT", `Junction ${key} has fewer than two endpoints.`, d);
      const walls = j.members.map((m) => m.wall);
      if (new Set(walls).size !== walls.length) fail("INVALID_WALL_JOIN", `Junction ${key} contains both ends of one wall.`, d);
      if (new Set(walls.map((w) => wallOf(s, w)!.storey)).size > 1)
        fail("WALL_JOIN_CONFLICT", `Junction ${key} would join walls on different storeys; reassign all joined walls together or unjoin first.`, { ...d, wallIds: walls.join(",") });
      const p0 = pointOf(s, j.members[0]);
      for (const m of j.members) if (!samePt(pointOf(s, m), p0)) fail("TOPOLOGY_INCONSISTENT", `Junction ${key}: ${epKey(m)} is not at the junction point.`, { ...d, wallId: m.wall, endpoint: m.endpoint });
      for (let a = 0; a < j.members.length; a++) for (let b = a + 1; b < j.members.length; b++) {
        const oa = otherOf(s, j.members[a]), ob = otherOf(s, j.members[b]);
        const da = sub(oa, p0), db = sub(ob, p0);
        if (orient(p0, oa, ob) === 0 && da[0] * db[0] + da[1] * db[1] > 0)
          fail("INVALID_WALL_JOIN", `Junction ${key}: ${j.members[a].wall} and ${j.members[b].wall} overlap (collinear, same side).`, { ...d, wallIds: `${j.members[a].wall},${j.members[b].wall}` });
      }
    } else {
      const host = wallOf(s, j.host);
      if (!host) fail("TOPOLOGY_INCONSISTENT", `Tee ${key} references missing host ${j.host}.`, { ...d, hostWallId: j.host });
      if (j.host === j.endpoint.wall) fail("INVALID_WALL_JOIN", `Tee ${key} is on its own wall.`, d);
      if (wallOf(s, j.endpoint.wall)!.storey !== host!.storey)
        fail("WALL_JOIN_CONFLICT", `Tee ${key} would join walls on different storeys; reassign all joined walls together or unjoin first.`, { ...d, wallIds: `${j.endpoint.wall},${j.host}` });
      if (!teeRangeOk(host!, j.t)) fail("INVALID_WALL_JOIN", `Tee ${key}: t=${j.t} is no longer clear of the ends of ${j.host}.`, { ...d, hostWallId: j.host, hostT: j.t });
      if (!samePt(pointOf(s, j.endpoint), teePoint(host!, j.t)))
        fail("TOPOLOGY_INCONSISTENT", `Tee ${key}: ${epKey(j.endpoint)} is not on ${j.host} at t=${j.t}.`, { ...d, wallId: j.endpoint.wall, endpoint: j.endpoint.endpoint, hostT: j.t });
    }
  }
  // derived miter hints of every managed endpoint are in sync
  const idx = topologyIndex(s);
  for (const k of [...owner.keys()].sort(cmp)) {
    const [wall, endpoint] = [k.slice(0, k.lastIndexOf(":")), k.slice(k.lastIndexOf(":") + 1) as "start" | "end"];
    const want = miterHint(s, idx, { wall, endpoint });
    const have = wallOf(s, wall)![endpoint === "start" ? "prevDir" : "nextDir"];
    if (JSON.stringify(have) !== JSON.stringify(want))
      fail("TOPOLOGY_INCONSISTENT", `${k}: miter data is out of sync with its junction.`, { wallId: wall, endpoint, joinId: owner.get(k)! });
  }
}

// ------------------------------------------------------------------ queries
/** Walls connected to `wallId` through explicit relations only (BFS; near misses never connect). */
export function connectedComponent(s: BimState, wallId: string): string[] {
  const idx = topologyIndex(s);
  const seen = new Set<string>([wallId]), queue = [wallId];
  while (queue.length) {
    const w = queue.shift()!;
    for (const j of idx.byWall.get(w) ?? []) for (const o of wallsOf(j)) if (!seen.has(o)) { seen.add(o); queue.push(o); }
  }
  return [...seen].sort(cmp);
}

export interface DetectOptions { storey?: string; walls?: string[]; maxResults?: number; nearMissDistance?: number; includeExisting?: boolean; }
export type Candidate =
  | { type: "endpoint_endpoint"; storey: string; wallA: string; endpointA: "start" | "end"; wallB: string; endpointB: "start" | "end"; distance: number; existingJoin?: string }
  | { type: "endpoint_segment"; storey: string; wall: string; endpoint: "start" | "end"; hostWall: string; hostT: number; distance: number; existingJoin?: string };
export interface Crossing { type: "segment_crossing"; storey: string; wallA: string; wallB: string; point: P2; tA: number; tB: number; }
export type NearMiss = { type: "near_miss"; kind: "endpoint_endpoint" | "endpoint_segment"; storey: string; wallA: string; endpointA: "start" | "end"; wallB: string;
                         endpointB?: "start" | "end"; hostT?: number; distance: number };

/**
 * Non-mutating detection of connection candidates among walls of the same storey (O(n²) per
 * storey; scope it with `storey` / `walls`). Classification uses exact orientation predicates
 * for crossings and JOIN_TOLERANCE / nearMissDistance for distances. Results are sorted.
 */
export function detectConnections(s: BimState, o: DetectOptions = {}) {
  const idx = topologyIndex(s);
  const near = Math.min(Math.max(o.nearMissDistance ?? NEAR_MISS_DISTANCE, JOIN_TOLERANCE), 1);
  const walls = Object.values(s.elements).filter((e): e is Wall => e.kind === "wall")
    .filter((w) => (!o.storey || w.storey === o.storey)).sort((a, b) => cmp(a.id, b.id));
  const focus = o.walls ? new Set(o.walls) : null;
  const candidates: Candidate[] = [], crossings: Crossing[] = [], nearMisses: NearMiss[] = [];
  const eps = ["start", "end"] as const;
  for (let i = 0; i < walls.length; i++) for (let k = i + 1; k < walls.length; k++) {
    const A = walls[i], B = walls[k];
    if (A.storey !== B.storey) continue;
    // Plan coincidence alone is not a physical junction (e.g. a lintel above a wall).
    if (Math.min(A.baseOffset+A.height,B.baseOffset+B.height)-Math.max(A.baseOffset,B.baseOffset)<=GEOMETRY_EPSILON) continue;
    if (focus && !focus.has(A.id) && !focus.has(B.id)) continue;
    for (const ea of eps) for (const eb of eps) {
      const d = distance2D(A[ea], B[eb]);
      if (d > near) continue;
      const ja = idx.byEndpoint.get(epKey({ wall: A.id, endpoint: ea })), jb = idx.byEndpoint.get(epKey({ wall: B.id, endpoint: eb }));
      const existing = ja && jb && ja.id === jb.id ? ja.id : undefined;
      if (d <= JOIN_TOLERANCE) { if (!existing || o.includeExisting) candidates.push({ type: "endpoint_endpoint", storey: A.storey, wallA: A.id, endpointA: ea, wallB: B.id, endpointB: eb, distance: r(d, 6), ...(existing ? { existingJoin: existing } : {}) }); }
      else nearMisses.push({ type: "near_miss", kind: "endpoint_endpoint", storey: A.storey, wallA: A.id, endpointA: ea, wallB: B.id, endpointB: eb, distance: r(d, 6) });
    }
    for (const [W, H] of [[A, B], [B, A]] as const) for (const e of eps) {
      const P = W[e];
      const L2 = (H.end[0] - H.start[0]) ** 2 + (H.end[1] - H.start[1]) ** 2;
      const t = ((P[0] - H.start[0]) * (H.end[0] - H.start[0]) + (P[1] - H.start[1]) * (H.end[1] - H.start[1])) / L2;
      if (!teeRangeOk(H, t)) continue;
      const d = pointSegmentDistance(P, H.start, H.end);
      if (d > near) continue;
      const j = idx.byEndpoint.get(epKey({ wall: W.id, endpoint: e }));
      const existing = j?.kind === "endpoint_segment" && j.host === H.id ? j.id : undefined;
      if (d <= JOIN_TOLERANCE) { if (!existing || o.includeExisting) candidates.push({ type: "endpoint_segment", storey: W.storey, wall: W.id, endpoint: e, hostWall: H.id, hostT: r(t, 9), distance: r(d, 6), ...(existing ? { existingJoin: existing } : {}) }); }
      else nearMisses.push({ type: "near_miss", kind: "endpoint_segment", storey: W.storey, wallA: W.id, endpointA: e, wallB: H.id, hostT: r(t, 9), distance: r(d, 6) });
    }
    if (segmentRelation(A.start, A.end, B.start, B.end) === "cross") {
      const lp = lineParams(A.start, A.end, B.start, B.end)!;                          // a proper crossing is never exactly parallel
      const { tA, tB } = lp;
      if (teeRangeOk(A, tA) && teeRangeOk(B, tB))
        crossings.push({ type: "segment_crossing", storey: A.storey, wallA: A.id, wallB: B.id, tA: r(tA, 9), tB: r(tB, 9),
          point: [r(A.start[0] + tA * (A.end[0] - A.start[0])), r(A.start[1] + tA * (A.end[1] - A.start[1]))] });
    }
  }
  const key = (x: any) => [x.type, x.kind ?? "", x.storey, x.wallA ?? x.wall, x.endpointA ?? x.endpoint ?? "", x.wallB ?? x.hostWall, x.endpointB ?? "", String(x.distance ?? x.tA)].join("|");
  const sortAll = <T>(a: T[]) => a.sort((p, q) => cmp(key(p), key(q)));
  const max = Math.min(Math.max(o.maxResults ?? 100, 1), 1000);
  const total = candidates.length + crossings.length + nearMisses.length;
  const take = <T>(a: T[], room: number) => a.slice(0, Math.max(room, 0));
  const c = take(sortAll(candidates), max), x = take(sortAll(crossings), max - c.length), n = take(sortAll(nearMisses), max - c.length - x.length);
  return { candidates: c, crossings: x, nearMisses: n, total, truncated: c.length + x.length + n.length < total };
}
