/** Conservative solid bounds and deterministic orthogonal route search. Never creates penetrations. */
import { DomainError } from '@insa/core';
import { wallFrame, wallRoof, thickness, planeHeight, memberWorldEnds, sectionBounds, type BimState, type LayeredType, type ProfileType } from '@insa/bim';
type V = [number, number, number];
type Box = { min: V; max: V; holes?: [number, number][][] };
function hits(a: V, b: V, box: Box, margin: number) {
  if (box.holes?.some(h => {
    if (h.length !== 4 || !h.every(p => h.some(q => q !== p && q[0] === p[0]) && h.some(q => q !== p && q[1] === p[1]))) return false;
    const xs = h.map(p => p[0]), ys = h.map(p => p[1]);
    return [a, b].every(p => p[0] >= Math.min(...xs) + margin && p[0] <= Math.max(...xs) - margin && p[1] >= Math.min(...ys) + margin && p[1] <= Math.max(...ys) - margin);
  })) return false;
  let lo = 0, hi = 1;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k], min = box.min[k] - margin, max = box.max[k] + margin;
    if (Math.abs(d) < 1e-10) { if (a[k] < min || a[k] > max) return false; }
    else { const u = (min - a[k]) / d, v = (max - a[k]) / d; lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v)); if (lo > hi) return false; }
  }
  return hi >= lo;
}
function obstacles(s: BimState): Box[] {
  const boxes: Box[] = [];
  const bounds = (points: number[][], z0: number, z1: number, holes?: [number, number][][]) => {
    boxes.push({ min: [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), z0], max: [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1])), z1], holes });
  };
  for (const e of Object.values(s.elements)) {
    const z = s.storeys[e.storey]?.elevation ?? 0;
    if (e.kind === 'wall') bounds(wallFrame(s, e).footprint, z + e.baseOffset, z + e.baseOffset + (wallRoof(s, e)?.maxHeight ?? e.height));
    if (e.kind === 'profile_member') {
      const ends = memberWorldEnds(s, e), pr = sectionBounds((s.types[e.type] as ProfileType).profile), radius = Math.max(pr.w, pr.h) / 2;
      boxes.push({ min: ends.start.map((v, i) => Math.min(v, ends.end[i]) - radius) as V, max: ends.start.map((v, i) => Math.max(v, ends.end[i]) + radius) as V });
    }
    if (e.kind === 'boundary') {
      const tops = e.outline.map(p => z + planeHeight(e, p)), d = thickness(s.types[e.type] as LayeredType) / Math.cos((e.slope?.pitch ?? 0) * Math.PI / 180);
      bounds(e.outline, Math.min(...tops) - d, Math.max(...tops), e.holes);
    }
  }
  return boxes;
}
export function orthogonalRoute(s: BimState, start: V, end: V, radius: number): V[] {
  const boxes = obstacles(s), permutations = [[0, 1, 2], [1, 0, 2], [2, 0, 1], [0, 2, 1], [1, 2, 0], [2, 1, 0]];
  for (const order of permutations) {
    const points: V[] = [[...start]];
    for (const axis of order) {
      const next: V = [...points.at(-1)!]; next[axis] = end[axis];
      if (Math.hypot(...next.map((v, i) => v - points.at(-1)![i])) > 1e-9) points.push(next);
    }
    if (points.length > 1 && points.slice(1).every((p, i) => !boxes.some(box => hits(points[i], p, box, radius)))) return points;
  }
  throw new DomainError('No collision-free orthogonal route inside the authorized endpoint envelope. Provide a reviewed shaft/opening or another service zone; no structural penetration was created.', 'INVALID_ROUTE');
}
