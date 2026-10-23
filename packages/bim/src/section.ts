/**
 * THE profile-section model (Phase 12): rectangle, circle, RHS, CHS, I-section. One place defines a section's validity, its area, its outer
 * bounds and its plan outline; quantities, validation, IFC and the plan read these functions (no section formula exists anywhere else).
 * Sections are parametric: nothing here is persisted as geometry. All dimensions are metres.
 */
import type { P2 } from "./geo.js";
import { r } from "./geo.js";
import type { Profile } from "./model.js";

export type SectionProblem = { field: string; message: string };
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The first problem of a section, or null. Impossible walls / flanges are refused: the section must keep a positive core. */
export function sectionProblem(p: Profile | undefined): SectionProblem | null {
  if (!p || typeof p !== "object") return { field: "profile", message: "a profile is required" };
  const pos = (field: string, v: unknown): SectionProblem | null => (fin(v) && v > 0 ? null : { field, message: `${field} must be a finite number greater than 0 (got ${String(v)})` });
  switch (p.shape) {
    case "rect": return pos("b", p.b) ?? pos("h", p.h);
    case "circle": return pos("d", p.d);
    case "rhs": return pos("b", p.b) ?? pos("h", p.h) ?? pos("t", p.t) ?? (2 * p.t < Math.min(p.b, p.h) ? null : { field: "t", message: `wall thickness ${p.t} leaves no hollow in a ${p.b} x ${p.h} section (need 2 t < min(b, h))` });
    case "chs": return pos("d", p.d) ?? pos("t", p.t) ?? (2 * p.t < p.d ? null : { field: "t", message: `wall thickness ${p.t} leaves no hollow in a ${p.d} diameter section (need 2 t < d)` });
    case "i_section": return pos("h", p.h) ?? pos("b", p.b) ?? pos("tw", p.tw) ?? pos("tf", p.tf)
      ?? (2 * p.tf < p.h ? null : { field: "tf", message: `flanges ${p.tf} + ${p.tf} leave no web in a ${p.h} deep section (need 2 tf < h)` })
      ?? (p.tw < p.b ? null : { field: "tw", message: `web thickness ${p.tw} is not narrower than the flange width ${p.b}` });
    default: return { field: "shape", message: `unknown section shape '${String((p as { shape?: unknown }).shape)}'` };
  }
}
/** Cross-section area: the single source of every cross_section_area / volume in the model. */
export function sectionArea(p: Profile): number {
  switch (p.shape) {
    case "rect": return p.b * p.h;
    case "circle": return (Math.PI * p.d * p.d) / 4;
    case "rhs": return p.b * p.h - (p.b - 2 * p.t) * (p.h - 2 * p.t);
    case "chs": return (Math.PI / 4) * (p.d * p.d - (p.d - 2 * p.t) ** 2);
    case "i_section": return 2 * p.b * p.tf + (p.h - 2 * p.tf) * p.tw;
  }
}
/** Outer extent: `w` across (local X), `h` along local Y (the section's depth). */
export const sectionBounds = (p: Profile): { w: number; h: number } =>
  p.shape === "rect" ? { w: p.b, h: p.h } : p.shape === "rhs" ? { w: p.b, h: p.h } : p.shape === "i_section" ? { w: p.b, h: p.h } : { w: p.d, h: p.d };
export const isRoundSection = (p: Profile) => p.shape === "circle" || p.shape === "chs";
export const isHollowSection = (p: Profile) => p.shape === "rhs" || p.shape === "chs";
/** Outer outline of a non-round section, centred on the origin (X across, Y deep): the plan drawing of a vertical member. */
export function sectionOutline(p: Profile): P2[] | null {
  if (isRoundSection(p)) return null;
  const { w, h } = sectionBounds(p), hw = w / 2, hh = h / 2;
  if (p.shape !== "i_section") return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const tw = p.tw / 2, fy = hh - p.tf;
  return [[-hw, -hh], [hw, -hh], [hw, -fy], [tw, -fy], [tw, fy], [hw, fy], [hw, hh], [-hw, hh], [-hw, fy], [-tw, fy], [-tw, -fy], [-hw, -fy]].map(([x, y]) => [r(x, 9), r(y, 9)] as P2);
}
