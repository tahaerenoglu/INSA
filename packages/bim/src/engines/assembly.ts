/** assembly engine (Phase 14): explicit aggregation (IfcElementAssembly). See model.ts Assembly. */
import type { ErrorDetails } from "@insa/core";
import type { BimState, Assembly } from "../model.js";
import { findCategory } from "../taxonomy.js";
import type { IfcWriteContext } from "../ifc.js";
import { fail } from "./kit.js";

const NOT_MEMBERS = new Set(["opening", "hosted_component", "spatial"]);   // they live with their host / region
/** every element below an assembly (children, their children, ...), each once; terminates on any input */
export function assemblyDescendants(s: BimState, id: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const q = [id]; q.length; ) { const a = s.elements[q.shift()!]; if (a?.kind !== "assembly") continue; for (const c of a.children) if (!seen.has(c)) { seen.add(c); out.push(c); q.push(c); } }
  return out;
}
// ================================================================ assembly RULES (data-driven: a category names its rule; no category branches here)
type P2 = [number, number];
interface Piece { id: string; role: "flight" | "landing"; start?: P2; end?: P2; z0?: number; z1?: number; run?: number; risers?: number; outline?: P2[]; z?: number; slope?: number }
const TOL = 1e-3;
const onOrIn = (p: P2, poly: P2[]) => {                                   // inclusive point-in-polygon (the landing's boundary counts)
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j], dx = xj - xi, dy = yj - yi, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - xi) * dx + (p[1] - yi) * dy) / l2)) : 0;
    if (Math.hypot(p[0] - (xi + t * dx), p[1] - (yi + t * dy)) <= TOL) return true;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export interface AssemblyRule {
  readonly id: string; readonly flightKind: "stair" | "ramp";
  validate(s: BimState, el: Assembly, pieces: Piece[], bad: (m: string) => never): void;
  quantities(pieces: Piece[]): Record<string, number>;
}
/** flights (in the order of `children`) must meet end-to-start at the SAME elevation, either directly or through a LANDING at that elevation that contains both points */
function continuity(pieces: Piece[], bad: (m: string) => never) {
  const flights = pieces.filter((p) => p.role === "flight"), landings = pieces.filter((p) => p.role === "landing");
  if (!flights.length) bad("a run needs at least one flight.");
  for (let i = 0; i + 1 < flights.length; i++) {
    const a = flights[i], b = flights[i + 1];
    if (Math.abs(a.z1! - b.z0!) > TOL) bad(`flight ${b.id} starts at ${b.z0!.toFixed(3)} m but ${a.id} tops out at ${a.z1!.toFixed(3)} m: elevations must be continuous.`);
    const direct = Math.hypot(a.end![0] - b.start![0], a.end![1] - b.start![1]) <= TOL;
    if (!direct && !landings.some((L) => Math.abs(L.z! - a.z1!) <= TOL && onOrIn(a.end!, L.outline!) && onOrIn(b.start!, L.outline!)))
      bad(`${a.id} and ${b.id} are not connected: no direct meeting and no landing at ${a.z1!.toFixed(3)} m contains both the end of ${a.id} and the start of ${b.id}.`);
  }
}
const sumRun = (p: Piece[]) => p.filter((x) => x.role === "flight").reduce((n, x) => n + x.run!, 0);
const rise = (p: Piece[]) => { const f = p.filter((x) => x.role === "flight"); return f.length ? f[f.length - 1].z1! - f[0].z0! : 0; };
export const ASSEMBLY_RULES: Readonly<Record<string, AssemblyRule>> = Object.freeze({
  stair_run: { id: "stair_run", flightKind: "stair", validate: (_s, _el, pieces, bad) => continuity(pieces, bad),
    quantities: (p) => ({ flight_count: p.filter((x) => x.role === "flight").length, landing_count: p.filter((x) => x.role === "landing").length, total_rise: rise(p), total_run: sumRun(p), total_riser_count: p.reduce((n, x) => n + (x.risers ?? 0), 0) }) },
  ramp_run: { id: "ramp_run", flightKind: "ramp", validate: (_s, _el, pieces, bad) => continuity(pieces, bad),
    quantities: (p) => ({ flight_count: p.filter((x) => x.role === "flight").length, landing_count: p.filter((x) => x.role === "landing").length, total_rise: rise(p), total_run: sumRun(p), max_slope_percent: Math.max(0, ...p.filter((x) => x.role === "flight").map((x) => x.slope! * 100)) }) },
});
/** the pieces of a rule-governed assembly: flights of the rule's kind (class IfcStairFlight / IfcRampFlight) and landings, in member order; null = a member the rule does not accept */
function piecesOf(s: BimState, el: Assembly, rule: AssemblyRule): { pieces: Piece[]; rejected: string[] } {
  const pieces: Piece[] = [], rejected: string[] = [], flightClass = rule.flightKind === "stair" ? "IfcStairFlight" : "IfcRampFlight";
  for (const id of el.children) {
    const m = s.elements[id], cat = m ? findCategory((m as unknown as { category?: string }).category ?? "") : undefined;
    if (m?.kind === "stair" && cat?.ifcClass === flightClass) pieces.push({ id, role: "flight", start: m.start, end: m.end, z0: m.baseOffset, z1: m.baseOffset + m.height, run: Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1]), risers: m.riserCount });
    else if (m?.kind === "ramp" && cat?.ifcClass === flightClass) { const run = Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1]); pieces.push({ id, role: "flight", start: m.start, end: m.end, z0: m.baseOffset, z1: m.baseOffset + m.rise, run, slope: m.rise / run }); }
    else if (m?.kind === "boundary" && cat?.id === "architecture.landing") pieces.push({ id, role: "landing", outline: m.outline as P2[], z: m.offset });
    else rejected.push(id);
  }
  return { pieces, rejected };
}
export function assemblyRuleQuantities(s: BimState, el: Assembly): Record<string, number> {
  const rule = ASSEMBLY_RULES[findCategory(el.category)?.assemblyRule ?? ""];
  return rule ? rule.quantities(piecesOf(s, el, rule).pieces) : {};
}
function validateRule(s: BimState, el: Assembly, d: ErrorDetails) {
  const rule = ASSEMBLY_RULES[findCategory(el.category)?.assemblyRule ?? ""];
  if (!rule) return;
  const bad = (m: string): never => fail("INVALID_ASSEMBLY_RELATION", `${el.id}: ${m}`, { ...d, field: "children", rule: rule.id });
  const { pieces, rejected } = piecesOf(s, el, rule);
  if (rejected.length) bad(`${rejected.join(", ")} cannot be members of a ${rule.flightKind} assembly (members are ${rule.flightKind} flights and landings).`);
  rule.validate(s, el, pieces, bad);
}
export function validateAssembly(s: BimState, el: Assembly, d: ErrorDetails) {
  const cat = findCategory(el.category), bad = (m: string, field = "children"): never => fail("INVALID_ASSEMBLY_RELATION", `${el.id}: ${m}`, { ...d, field });
  if (!Array.isArray(el.children) || !el.children.length) bad("an assembly needs at least one member.");
  if (new Set(el.children).size !== el.children.length) bad("a member is listed twice.");
  for (const c of el.children) {
    const m = s.elements[c];
    if (!m) fail("INVALID_REFERENCE", `${el.id}: member ${c} does not exist.`, { ...d, field: "children", elementId: c });
    if (c === el.id) bad("an assembly cannot contain itself.");
    if (NOT_MEMBERS.has(m!.kind)) bad(`${c} (${m!.kind}) belongs to its host / region and cannot be an assembly member.`);
    if (m!.storey !== el.storey) bad(`${c} is on storey ${m!.storey}; all members share the assembly's storey (${el.storey}).`);
    const parents = Object.values(s.elements).filter((o) => o.kind === "assembly" && o.id !== el.id && o.children.includes(c));
    if (parents.length) bad(`${c} already belongs to assembly ${parents[0].id}: a member has ONE parent.`);
  }
  if (assemblyDescendants(s, el.id).includes(el.id)) bad("the aggregation would be cyclic.");
  validateRule(s, el, d);                                                  // the category's rule (stair / ramp runs); none for a plain assembly
  if (el.predefinedType !== undefined && !cat?.ifcPredefinedValues?.includes(el.predefinedType)) fail("INVALID_PREDEFINED_TYPE", `${el.id}: '${el.predefinedType}' is not a valid ${cat?.ifcClass} PredefinedType (${(cat?.ifcPredefinedValues ?? []).join(", ")}).`, { ...d, field: "predefined_type" });
}

// ---- IFC (engine-owned writer, relationship phase): IfcElementAssembly + IfcRelAggregates to the members (children first); the members are PARTS, so only the
// top-level assemblies stay contained in the storey.
export function writeAssembliesIfc(c: IfcWriteContext, els: readonly Assembly[]) {
  const assembled = new Set<string>();
  for (const a of els) for (const m of a.children) assembled.add(m);
  for (const el of [...els].sort((a, b) => assemblyDescendants(c.s, a.id).length - assemblyDescendants(c.s, b.id).length || (a.id < b.id ? -1 : 1))) {
    const cat = findCategory(el.category)!, tpl = c.template(cat.ifcClass!);
    const vals: Record<string, string> = { GlobalId: c.gid(el.id), Name: c.str(el.name ?? el.id), ObjectPlacement: c.placement(c.storeyPlacement(el.storey), c.identity), Tag: c.str(el.id), AssemblyPlace: ".NOTDEFINED.", PredefinedType: `.${el.predefinedType ?? "NOTDEFINED"}.` };
    const ref = c.add(cat.ifcClass!.toUpperCase(), (tpl ?? []).map(([n]) => vals[n] ?? "$").join(","));      // IfcElementAssembly, IfcStair, IfcRamp ...: the category's class
    c.elRef[el.id] = ref;
    const parts = el.children.map((m) => c.elRef[m]).filter(Boolean);
    if (parts.length) c.add("IFCRELAGGREGATES", `${c.gid("assembly:" + el.id)},$,$,$,${ref},${c.list(parts)}`);
    if (!assembled.has(el.id)) c.contain(el, ref); else c.markPart(ref);
    for (const p of parts) c.markPart(p);
  }
}
