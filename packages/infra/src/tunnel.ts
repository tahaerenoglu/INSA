/** Tunnel = alignment + section types assigned to station ranges -> solids and quantities. */
import { Alignment3D, sampleStations, point3d, GeometryError } from "./alignment.js";
import { boundaries, polyArea, SectionType } from "./section.js";
import { frames, sweepSolid, sweepAnnulus, meshVolume, Mesh } from "./sweep.js";

export interface Range { from: number; to: number; section: string; }

export interface RangeGeometry {
  range: Range;
  section: SectionType;
  stations: number[];
  layers: { name: string; material?: string; mesh: Mesh }[];
  excavation: Mesh;
  payment: Mesh;
  areas: { clear: number; layers: Record<string, number>; excavation: number; payment: number };
}

export function localOrigin(a: Alignment3D): [number, number, number] {
  const p = point3d(a, a.h[0].s0);
  return [Math.round(p.x), Math.round(p.y), 0];
}

/**
 * tol: max chord deviation along the alignment; ringTol: max chord deviation of section arcs.
 * Quantities use the precise defaults; visual exports use coarser values (see EXPORT_TOL).
 */
export const EXPORT_TOL = { tol: 0.01, ringTol: 0.001 };

export function tunnelGeometry(a: Alignment3D, ranges: Range[], sections: Record<string, SectionType>,
                               origin: [number, number, number], tol = 0.002, ringTol = 0.0002): RangeGeometry[] {
  return ranges.map((rg) => {
    const t = sections[rg.section];
    if (!t) throw new GeometryError(`Section type ${rg.section} not found.`);
    const b = boundaries(t, ringTol);
    const st = sampleStations(a, rg.from, rg.to, tol, 25);
    const fr = frames(a, st, origin);
    const layers = t.layers.map((l, i) => ({ name: l.name, material: l.material, mesh: sweepAnnulus(fr, b.rings[i], b.rings[i + 1],Boolean(l.outer_profile)) }));
    const areas = {
      clear: polyArea(b.rings[0]),
      layers: Object.fromEntries(t.layers.map((l, i) => [l.name, polyArea(b.rings[i + 1]) - polyArea(b.rings[i])])),
      excavation: polyArea(b.excavation),
      payment: polyArea(b.payment),
    };
    return { range: rg, section: t, stations: st, layers, excavation: sweepSolid(fr, b.excavation), payment: sweepSolid(fr, b.payment), areas };
  });
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function tunnelQuantities(geo: RangeGeometry[]) {
  const totals: Record<string, number> = {};
  const add = (k: string, v: number) => { totals[k] = (totals[k] ?? 0) + v; };
  const rows = geo.map((g) => {
    const L = g.range.to - g.range.from;
    const vExc = meshVolume(g.excavation), vPay = meshVolume(g.payment);
    const layers = Object.fromEntries(g.layers.map((l) => [l.name, r3(meshVolume(l.mesh))]));
    add("excavation_m3", vExc); add("overbreak_m3", vPay - vExc); add("length_m", L);
    for (const [k, v] of Object.entries(layers)) add(`${k}_m3`, v);
    const row: Record<string, unknown> = {
      from: g.range.from, to: g.range.to, length_m: r3(L), section: g.section.name,
      areas_m2: { clear: r3(g.areas.clear), excavation: r3(g.areas.excavation), payment_line: r3(g.areas.payment),
                  ...Object.fromEntries(Object.entries(g.areas.layers).map(([k, v]) => [k, r3(v)])) },
      volumes_m3: { excavation: r3(vExc), overbreak: r3(vPay - vExc), ...layers },
    };
    if (g.section.bolts) {
      const rounds = Math.floor(L / g.section.bolts.spacing) + 1;
      const n = rounds * g.section.bolts.per_round;
      row.rock_bolts = { count: n, total_length_m: r3(n * g.section.bolts.length) };
      add("rock_bolts_count", n); add("rock_bolts_m", n * g.section.bolts.length);
    }
    if (g.section.ring_length) {
      const n = Math.ceil(L / g.section.ring_length - 1e-9);
      row.tbm_rings = n; add("tbm_rings", n);
    }
    return row;
  });
  return { ranges: rows, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, r3(v)])) };
}
