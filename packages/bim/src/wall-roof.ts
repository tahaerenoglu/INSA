import { DomainError, type CommandTool } from '@insa/core';
import { z } from 'zod';
import { thickness, wallFrame, type BimState, type Wall, type Boundary, type LayeredType } from './model.js';
import { planeHeight } from './arch.js';
import { pointInPolygon } from './geometry.js';

/** Storey-local underside height. The reference is live, so roof/type/level edits propagate without duplicate geometry. */
export function wallRoof(s: BimState, wall: Wall) {
  if (!wall.topRoof) return null;
  const roof = s.elements[wall.topRoof];
  if (!roof || roof.kind !== 'boundary' || roof.category !== 'architecture.roof')
    throw new DomainError(`${wall.id}: missing single-plane roof`, 'INVALID_HOST_RELATION');
  const t = s.types[roof.type] as LayeredType;
  const dz = s.storeys[roof.storey].elevation - s.storeys[wall.storey].elevation;
  const depth = thickness(t) / Math.cos((roof.slope?.pitch ?? 0) * Math.PI / 180);
  const heightAt = (p: [number, number]) => dz + planeHeight(roof, p) - depth;
  const f = wallFrame(s, wall);
  for (const p of [wall.start, wall.end]) {
    // Boundary points are legal; sample just inward as pointInPolygon excludes edges in some callers.
    const center = roof.outline.reduce((v, p) => [v[0] + p[0] / roof.outline.length, v[1] + p[1] / roof.outline.length] as [number, number], [0, 0] as [number, number]);
    const q: [number, number] = [p[0] + (center[0] - p[0]) * 1e-7, p[1] + (center[1] - p[1]) * 1e-7];
    if (pointInPolygon(q, roof.outline) === 'outside' || roof.holes.some(h => pointInPolygon(q, h) !== 'outside'))
      throw new DomainError(`${wall.id}: wall lies outside roof footprint`, 'INVALID_HOST_RELATION');
  }
  const tops = f.footprint.map(heightAt);
  if (Math.min(...tops) <= wall.baseOffset) throw new DomainError(`${wall.id}: roof underside below wall base`, 'INVALID_HOST_RELATION');
  let twiceArea = 0, cx = 0, cy = 0;
  f.footprint.forEach((p, i) => { const q = f.footprint[(i + 1) % f.footprint.length], cross = p[0] * q[1] - q[0] * p[1]; twiceArea += cross; cx += (p[0] + q[0]) * cross; cy += (p[1] + q[1]) * cross; });
  const meanHeight = heightAt([cx / (3 * twiceArea), cy / (3 * twiceArea)]) - wall.baseOffset;
  return { roof: roof as Boundary, heightAt, meanHeight, maxHeight: Math.max(...tops) - wall.baseOffset,
    start: heightAt(wall.start), end: heightAt(wall.end) };
}
export const attachWallsToRoof: CommandTool<BimState> = {
  name: 'bim_attach_walls_to_roof', title: 'Attach walls to roof underside', module: 'bim', kind: 'command', effect: 'write', permission: 'bim.write',
  description: 'Explicit dependency from selected walls to one single-plane roof underside. IFC solids are clipped to the live plane; future roof/type/storey edits revalidate every attached wall.',
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
