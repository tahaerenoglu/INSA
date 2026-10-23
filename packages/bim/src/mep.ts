/**
 * MEP core (Phase 13). ONE canonical route element (`mep_segment`, engine mep_network) for pipes, ducts, cable trays and conduits; systems and
 * junctions are first-class RESOURCES (not elements). Everything here is pure and derived:
 *   - the world route (storey elevation + offset), its length (the ONE polyline length), the representation;
 *   - connectors: stable identities { element, connector }; their world position / direction / size are DERIVED, never stored;
 *   - the junction rules (explicit connectivity: touching is never connected) and the network graph.
 * No engineering analysis: connectors carry semantics (domain, shape, size, flow), not hydraulics or electrics.
 */
import { DomainError, ErrorReason } from "@insa/core";
import type { BimState, BimType, MepSegment, MepRoutePoint, ConnectorRef, ConnectorDef, Component, ComponentType, MepJunction, Element } from "./model.js";
import { findCategory } from "./taxonomy.js";
import { fittingConnectors } from "./engines/mep-fitting.js";
import { JOIN_TOLERANCE } from "./topology.js";

export type V3 = [number, number, number];
export const MEP_DOMAINS = ["piping", "hvac", "electrical"] as const;
export type MepDomain = (typeof MEP_DOMAINS)[number];
export const CONNECTOR_FLOWS = ["in", "out", "bidirectional"] as const;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;   // + 0: never -0

// ---------------------------------------------------------------- the route (derived world geometry)
export const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** THE 3D polyline length: quantities, representation, validation and IFC all use this one function. */
export const polylineLength = (pts: readonly V3[]) => pts.slice(1).reduce((a, p, i) => a + dist3(pts[i], p), 0);
export const routeWorld = (s: BimState, el: Pick<MepSegment, "route">): V3[] => el.route.map((p) => [p.at[0], p.at[1], (s.storeys[p.storey]?.elevation ?? 0) + p.offset]);
export const routeStoreys = (el: Pick<MepSegment, "route">) => [...new Set(el.route.map((p) => p.storey))];
export const routeLength = (s: BimState, el: MepSegment) => polylineLength(routeWorld(s, el));
const unit = (a: V3, b: V3): V3 => { const l = dist3(a, b); return l === 0 ? [0, 0, 0] : [round((b[0] - a[0]) / l), round((b[1] - a[1]) / l), round((b[2] - a[2]) / l)]; };

export interface CrossSection { shape: "round" | "rectangular"; diameter?: number; width?: number; height?: number }
/** The cross-section of an MEP type (pipe / conduit: round; duct: round or rectangular; cable tray: rectangular). */
export function crossSection(t: BimType | undefined): CrossSection | undefined {
  if (!t) return undefined;
  if (t.kind === "pipe" || t.kind === "conduit" || t.kind === "cable") return { shape: "round", diameter: t.diameter };
  if (t.kind === "duct") return t.shape === "round" ? { shape: "round", diameter: t.diameter } : { shape: "rectangular", width: t.width, height: t.height };
  if (t.kind === "cable_tray") return { shape: "rectangular", width: t.width, height: t.height };
  return undefined;
}
export const mepSectionArea = (c: CrossSection) => (c.shape === "round" ? (Math.PI * c.diameter! ** 2) / 4 : c.width! * c.height!);

export function mepSegmentQuantities(s: BimState, el: MepSegment) {
  const t = s.types[el.type], c = crossSection(t), length = routeLength(s, el);
  const dims: Record<string, number> = c?.shape === "round" ? { diameter: c.diameter! } : c ? { width: c.width!, height: c.height! } : {};
  return { length, ...dims, cross_section_area: c ? mepSectionArea(c) : 0 };
}

/** The derived representation: a swept section along each route segment (one product, several deterministic solids). */
export function mepRepresentation(s: BimState, el: MepSegment) {
  const w = routeWorld(s, el), z0 = s.storeys[el.storey]?.elevation ?? 0;
  const pts = w.map((p) => [p[0], p[1], p[2] - z0] as V3);                     // storey-local, like the other engines
  const segments = pts.slice(1).map((p, i) => ({ start: pts[i], end: p, length: dist3(pts[i], p), direction: unit(pts[i], p) }));
  return { kind: "mep_route_sweep" as const, points: pts, section: crossSection(s.types[el.type])!, segments, length: segments.reduce((a, g) => a + g.length, 0) };
}
export const mepPlacement = (el: MepSegment) => ({ kind: "mep_route" as const, storey: el.storey, route: el.route });

// ---------------------------------------------------------------- validation of a route element
export function validateMepSegment(s: BimState, el: MepSegment, fail: (r: ErrorReason, m: string, extra?: Record<string, unknown>) => never) {
  const c = findCategory(el.category);
  const sys = s.mepSystems?.[el.system];
  if (!sys) fail("INVALID_REFERENCE", `${el.id}: MEP system ${String(el.system)} does not exist (every route element belongs to a system).`, { field: "system" });
  if (c?.mepDomain !== sys!.domain) fail("MEP_SYSTEM_DOMAIN_MISMATCH", `${el.id}: ${el.category} is a ${c?.mepDomain} category; system ${sys!.name} is ${sys!.domain}.`, { field: "system", categoryId: el.category });
  if (!Array.isArray(el.route) || el.route.length < 2) fail("INVALID_ROUTE", `${el.id}: a route needs at least 2 points (got ${Array.isArray(el.route) ? el.route.length : "none"}).`, { field: "route" });
  el.route.forEach((p, i) => {
    if (!p || !s.storeys[p.storey]) fail("INVALID_REFERENCE", `${el.id}: route point ${i} references a missing storey (${String(p?.storey)}).`, { field: "route", index: i });
    if (!Array.isArray(p.at) || p.at.length !== 2 || !p.at.every(fin) || !fin(p.offset)) fail("INVALID_ROUTE", `${el.id}: route point ${i} needs finite at [x, y] and offset.`, { field: "route", index: i });
  });
  if (el.storey !== el.route[0].storey) fail("INVALID_REFERENCE", `${el.id}: its storey must be the storey of its first route point.`, { field: "storey" });
  const w = routeWorld(s, el);
  w.slice(1).forEach((p, i) => { if (dist3(w[i], p) <= JOIN_TOLERANCE / 10) fail("INVALID_ROUTE", `${el.id}: route segment ${i} has zero length (duplicate adjacent route points).`, { field: "route", index: i + 1 }); });
}

/** The first problem of an MEP type's section / thicknesses (null = valid). */
export function mepTypeProblem(t: BimType): string | null {
  const pos = (n: string, v: unknown) => (fin(v) && v > 0 ? null : `${n} must be a finite number greater than 0`);
  const opt = (n: string, v: unknown) => (v === undefined || (fin(v) && v >= 0) ? null : `${n} must be a finite number >= 0`);
  if (t.kind === "pipe") return pos("diameter", t.diameter) ?? (t.wallThickness === undefined ? null : pos("wallThickness", t.wallThickness) ?? (2 * t.wallThickness < t.diameter ? null : "wallThickness leaves no bore (2 t < diameter)")) ?? opt("insulationThickness", t.insulationThickness);
  if (t.kind === "duct") return t.shape === "round" ? pos("diameter", t.diameter) ?? opt("insulationThickness", t.insulationThickness)
    : t.shape === "rectangular" ? pos("width", t.width) ?? pos("height", t.height) ?? opt("insulationThickness", t.insulationThickness) : "duct shape must be round | rectangular";
  if (t.kind === "cable_tray") return pos("width", t.width) ?? pos("height", t.height);
  if (t.kind === "conduit" || t.kind === "cable") return pos("diameter", t.diameter);
  return null;
}

// ---------------------------------------------------------------- connectors
export interface ResolvedConnector {
  ref: ConnectorRef; owner: "route" | "component"; domain: MepDomain; position: V3; direction: V3; flow: "in" | "out" | "bidirectional";
  shape: "round" | "rectangular"; diameter?: number; width?: number; height?: number; system?: string; classification?: string;
}
const rotZ = (v: V3, deg: number): V3 => { const a = (deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a); return [round(v[0] * c - v[1] * sn), round(v[0] * sn + v[1] * c), v[2]]; };

/** Local connector definition -> world, through the EXISTING point-component placement (storey elevation + offset, x / y, rotation about Z). */
export function componentConnector(s: BimState, el: Component, def: ConnectorDef): ResolvedConnector {
  const pl = el.placement, z0 = s.storeys[el.storey]?.elevation ?? 0, rp = rotZ(def.position, pl.rotation);
  return { ref: { element: el.id, connector: def.key }, owner: "component", domain: def.domain, position: [round(pl.x + rp[0]), round(pl.y + rp[1]), round(z0 + pl.offset + def.position[2])],
    direction: rotZ(def.direction, pl.rotation), flow: def.flow, shape: def.shape, ...(def.shape === "round" ? { diameter: def.diameter } : { width: def.width, height: def.height }),
    ...(def.classification ? { classification: def.classification } : {}) };
}
/** Route endpoints: start (direction OUTWARD = opposite to the first segment) and end (along the last segment); bidirectional. */
export function routeConnectors(s: BimState, el: MepSegment): ResolvedConnector[] {
  const w = routeWorld(s, el), c = crossSection(s.types[el.type]), dom = findCategory(el.category)?.mepDomain;
  if (w.length < 2 || !c || !dom) return [];
  const base = { owner: "route" as const, domain: dom, flow: "bidirectional" as const, shape: c.shape, ...(c.shape === "round" ? { diameter: c.diameter } : { width: c.width, height: c.height }), system: el.system };
  const first = unit(w[1], w[0]), last = unit(w[w.length - 2], w[w.length - 1]);
  return [{ ...base, ref: { element: el.id, connector: "start" }, position: w[0], direction: first }, { ...base, ref: { element: el.id, connector: "end" }, position: w[w.length - 1], direction: last }];
}
export function connectorsOf(s: BimState, el: Element): ResolvedConnector[] {
  if (el.kind === "mep_segment") return routeConnectors(s, el);
  if (el.kind === "mep_fitting") return fittingConnectors(s, el);
  if (el.kind === "component") return ((s.types[el.type] as ComponentType | undefined)?.connectors ?? []).map((d) => componentConnector(s, el, d));
  return [];
}
export const resolveConnector = (s: BimState, ref: ConnectorRef) => { const el = s.elements[ref.element]; return el ? connectorsOf(s, el).find((c) => c.ref.connector === ref.connector) : undefined; };
export const refKey = (r: ConnectorRef) => `${r.element}#${r.connector}`;
export const sameRef = (a: ConnectorRef, b: ConnectorRef) => a.element === b.element && a.connector === b.connector;
export const sortRefs = (rs: ConnectorRef[]) => [...rs].sort((a, b) => (refKey(a) < refKey(b) ? -1 : refKey(a) > refKey(b) ? 1 : 0));

export function connectorDefProblem(d: ConnectorDef): string | null {
  if (!d || typeof d.key !== "string" || !d.key.trim()) return "a connector needs a non-empty key";
  if (!(MEP_DOMAINS as readonly string[]).includes(d.domain)) return `connector ${d.key}: unknown domain '${String(d.domain)}'`;
  if (!Array.isArray(d.position) || d.position.length !== 3 || !d.position.every(fin)) return `connector ${d.key}: position must be 3 finite numbers`;
  if (!Array.isArray(d.direction) || d.direction.length !== 3 || !d.direction.every(fin) || Math.hypot(...d.direction) < 1e-9) return `connector ${d.key}: direction must be a non-zero vector`;
  if (!(CONNECTOR_FLOWS as readonly string[]).includes(d.flow)) return `connector ${d.key}: flow must be in | out | bidirectional`;
  if (d.shape === "round") return fin(d.diameter) && d.diameter > 0 ? null : `connector ${d.key}: a round connector needs a positive diameter`;
  if (d.shape === "rectangular") return fin(d.width) && d.width > 0 && fin(d.height) && d.height > 0 ? null : `connector ${d.key}: a rectangular connector needs positive width and height`;
  return `connector ${d.key}: shape must be round | rectangular`;
}
export function connectorDefsProblem(defs: ConnectorDef[] | undefined): string | null {
  if (defs === undefined) return null;
  if (!Array.isArray(defs)) return "connectors must be a list";
  for (const d of defs) { const p = connectorDefProblem(d); if (p) return p; }
  const keys = defs.map((d) => d.key);
  return new Set(keys).size === keys.length ? null : "connector keys must be unique within a type";
}

// ---------------------------------------------------------------- junction rules (the single place)
export interface JunctionProblem { reason: ErrorReason; message: string; details: Record<string, unknown> }
const near = (a: number, b: number) => Math.abs(a - b) <= JOIN_TOLERANCE;
/** Why these connectors cannot form one junction (null = they can). Used by bim_connect_mep AND by the post-command invariant. */
export function junctionProblem(s: BimState, members: ConnectorRef[]): JunctionProblem | null {
  if (members.length < 2) return { reason: "INVALID_INPUT", message: "a junction needs at least 2 connectors.", details: {} };
  if (new Set(members.map(refKey)).size !== members.length) return { reason: "INVALID_INPUT", message: "the same connector is listed twice.", details: {} };
  const rs: ResolvedConnector[] = [];
  for (const m of members) {
    if (!s.elements[m.element]) return { reason: "MEP_CONNECTOR_NOT_FOUND", message: `element ${m.element} does not exist.`, details: { elementId: m.element } };
    const r = resolveConnector(s, m);
    if (!r) return { reason: "MEP_CONNECTOR_NOT_FOUND", message: `element ${m.element} has no connector '${m.connector}'.`, details: { elementId: m.element, connector: m.connector } };
    rs.push(r);
  }
  const a = rs[0];
  for (const b of rs.slice(1)) if (b.domain !== a.domain) return { reason: "MEP_DOMAIN_MISMATCH", message: `${refKey(a.ref)} is ${a.domain}, ${refKey(b.ref)} is ${b.domain}: no automatic adapters.`, details: { connectors: [a.ref, b.ref] } };
  const systems = [...new Set(rs.map((r) => r.system).filter((x): x is string => !!x))];
  if (systems.length > 1) return { reason: "MEP_SYSTEM_MISMATCH", message: `connected route elements belong to different systems (${systems.join(", ")}).`, details: { systems } };
  for (const b of rs.slice(1)) {
    const okSize = a.shape === b.shape && (a.shape === "round" ? near(a.diameter!, b.diameter!) : near(a.width!, b.width!) && near(a.height!, b.height!));
    if (!okSize) return { reason: "MEP_CONNECTOR_INCOMPATIBLE", message: `${refKey(a.ref)} (${a.shape} ${a.diameter ?? `${a.width} x ${a.height}`}) and ${refKey(b.ref)} (${b.shape} ${b.diameter ?? `${b.width} x ${b.height}`}) have different shape / size: no automatic reducers.`, details: { connectors: [a.ref, b.ref] } };
  }
  const flows = rs.map((r) => r.flow);
  if (flows.filter((f) => f === "out").length > 1 || flows.filter((f) => f === "in").length > 1)
    return { reason: "MEP_FLOW_CONFLICT", message: "two strictly directional connectors of the same flow (out -> out or in -> in) cannot be connected.", details: { connectors: members } };
  for (const b of rs.slice(1)) {
    const d = dist3(a.position, b.position);
    if (d > JOIN_TOLERANCE) return { reason: "MEP_CONNECTION_DISTANCE", message: `${refKey(a.ref)} and ${refKey(b.ref)} are ${round(d)} m apart (tolerance ${JOIN_TOLERANCE} m); nothing is snapped or moved.`,
      details: { connectors: [a.ref, b.ref], positions: [a.position, b.position], distance: round(d), tolerance: JOIN_TOLERANCE } };
  }
  return null;
}

/**
 * Post-command invariant: every junction is still valid. A geometric separation caused by an edit (a route point, a component, a storey) rejects
 * the WHOLE command (MEP_CONNECTED_ELEMENT_MOVE_CONFLICT); structural corruption keeps its own reason. Connector membership is unique.
 */
export function validateMepJunctions(s: BimState) {
  const seen = new Map<string, string>();
  for (const id of Object.keys(s.mepJunctions ?? {}).sort()) {
    const j = s.mepJunctions[id];
    for (const m of j.members) {
      const k = refKey(m);
      if (seen.has(k)) throw new DomainError(`connector ${k} belongs to two junctions (${seen.get(k)}, ${id}).`, "MEP_CONNECTOR_IN_USE", { junctionId: id, connector: k });
      seen.set(k, id);
    }
    const p = junctionProblem(s, j.members);
    if (!p) continue;
    if (p.reason === "MEP_CONNECTION_DISTANCE") throw new DomainError(`junction ${id} would be broken: ${p.message} Disconnect first (bim_disconnect_mep), edit, then reconnect.`, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT", { junctionId: id, ...p.details });
    throw new DomainError(`junction ${id}: ${p.message}`, p.reason, { junctionId: id, ...p.details });
  }
}
export const junctionOf = (s: BimState, ref: ConnectorRef): MepJunction | undefined => Object.values(s.mepJunctions ?? {}).find((j) => j.members.some((m) => sameRef(m, ref)));
export const junctionKind = (n: number) => (n === 2 ? "coupling" : n === 3 ? "tee" : n === 4 ? "cross" : "multi");

// ---------------------------------------------------------------- the network (derived; a CONNECTOR graph; deterministic ordering by stable ids)
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** The system a junction belongs to: the (single, validated) system of its route members; undefined when it has none (equipment-to-equipment). */
export function junctionSystem(s: BimState, j: MepJunction): string | undefined {
  for (const m of j.members) { const e = s.elements[m.element]; if (e?.kind === "mep_segment" || e?.kind === "mep_fitting") return e.system; }
  return undefined;
}
export type NetworkScope = { system?: string; element?: string; connector?: ConnectorRef };
/**
 * The network as a graph of CONNECTORS. Nodes: connectors. Edges: (1) the members of a junction (all mutually adjacent); (2) the two ends of one
 * ROUTE element (start <-> end: a route passes the medium through). A component's connectors are NOT joined to each other: equipment is an
 * endpoint device, never a bridge, so a system never leaks into another system through shared equipment.
 * Scopes (distinct modes): `connector` = reachability from that exact connector; `element` = from all connectors of that element; `system` = all route
 * connectors of that system through that system's junctions only (equipment appears as a shared endpoint device). `system` combined with an
 * element / connector additionally restricts traversal to that system's junctions.
 */
export function mepNetwork(s: BimState, o: NetworkScope) {
  const els = s.elements, junctions = Object.values(s.mepJunctions ?? {}).sort((a, b) => cmp(a.id, b.id));
  const jOf = new Map<string, MepJunction>();
  for (const j of junctions) for (const m of j.members) jOf.set(refKey(m), j);
  const allowed = (j: MepJunction) => !o.system || junctionSystem(s, j) === o.system;
  const mode = o.connector ? "connector" : o.element ? "element" : "system";
  const owner = (k: string) => k.slice(0, k.lastIndexOf("#"));
  let starts: string[] = [];
  if (o.connector) starts = [refKey(o.connector)];
  else if (o.element) starts = (els[o.element] ? connectorsOf(s, els[o.element]) : []).map((c) => refKey(c.ref));
  else for (const e of Object.values(els)) if ((e.kind === "mep_segment" || e.kind === "mep_fitting") && e.system === o.system) for (const c of connectorsOf(s, e)) starts.push(refKey(c.ref));
  starts = [...new Set(starts)].sort(cmp);
  const neighbours = (k: string): string[] => {
    const out: string[] = [], e = els[owner(k)];
    if (e?.kind === "mep_segment") { const other = k.endsWith("#start") ? "end" : "start"; out.push(`${e.id}#${other}`); }          // a route passes through: start <-> end
    if (e?.kind === "mep_fitting") for (const c of connectorsOf(s, e)) if (refKey(c.ref) !== k) out.push(refKey(c.ref));          // a fitting passes the medium between ALL its connectors
    const j = jOf.get(k);
    if (j && allowed(j)) for (const m of j.members) if (refKey(m) !== k) out.push(refKey(m));
    return out.sort(cmp);
  };
  const order: string[] = [], seen = new Set<string>(starts), parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  for (const k of starts) parent.set(k, k);
  for (const q = [...starts]; q.length; ) {
    const k = q.shift()!; order.push(k);
    for (const n of neighbours(k)) {
      if (!seen.has(n)) { seen.add(n); parent.set(n, n); q.push(n); }
      const ra = find(k), rb = find(n); if (ra !== rb) parent.set(ra, rb);
    }
  }
  const elementOrder: string[] = [];
  for (const k of order) if (els[owner(k)] && !elementOrder.includes(owner(k))) elementOrder.push(owner(k));
  const ids = [...new Set(order.map(owner))].filter((id) => els[id]).sort(cmp);
  const js = junctions.filter((j) => allowed(j) && j.members.some((m) => seen.has(refKey(m))));
  const groups = new Map<string, string[]>();
  for (const k of seen) (groups.get(find(k)) ?? groups.set(find(k), []).get(find(k))!).push(k);
  const comps = [...groups.values()].map((ks) => ({ elements: [...new Set(ks.map(owner))].sort(cmp), junctions: [...new Set(ks.map((k) => jOf.get(k)).filter((j): j is MepJunction => !!j && allowed(j)).map((j) => j.id))].sort(cmp) }))
    .sort((a, b) => cmp(a.elements[0], b.elements[0]) || cmp(a.junctions[0] ?? "", b.junctions[0] ?? ""));
  const open: ResolvedConnector[] = [];
  for (const id of ids) for (const c of connectorsOf(s, els[id])) if (seen.has(refKey(c.ref)) && !jOf.get(refKey(c.ref))) open.push(c);
  const sysScopeRoutesOnly = mode === "system";                           // in a system view an unconnected equipment connector is not that system's
  const openOut = open.filter((c) => !sysScopeRoutesOnly || c.owner === "route");
  return {
    mode,
    elements: ids.map((id) => ({ id, kind: els[id].kind, category: (els[id] as { category?: string }).category ?? null, ...(els[id].kind === "mep_segment" || els[id].kind === "mep_fitting" ? { system: (els[id] as MepSegment).system } : {}) })),
    junctions: js.map((j) => ({ id: j.id, kind: junctionKind(j.members.length), ...(junctionSystem(s, j) ? { system: junctionSystem(s, j) } : {}), members: j.members })),
    components: comps.map((c, i) => ({ id: `component-${i + 1}`, ...c })),
    openConnectors: openOut.map((c) => ({ ...c.ref, position: c.position, domain: c.domain })),
    adjacency: js.flatMap((j) => j.members.filter((m) => seen.has(refKey(m))).slice(1).map((m) => ({ junction: j.id, from: j.members.filter((x) => seen.has(refKey(x)))[0], to: m }))),
    ...(mode !== "system" ? { traversal: elementOrder, connectorTraversal: order } : {}),
  };
}
export function systemSummary(s: BimState, systemId: string) {
  const all = Object.values(s.elements).filter((e) => (e.kind === "mep_segment" || e.kind === "mep_fitting") && e.system === systemId);
  const segs = all.filter((e): e is MepSegment => e.kind === "mep_segment");
  const net = mepNetwork(s, { system: systemId });
  return { element_count: all.length, total_route_length: segs.reduce((a, e) => a + routeLength(s, e), 0), junction_count: net.junctions.length,
    open_connector_count: net.openConnectors.filter((c) => all.some((e) => e.id === c.element)).length, connected_component_count: net.components.length };
}
