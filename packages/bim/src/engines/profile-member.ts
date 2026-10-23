/**
 * profile_member engine: ONE behaviour for every member category (beam, column, brace, pile, ...). The category decides which placement it
 * uses and its direction (registry data); the engine owns validation, normalised placement and the single profile-sweep representation.
 *   member_axis          horizontal axis at a level above the storey (beams)
 *   member_vertical      a vertical axis at a point: up (columns) or down (piles: category.memberDirection)
 *   member_spatial_axis  a true 3D axis between two storey-aware endpoints (braces)
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, ProfileMember, ProfileType, MemberEnd, SpatialAxisMember } from "../model.js";
import { GEOMETRY_EPSILON as E, distance } from "../geometry.js";
import { fail, finite, positive, point, checkVertical } from "./kit.js";
import { findCategory } from "../taxonomy.js";
import { sectionBounds } from "../section.js";
import { r } from "../geo.js";

type V3 = [number, number, number];
const elev = (s: BimState, id: string) => s.storeys[id]?.elevation;
/** world positions of a member's two ends (z includes the storey elevation); the one place that knows how each placement maps to the world */
export function memberWorldEnds(s: BimState, el: ProfileMember): { start: V3; end: V3 } {
  const z0 = elev(s, el.storey) ?? 0;
  if (el.placement === "member_axis") return { start: [el.start[0], el.start[1], z0 + el.z], end: [el.end[0], el.end[1], z0 + el.z] };
  if (el.placement === "member_vertical") {
    const b = z0 + el.baseOffset, down = el.direction === "down";
    return down ? { start: [el.at[0], el.at[1], b], end: [el.at[0], el.at[1], b - el.height] } : { start: [el.at[0], el.at[1], b], end: [el.at[0], el.at[1], b + el.height] };
  }
  const z = (e: MemberEnd) => (elev(s, e.storey) ?? 0) + e.offset;
  return { start: [el.start.at[0], el.start.at[1], z(el.start)], end: [el.end.at[0], el.end.at[1], z(el.end)] };
}
const len3 = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
/** true 3D length of the axis (the vertical member's `height` for columns / piles) */
export const memberLength = (s: BimState, el: ProfileMember) => { const w = memberWorldEnds(s, el); return len3(w.start, w.end); };

const validEnd = (s: BimState, e: MemberEnd, what: string, d: ErrorDetails) => {
  if (!e || typeof e !== "object") fail("INVALID_GEOMETRY", `${what} must be { storey, at, offset }.`, { ...d, field: what });
  if (!s.storeys[e.storey]) fail("INVALID_REFERENCE", `${what}: storey ${String(e.storey)} does not exist.`, { ...d, field: what, storeyId: String(e.storey) });
  point(e.at, `${what} position`, { ...d, field: what }); finite(e.offset, `${what} offset`, { ...d, field: what });
};

export function validateMember(s: BimState, el: ProfileMember, d: ErrorDetails) {
  const cat = findCategory(el.category);
  const wantDown = cat?.memberDirection === "down";
  if (el.placement === "member_axis") {
    checkVertical(s, el, d);
    const a = point(el.start, `${el.id} start`, { ...d, field: "start" }), b = point(el.end, `${el.id} end`, { ...d, field: "end" });
    if (distance(a, b) <= E) fail("DEGENERATE_GEOMETRY", `${el.id}: member length ${distance(a, b)} m is not greater than ${E} m.`, { ...d, field: "end" });
    finite(el.z, `${el.id} z`, { ...d, field: "z" });
  } else if (el.placement === "member_vertical") {
    const dir = (el as { direction?: unknown }).direction;
    if (dir !== undefined && dir !== "down") fail("INVALID_ENGINE_PLACEMENT", `${el.id}: direction must be absent (up) or "down".`, { ...d, field: "direction" });
    if ((dir === "down") !== wantDown) fail("CATEGORY_ENGINE_MISMATCH", `${el.id}: ${el.category} members hang ${wantDown ? "DOWN" : "UP"}; a member cannot change direction (a pile is not a column).`, { ...d, field: "direction" });
    if (wantDown) { if (el.vertical?.mode !== "fixed") fail("INVALID_VERTICAL_CONSTRAINT", `${el.id}: a downward member has a fixed length (no storey constraint).`, { ...d, field: "vertical" }); }
    else checkVertical(s, el, d);
    point(el.at, `${el.id} position`, { ...d, field: "at" });
    positive(el.height, `${el.id} ${wantDown ? "length" : "height"}`, { ...d, field: "height" });
    finite(el.baseOffset, `${el.id} base offset`, { ...d, field: "base_offset" });
    finite(el.rotation, `${el.id} rotation`, { ...d, field: "rotation" });
  } else if (el.placement === "member_spatial_axis") {
    validEnd(s, el.start, "start", d); validEnd(s, el.end, "end", d);
    if (el.storey !== el.start.storey) fail("INVALID_REFERENCE", `${el.id}: its storey must be the storey of its start point.`, { ...d, field: "storey" });
    finite(el.rotation, `${el.id} rotation`, { ...d, field: "rotation" });
    if (memberLength(s, el) <= E) fail("DEGENERATE_GEOMETRY", `${el.id}: the 3D axis is shorter than ${E} m (coincident endpoints in the world).`, { ...d, field: "end" });
  } else fail("INVALID_ENGINE_PLACEMENT", `${(el as ProfileMember).id}: unknown member placement.`, { ...d, field: "placement" });
}

/** Normalised placement descriptor (storey-local; spatial axes carry their storeys). */
export const memberPlacement = (el: ProfileMember) => el.placement === "member_axis"
  ? { kind: "member_axis" as const, storey: el.storey, start: el.start, end: el.end, z: el.z }
  : el.placement === "member_vertical"
    ? { kind: "member_vertical" as const, storey: el.storey, at: el.at, baseOffset: el.baseOffset, height: el.height, rotation: el.rotation, direction: el.direction === "down" ? "down" as const : "up" as const }
    : { kind: "member_spatial_axis" as const, storey: el.storey, start: el.start, end: el.end, rotation: el.rotation };

/**
 * The deterministic section frame of a 3D axis. Z = the axis; X (the section's width direction) = the horizontal lateral (up x axis normalised)
 * for any axis that is not vertical, else the world X; `rotation` rolls the section about the axis. The vertical members keep their explicit
 * rotation about Z. No flipping between runs: a pure function of the axis and the roll.
 */
export function memberFrame(dir: V3, rollDeg: number): { axis: V3; ref: V3 } {
  const l = Math.hypot(dir[0], dir[1], dir[2]), a: V3 = [dir[0] / l, dir[1] / l, dir[2] / l], h = Math.hypot(a[0], a[1]);
  const lat: V3 = h > 1e-9 ? [-a[1] / h, a[0] / h, 0] : [1, 0, 0];
  const nrm: V3 = [a[1] * lat[2] - a[2] * lat[1], a[2] * lat[0] - a[0] * lat[2], a[0] * lat[1] - a[1] * lat[0]];   // axis x lateral
  const t = (rollDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return { axis: a.map((v) => r(v, 12)) as V3, ref: lat.map((v, i) => r(v * c + nrm[i] * s, 12)) as V3 };
}

/**
 * THE profile sweep every member category resolves to (storey-local coordinates: z relative to the member's own storey).
 * origin / axisDir / refDir: where the section starts, the sweep direction and the section's X direction; profileCenter: where the axis passes
 * through the section (beams hang from their top reference; everything else is centred).
 */
export function memberRepresentation(s: BimState, el: ProfileMember) {
  const profile = (s.types[el.type] as ProfileType).profile;
  const w = memberWorldEnds(s, el), z0 = elev(s, el.storey) ?? 0;
  const start: V3 = [w.start[0], w.start[1], w.start[2] - z0], length = len3(w.start, w.end);
  const dir: V3 = [w.end[0] - w.start[0], w.end[1] - w.start[1], w.end[2] - w.start[2]];
  if (el.placement === "member_axis") {
    const f = memberFrame(dir, 0), hgt = sectionBounds(profile).h;
    return { kind: "profile_sweep" as const, sweep: "axis" as const, profile, origin: start, axisDir: f.axis, refDir: f.ref, direction: [f.axis[0], f.axis[1]] as [number, number], length, profileCenter: [0, -hgt / 2] as [number, number] };
  }
  if (el.placement === "member_vertical") {
    const a = (el.rotation * Math.PI) / 180, down = el.direction === "down";
    const ref: V3 = [r(Math.cos(a), 12), r(Math.sin(a), 12), 0];
    return { kind: "profile_sweep" as const, sweep: "vertical" as const, profile, origin: start, axisDir: [0, 0, down ? -1 : 1] as V3, refDir: ref, direction: [ref[0], ref[1]] as [number, number], length, profileCenter: [0, 0] as [number, number] };
  }
  const f = memberFrame(dir, el.rotation);
  return { kind: "profile_sweep" as const, sweep: "spatial" as const, profile, origin: start, axisDir: f.axis, refDir: f.ref, direction: [f.axis[0], f.axis[1]] as [number, number], length, profileCenter: [0, 0] as [number, number] };
}
export type MemberRepresentation = ReturnType<typeof memberRepresentation>;
export type { SpatialAxisMember };
