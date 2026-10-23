/**
 * Sweeping sections along a 3D alignment into closed, consistently oriented
 * triangle meshes. Section planes are vertical and perpendicular to the plan
 * tangent (tunnel practice). Mesh coordinates are local: world minus `origin`.
 */
import { Alignment3D, point3d } from "./alignment.js";
import type { UV } from "./section.js";
import earcut from 'earcut';

export interface Mesh { positions: number[]; indices: number[]; }
export interface Frame { p: [number, number, number]; n: [number, number, number]; }

export function frames(a: Alignment3D, stations: number[], origin: [number, number, number]): Frame[] {
  return stations.map((s) => {
    const q = point3d(a, s);
    return { p: [q.x - origin[0], q.y - origin[1], q.z - origin[2]], n: [-Math.sin(q.az), Math.cos(q.az), 0] };
  });
}

// section (x right, y up, looking forward) -> world: right = -left normal
const place = (f: Frame, [x, y]: UV): [number, number, number] =>
  [f.p[0] - x * f.n[0], f.p[1] - x * f.n[1], f.p[2] + y];

/** Ear clipping for a simple polygon; returns triangles CCW in (x, y). */
export function earClip(poly: UV[]): [number, number, number][] {
  const idx = poly.map((_, i) => i);
  const area = (a: UV, b: UV, c: UV) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: UV, a: UV, b: UV, c: UV) => area(a, b, p) >= -1e-12 && area(b, c, p) >= -1e-12 && area(c, a, p) >= -1e-12;
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (area(a, b, c) <= 1e-14) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(poly[j], a, b, c))) continue;
      tris.push([i0, i1, i2]); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/** Closed solid swept from a CCW section polygon (in x,y the polygon is CW in the right-handed (left, up, forward) frame, handled here). */
const solidTopologyCache=new Map<string,number[]>();
export function sweepSolid(fr: Frame[], ring: UV[]): Mesh {
  const n = ring.length, m = fr.length, pos: number[] = [], ind: number[] = [];
  for (const f of fr) for (const q of ring) pos.push(...place(f, q));
  const key=JSON.stringify([ring,m]);
  const cached=solidTopologyCache.get(key);
  if(cached)return {positions:pos,indices:cached.slice()};
  const v = (j: number, i: number) => j * n + (i % n);
  // ring is CCW in (x right, y up); in the (left, up) basis it is CW, so wind sides the other way round
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < n; i++)
    ind.push(v(j, i), v(j + 1, i + 1), v(j, i + 1), v(j, i), v(j + 1, i), v(j + 1, i + 1));
  for (const [a, b, c] of earClip(ring)) {
    ind.push(v(0, a), v(0, b), v(0, c));                 // start cap faces backwards
    ind.push(v(m - 1, a), v(m - 1, c), v(m - 1, b));     // end cap faces forwards
  }
  if(solidTopologyCache.size>=128)solidTopologyCache.delete(solidTopologyCache.keys().next().value!);
  solidTopologyCache.set(key,ind.slice());
  return { positions: pos, indices: ind };
}

/** Closed ring solid between two corresponding boundaries (inner, outer). */
export function sweepAnnulus(fr: Frame[], inner: UV[], outer: UV[], independentCaps=false): Mesh {
  const no=outer.length,ni=inner.length,stride=no+ni,m=fr.length,pos:number[]=[],ind:number[]=[];
  for(const f of fr){for(const q of outer)pos.push(...place(f,q));for(const q of inner)pos.push(...place(f,q));}
  const o=(j:number,i:number)=>j*stride+(i%no),k=(j:number,i:number)=>j*stride+no+(i%ni);
  for(let j=0;j<m-1;j++){
    for(let i=0;i<no;i++)ind.push(o(j,i),o(j+1,i+1),o(j,i+1),o(j,i),o(j+1,i),o(j+1,i+1));
    for(let i=0;i<ni;i++)ind.push(k(j,i),k(j,i+1),k(j+1,i+1),k(j,i),k(j+1,i+1),k(j+1,i));
  }
  if(independentCaps||no!==ni){
    // Triangulate the actual nested outlines: source drainage notches need no invented radial strips.
    const points=[...outer,...inner],caps=earcut(points.flat(),[no],2);
    for(let i=0;i<caps.length;i+=3){let[a,b,c]=caps.slice(i,i+3);const[A,B,C]=[points[a],points[b],points[c]];
      if((B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0])<0)[b,c]=[c,b];
      ind.push(a,b,c);const e=(m-1)*stride;ind.push(e+a,e+c,e+b);
    }
  }else for(let i=0;i<no;i++){
    ind.push(o(0,i),o(0,i+1),k(0,i+1),o(0,i),k(0,i+1),k(0,i));const e=m-1;
    ind.push(o(e,i),k(e,i+1),o(e,i+1),o(e,i),k(e,i),k(e,i+1));
  }
  return {positions:pos,indices:ind};
}

/** Signed volume (positive for a closed, outward-oriented mesh). */
export function meshVolume(m: Mesh): number {
  const p = m.positions, [ox, oy, oz] = [p[0], p[1], p[2]];
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
    const ax = p[a] - ox, ay = p[a + 1] - oy, az = p[a + 2] - oz;
    const bx = p[b] - ox, by = p[b + 1] - oy, bz = p[b + 2] - oz;
    const cx = p[c] - ox, cy = p[c + 1] - oy, cz = p[c + 2] - oz;
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Every directed edge must be matched by its reverse exactly once: closed and consistently oriented. */
export function isClosedOriented(m: Mesh): boolean {
  const edges = new Map<string, number>();
  const ind = m.indices;
  for (let t = 0; t < ind.length; t += 3)
    for (const [a, b] of [[ind[t], ind[t + 1]], [ind[t + 1], ind[t + 2]], [ind[t + 2], ind[t]]]) {
      const key = `${a}>${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  for (const [key, c] of edges) {
    if (c !== 1) return false;
    const [a, b] = key.split(">");
    if (edges.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}
