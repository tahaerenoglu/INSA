import { DomainError, type CommandTool } from '@insa/core';
import { z } from 'zod';
import { thickness, wallFrame, type BimState, type Wall, type LayeredType } from './model.js';
import { planeHeight } from './arch.js';
import { pointInPolygon, polygonEdges, segmentsCross, segmentsIntersect, GEOMETRY_EPSILON } from './geometry.js';
import { roofGeometry } from './engines/pitched-roof.js';

export type RoofPlane = { id: string; a: number; b: number; c: number; normal: [number, number, number] };
/** Clip a convex plan polygon to a*x+b*y+c >= 0. Shared by roof integration and solid derivation. */
export function clipPlanPolygon(polygon: [number, number][], a: number, b: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], u = a*p[0]+b*p[1]+c, v = a*q[0]+b*q[1]+c;
    if (u >= -1e-10) out.push(p);
    if ((u >= -1e-10) !== (v >= -1e-10)) { const t = u / (u-v); out.push([p[0]+t*(q[0]-p[0]), p[1]+t*(q[1]-p[1])]); }
  }
  return out.filter((p,i) => !i || Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1]) > 1e-10);
}
export function planPolygonMeasure(polygon: [number,number][]) {
  let twice = 0, x = 0, y = 0;
  polygon.forEach((p,i) => { const q = polygon[(i+1)%polygon.length], d = p[0]*q[1]-q[0]*p[1]; twice+=d; x+=(p[0]+q[0])*d; y+=(p[1]+q[1])*d; });
  return { area: Math.abs(twice)/2, center: [x/(3*twice), y/(3*twice)] as [number,number] };
}

/** Storey-local underside height. The reference is live, so roof/type/level edits propagate without duplicate geometry. */
export function wallRoof(s: BimState, wall: Wall) {
  if (!wall.topRoof) return null;
  const roof = s.elements[wall.topRoof];
  if (!roof || !(roof.kind === 'pitched_roof' || roof.kind === 'boundary' && roof.category === 'architecture.roof'))
    throw new DomainError(`${wall.id}: missing supported roof`, 'INVALID_HOST_RELATION');
  const t = s.types[roof.type] as LayeredType;
  const dz = s.storeys[roof.storey].elevation - s.storeys[wall.storey].elevation;
  let outline = roof.outline;
  let planes: RoofPlane[];
  if (roof.kind === 'pitched_roof') {
    const geometry = roofGeometry(s, roof);
    outline = geometry.eave.map(p => [p[0],p[1]]);
    planes = geometry.planes.map(p => {
      const [nx,ny,nz] = p.normal, a=-nx/nz, b=-ny/nz, v=p.polygon[0];
      return { id:p.id, a,b,c:dz+v[2]-a*v[0]-b*v[1]-geometry.thickness/nz,normal:p.normal };
    });
  } else {
    const origin = planeHeight(roof,[0,0]), a=planeHeight(roof,[1,0])-origin, b=planeHeight(roof,[0,1])-origin;
    const length=Math.hypot(a,b,1);
    planes=[{id:roof.id,a,b,c:dz+origin-thickness(t)*length,normal:[-a/length,-b/length,1/length]}];
  }
  const heightAt = (p: [number, number]) => Math.min(...planes.map(v => v.a*p[0]+v.b*p[1]+v.c));
  const f = wallFrame(s, wall);
  // Preserve the existing boundary-axis attachment contract (zero-overhang eaves may meet centered walls).
  for (const p of [wall.start,wall.end]) {
    if (pointInPolygon(p, outline) === 'outside' || roof.kind === 'boundary' && roof.holes.some(h => pointInPolygon(p, h) !== 'outside'))
      throw new DomainError(`${wall.id}: wall lies outside roof footprint`, 'INVALID_HOST_RELATION');
  }
  if(polygonEdges(outline).some(([c,d])=>segmentsCross(wall.start,wall.end,c,d))
    ||roof.kind==='boundary'&&roof.holes.some(h=>h.some(p=>pointInPolygon(p,f.footprint)!=='outside')||polygonEdges(f.footprint).some(([a,b])=>polygonEdges(h).some(([c,d])=>segmentsIntersect(a,b,c,d)))))
    throw new DomainError(`${wall.id}: wall footprint crosses roof boundary or opening`, 'INVALID_HOST_RELATION');
  // A min-of-planes roof is concave. Integrate each active facet separately: a ridge may cross the interior of a wall.
  const patches = planes.flatMap(plane => {
    let polygon=f.footprint;
    for(const other of planes) if(other!==plane) polygon=clipPlanPolygon(polygon,other.a-plane.a,other.b-plane.b,other.c-plane.c);
    const measure=planPolygonMeasure(polygon);
    if(measure.area<=GEOMETRY_EPSILON**2)return [];
    const top=plane.a*measure.center[0]+plane.b*measure.center[1]+plane.c;
    return [{plane:plane.id,polygon,heights:polygon.map(p=>plane.a*p[0]+plane.b*p[1]+plane.c),area:measure.area,volume:measure.area*(top-wall.baseOffset)}];
  });
  if(!patches.length)throw new DomainError(`${wall.id}: empty roof clipping`, 'INVALID_HOST_RELATION');
  const tops = patches.flatMap(p=>p.heights);
  if (Math.min(...tops) <= wall.baseOffset) throw new DomainError(`${wall.id}: roof underside below wall base`, 'INVALID_HOST_RELATION');
  const meanHeight = patches.reduce((sum,p)=>sum+p.volume,0)/patches.reduce((sum,p)=>sum+p.area,0);
  return { roof, planes, patches, heightAt, meanHeight, maxHeight: Math.max(...tops) - wall.baseOffset,
    start: heightAt(wall.start), end: heightAt(wall.end) };
}
export const attachWallsToRoof: CommandTool<BimState> = {
  name: 'bim_attach_walls_to_roof', title: 'Attach walls to roof underside', module: 'bim', kind: 'command', effect: 'write', permission: 'bim.write',
  description: 'Attach walls to a single-plane, gable or hip roof underside. Piecewise derived geometry, quantities, validation and IFC share the same live planes; roof/type/storey edits revalidate dependents.',
  input: z.object({ roof: z.string(), walls: z.array(z.string()).min(1).max(500) }).strict(),
  decide(s, i) {
    const events = i.walls.map((id: string) => {
      const wall = s.elements[id];
      if (!wall || wall.kind !== 'wall') throw new DomainError('Wall not found', 'ELEMENT_NOT_FOUND');
      const candidate = { ...wall, topRoof: i.roof };
      wallRoof(s, candidate);
      return { type: 'ElementUpdated', payload: { id, changes: { topRoof: i.roof } } };
    });
    return { events, summary: { walls: i.walls, roof: i.roof, relation: 'DependsOn' } };
  },
};
