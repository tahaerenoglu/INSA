/**
 * Derived structural connectivity (Phase 12): which structural members, walls and boundaries TOUCH, computed on demand from the current
 * geometry. It is a geometric view: NOT a persistent joint, NOT an engineering connection design, never written to the state and never
 * inferred into events. Move an element and the answer changes with no event of its own.
 * Contact tolerance: the existing JOIN_TOLERANCE (3D for points, plan + z for walls / boundaries).
 */
import type { BimState, Element, ProfileMember, Wall, Boundary } from "./model.js";
import { wallFrame } from "./model.js";
import { memberWorldEnds } from "./engines/profile-member.js";
import { boundaryRepresentation } from "./engines/boundary.js";
import { categoryIdOfElement, findCategory } from "./taxonomy.js";
import { pointInPolygon } from "./geometry.js";
import { JOIN_TOLERANCE } from "./topology.js";

type V3 = [number, number, number];
export type ConnectivityKind = "endpoint_contact" | "endpoint_on_member" | "endpoint_in_wall" | "endpoint_in_boundary";
export interface ConnectivityRelation {
  source: string; sourceCategory: string; target: string; targetCategory: string;
  relation: ConnectivityKind; endpoint: "start" | "end"; targetEndpoint?: "start" | "end"; point: V3;
}
const d3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function pointSegment3(p: V3, a: V3, b: V3): number {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
  return d3(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const structural = (s: BimState, el: Element) => findCategory(categoryIdOfElement(s, el) ?? "")?.discipline === "structure";

export function structuralConnectivity(s: BimState, opts: { ids?: string[]; relation?: ConnectivityKind } = {}) {
  const els = Object.values(s.elements).sort((a, b) => cmp(a.id, b.id));
  const members = els.filter((e): e is ProfileMember => e.kind === "profile_member");
  const walls = els.filter((e): e is Wall => e.kind === "wall" && structural(s, e));
  const bounds = els.filter((e): e is Boundary => e.kind === "boundary" && structural(s, e));
  const cat = (e: Element) => categoryIdOfElement(s, e) ?? "";
  const ends = new Map(members.map((m) => [m.id, memberWorldEnds(s, m)] as const));
  const out: ConnectivityRelation[] = [];
  const E = ["start", "end"] as const;
  for (let i = 0; i < members.length; i++) for (let j = 0; j < members.length; j++) {
    if (i === j) continue;
    const a = members[i], b = members[j], ea = ends.get(a.id)!, eb = ends.get(b.id)!;
    for (const ia of E) for (const ib of E) {
      if (i < j && d3(ea[ia], eb[ib]) <= JOIN_TOLERANCE) out.push({ source: a.id, sourceCategory: cat(a), target: b.id, targetCategory: cat(b), relation: "endpoint_contact", endpoint: ia, targetEndpoint: ib, point: ea[ia] });
    }
    for (const ia of E) {                                                   // an end lying ALONG another member (a T), away from its ends
      if (E.some((ib) => d3(ea[ia], eb[ib]) <= JOIN_TOLERANCE)) continue;
      if (pointSegment3(ea[ia], eb.start, eb.end) <= JOIN_TOLERANCE) out.push({ source: a.id, sourceCategory: cat(a), target: b.id, targetCategory: cat(b), relation: "endpoint_on_member", endpoint: ia, point: ea[ia] });
    }
  }
  for (const m of members) for (const ie of E) {
    const p = ends.get(m.id)![ie];
    for (const w of walls) {
      const z0 = (s.storeys[w.storey]?.elevation ?? 0) + w.baseOffset, fp = wallFrame(s, w).footprint;
      if (p[2] >= z0 - JOIN_TOLERANCE && p[2] <= z0 + w.height + JOIN_TOLERANCE && pointInPolygon([p[0], p[1]], fp) !== "outside")
        out.push({ source: m.id, sourceCategory: cat(m), target: w.id, targetCategory: cat(w), relation: "endpoint_in_wall", endpoint: ie, point: p });
    }
    for (const b of bounds) {
      const rep = boundaryRepresentation(s, b);
      if (rep.kind !== "boundary_extrusion") continue;                       // sloped planes are not part of this derived view
      const z0 = (s.storeys[b.storey]?.elevation ?? 0), lo = z0 + rep.bottom, hi = z0 + rep.top;
      const inHole = rep.holes.some((h) => pointInPolygon([p[0], p[1]], h) === "inside");
      if (p[2] >= lo - JOIN_TOLERANCE && p[2] <= hi + JOIN_TOLERANCE && pointInPolygon([p[0], p[1]], rep.outer) !== "outside" && !inHole)
        out.push({ source: m.id, sourceCategory: cat(m), target: b.id, targetCategory: cat(b), relation: "endpoint_in_boundary", endpoint: ie, point: p });
    }
  }
  out.sort((x, y) => cmp(x.source, y.source) || cmp(x.target, y.target) || cmp(x.relation, y.relation) || cmp(x.endpoint, y.endpoint) || cmp(x.targetEndpoint ?? "", y.targetEndpoint ?? ""));
  const sel = out.filter((r) => (!opts.ids?.length || opts.ids.includes(r.source) || opts.ids.includes(r.target)) && (!opts.relation || r.relation === opts.relation));
  return { derived: true, basis: "geometric contact within the join tolerance", note: "NOT a structural connection design and NOT stored: moving an element changes this answer without any event.", count: sel.length, relations: sel };
}
