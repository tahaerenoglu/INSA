/** Phase 2 · unit tests for the shared geometry primitives. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GEOMETRY_EPSILON as E, orient, segmentsCross, segmentDistance, pointSegmentDistance, polygonArea, polygonSignedArea, pointInPolygon,
  polygonProblem, holeProblem, normalizeRing, isFinitePoint, isFinitePoint3D, distance3D, approximatelyEqual, polygonEdges,
  pointOnSegment, segmentRelation, segmentsIntersect, Pt,
} from "../src/geometry.js";
import { signedArea as geoSignedArea, area as geoArea } from "../src/geo.js";

const sq = (x: number, y: number, w: number): Pt[] => [[x, y], [x + w, y], [x + w, y + w], [x, y + w]];

test("tolerance is a single documented constant in metres", () => { assert.equal(E, 1e-4); });

test("orientation, segment crossing and distance", () => {
  assert.ok(orient([0, 0], [1, 0], [0, 1]) > 0); assert.ok(orient([0, 0], [1, 0], [0, -1]) < 0); assert.equal(orient([0, 0], [1, 0], [2, 0]), 0);
  assert.equal(segmentsCross([0, 0], [2, 2], [0, 2], [2, 0]), true);
  assert.equal(segmentsCross([0, 0], [1, 0], [1, 0], [2, 1]), false, "shared end point is not a crossing");
  assert.equal(segmentDistance([0, 0], [2, 2], [0, 2], [2, 0]), 0);
  assert.equal(segmentDistance([0, 0], [1, 0], [0, 1], [1, 1]), 1);
  assert.equal(segmentDistance([0, 0], [1, 0], [2, 0], [3, 0]), 1, "collinear, disjoint");
  assert.equal(segmentDistance([0, 0], [2, 0], [1, 0], [3, 0]), 0, "collinear, overlapping");
  assert.equal(pointSegmentDistance([1, 1], [0, 0], [2, 0]), 1);
});

test("orientation is exact (robust-predicates): no sign errors on a near-degenerate grid where naive arithmetic fails", () => {
  const big = (v: number) => BigInt(v * 2 ** 60);                    // inputs are dyadic: exact integer scaling
  const exact = (a: Pt, b: Pt, c: Pt) => {
    const v = (big(b[0]) - big(a[0])) * (big(c[1]) - big(a[1])) - (big(b[1]) - big(a[1])) * (big(c[0]) - big(a[0]));
    return v > 0n ? 1 : v < 0n ? -1 : 0;
  };
  const naive = (a: Pt, b: Pt, c: Pt) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const u = 2 ** -53;
  let naiveWrong = 0, robustWrong = 0;
  for (let i = 0; i < 256; i++) for (let j = 0; j < 256; j++) {
    const a: Pt = [0.5 + i * u, 0.5 + j * u], b: Pt = [12, 12], c: Pt = [24, 24];
    const e = exact(a, b, c);
    if (naive(a, b, c) !== e) naiveWrong++;
    if (Math.sign(orient(a, b, c)) !== e) robustWrong++;
  }
  assert.equal(robustWrong, 0);
  assert.ok(naiveWrong > 0, "the grid is a real robustness test case");
  assert.ok(orient([0, 0], [1, 0], [0, 1]) > 0, "INSA convention: > 0 counter-clockwise");
});

test("segment relation: cross, collinear overlap, end-point touch, T-junction, shared vertex, disjoint", () => {
  assert.equal(segmentRelation([0, 0], [2, 2], [0, 2], [2, 0]), "cross");
  assert.equal(segmentRelation([0, 0], [4, 0], [2, 0], [6, 0]), "overlap");
  assert.equal(segmentRelation([0, 0], [4, 0], [1, 0], [3, 0]), "overlap", "contained");
  assert.equal(segmentRelation([0, 0], [4, 0], [4, 0], [6, 0]), "touch", "collinear, end to end");
  assert.equal(segmentRelation([0, 0], [4, 0], [2, 0], [2, 3]), "touch", "T-junction");
  assert.equal(segmentRelation([0, 0], [4, 0], [4, 0], [4, 3]), "touch", "shared vertex (adjacent polygon edges)");
  assert.equal(segmentRelation([0, 0], [4, 0], [5, 0], [6, 0]), "disjoint", "collinear, apart");
  assert.equal(segmentRelation([0, 0], [4, 0], [0, 1], [4, 1]), "disjoint", "parallel");
  assert.equal(segmentRelation([0, 0], [4, 0], [5, -1], [5, 1]), "disjoint", "would cross only if extended");
  assert.equal(segmentsIntersect([0, 0], [4, 0], [2, 1e-9], [2, 3]), false, "exact: a hair above is not touching ...");
  assert.equal(segmentDistance([0, 0], [4, 0], [2, 1e-9], [2, 3]) <= E, true, "... but within the tolerance");
  assert.equal(pointOnSegment([2, E / 2], [0, 0], [4, 0]), true); assert.equal(pointOnSegment([2, 2 * E], [0, 0], [4, 0]), false);
});

test("numbers, points and edges helpers", () => {
  assert.equal(isFinitePoint3D([1, 2, 3]), true); assert.equal(isFinitePoint3D([1, 2, NaN]), false); assert.equal(isFinitePoint3D([1, 2]), false);
  assert.equal(distance3D([0, 0, 0], [2, 3, 6]), 7);
  assert.equal(approximatelyEqual(1, 1 + E / 2), true); assert.equal(approximatelyEqual(1, 1 + 2 * E), false);
  assert.deepEqual(polygonEdges([[0, 0], [1, 0], [0, 1]]).map((e) => e[2]), [0, 1, 2]);
  assert.deepEqual(polygonEdges([[0, 0], [1, 0], [0, 1]])[2], [[0, 1], [0, 0], 2], "closing edge");
});

test("signed area and point-in-polygon (with boundary band)", () => {
  assert.equal(polygonArea([[0, 0], [4, 0], [0, 3]]), 6);
  assert.equal(polygonSignedArea([[0, 0], [0, 3], [4, 0]]), -6);
  // regression: the construction helpers rely on the SIGN (wall offsets, exterior side); quantities on the absolute value
  assert.equal(geoSignedArea([[0, 0], [0, 3], [4, 0]]), -6); assert.equal(geoArea([[0, 0], [0, 3], [4, 0]]), 6);
  const L: Pt[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
  assert.equal(polygonArea(L), 7);
  assert.equal(pointInPolygon([0.5, 3], L), "inside"); assert.equal(pointInPolygon([3, 3], L), "outside");
  assert.equal(pointInPolygon([2, 1], L), "boundary"); assert.equal(pointInPolygon([2, 1 + E / 2], L), "boundary");
  const cw = [...L].reverse();
  for (const q of [[0.5, 3], [3, 3], [2, 1], [0.5, 0.5]] as Pt[]) assert.equal(pointInPolygon(q, cw), pointInPolygon(q, L), "winding-independent");
  assert.equal(pointInPolygon([4, 0.5], L), "boundary"); assert.equal(pointInPolygon([0, 0], L), "boundary", "vertex");
});

test("simple polygons pass; degenerate, collinear, bow-tie, spikes and NaN fail with the right reason", () => {
  assert.equal(polygonProblem(sq(0, 0, 10)), null);
  assert.equal(polygonProblem([[0, 0], [3, 0], [0, 4]]), null);
  assert.equal(polygonProblem([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]]), null, "concave L");
  assert.equal(polygonProblem([[0, 0], [5, 0], [10, 0], [10, 5], [0, 5]]), null, "collinear vertex on a straight edge is fine");
  const r = (p: unknown[]) => polygonProblem(p)?.reason;
  assert.equal(r([[0, 0], [1, 0]]), "DEGENERATE_GEOMETRY");
  assert.equal(r([[0, 0], [5, 0], [10, 0]]), "DEGENERATE_GEOMETRY", "three collinear points");
  assert.equal(r([[0, 0], [10, 0], [10, 0], [0, 10]]), "DEGENERATE_GEOMETRY", "repeated vertex");
  assert.equal(r([[0, 0], [10, 0], [10, E / 2], [0, 10]]), "DEGENERATE_GEOMETRY", "near-repeated vertex");
  assert.equal(r([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]), "DEGENERATE_GEOMETRY", "un-normalised closing vertex counts as a repeat");
  assert.equal(r([[0, 0], [10, 10], [10, 0], [0, 10]]), "SELF_INTERSECTING_POLYGON", "bow-tie");
  assert.equal(r([[0, 0], [10, 0], [10, 10], [5, -1], [0, 10]]), "SELF_INTERSECTING_POLYGON");
  assert.equal(r([[0, 0], [10, 0], [5, 0], [5, 5]]), "SELF_INTERSECTING_POLYGON", "spike folding back");
  assert.equal(r([[0, 0], [10, 0], [10, 10], [0, 10], [5, 10 - E / 2]]), "SELF_INTERSECTING_POLYGON", "vertex touching another edge");
  assert.equal(r([[0, 0], [10, 0], [10, E], [0, E]]), "DEGENERATE_GEOMETRY", "sliver thinner than the tolerance");
  assert.equal(r([[0, 0], [NaN, 0], [1, 1]]), "INVALID_GEOMETRY");
  assert.equal(r([[0, 0], [Infinity, 0], [1, 1]]), "INVALID_GEOMETRY");
  assert.equal(r([[0, 0], [1, 0], "x"] as any), "INVALID_GEOMETRY");
  assert.equal(isFinitePoint([1, -Infinity]), false);
});

test("closing vertex normalisation only removes an exact repeat of the first vertex", () => {
  assert.deepEqual(normalizeRing([[0, 0], [1, 0], [1, 1], [0, 0]]), [[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(normalizeRing([[0, 0], [1, 0], [1, 1], [0, 1]]), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  assert.deepEqual(normalizeRing([[0, 0], [1, 0], [0, 0]]), [[0, 0], [1, 0], [0, 0]], "never shrinks below 3 vertices");
});

test("hole rules: inside, outside, partly outside, crossing, touching, overlap, containment", () => {
  const outer = sq(0, 0, 10);
  const p = (holes: Pt[][]) => holeProblem(outer, holes)?.problem ?? null;
  assert.deepEqual(holeProblem(outer, [sq(2, 2, 2), sq(3, 3, 2)]), { holeIndex: 0, otherHoleIndex: 1, problem: "holes_intersect", message: "holes 0 and 1 intersect or touch" });
  assert.equal(p([sq(2, 2, 2), sq(6, 6, 2)]), null);
  assert.equal(p([sq(20, 20, 2)]), "outside_outline");
  assert.equal(p([sq(9, 4, 2)]), "crosses_or_touches_outline");
  assert.equal(p([[[5, 5], [15, 5], [15, 6], [5, 6]]]), "crosses_or_touches_outline");
  assert.equal(p([sq(0, 4, 2)]), "crosses_or_touches_outline", "touching the outline is rejected");
  assert.equal(p([sq(-1, -1, 12)]), "outside_outline", "hole enclosing the whole slab");
  assert.equal(p([sq(2, 2, 3), sq(4, 4, 3)]), "holes_intersect");
  assert.equal(p([sq(2, 2, 2), sq(4, 2, 2)]), "holes_intersect", "touching holes are rejected");
  assert.equal(p([sq(1, 1, 6), sq(2, 2, 2)]), "holes_overlap", "one hole inside another");
});
