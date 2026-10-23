/**
 * Shared geometry validation primitives for the BIM domain.
 *
 * Units: metres. Plan coordinates x (east) and y (north); element z values are
 * relative to their storey.
 *
 * GEOMETRY_EPSILON is the single tolerance of the BIM domain: two points
 * closer than it are the same point; a length, dimension or polygon "width"
 * at or below it is degenerate. 0.1 mm is above the IFC context precision we
 * write (0.01 mm) and below any meaningful construction dimension.
 *
 * Topology decisions (which side of a line, collinear or not, do two segments
 * cross) use exact orientation signs from `robust-predicates` (Shewchuk's
 * adaptive-precision orient2d), so floating-point rounding cannot flip them.
 * The tolerance is applied separately, to distances.
 */
import { orient2d } from "robust-predicates";

export const GEOMETRY_EPSILON = 1e-4;

export type Pt = readonly [number, number];
export type Pt3 = readonly [number, number, number];

// ------------------------------------------------------------------ numbers and points
export const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isFinitePoint2D = (p: unknown): p is Pt =>
  Array.isArray(p) && p.length === 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]);
export const isFinitePoint3D = (p: unknown): p is Pt3 =>
  Array.isArray(p) && p.length === 3 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]) && isFiniteNumber(p[2]);
/** @deprecated alias of isFinitePoint2D */
export const isFinitePoint = isFinitePoint2D;

export const distance2D = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const distance3D = (a: Pt3, b: Pt3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
export const distance = distance2D;
export const approximatelyEqual = (a: number, b: number, tol = GEOMETRY_EPSILON) => Math.abs(a - b) <= tol;

/**
 * Exact orientation of c relative to the directed line a->b:
 * > 0 counter-clockwise (c on the left), < 0 clockwise, 0 exactly collinear.
 * (robust-predicates' orient2d uses the opposite sign; it is flipped here, once.)
 */
export const orient = (a: Pt, b: Pt, c: Pt): number => {
  const v = -orient2d(a[0], a[1], b[0], b[1], c[0], c[1]);
  return v === 0 ? 0 : v;                                   // never leak -0
};

// ------------------------------------------------------------------ segments
export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  if (L2 === 0) return distance2D(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** True when p lies on segment ab within the tolerance. */
export const pointOnSegment = (p: Pt, a: Pt, b: Pt, tol = GEOMETRY_EPSILON) => pointSegmentDistance(p, a, b) <= tol;

const between = (p: Pt, a: Pt, b: Pt) =>             // p collinear with ab: inside the closed box of ab
  Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

export type SegmentRelation = "disjoint" | "cross" | "touch" | "overlap";

/**
 * Exact topological relation of two closed segments (no tolerance):
 * cross   — interiors cross at a single point;
 * overlap — collinear and sharing more than one point;
 * touch   — share exactly one point that is an end point of at least one of them;
 * disjoint — no common point.
 */
export function segmentRelation(a: Pt, b: Pt, c: Pt, d: Pt): SegmentRelation {
  const o1 = Math.sign(orient(a, b, c)), o2 = Math.sign(orient(a, b, d));
  const o3 = Math.sign(orient(c, d, a)), o4 = Math.sign(orient(c, d, b));
  if (o1 * o2 < 0 && o3 * o4 < 0) return "cross";
  if (o1 === 0 && o2 === 0) {                                          // collinear: compare along the dominant axis
    const ax = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
    const [p0, p1] = [Math.min(a[ax], b[ax]), Math.max(a[ax], b[ax])];
    const [q0, q1] = [Math.min(c[ax], d[ax]), Math.max(c[ax], d[ax])];
    const lo = Math.max(p0, q0), hi = Math.min(p1, q1);
    if (lo > hi) return "disjoint";
    return lo === hi ? "touch" : "overlap";
  }
  if ((o1 === 0 && between(c, a, b)) || (o2 === 0 && between(d, a, b)) || (o3 === 0 && between(a, c, d)) || (o4 === 0 && between(b, c, d)))
    return "touch";
  return "disjoint";
}
export const segmentsIntersect = (a: Pt, b: Pt, c: Pt, d: Pt) => segmentRelation(a, b, c, d) !== "disjoint";
export const segmentsCross = (a: Pt, b: Pt, c: Pt, d: Pt) => segmentRelation(a, b, c, d) === "cross";

/** Minimum distance between two segments (0 if they intersect). */
export function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

// ------------------------------------------------------------------ polygons (open rings: the last vertex connects to the first)
export function polygonEdges(p: readonly Pt[]): [Pt, Pt, number][] {
  return p.map((v, i) => [v, p[(i + 1) % p.length], i]);
}
/** Signed area (shoelace; > 0 counter-clockwise). */
export function polygonSignedArea(p: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }
  return a / 2;
}
export const polygonArea = (p: readonly Pt[]) => Math.abs(polygonSignedArea(p));
export function polygonPerimeter(p: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += distance2D(p[i], p[(i + 1) % p.length]);
  return s;
}

/**
 * Point against a simple polygon (either winding). "boundary" when within
 * GEOMETRY_EPSILON of an edge; otherwise the winding number decides, using
 * exact orientation signs.
 */
export function pointInPolygon(pt: Pt, poly: readonly Pt[]): "inside" | "outside" | "boundary" {
  for (const [a, b] of polygonEdges(poly)) if (pointOnSegment(pt, a, b)) return "boundary";
  let wn = 0;
  for (const [a, b] of polygonEdges(poly)) {
    if (a[1] <= pt[1]) { if (b[1] > pt[1] && orient(a, b, pt) > 0) wn++; }
    else if (b[1] <= pt[1] && orient(a, b, pt) < 0) wn--;
  }
  return wn !== 0 ? "inside" : "outside";
}

/**
 * Canonical ring: rings are stored open (no repeated closing vertex). An
 * explicit closing vertex equal to the first one is removed; nothing else is changed.
 */
export function normalizeRing<T extends Pt>(p: readonly T[]): T[] {
  const out = [...p];
  if (out.length > 3 && isFinitePoint2D(out[0]) && isFinitePoint2D(out[out.length - 1]) && distance2D(out[0], out[out.length - 1]) <= GEOMETRY_EPSILON) out.pop();
  return out;
}

export type PolygonProblem = {
  reason: "INVALID_GEOMETRY" | "DEGENERATE_GEOMETRY" | "SELF_INTERSECTING_POLYGON";
  message: string;
  vertexIndex?: number;
  segmentIndex?: number;
  otherSegmentIndex?: number;
};

/**
 * Validates an open ring as a simple polygon:
 * >= 3 finite vertices; no repeated consecutive vertices (within ε); not all
 * collinear; non-adjacent edges neither intersect (exact) nor come within ε;
 * adjacent edges share only their common vertex (no fold-back); and the ring
 * does not collapse below the tolerance (area > ε · perimeter / 2).
 * Returns the first problem found, or null.
 */
export function polygonProblem(p: readonly unknown[]): PolygonProblem | null {
  const E = GEOMETRY_EPSILON;
  if (!Array.isArray(p) || p.length < 3) return { reason: "DEGENERATE_GEOMETRY", message: "needs at least 3 vertices" };
  for (let i = 0; i < p.length; i++) if (!isFinitePoint2D(p[i])) return { reason: "INVALID_GEOMETRY", message: `vertex ${i} is not a finite [x, y] point`, vertexIndex: i };
  const q = p as Pt[], n = q.length;
  for (let i = 0; i < n; i++)
    if (distance2D(q[i], q[(i + 1) % n]) <= E) return { reason: "DEGENERATE_GEOMETRY", message: `vertices ${i} and ${(i + 1) % n} coincide`, vertexIndex: i, segmentIndex: i };
  let far = 0;
  for (let i = 1; i < n; i++) if (distance2D(q[0], q[i]) > distance2D(q[0], q[far])) far = i;
  if (q.every((v) => orient(q[0], q[far], v) === 0 || pointSegmentDistance(v, q[0], q[far]) <= E))
    return { reason: "DEGENERATE_GEOMETRY", message: "all vertices are collinear (zero area)" };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;                       // adjacent: handled below
      if (segmentDistance(q[i], q[(i + 1) % n], q[j], q[(j + 1) % n]) <= E)
        return { reason: "SELF_INTERSECTING_POLYGON", message: `edges ${i} and ${j} cross or touch`, segmentIndex: i, otherSegmentIndex: j };
    }
  for (let i = 0; i < n; i++) {                                                     // adjacent edges meeting at vertex i
    const a = q[(i - 1 + n) % n], b = q[i], c = q[(i + 1) % n];
    const folds = segmentRelation(a, b, b, c) === "overlap" ||
      (((a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1])) > 0 && (pointOnSegment(c, b, a) || pointOnSegment(a, b, c)));
    if (folds) return { reason: "SELF_INTERSECTING_POLYGON", message: `edges meeting at vertex ${i} overlap`, vertexIndex: i, segmentIndex: (i - 1 + n) % n, otherSegmentIndex: i };
  }
  if (polygonArea(q) <= (E * polygonPerimeter(q)) / 2)
    return { reason: "DEGENERATE_GEOMETRY", message: "polygon collapses below the geometry tolerance" };
  return null;
}

/** Minimum distance between the boundaries of two rings. */
export function ringDistance(a: readonly Pt[], b: readonly Pt[]): number {
  let d = Infinity;
  for (const [p0, p1] of polygonEdges(a)) for (const [q0, q1] of polygonEdges(b)) d = Math.min(d, segmentDistance(p0, p1, q0, q1));
  return d;
}

export type HoleProblem = { message: string; holeIndex: number; otherHoleIndex?: number; problem: string };

/**
 * Slab hole rules (rings already validated as simple polygons). A hole is valid
 * only if BOTH: its boundary stays more than ε away from the outline (no
 * crossing, no touching) AND it is inside the outline. Holes neither intersect,
 * touch, nor contain one another. Touching is rejected: a hole sharing an edge
 * or vertex with the outline or another hole is ambiguous topology.
 */
export function holeProblem(outline: readonly Pt[], holes: readonly (readonly Pt[])[]): HoleProblem | null {
  const E = GEOMETRY_EPSILON;
  for (let h = 0; h < holes.length; h++) {
    if (ringDistance(holes[h], outline) <= E) return { holeIndex: h, problem: "crosses_or_touches_outline", message: `hole ${h} crosses or touches the slab outline` };
    if (pointInPolygon(holes[h][0], outline) !== "inside") return { holeIndex: h, problem: "outside_outline", message: `hole ${h} is not inside the slab outline` };
  }
  for (let a = 0; a < holes.length; a++)
    for (let b = a + 1; b < holes.length; b++) {
      if (ringDistance(holes[a], holes[b]) <= E) return { holeIndex: a, otherHoleIndex: b, problem: "holes_intersect", message: `holes ${a} and ${b} intersect or touch` };
      if (pointInPolygon(holes[a][0], holes[b]) !== "outside" || pointInPolygon(holes[b][0], holes[a]) !== "outside")
        return { holeIndex: a, otherHoleIndex: b, problem: "holes_overlap", message: `holes ${a} and ${b} overlap (one contains the other)` };
    }
  return null;
}
