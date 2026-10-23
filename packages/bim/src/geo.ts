import { polygonSignedArea } from "./geometry.js";
/** Pure 2D geometry for the BIM kernel (metres, x right, y up / north). */
import { createHash } from "node:crypto";

export type P2 = [number, number];

export const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
export const len = (a: P2) => Math.hypot(a[0], a[1]);
export const unit = (a: P2): P2 => { const l = len(a); return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l]; };
export const leftNormal = (d: P2): P2 => [-d[1], d[0]];
export const dist = (a: P2, b: P2) => len(sub(a, b));

/** Signed area (> 0 counter-clockwise); single implementation lives in geometry.ts. */
export const signedArea = (pts: P2[]): number => polygonSignedArea(pts);
export const area = (pts: P2[]) => Math.abs(signedArea(pts));

/** Intersection of lines p + t*d and q + s*e (null if parallel). */
export function intersect(p: P2, d: P2, q: P2, e: P2): P2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + t * d[0], p[1] + t * d[1]];
}

/**
 * Offsets a polyline with mitred corners.
 * closed: positive dist = inward, negative = outward (orientation independent).
 * open: offset to the left of the drawing direction when sideLeft.
 */
export function offsetPolyline(pts: P2[], d: number, closed: boolean, sideLeft = true): P2[] {
  const n = pts.length;
  const sgn = closed ? (signedArea(pts) > 0 ? 1 : -1) : sideLeft ? 1 : -1;
  const edges: { p: P2; u: P2; q: P2 }[] = [];
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const u = unit(sub(b, a));
    if (len(u) === 0) continue;
    const off = mul(leftNormal(u), sgn * d);
    edges.push({ p: add(a, off), u, q: add(b, off) });
  }
  const out: P2[] = [];
  if (closed) {
    for (let i = 0; i < edges.length; i++) {
      const prev = edges[(i - 1 + edges.length) % edges.length], cur = edges[i];
      out.push(intersect(prev.p, prev.u, cur.p, cur.u) ?? cur.p);
    }
  } else {
    out.push(edges[0].p);
    for (let i = 1; i < edges.length; i++) out.push(intersect(edges[i - 1].p, edges[i - 1].u, edges[i].p, edges[i].u) ?? edges[i].p);
    out.push(edges[edges.length - 1].q);
  }
  return out;
}


/**
 * Footprint of a wall segment start->end with thickness t.
 * prevDir / nextDir: directions of the joined neighbour segments (for mitred
 * corners); null = square end. Returns 4 points CCW-agnostic: left-start,
 * left-end, right-end, right-start.
 */
/** An end cut: the (infinite) line an end is trimmed to — e.g. the near face of the wall a branch is teed onto. */
export interface EndCut { p: P2; d: P2; }
export function wallFootprint(start: P2, end: P2, t: number, prevDir: P2 | null, nextDir: P2 | null,
                              startCut: EndCut | null = null, endCut: EndCut | null = null): P2[] {
  const d = unit(sub(end, start));
  const n = leftNormal(d);
  const h = t / 2;
  const side = (s: number) => {
    const off = mul(n, s * h);
    const lineP = add(start, off);
    let a: P2 = lineP, b: P2 = add(end, off);
    if (prevDir) {
      const pn = leftNormal(prevDir);
      a = intersect(lineP, d, add(start, mul(pn, s * h)), prevDir) ?? a;
    }
    if (nextDir) {
      const nn = leftNormal(nextDir);
      b = intersect(lineP, d, add(end, mul(nn, s * h)), nextDir) ?? b;
    }
    // a derived end cut (T branch against a host face) takes the place of the square / mitred end
    if (startCut) a = intersect(lineP, d, startCut.p, startCut.d) ?? a;
    if (endCut) b = intersect(lineP, d, endCut.p, endCut.d) ?? b;
    return [a, b] as [P2, P2];
  };
  const [ls, le] = side(1), [rs, re] = side(-1);
  return [ls, le, re, rs];
}

/** Transforms a global point into a wall's local frame (origin start, x along the wall). */
export function toLocal(p: P2, origin: P2, dir: P2): P2 {
  const v = sub(p, origin);
  return [v[0] * dir[0] + v[1] * dir[1], -v[0] * dir[1] + v[1] * dir[0]];
}

export const r = (v: number, k = 6) => Math.round(v * 10 ** k) / 10 ** k;

/**
 * THE segment-line intersection formula (trim, extend and crossing detection all use it): parameters of the
 * intersection of the lines through a0->a1 and b0->b1 (0 at a0 / b0, 1 at a1 / b1), or null when exactly parallel.
 */
export function lineParams(a0: P2, a1: P2, b0: P2, b1: P2): { tA: number; tB: number } | null {
  const dA: P2 = [a1[0] - a0[0], a1[1] - a0[1]], dB: P2 = [b1[0] - b0[0], b1[1] - b0[1]];
  const den = dA[0] * dB[1] - dA[1] * dB[0];
  if (den === 0) return null;
  const w: P2 = [b0[0] - a0[0], b0[1] - a0[1]];
  return { tA: (w[0] * dB[1] - w[1] * dB[0]) / den, tB: (w[0] * dA[1] - w[1] * dA[0]) / den };
}

// ------------------------------------------------------------------ IFC GUIDs
const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** Deterministic 22-char IFC GlobalId from a seed (128 bits of an MD5 hash). */
export function ifcGuid(seed: string): string {
  const bytes = createHash("md5").update(seed).digest();
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const chars: string[] = [];
  for (let i = 0; i < 22; i++) {
    const bits = i === 0 ? 2 : 6;
    const shift = BigInt(128 - (i === 0 ? 2 : 2 + 6 * i));
    const mask = (1n << BigInt(bits)) - 1n;
    chars.push(B64[Number((n >> shift) & mask)]);
  }
  return chars.join("");
}

/** One side line of a wall at a signed offset from the axis (left positive), mitred to its neighbours. */
export function offsetSegment(start: P2, end: P2, off: number, prevDir: P2 | null, nextDir: P2 | null): [P2, P2] {
  const d = unit(sub(end, start));
  const n = leftNormal(d);
  const lineP = add(start, mul(n, off));
  let a: P2 = lineP, b: P2 = add(end, mul(n, off));
  if (prevDir) a = intersect(lineP, d, add(start, mul(leftNormal(prevDir), off)), prevDir) ?? a;
  if (nextDir) b = intersect(lineP, d, add(end, mul(leftNormal(nextDir), off)), nextDir) ?? b;
  return [a, b];
}

/** Polygon of the band between two signed axis offsets (e.g. one material layer). */
export function band(start: P2, end: P2, o1: number, o2: number, prevDir: P2 | null, nextDir: P2 | null): P2[] {
  const [a1, b1] = offsetSegment(start, end, o1, prevDir, nextDir);
  const [a2, b2] = offsetSegment(start, end, o2, prevDir, nextDir);
  return [a1, b1, b2, a2];
}
