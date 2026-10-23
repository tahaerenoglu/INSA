/**
 * Pure derivations for the Phase 11 architecture engines (no state, no events): the roof plane, the stair run and the
 * railing path. Quantities, plan, IFC, validation and the representation all read THESE functions, so a formula exists once.
 */
import type { P2 } from "./geo.js";
import { r } from "./geo.js";
import type { Boundary, BoundarySlope, StairElement, PathElement } from "./model.js";

/** Domain bound of a roof pitch (degrees): a steeper plane is a wall, and tan(pitch) / cos(pitch) leave their sane range. */
export const MAX_ROOF_PITCH_DEG = 80;
const rad = (d: number) => (d * Math.PI) / 180;
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const dist = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---------------------------------------------------------------- roof plane (boundary_plane)
/**
 * Canonical plane intent of a single-plane boundary: `azimuth` (degrees, [0, 360), CCW from +X) is the direction the plane RISES,
 * `pitch` (degrees, (0, MAX_ROOF_PITCH_DEG]) its inclination. The plane's reference line is the EAVE: the outline vertices with the
 * smallest projection on the rise direction; `offset` is the top-surface elevation there. Nothing else is stored.
 */
export function slopeFrame(b: Pick<Boundary, "outline"> & { slope: BoundarySlope }) {
  const a = rad(b.slope.azimuth);
  const u: P2 = [r(Math.cos(a), 12), r(Math.sin(a), 12)];                        // unit rise direction, free of 1e-17 noise at 90 / 180 / 270
  const s0 = Math.min(...b.outline.map((v) => dot(v, u)));
  return { u, s0, tan: Math.tan(rad(b.slope.pitch)), cos: Math.cos(rad(b.slope.pitch)), sin: Math.sin(rad(b.slope.pitch)) };
}
/** THE roof height formula: top-surface elevation (storey-local) of a boundary at plan point p. Flat boundaries: their offset. */
export function planeHeight(b: Pick<Boundary, "outline" | "offset" | "slope">, p: P2): number {
  if (!b.slope) return b.offset;
  const f = slopeFrame({ outline: b.outline, slope: b.slope });
  return b.offset + f.tan * (dot(p, f.u) - f.s0);
}
export const normalizeAzimuth = (deg: number) => r(((deg % 360) + 360) % 360, 6);

// ---------------------------------------------------------------- stair run
export interface StairGeometry { run: number; dir: P2; treadCount: number; treadDepth: number; riserHeight: number; slopeAngle: number; }
/** Derived run geometry (callers validate first: run > 0, riserCount >= 2, height > 0). Positions are products, never accumulated sums. */
export function stairGeometry(el: Pick<StairElement, "start" | "end" | "riserCount" | "height">): StairGeometry {
  const run = dist(el.start, el.end), dir: P2 = run > 0 ? [(el.end[0] - el.start[0]) / run, (el.end[1] - el.start[1]) / run] : [0, 0];
  const treadCount = el.riserCount - 1, treadDepth = run / treadCount, riserHeight = el.height / el.riserCount;
  return { run, dir, treadCount, treadDepth, riserHeight, slopeAngle: (Math.atan2(riserHeight, treadDepth) * 180) / Math.PI };
}
/**
 * The solid stair in the vertical plane of its walking line: (s, z) with s along the run from the first riser (bottom) to the last riser (top,
 * whose top is the upper floor level) and z from the base. N risers, N - 1 treads.
 */
export function stairProfile(el: Pick<StairElement, "start" | "end" | "riserCount" | "height">, waistThickness?: number): P2[] {
  // The N-th riser rises to the UPPER FLOOR level, which belongs to the floor, not to the stair: the solid ends at its last tread
  // (height = (N - 1) * riser height) and drops back to the base along the last riser line. No zero-area spike.
  const g = stairGeometry(el), out: P2[] = [[0, 0]];
  for (let k = 0; k < el.riserCount - 1; k++) {
    out.push([r(k * g.treadDepth), r((k + 1) * g.riserHeight)]);                       // up the riser k
    out.push([r((k + 1) * g.treadDepth), r((k + 1) * g.riserHeight)]);                 // along tread k
  }
  if(waistThickness){
    const top=el.height-g.riserHeight,slope=top/g.run,depth=waistThickness*Math.sqrt(1+slope*slope);
    if(depth<top){out.push([r(g.run),r(top-depth)],[r(depth/slope),0]);}
    else out.push([r(g.run),0]);
  }else out.push([r(g.run), 0]);
  return out;
}
export interface StairStep { index: number; riserAt: number; treadFrom: number; treadTo: number | null; top: number; }
export function stairSteps(el: Pick<StairElement, "start" | "end" | "riserCount" | "height">): StairStep[] {
  const g = stairGeometry(el);
  return Array.from({ length: el.riserCount }, (_, k) => ({ index: k + 1, riserAt: r(k * g.treadDepth), treadFrom: r(k * g.treadDepth),
    treadTo: k < el.riserCount - 1 ? r((k + 1) * g.treadDepth) : null, top: r((k + 1) * g.riserHeight) }));
}

// ---------------------------------------------------------------- path (railing)
/** Segments of a path, including the closing one of a closed path. */
export function pathSegments(p: Pick<PathElement, "path" | "closed">): [P2, P2][] {
  const n = p.path.length, out: [P2, P2][] = [];
  for (let i = 0; i + 1 < n; i++) out.push([p.path[i], p.path[i + 1]]);
  if (p.closed && n > 2) out.push([p.path[n - 1], p.path[0]]);
  return out;
}
export const pathLength = (p: Pick<PathElement, "path" | "closed">) => pathSegments(p).reduce((a, [x, y]) => a + dist(x, y), 0);
/**
 * Post positions (ONE documented rule): a post at every vertex, and every segment longer than `maxSpacing` is divided into
 * n = ceil(length / maxSpacing) equal intervals (posts at j * length / n, computed as products: no accumulated drift).
 * A closed path has no duplicated first / last post.
 */
export function pathPosts(p: Pick<PathElement, "path" | "closed">, maxSpacing: number): P2[] {
  const out: P2[] = [];
  const segs = pathSegments(p);
  segs.forEach(([a, b], i) => {
    const l = dist(a, b), n = Math.max(1, Math.ceil(r(l / maxSpacing, 9)));
    for (let j = 0; j < n; j++) out.push([r(a[0] + ((b[0] - a[0]) * j) / n), r(a[1] + ((b[1] - a[1]) * j) / n)]);
    if (i === segs.length - 1 && !p.closed) out.push([b[0], b[1]]);
  });
  return out;
}
