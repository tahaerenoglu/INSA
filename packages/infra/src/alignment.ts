/**
 * Alignment geometry (metres, radians; x east, y north, z up).
 *
 * Horizontal: chain of elements whose curvature varies linearly with length
 * (line k0=k1=0, arc k0=k1=±1/R, clothoid k0->k1). Built from PIs with radius
 * and symmetric clothoid length (spiral-arc-spiral at each PI).
 * Vertical: PVIs with symmetric parabolic vertical curves.
 * Stations are horizontal distances along the alignment (+ start station).
 */
export type XY = [number, number];

export interface HElement {
  id?: string; // Stable canonical segment identity (optional for legacy PI-derived elements).
  kind: "line" | "arc" | "clothoid";
  s0: number;          // start station
  length: number;
  start: XY;
  az0: number;         // start heading (radians, from +x, counter-clockwise)
  k0: number;          // curvature at start (left turn positive)
  k1: number;          // curvature at end
  pi?: number;         // index of the PI it belongs to
}

export interface PI { x: number; y: number; radius?: number; spiral?: number; }
export interface PVI { station: number; z: number; curve?: number; }

export class GeometryError extends Error { readonly code = "domain"; }

// ------------------------------------------------------------------ element evaluation
const GL_X = [-0.9324695142, -0.6612093865, -0.2386191861, 0.2386191861, 0.6612093865, 0.9324695142];
const GL_W = [0.1713244924, 0.3607615730, 0.4679139346, 0.4679139346, 0.3607615730, 0.1713244924];

/** Position and heading at distance l (0..length) along an element. */
export function evalElement(e: HElement, l: number): { x: number; y: number; az: number; k: number } {
  const L = e.length;
  const dk = L > 0 ? (e.k1 - e.k0) / L : 0;
  const az = e.az0 + e.k0 * l + (dk * l * l) / 2;
  const k = e.k0 + dk * l;
  let x: number, y: number;
  if (Math.abs(dk) < 1e-15) {
    if (Math.abs(e.k0) < 1e-15) { x = e.start[0] + l * Math.cos(e.az0); y = e.start[1] + l * Math.sin(e.az0); }
    else {
      const r = 1 / e.k0;
      x = e.start[0] + r * (Math.sin(az) - Math.sin(e.az0));
      y = e.start[1] - r * (Math.cos(az) - Math.cos(e.az0));
    }
  } else {
    // clothoid: integrate cos/sin of the heading (Gauss-Legendre, 6 points per 2 m)
    const n = Math.max(1, Math.ceil(l / 2));
    const h = l / n;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      const a = i * h;
      for (let g = 0; g < 6; g++) {
        const t = a + (GL_X[g] + 1) * h / 2;
        const th = e.az0 + e.k0 * t + (dk * t * t) / 2;
        sx += GL_W[g] * Math.cos(th) * h / 2;
        sy += GL_W[g] * Math.sin(th) * h / 2;
      }
    }
    x = e.start[0] + sx; y = e.start[1] + sy;
  }
  return { x, y, az, k };
}

const unit = (dx: number, dy: number): XY => { const l = Math.hypot(dx, dy); return [dx / l, dy / l]; };

/** Builds the horizontal element chain from PIs (first and last are start/end points). */
export function buildHorizontal(pis: PI[], startStation = 0): HElement[] {
  if (pis.length < 2) throw new GeometryError("An alignment needs at least two points.");
  const out: HElement[] = [];
  let cur: XY = [pis[0].x, pis[0].y];
  let s = startStation;
  const push = (kind: HElement["kind"], length: number, az0: number, k0: number, k1: number, pi?: number) => {
    if (length < 1e-9) return;
    const e: HElement = { kind, s0: s, length, start: cur, az0, k0, k1, pi };
    out.push(e);
    const end = evalElement(e, length);
    cur = [end.x, end.y];
    s += length;
  };
  let prevT = 0; // tangent length used on the incoming side of the previous PI
  for (let i = 1; i < pis.length - 1; i++) {
    const P0 = pis[i - 1], P = pis[i], P1 = pis[i + 1];
    const dIn = unit(P.x - P0.x, P.y - P0.y), dOut = unit(P1.x - P.x, P1.y - P.y);
    const delta = Math.atan2(dIn[0] * dOut[1] - dIn[1] * dOut[0], dIn[0] * dOut[0] + dIn[1] * dOut[1]);
    const azIn = Math.atan2(dIn[1], dIn[0]);
    const R = P.radius ?? 0, Ls = P.spiral ?? 0;
    if (Math.abs(delta) < 1e-10 || R <= 0) {
      if (R > 0) continue; // straight through
      // angle point without curve: line to the PI
      push("line", Math.hypot(P.x - cur[0], P.y - cur[1]), azIn, 0, 0);
      prevT = 0;
      continue;
    }
    const sign = Math.sign(delta), D = Math.abs(delta);
    const ths = Ls / (2 * R);
    if (2 * ths > D + 1e-12)
      throw new GeometryError(`PI ${i}: spirals of ${Ls} m need a deflection of at least ${(2 * ths * 180 / Math.PI).toFixed(3)}°, the PI has ${(D * 180 / Math.PI).toFixed(3)}°.`);
    let p = 0, kk = 0;
    if (Ls > 0) {
      const e = evalElement({ kind: "clothoid", s0: 0, length: Ls, start: [0, 0], az0: 0, k0: 0, k1: 1 / R }, Ls);
      p = e.y - R * (1 - Math.cos(ths));
      kk = e.x - R * Math.sin(ths);
    }
    const T = (R + p) * Math.tan(D / 2) + kk;
    const dPrev = Math.hypot(P.x - P0.x, P.y - P0.y);
    if (T + prevT > dPrev + 1e-6)
      throw new GeometryError(`PI ${i}: tangent length ${T.toFixed(3)} m overlaps the previous curve (only ${(dPrev - prevT).toFixed(3)} m available).`);
    const TS: XY = [P.x - dIn[0] * T, P.y - dIn[1] * T];
    push("line", Math.hypot(TS[0] - cur[0], TS[1] - cur[1]), azIn, 0, 0);
    const az = () => evalElement(out[out.length - 1], out[out.length - 1].length).az;
    if (Ls > 0) push("clothoid", Ls, azIn, 0, sign / R, i);
    push("arc", R * (D - 2 * ths), out.length ? az() : azIn, sign / R, sign / R, i);
    if (Ls > 0) push("clothoid", Ls, az(), sign / R, 0, i);
    const ST: XY = [P.x + dOut[0] * T, P.y + dOut[1] * T];
    if (Math.hypot(cur[0] - ST[0], cur[1] - ST[1]) > 1e-5)
      throw new GeometryError(`PI ${i}: curve closure error ${Math.hypot(cur[0] - ST[0], cur[1] - ST[1]).toExponential(2)} m.`);
    cur = ST;
    const dNext = Math.hypot(P1.x - P.x, P1.y - P.y);
    if (T > dNext + 1e-6) throw new GeometryError(`PI ${i}: tangent length ${T.toFixed(3)} m exceeds the next leg (${dNext.toFixed(3)} m).`);
    prevT = T;
  }
  const last = pis[pis.length - 1];
  const dl = unit(last.x - cur[0], last.y - cur[1]);
  push("line", Math.hypot(last.x - cur[0], last.y - cur[1]), Math.atan2(dl[1], dl[0]), 0, 0);
  return out;
}

export function hLength(h: HElement[]) { return h.reduce((a, e) => a + e.length, 0); }

export function evalH(h: HElement[], station: number) {
  const s0 = h[0].s0, end = h[h.length - 1].s0 + h[h.length - 1].length;
  if (station < s0 - 1e-6 || station > end + 1e-6) throw new GeometryError(`Station ${station.toFixed(3)} is outside the alignment (${s0}-${end.toFixed(3)}).`);
  let e = h[0];
  for (const x of h) { if (station >= x.s0 - 1e-9) e = x; else break; }
  return { ...evalElement(e, Math.min(Math.max(station - e.s0, 0), e.length)), element: e };
}

// ------------------------------------------------------------------ vertical
export function checkVertical(v: PVI[]) {
  if (v.length < 2) throw new GeometryError("A vertical profile needs at least two PVIs.");
  for (let i = 1; i < v.length; i++) if (v[i].station <= v[i - 1].station) throw new GeometryError("PVI stations must increase.");
  for (let i = 1; i < v.length - 1; i++) {
    const L = v[i].curve ?? 0;
    if (L < 0) throw new GeometryError("Vertical curve length cannot be negative.");
    const a = v[i].station - L / 2, b = v[i].station + L / 2;
    const prevEnd = v[i - 1].station + (i - 1 > 0 ? (v[i - 1].curve ?? 0) / 2 : 0);
    const nextStart = v[i + 1].station - (i + 1 < v.length - 1 ? (v[i + 1].curve ?? 0) / 2 : 0);
    if (a < prevEnd - 1e-9 || b > nextStart + 1e-9) throw new GeometryError(`Vertical curve at PVI ${i} (L=${L} m) overlaps its neighbours.`);
  }
}

/** Known vertical coverage only: never extrapolate elevations outside actual PVIs. */
export const hasVerticalAt=(v:PVI[],station:number)=>v.length>=2&&station>=v[0].station-1e-8&&station<=v[v.length-1].station+1e-8;
export function verticalCoverage(a:Alignment3D){const range=a.v.length>=2?[a.v[0].station,a.v[a.v.length-1].station]:null,horizontal=[a.h[0].s0,a.h[0].s0+hLength(a.h)],complete=Boolean(range&&range[0]<=horizontal[0]+1e-8&&range[1]>=horizontal[1]-1e-8);return {status:range?(complete?'defined':'partial'):'unresolved',range,horizontal,complete};}
/** Elevation, grade (dz/ds) and vertical curvature at a station. */
export function evalV(v: PVI[], s: number): { z: number; grade: number; kv: number } {
  if(!hasVerticalAt(v,s))throw new GeometryError("Vertical profile coverage missing at this station; no extrapolation is permitted.");
  s=Math.max(v[0].station,Math.min(v[v.length-1].station,s));
  const g = (i: number) => (v[i + 1].z - v[i].z) / (v[i + 1].station - v[i].station);
  for (let i = 1; i < v.length - 1; i++) {
    const L = v[i].curve ?? 0;
    if (L > 0 && Math.abs(s - v[i].station) <= L / 2) {
      const g1 = g(i - 1), g2 = g(i), x = s - (v[i].station - L / 2);
      const z0 = v[i].z - g1 * L / 2;
      return { z: z0 + g1 * x + ((g2 - g1) * x * x) / (2 * L), grade: g1 + ((g2 - g1) * x) / L, kv: (g2 - g1) / L };
    }
  }
  let i = 0;
  while (i < v.length - 2 && s > v[i + 1].station) i++;
  return { z: v[i].z + g(i) * (s - v[i].station), grade: g(i), kv: 0 };
}

// ------------------------------------------------------------------ 3D alignment
export interface Alignment3D { h: HElement[]; v: PVI[]; }

export function point3d(a: Alignment3D, s: number) {
  if(a.v.length<2)throw new GeometryError("Horizontal-only alignment: vertical profile unresolved; no elevation or 3D geometry is inferred.");
  const hp = evalH(a.h, s);
  const vp = evalV(a.v, s);
  return { x: hp.x, y: hp.y, z: vp.z, az: hp.az, k: hp.k, grade: vp.grade, kv: vp.kv };
}

/**
 * Stations between s0 and s1 so that chords deviate from the curve by at most
 * `tol` (sagitta) in plan and profile; element and vertical-curve boundaries
 * are always included.
 */
export function sampleStations(a: Alignment3D, s0: number, s1: number, tol = 0.002, maxStep = 10): number[] {
  const breaks = new Set<number>([s0, s1]);
  for (const e of a.h) { if (e.s0 > s0 && e.s0 < s1) breaks.add(e.s0); }
  for (const p of a.v) {
    const L = p.curve ?? 0;
    for (const b of [p.station - L / 2, p.station + L / 2]) if (b > s0 && b < s1) breaks.add(b);
  }
  const sorted = [...breaks].sort((x, y) => x - y);
  const out: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a0 = sorted[i], a1 = sorted[i + 1];
    const mid = hasVerticalAt(a.v,(a0+a1)/2)?point3d(a, (a0 + a1) / 2):{kv:0};
    const kh = Math.max(...a.h.filter((e) => e.s0 < a1 && e.s0 + e.length > a0).map((e) => Math.max(Math.abs(e.k0), Math.abs(e.k1))), 0);
    const curv = Math.max(kh, Math.abs(mid.kv));
    const step = Math.min(maxStep, curv > 0 ? Math.sqrt((8 * tol) / curv) : maxStep);
    const n = Math.max(1, Math.ceil((a1 - a0) / step));
    for (let j = 0; j < n; j++) out.push(a0 + ((a1 - a0) * j) / n);
  }
  out.push(s1);
  return out;
}

export const kmLabel = (s: number) => {
  const km = Math.floor(s / 1000), m = s - km * 1000;
  return `${km}+${m.toFixed(m % 1 ? 2 : 0).padStart(m % 1 ? 6 : 3, "0")}`;
};

/** The same canonical evaluator accepts exact element definitions; no tessellated geometry. */
export function validateHorizontalElements(h:HElement[],startStation:number){
 if(!h.length||h.length>2000)throw new GeometryError('Exact alignment requires 1–2000 elements.');
 let station=startStation;const ids=new Set<string>();
 for(let i=0;i<h.length;i++){const e=h[i];if(![e.s0,e.length,...e.start,e.az0,e.k0,e.k1].every(Number.isFinite)||e.length<=1e-8)throw new GeometryError('Invalid/zero-length canonical horizontal element.');if(Math.abs(e.s0-station)>1e-5)throw new GeometryError('Canonical station accumulation mismatch.');if(e.kind==='line'&&(e.k0!==0||e.k1!==0)||e.kind==='arc'&&(Math.abs(e.k0)<1e-14||e.k0!==e.k1))throw new GeometryError('Canonical element curvature/kind mismatch.');if(e.id){if(ids.has(e.id))throw new GeometryError('Duplicate canonical segment id.');ids.add(e.id);}if(i){const end=evalElement(h[i-1],h[i-1].length);if(Math.hypot(end.x-e.start[0],end.y-e.start[1])>1e-5)throw new GeometryError('Canonical elements have an endpoint gap.');}station+=e.length;}
 return h;
}
