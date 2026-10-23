/**
 * Spatial engine (Phase 8): rooms, spaces and later spatial categories share this one implementation.
 *
 * SPATIAL INTENT IS PERSISTED, SPATIAL GEOMETRY IS DERIVED. A spatial element stores a storey-local
 * location point; its boundary is the bounded face of the storey's boundary graph that contains it.
 *
 * Boundary graph (per storey, room-bounding walls only):
 *   nodes — explicit topology only: a junction is ONE node; a tee endpoint and host(t) are ONE node;
 *           every other wall endpoint is its own node. Coincident but unjoined endpoints stay apart
 *           (touching is not joining), and walls crossing without topology create no node.
 *   edges — each wall is cut VIRTUALLY at its tee parameters: [0, t1, t2, ..., 1]. The wall element
 *           is never split; every edge keeps { wallId, fromT, toT }.
 * Faces: half-edge traversal with the face on the LEFT of each half-edge, outgoing edges sorted by
 *   exact angle (half-plane + orient2d). Bounded faces come out counter-clockwise; the outer face of
 *   each connected component clockwise. Edges walked both ways inside one face (dangling branches,
 *   bridges) are removed; what remains is the face's outer loop (CCW) and its holes (CW). The outer
 *   loop of a component lying inside a bounded face of another component becomes a hole of the
 *   smallest such face.
 * Boundary location: wall CENTERLINE (the topology is on wall axes). Area = outer - holes; perimeter =
 *   outer + holes. Complexity: O(E log E) per storey for the graph and faces, O(F) per point lookup.
 */
import { createHash } from "node:crypto";
import type { BimState, Wall, Element, SpatialElement, Opening, Insert } from "./model.js";
import type { P2 } from "./geo.js";
import { GEOMETRY_EPSILON, orient, pointInPolygon, pointSegmentDistance, polygonSignedArea, distance2D } from "./geometry.js";
import { epKey, teePoint } from "./topology.js";

export const BOUNDARY_LOCATION = "wall_centerline" as const;
export const isRoomBounding = (w: Wall) => w.roomBounding !== false;
export const isSpatialElement = (el: Element | undefined): el is SpatialElement => el?.kind === "spatial";
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface BoundarySegment { wallId: string; fromT: number; toT: number; }
export interface SpatialRegion {
  signature: string; storey: string;
  outer: P2[]; holes: P2[][];                       // outer CCW, holes CW (storey-local XY)
  boundarySegments: BoundarySegment[];              // outer loop first, then each hole (loop order)
  holeSegments: BoundarySegment[][];
  boundaryWalls: string[];
  area: number; perimeter: number; outerPerimeter: number;
  representativePoint: P2;
}

// ------------------------------------------------------------------ graph
interface HalfEdge { id: number; from: string; to: string; wall: string; fromT: number; toT: number; twin: number; }
interface Graph { pos: Map<string, P2>; edges: HalfEdge[]; out: Map<string, number[]>; }

function buildGraph(s: BimState, storey: string): Graph {
  const walls = Object.values(s.elements).filter((e): e is Wall => e.kind === "wall" && e.storey === storey && isRoomBounding(e)).sort((a, b) => cmp(a.id, b.id));
  const bounding = new Set(walls.map((w) => w.id));
  const nodeOf = new Map<string, string>();                         // wall endpoint -> node key
  const teesOnHost = new Map<string, Map<number, string>>();         // host -> t -> node key
  for (const j of Object.values(s.joins ?? {}).sort((a, b) => cmp(a.id, b.id))) {
    if (j.kind === "endpoint_endpoint") {
      for (const m of j.members) if (bounding.has(m.wall)) nodeOf.set(epKey(m), `J:${j.id}`);
    } else if (bounding.has(j.endpoint.wall) && bounding.has(j.host)) {
      const key = `T:${j.host}:${j.t}`;                             // tees at the same parameter share one node
      nodeOf.set(epKey(j.endpoint), key);
      if (!teesOnHost.has(j.host)) teesOnHost.set(j.host, new Map());
      teesOnHost.get(j.host)!.set(j.t, key);
    }
  }
  const pos = new Map<string, P2>();
  const edges: HalfEdge[] = [];
  for (const w of walls) {
    const a = nodeOf.get(`${w.id}:start`) ?? `E:${w.id}:start`, b = nodeOf.get(`${w.id}:end`) ?? `E:${w.id}:end`;
    if (!pos.has(a)) pos.set(a, w.start);
    if (!pos.has(b)) pos.set(b, w.end);
    const cuts = [...(teesOnHost.get(w.id) ?? new Map<number, string>()).entries()].sort((x, y) => x[0] - y[0]);
    const ts = [0, ...cuts.map((c) => c[0]), 1], keys = [a, ...cuts.map((c) => c[1]), b];
    for (const [t, k] of cuts) if (!pos.has(k)) pos.set(k, teePoint(w, t));
    for (let i = 0; i + 1 < ts.length; i++) {
      const id = edges.length;
      edges.push({ id, from: keys[i], to: keys[i + 1], wall: w.id, fromT: ts[i], toT: ts[i + 1], twin: id + 1 });
      edges.push({ id: id + 1, from: keys[i + 1], to: keys[i], wall: w.id, fromT: ts[i + 1], toT: ts[i], twin: id });
    }
  }
  // outgoing half-edges per node, counter-clockwise by exact angle (half-plane, then orient2d)
  const out = new Map<string, number[]>();
  for (const e of edges) { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from)!.push(e.id); }
  for (const [n, list] of out) {
    const o = pos.get(n)!;
    const half = (e: HalfEdge) => { const d = [pos.get(e.to)![0] - o[0], pos.get(e.to)![1] - o[1]]; return d[1] > 0 || (d[1] === 0 && d[0] > 0) ? 0 : 1; };
    list.sort((x, y) => {
      const ex = edges[x], ey = edges[y];
      const hx = half(ex), hy = half(ey);
      if (hx !== hy) return hx - hy;
      const c = orient(o, pos.get(ex.to)!, pos.get(ey.to)!);
      if (c !== 0) return c > 0 ? -1 : 1;
      return cmp(ex.wall, ey.wall) || ex.fromT - ey.fromT;                     // collinear: deterministic tie-break
    });
  }
  return { pos, edges, out };
}

// ------------------------------------------------------------------ faces
interface Loop { pts: P2[]; segs: BoundarySegment[]; area: number; length: number; }

function faces(g: Graph): number[][] {
  const seen = new Uint8Array(g.edges.length), result: number[][] = [];
  const next = (e: HalfEdge) => {
    const list = g.out.get(e.to)!, i = list.indexOf(e.twin);
    return list[(i - 1 + list.length) % list.length];                         // clockwise neighbour of the twin: face stays on the left
  };
  for (const start of g.edges) {
    if (seen[start.id]) continue;
    const cyc: number[] = [];
    let e = start.id, guard = 0;
    do { seen[e] = 1; cyc.push(e); e = next(g.edges[e]); if (++guard > g.edges.length + 1) break; } while (e !== start.id);
    result.push(cyc);
  }
  return result;
}

/** Removes half-edges walked both ways in one face (dangling branches, bridges) and re-chains the rest into loops. */
function loopsOf(g: Graph, cyc: number[]): Loop[] {
  const inFace = new Set(cyc);
  const keep = cyc.filter((e) => !inFace.has(g.edges[e].twin));
  const used = new Set<number>(), loops: Loop[] = [];
  for (let i = 0; i < keep.length; i++) {
    if (used.has(keep[i])) continue;
    const seq: number[] = [];
    let k = i, guard = 0;
    while (!used.has(keep[k]) && guard++ <= keep.length) {
      used.add(keep[k]); seq.push(keep[k]);
      const to = g.edges[keep[k]].to;
      let n = -1;
      for (let step = 1; step <= keep.length; step++) {
        const c = (k + step) % keep.length;
        if (!used.has(keep[c]) && g.edges[keep[c]].from === to) { n = c; break; }
      }
      if (n < 0) break;
      k = n;
    }
    if (seq.length < 2) continue;
    const pts = seq.map((e) => g.pos.get(g.edges[e].from)!);
    const segs = seq.map((e) => ({ wallId: g.edges[e].wall, fromT: g.edges[e].fromT, toT: g.edges[e].toT }));
    let length = 0;
    for (let j = 0; j < pts.length; j++) length += distance2D(pts[j], pts[(j + 1) % pts.length]);
    loops.push({ pts, segs, area: polygonSignedArea(pts), length });
  }
  return loops;
}

const tok = (x: BoundarySegment) => `${x.wallId}@${x.fromT}-${x.toT}`;
/**
 * Consecutive pieces of the same wall in the same direction merged into one run (wrap-around included):
 * a virtual cut that does not change the region (e.g. a dangling tee) does not change its signature.
 */
function runs(segs: BoundarySegment[]): BoundarySegment[] {
  const out: BoundarySegment[] = [];
  const joins = (a: BoundarySegment, b: BoundarySegment) => a.wallId === b.wallId && a.toT === b.fromT && Math.sign(a.toT - a.fromT) === Math.sign(b.toT - b.fromT);
  for (const x of segs) {
    const last = out[out.length - 1];
    if (last && joins(last, x)) last.toT = x.toT; else out.push({ ...x });
  }
  if (out.length > 1 && joins(out[out.length - 1], out[0])) { out[0] = { ...out[0], fromT: out[out.length - 1].fromT }; out.pop(); }
  return out;
}
/** Canonical, order-independent text of a loop: merged runs, rotated to start at the smallest token. */
function loopKey(raw: BoundarySegment[]): string {
  const segs = runs(raw);
  const t = segs.map(tok);
  let best = 0;
  for (let i = 1; i < t.length; i++) if (t[i] < t[best]) best = i;
  return [...t.slice(best), ...t.slice(0, best)].join(",");
}
const rotateSegs = (segs: BoundarySegment[]) => { const t = segs.map(tok); let b = 0; for (let i = 1; i < t.length; i++) if (t[i] < t[b]) b = i; return [...segs.slice(b), ...segs.slice(0, b)]; };
const rotatePts = (segs: BoundarySegment[], pts: P2[]) => { const t = segs.map(tok); let b = 0; for (let i = 1; i < t.length; i++) if (t[i] < t[b]) b = i; return [...pts.slice(b), ...pts.slice(0, b)]; };

/** A point strictly inside outer-minus-holes: midpoint of the widest scanline interval between vertex heights. */
function interiorPoint(outer: P2[], holes: P2[][]): P2 {
  const loops = [outer, ...holes];
  const ys = [...new Set(loops.flat().map((p) => p[1]))].sort((a, b) => a - b);
  let best: { w: number; p: P2 } | null = null;
  for (let i = 0; i + 1 < ys.length; i++) {
    const y = (ys[i] + ys[i + 1]) / 2, xs: number[] = [];
    for (const L of loops) for (let j = 0; j < L.length; j++) {
      const a = L[j], b = L[(j + 1) % L.length];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      if (!best || w > best.w) best = { w, p: [(xs[k] + xs[k + 1]) / 2, y] };
    }
  }
  return best ? best.p : outer[0];
}

/** All bounded regions of a storey, sorted by signature. */
export function storeyRegions(s: BimState, storey: string): SpatialRegion[] {
  const g = buildGraph(s, storey);
  const bounded: { outer: Loop; holes: Loop[] }[] = [], exteriors: Loop[] = [];
  const tiny = GEOMETRY_EPSILON * GEOMETRY_EPSILON;
  for (const cyc of faces(g)) {
    const loops = loopsOf(g, cyc);
    const pos = loops.filter((l) => l.area > tiny).sort((a, b) => b.area - a.area);
    const neg = loops.filter((l) => l.area < -tiny);
    if (pos.length) bounded.push({ outer: pos[0], holes: neg });
    else exteriors.push(...neg);
  }
  // nested components: an exterior loop inside a bounded face of another component is a hole of the smallest one
  for (const L of exteriors) {
    let host: { outer: Loop; holes: Loop[] } | null = null;
    for (const f of bounded) {
      if (L.segs.some((x) => f.outer.segs.some((y) => y.wallId === x.wallId))) continue;   // same component
      const probe = L.pts.find((p) => pointInPolygon(p, f.outer.pts) !== "boundary");
      if (!probe || pointInPolygon(probe, f.outer.pts) !== "inside") continue;
      if (!host || f.outer.area < host.outer.area || (f.outer.area === host.outer.area && loopKey(f.outer.segs) < loopKey(host.outer.segs))) host = f;
    }
    if (host) host.holes.push(L);
  }
  const regions = bounded.map(({ outer, holes }) => {
    const hs = [...holes].sort((a, b) => cmp(loopKey(a.segs), loopKey(b.segs)));
    const canonical = [loopKey(outer.segs), ...hs.map((h) => loopKey(h.segs))].join("|");
    const outerPts = rotatePts(outer.segs, outer.pts), holePts = hs.map((h) => rotatePts(h.segs, h.pts));
    const outerSegs = rotateSegs(outer.segs), holeSegs = hs.map((h) => rotateSegs(h.segs));
    return {
      signature: "R-" + createHash("sha256").update(canonical).digest("hex").slice(0, 16), storey,
      outer: outerPts, holes: holePts, boundarySegments: [...outerSegs, ...holeSegs.flat()], holeSegments: holeSegs,
      boundaryWalls: [...new Set([...outerSegs, ...holeSegs.flat()].map((x) => x.wallId))].sort(cmp),
      area: outer.area - hs.reduce((a, h) => a + Math.abs(h.area), 0),
      perimeter: outer.length + hs.reduce((a, h) => a + h.length, 0), outerPerimeter: outer.length,
      representativePoint: interiorPoint(outerPts, holePts),
    } satisfies SpatialRegion;
  });
  return regions.sort((a, b) => cmp(a.signature, b.signature));
}

// ------------------------------------------------------------------ resolution
/** Command- or query-local cache of storey regions (never persisted; built from the given state only). */
export class SpatialContext {
  private regions = new Map<string, SpatialRegion[]>();
  constructor(readonly s: BimState) {}
  storey(id: string): SpatialRegion[] {
    if (!this.regions.has(id)) this.regions.set(id, storeyRegions(this.s, id));
    return this.regions.get(id)!;
  }
}

export type PointResolution = { status: "bounded"; region: SpatialRegion } | { status: "unbounded"; onBoundary: boolean; wallId?: string };
/** Which bounded region of the storey contains the point (strictly); a point on any region boundary is ambiguous. */
export function resolvePoint(ctx: SpatialContext, storey: string, p: P2): PointResolution {
  for (const r of ctx.storey(storey)) {
    const loops: [P2[], BoundarySegment[]][] = [[r.outer, r.boundarySegments.slice(0, r.outer.length)], ...r.holes.map((h, i) => [h, r.holeSegments[i]] as [P2[], BoundarySegment[]])];
    for (const [pts, segs] of loops)
      for (let i = 0; i < pts.length; i++)
        if (pointSegmentDistance(p, pts[i], pts[(i + 1) % pts.length]) <= GEOMETRY_EPSILON) return { status: "unbounded", onBoundary: true, wallId: segs[i]?.wallId };
  }
  for (const r of ctx.storey(storey))
    if (pointInPolygon(p, r.outer) === "inside" && r.holes.every((h) => pointInPolygon(p, h) === "outside")) return { status: "bounded", region: r };
  return { status: "unbounded", onBoundary: false };
}

export interface ResolvedSpatial {
  status: "bounded" | "unbounded"; boundaryLocation: typeof BOUNDARY_LOCATION; onBoundary?: boolean;
  regionSignature: string | null; area: number | null; perimeter: number | null; outerPerimeter: number | null;
  height: number; volume: number | null; boundaryWalls: string[]; region: SpatialRegion | null;
}
/** The one resolver every consumer uses (queries, validation, IFC, plan, MCP). */
export function resolveSpatialElement(ctx: SpatialContext, el: SpatialElement): ResolvedSpatial {
  const r = resolvePoint(ctx, el.storey, el.point);
  if (r.status === "unbounded")
    return { status: "unbounded", boundaryLocation: BOUNDARY_LOCATION, ...(r.onBoundary ? { onBoundary: true } : {}), regionSignature: null,
             area: null, perimeter: null, outerPerimeter: null, height: el.height, volume: null, boundaryWalls: [], region: null };
  const g = r.region;
  return { status: "bounded", boundaryLocation: BOUNDARY_LOCATION, regionSignature: g.signature, area: g.area, perimeter: g.perimeter,
           outerPerimeter: g.outerPerimeter, height: el.height, volume: g.area * el.height, boundaryWalls: g.boundaryWalls, region: g };
}

/** Spatial elements of the storey grouped by the region they occupy (signature -> elements), sorted ids. */
export function occupancy(ctx: SpatialContext, storey: string): Map<string, SpatialElement[]> {
  const m = new Map<string, SpatialElement[]>();
  for (const el of Object.values(ctx.s.elements).filter((e): e is SpatialElement => e.kind === "spatial" && e.storey === storey).sort((a, b) => cmp(a.id, b.id))) {
    const r = resolvePoint(ctx, storey, el.point);
    if (r.status !== "bounded") continue;
    if (!m.has(r.region.signature)) m.set(r.region.signature, []);
    m.get(r.region.signature)!.push(el);
  }
  return m;
}

// ------------------------------------------------------------------ adjacency (derived)
const segKey = (x: BoundarySegment) => `${x.wallId}|${Math.min(x.fromT, x.toT)}|${Math.max(x.fromT, x.toT)}`;

/** Regions on each side of a wall at parameter t (0..2 bounded regions). */
function regionsAt(ctx: SpatialContext, storey: string, wallId: string, t: number): SpatialRegion[] {
  return ctx.storey(storey).filter((r) => r.boundarySegments.some((x) => x.wallId === wallId && t >= Math.min(x.fromT, x.toT) && t <= Math.max(x.fromT, x.toT)));
}

export function spatialAdjacency(ctx: SpatialContext, storey: string) {
  const regions = ctx.storey(storey), occ = occupancy(ctx, storey);
  const bySeg = new Map<string, SpatialRegion[]>();
  for (const r of regions) for (const x of r.boundarySegments) { const k = segKey(x); if (!bySeg.has(k)) bySeg.set(k, []); bySeg.get(k)!.push(r); }
  const pairs = new Map<string, { a: SpatialRegion; b: SpatialRegion; shared: Map<string, [number, number][]> }>();
  for (const [k, rs] of [...bySeg].sort((x, y) => cmp(x[0], y[0]))) {
    if (rs.length !== 2 || rs[0].signature === rs[1].signature) continue;
    const [a, b] = [...rs].sort((x, y) => cmp(x.signature, y.signature));
    const key = `${a.signature}|${b.signature}`;
    if (!pairs.has(key)) pairs.set(key, { a, b, shared: new Map() });
    const [wall, t0, t1] = k.split("|");
    const sh = pairs.get(key)!.shared;
    if (!sh.has(wall)) sh.set(wall, []);
    sh.get(wall)!.push([Number(t0), Number(t1)]);
  }
  const adjacency: { category: string; spatialElementA: string; spatialElementB: string; regionA: string; regionB: string; walls: { wallId: string; intervals: [number, number][] }[] }[] = [];
  for (const { a, b, shared } of pairs.values()) {
    const ea = occ.get(a.signature) ?? [], eb = occ.get(b.signature) ?? [];
    for (const x of ea) for (const y of eb) {
      if (x.category !== y.category) continue;
      const [p, q] = x.id < y.id ? [x, y] : [y, x];
      adjacency.push({ category: x.category, spatialElementA: p.id, spatialElementB: q.id, regionA: x.id < y.id ? a.signature : b.signature,
        regionB: x.id < y.id ? b.signature : a.signature, walls: [...shared].sort((m, n) => cmp(m[0], n[0])).map(([wallId, intervals]) => ({ wallId, intervals })) });
    }
  }
  adjacency.sort((m, n) => cmp(m.category, n.category) || cmp(m.spatialElementA, n.spatialElementA) || cmp(m.spatialElementB, n.spatialElementB));
  // doors (navigable) and windows (boundary only): which bounded regions lie on each side of the host wall
  const openings = (kind: "door" | "window") => Object.values(ctx.s.elements)
    // navigation (doors) vs boundary information (windows) is a semantic policy of those categories
    .filter((e): e is Insert => e.kind === "hosted_component" && e.category === `architecture.${kind}` && e.storey === storey).sort((m, n) => cmp(m.id, n.id))
    .map((ins) => {
      const op = ctx.s.elements[ins.opening] as Opening, w = ctx.s.elements[op.host] as Wall;
      const t = op.along / distance2D(w.start, w.end);
      const sides = regionsAt(ctx, storey, w.id, t).sort((m, n) => cmp(m.signature, n.signature)).map((r) => ({
        regionSignature: r.signature, spatialElements: (occ.get(r.signature) ?? []).map((e) => ({ id: e.id, category: e.category })) }));
      return { [`${kind}Id`]: ins.id, openingId: op.id, wallId: w.id, roomBounding: isRoomBounding(w), sides, exteriorSide: isRoomBounding(w) && sides.length < 2 };
    });
  return { adjacency, doors: openings("door"), windows: openings("window") };
}
