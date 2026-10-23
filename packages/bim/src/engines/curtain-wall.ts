/**
 * curtain_wall engine (Phase 14, Milestone B): a CURTAIN-WALL ASSEMBLY (IfcCurtainWall) on a wall axis. Intent: axis (start -> end), base elevation,
 * height and optionally an explicit grid (uDivisions / vDivisions); the CurtainWallType carries the frame and panel parameters (maximum panel size,
 * mullion / transom sections, panel thickness). Everything below is DERIVED, never persisted:
 *   grid     nU = uDivisions ?? ceil(L / maxPanelWidth), nV = vDivisions ?? ceil(H / maxPanelHeight); equal cells.
 *   mullions nU + 1 full-height members centred on the grid lines (the two end mullions are clipped to the wall length: half width).
 *   transoms (nV + 1) rows of nU members between adjacent mullions (top / bottom rows clipped to the wall height: half width).
 *   panels   nU x nV plates filling the cells between the frame faces.
 * CHILD IDENTITY is stable and deterministic: `<id>.M<i>`, `<id>.T<i>.<j>`, `<id>.P<i>.<j>` (i = column, j = row). A change of height, type or
 * divisions re-derives the same indices; nothing is stored per child. NOT modelled: per-panel overrides (doors, louvres, spandrels), curved walls,
 * corner mullions, anchors / brackets, glazing build-up.
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, CurtainWall, CurtainWallType } from "../model.js";
import type { IfcWriteContext } from "../ifc.js";
import type { PlanDrawContext } from "./handlers.js";
import { GEOMETRY_EPSILON as E, distance } from "../geometry.js";
import { fail, finite, positive, point } from "./kit.js";

export const MAX_CELLS = 2500;
const MAX_DIV = 200;
const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;

export function curtainGrid(s: BimState, el: CurtainWall) {
  const t = s.types[el.type] as CurtainWallType, L = distance(el.start, el.end), H = el.height;
  const nU = el.uDivisions ?? Math.max(1, Math.ceil(L / t.maxPanelWidth - 1e-9)), nV = el.vDivisions ?? Math.max(1, Math.ceil(H / t.maxPanelHeight - 1e-9));
  const dir: [number, number] = [(el.end[0] - el.start[0]) / L, (el.end[1] - el.start[1]) / L];
  return { t, L, H, nU, nV, pw: L / nU, ph: H / nV, dir, normal: [-dir[1], dir[0]] as [number, number] };
}
export interface CurtainPart {
  id: string; role: "panel" | "mullion" | "transom"; i: number; j: number;
  u0: number; u1: number;               // extent along the axis (m from the start)
  z0: number; z1: number;               // extent in z (storey-local)
  depth: number;                        // thickness normal to the wall plane
}
/** every derived child, in a fixed order (mullions, transoms, panels; column then row): deterministic by construction */
export function curtainParts(s: BimState, el: CurtainWall): CurtainPart[] {
  const { t, L, H, nU, nV, pw, ph } = curtainGrid(s, el), mw = t.mullion.width, th = t.transom.width, parts: CurtainPart[] = [], z = el.baseOffset;
  for (let i = 0; i <= nU; i++) {
    const c = i === 0 ? mw / 4 : i === nU ? L - mw / 4 : i * pw, w = i === 0 || i === nU ? mw / 2 : mw;
    parts.push({ id: `${el.id}.M${i}`, role: "mullion", i, j: 0, u0: round(c - w / 2), u1: round(c + w / 2), z0: z, z1: round(z + H), depth: t.mullion.depth });
  }
  for (let j = 0; j <= nV; j++) {
    const c = j === 0 ? th / 4 : j === nV ? H - th / 4 : j * ph, h = j === 0 || j === nV ? th / 2 : th;
    for (let i = 0; i < nU; i++) parts.push({ id: `${el.id}.T${i}.${j}`, role: "transom", i, j, u0: round(i * pw + mw / 2), u1: round((i + 1) * pw - mw / 2), z0: round(z + c - h / 2), z1: round(z + c + h / 2), depth: t.transom.depth });
  }
  for (let i = 0; i < nU; i++) for (let j = 0; j < nV; j++)
    parts.push({ id: `${el.id}.P${i}.${j}`, role: "panel", i, j, u0: round(i * pw + mw / 2), u1: round((i + 1) * pw - mw / 2), z0: round(z + j * ph + th / 2), z1: round(z + (j + 1) * ph - th / 2), depth: t.panelThickness });
  return parts;
}

export function curtainTypeProblem(t: CurtainWallType): string | null {
  const pos = (n: string, v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? null : `${n} must be a finite number greater than 0`);
  return pos("maxPanelWidth", t.maxPanelWidth) ?? pos("maxPanelHeight", t.maxPanelHeight) ?? pos("panelThickness", t.panelThickness) ?? pos("mullion.width", t.mullion?.width) ?? pos("mullion.depth", t.mullion?.depth)
    ?? pos("transom.width", t.transom?.width) ?? pos("transom.depth", t.transom?.depth);
}
export function validateCurtainWall(s: BimState, el: CurtainWall, d: ErrorDetails) {
  const a = point(el.start, `${el.id} start`, { ...d, field: "start" }), b = point(el.end, `${el.id} end`, { ...d, field: "end" });
  if (distance(a, b) <= E) fail("DEGENERATE_GEOMETRY", `${el.id}: the axis has zero length.`, { ...d, field: "end" });
  finite(el.baseOffset, `${el.id} base offset`, { ...d, field: "baseOffset" });
  positive(el.height, `${el.id} height`, { ...d, field: "height" });
  for (const [k, v] of [["uDivisions", el.uDivisions], ["vDivisions", el.vDivisions]] as const)
    if (v !== undefined && !(Number.isInteger(v) && v >= 1 && v <= MAX_DIV)) fail("INVALID_CURTAIN_GRID", `${el.id}: ${k} must be an integer in [1, ${MAX_DIV}].`, { ...d, field: k });
  const g = curtainGrid(s, el);
  if (g.nU * g.nV > MAX_CELLS) fail("INVALID_CURTAIN_GRID", `${el.id}: ${g.nU} x ${g.nV} = ${g.nU * g.nV} cells exceed the limit of ${MAX_CELLS}.`, { ...d, field: "type" });
  if (g.pw - g.t.mullion.width <= E) fail("INVALID_CURTAIN_GRID", `${el.id}: the cell width ${g.pw.toFixed(3)} m leaves no panel between mullions of ${g.t.mullion.width} m.`, { ...d, field: "uDivisions" });
  if (g.ph - g.t.transom.width <= E) fail("INVALID_CURTAIN_GRID", `${el.id}: the cell height ${g.ph.toFixed(3)} m leaves no panel between transoms of ${g.t.transom.width} m.`, { ...d, field: "vDivisions" });
}
export const curtainPlacement = (el: CurtainWall) => ({ kind: "wall_axis" as const, storey: el.storey, start: el.start, end: el.end, baseOffset: el.baseOffset });
export function curtainRepresentation(s: BimState, el: CurtainWall) {
  const g = curtainGrid(s, el);
  return { kind: "curtain_grid" as const, start: el.start, end: el.end, direction: g.dir, baseZ: el.baseOffset, height: el.height, length: g.L, uDivisions: g.nU, vDivisions: g.nV, panelWidth: g.pw, panelHeight: g.ph,
           parts: curtainParts(s, el).map((p) => ({ id: p.id, role: p.role, i: p.i, j: p.j })) };
}
export function curtainQuantities(s: BimState, el: CurtainWall) {
  const g = curtainGrid(s, el), mw = g.t.mullion.width, pwNet = g.pw - mw, phNet = g.ph - g.t.transom.width;
  return { grid_u: g.nU, grid_v: g.nV, panel_count: g.nU * g.nV, mullion_count: g.nU + 1, transom_count: g.nU * (g.nV + 1), panel_area: g.nU * g.nV * pwNet * phNet, gross_area: g.L * g.H,
           frame_area: g.L * g.H - g.nU * g.nV * pwNet * phNet, mullion_length_total: (g.nU + 1) * g.H, transom_length_total: g.nU * (g.nV + 1) * pwNet, panel_width_nominal: g.pw, panel_height_nominal: g.ph };
}

/** plan: the frame band along the axis with a tick at every grid line */
export function drawCurtainWallsPlan(c: PlanDrawContext, els: readonly CurtainWall[]): string[] {
  const out: string[] = [];
  for (const el of els) {
    const g = curtainGrid(c.s, el), [dx, dy] = g.dir, [nx, ny] = g.normal, h = Math.max(g.t.mullion.depth, g.t.panelThickness) / 2;
    const at = (u: number, k: number): [number, number] => [el.start[0] + dx * u + nx * k, el.start[1] + dy * u + ny * k];
    out.push(`<polygon points="${c.poly([at(0, h), at(g.L, h), at(g.L, -h), at(0, -h)])}" fill="#dff1f7" stroke="#2a7f9e" stroke-width="1.4"/>`);
    for (let i = 0; i <= g.nU; i++) out.push(`<polyline points="${c.poly([at(i * g.pw, h * 1.6), at(i * g.pw, -h * 1.6)])}" fill="none" stroke="#2a7f9e" stroke-width="1.2"/>`);
  }
  return out;
}

// ---- IFC (engine-owned writer): IfcCurtainWall decomposed (IfcRelAggregates) into IfcPlate CURTAIN_PANEL, IfcMember MULLION and IfcMember USERDEFINED / ObjectType TRANSOM
// (IFC has no TRANSOM value). The parts are swept rectangles in storey-local coordinates; they are parts, so only the curtain wall is contained in the storey.
const PART_CLASS = { panel: { cls: "IfcPlate", pre: "CURTAIN_PANEL", type: null }, mullion: { cls: "IfcMember", pre: "MULLION", type: null }, transom: { cls: "IfcMember", pre: "USERDEFINED", type: "TRANSOM" } } as const;
export function writeCurtainWallsIfc(c: IfcWriteContext, els: readonly CurtainWall[]) {
  for (const el of els) {
    const g = curtainGrid(c.s, el), [dx, dy] = g.dir, [nx, ny] = g.normal, wallTpl = c.template("IfcCurtainWall");
    const wvals: Record<string, string> = { GlobalId: c.gid(el.id), Name: c.str(el.name ?? el.id), ObjectPlacement: c.placement(c.storeyPlacement(el.storey), c.identity), Tag: c.str(el.id), PredefinedType: ".NOTDEFINED." };
    const wall = c.add("IFCCURTAINWALL", (wallTpl ?? []).map(([n]) => wvals[n] ?? "$").join(","));
    c.elRef[el.id] = wall; c.contain(el, wall); c.typed(el, wall);
    const refs: string[] = [];
    for (const p of curtainParts(c.s, el)) {
      const k = PART_CLASS[p.role], tpl = c.template(k.cls), w = p.u1 - p.u0, h = p.z1 - p.z0, uc = (p.u0 + p.u1) / 2, zc = (p.z0 + p.z1) / 2;
      const at = (u: number, off: number, z: number) => c.pt3(el.start[0] + dx * u + nx * off, el.start[1] + dy * u + ny * off, z);
      let pos: string, prof: string, len: number;
      if (p.role === "mullion") { pos = c.axis3(at(uc, 0, p.z0), c.dir3(0, 0, 1), c.dir3(dx, dy, 0)); prof = c.profile({ shape: "rect", b: w, h: p.depth }); len = p.z1 - p.z0; }   // X along the wall, Y = normal
      else if (p.role === "transom") { pos = c.axis3(at(p.u0, 0, zc), c.dir3(dx, dy, 0), c.dir3(nx, ny, 0)); prof = c.profile({ shape: "rect", b: p.depth, h }); len = w; }                // extruded along the wall: X = normal, Y = up
      else { pos = c.axis3(at(uc, -p.depth / 2, zc), c.dir3(nx, ny, 0), c.dir3(dx, dy, 0)); prof = c.profile({ shape: "rect", b: w, h }); len = p.depth; }                                // extruded along the normal through the thickness
      const vals: Record<string, string> = { GlobalId: c.gid(p.id), Name: c.str(p.id), ObjectType: k.type ? c.str(k.type) : "$", ObjectPlacement: c.placement(c.storeyPlacement(el.storey), c.identity),
        Representation: c.product([c.bodyShape("SweptSolid", [c.extrude(prof, pos, len)])]), Tag: c.str(p.id), PredefinedType: `.${k.pre}.` };
      refs.push(c.add(k.cls.toUpperCase(), (tpl ?? []).map(([n]) => vals[n] ?? "$").join(",")));
    }
    c.add("IFCRELAGGREGATES", `${c.gid("cw:" + el.id)},$,$,$,${wall},${c.list(refs)}`);
  }
}
