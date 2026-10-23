/** Geometric layouts only. Cover, diameters, steel grade and spacing are explicit project inputs. */
import { DomainError } from '@insa/core';
import { type BimState, type ProfileType, rebarCoverProblem } from '@insa/bim';
type Parameters = { cover: number; diameter: number; stirrupDiameter: number; spacing: number; steelGrade: string };
export function reinforcementLayout(s: BimState, hostId: string, p: Parameters, main: string, tie: string) {
  const host = s.elements[hostId];
  if (!host) throw new DomainError('Reinforcement host missing', 'ELEMENT_NOT_FOUND');
  if (host.kind !== 'profile_member' || host.placement !== 'member_vertical' || host.category !== 'structure.column' || host.direction === 'down')
    throw new DomainError('This layout supports upright rectangular columns only; other hosts retain explicit low-level bar authoring.', 'UNSUPPORTED_GEOMETRY');
  const t = s.types[host.type] as ProfileType;
  if (t.profile.shape !== 'rect') throw new DomainError('Column section must be rectangular', 'UNSUPPORTED_GEOMETRY');
  const { b, h } = t.profile, radius = p.diameter / 2, tr = p.stirrupDiameter / 2;
  const tx = b / 2 - p.cover - tr, ty = h / 2 - p.cover - tr;
  const z0 = host.baseOffset + p.cover + Math.max(radius, tr), z1 = host.baseOffset + host.height - p.cover - Math.max(radius, tr);
  const bend = Math.max(p.stirrupDiameter * 2, radius + tr); // geometric modeling radius; NOT a national-standard minimum.
  const mx = tx - bend, my = ty - bend; // main bars sit inside the rounded tie corners, including both bar radii.
  if (mx <= radius || my <= radius || tx <= 2 * bend || ty <= 2 * bend || z1 <= z0 || p.spacing < p.stirrupDiameter)
    throw new DomainError('Cover, diameters and spacing do not fit the section', 'INVALID_GEOMETRY');
  const a = host.rotation * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const v = (x: number, y: number, z: number): [number, number, number] => [host.at[0] + x * c - y * sn, host.at[1] + x * sn + y * c, z];
  const layers = [[-mx, -my], [mx, -my], [mx, my], [-mx, my]].map(([x, y]) => ({ path: [v(x, y, z0), v(x, y, z1)], count: 1 }));
  const count = Math.floor((z1 - z0) / p.spacing + 1e-9) + 1;
  if (count > 500) throw new DomainError('Stirrup set exceeds 500 bars', 'INVALID_GEOMETRY');
  return [
    { category: 'structure.rebar_set', name: `Longitudinal ${hostId}`, type: main, host: hostId, cover: p.cover, layers },
    { category: 'structure.rebar_set', name: `Stirrups ${hostId}`, type: tie, host: hostId, cover: p.cover, bend_radius: bend,
      layers: [{ path: [v(-tx, -ty, z0), v(tx, -ty, z0), v(tx, ty, z0), v(-tx, ty, z0), v(-tx, -ty, z0)], count, spacing: p.spacing, direction: [0, 0, 1] }] },
  ];
}
/** Check the outer bar surface against the rotated host prism, never just its centerline. */
export function reinforcementGeometryIssues(s: BimState) {
  const issues: { id: string; reason: string; message: string }[] = [];
  for (const e of Object.values(s.elements)) {
    if (e.kind !== 'reinforcement') continue;
    if (!e.geometryValidation) continue;
    const problem = rebarCoverProblem(s, e);
    if (problem) issues.push({ id: e.id, reason: 'REBAR_COVER_VIOLATION', message: problem });
  }
  return issues;
}
