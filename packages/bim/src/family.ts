/**
 * Generic component engine (Phase 7): Family -> ComponentType -> Component.
 * One validation path for every component category; the category always comes from the Family.
 *
 * Parameters: typed definitions with immutable machine keys and a scope.
 *   type scope     — values live on the ComponentType (the source of truth for geometry);
 *   instance scope — values live on each Component; type-scope keys can never be set per instance.
 * Units: length in metres, angle in degrees.
 */
import { DomainError, ErrorDetails, ErrorReason } from "@insa/core";
import type { BimState, Family, ParameterDefinition, ParamValue, ComponentType, Component } from "./model.js";
import type { P2 } from "./geo.js";
import { findCategory } from "./taxonomy.js";
import { GEOMETRY_EPSILON } from "./geometry.js";
import { nameProblem } from "./resources.js";

const fail = (reason: ErrorReason, message: string, details: ErrorDetails = {}): never => { throw new DomainError(message, reason, details); };
export const PARAM_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_PARAMETERS = 100;
const NUMERIC = new Set(["number", "length", "angle"]);
const DATA_TYPES = new Set(["number", "length", "angle", "string", "boolean"]);

/** Why a value does not fit a definition (null if it fits). */
export function valueProblem(def: ParameterDefinition, v: unknown): string | null {
  if (NUMERIC.has(def.dataType)) {
    if (typeof v !== "number" || !Number.isFinite(v)) return "must be a finite number";
    if (def.dataType === "length" && v < 0) return "a length cannot be negative";
    if (def.min !== undefined && v < def.min) return `must be >= ${def.min}`;
    if (def.max !== undefined && v > def.max) return `must be <= ${def.max}`;
    return null;
  }
  if (def.dataType === "string") return typeof v === "string" && v.length <= 500 ? null : "must be a string of at most 500 characters";
  return typeof v === "boolean" ? null : "must be true or false";
}

/** Family parameter schema (INVALID_PARAMETER_SCHEMA). */
export function checkParameterDefinitions(defs: unknown, d: ErrorDetails) {
  if (!Array.isArray(defs) || defs.length > MAX_PARAMETERS) fail("INVALID_PARAMETER_SCHEMA", `Parameters must be a list of at most ${MAX_PARAMETERS}.`, d);
  const seen = new Set<string>();
  for (const p of defs as ParameterDefinition[]) {
    const pd = { ...d, parameterKey: String(p?.key) };
    const bad = (m: string) => fail("INVALID_PARAMETER_SCHEMA", `Parameter '${p?.key}': ${m}.`, pd);
    if (typeof p?.key !== "string" || !PARAM_KEY.test(p.key)) bad("key must be lowercase letters, digits or _ (starting with a letter, at most 40)");
    if (seen.has(p.key)) bad("duplicate key");
    seen.add(p.key);
    const np = nameProblem(p.name);
    if (np) bad(`name ${np}`);
    if (p.scope !== "type" && p.scope !== "instance") bad("scope must be type or instance");
    if (!DATA_TYPES.has(p.dataType)) bad("dataType must be number, length, angle, string or boolean");
    if (typeof p.required !== "boolean") bad("required must be true or false");
    if (p.unit !== undefined && (typeof p.unit !== "string" || p.unit.length > 20)) bad("unit must be a short string");
    for (const k of ["min", "max"] as const)
      if (p[k] !== undefined && (!NUMERIC.has(p.dataType) || typeof p[k] !== "number" || !Number.isFinite(p[k]))) bad(`${k} needs a numeric dataType and a finite value`);
    if (p.min !== undefined && p.max !== undefined && p.min > p.max) bad("min is greater than max");
    if (p.default !== undefined) { const vp = valueProblem(p, p.default); if (vp) bad(`default ${vp}`); }
  }
}

/** Values of one scope against the family's definitions. */
export function checkParameterValues(defs: ParameterDefinition[], scope: "type" | "instance", values: unknown, d: ErrorDetails) {
  if (!values || typeof values !== "object" || Array.isArray(values)) fail("INVALID_PARAMETER_VALUE", "Parameters must be an object.", d);
  const vals = values as Record<string, unknown>;
  for (const key of Object.keys(vals).sort()) {
    const def = defs.find((x) => x.key === key);
    if (!def) fail("UNKNOWN_PARAMETER", `Unknown parameter '${key}'.`, { ...d, parameterKey: key });
    if (def!.scope !== scope)
      fail("UNKNOWN_PARAMETER", `'${key}' is a ${def!.scope} parameter; it cannot be set on ${scope === "instance" ? "an instance" : "a type"}.`, { ...d, parameterKey: key });
    const vp = valueProblem(def!, vals[key]);
    if (vp) fail("INVALID_PARAMETER_VALUE", `Parameter '${key}' ${vp}.`, { ...d, parameterKey: key });
  }
  for (const def of defs)
    if (def.scope === scope && def.required && vals[def.key] === undefined && def.default === undefined)
      fail("MISSING_REQUIRED_PARAMETER", `Required ${scope} parameter '${def.key}' is missing.`, { ...d, parameterKey: def.key });
}

/** Defaults overlaid by the given values (one scope). */
export function resolveParameters(defs: ParameterDefinition[], scope: "type" | "instance", values: Record<string, ParamValue>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const def of defs) if (def.scope === scope && def.default !== undefined) out[def.key] = def.default;
  return { ...out, ...values };
}

/** A family is well-formed: name, component category, placement, parameter schema, representation. */
export function checkFamily(f: Family) {
  const d: ErrorDetails = { familyId: f.id };
  const np = nameProblem(f.name);
  if (np) fail("INVALID_RESOURCE_NAME", `Family ${f.id}: name ${np}.`, { ...d, resourceKind: "family", field: "name" });
  const c = findCategory(f.category);
  if (!c) fail("INVALID_CATEGORY", `Family ${f.id}: unknown category '${f.category}'.`, { ...d, categoryId: String(f.category) });
  if (c!.engine !== "point_component")
    fail("CATEGORY_ENGINE_MISMATCH", `Category ${f.category} uses the native engine; families are only for component categories.`, { ...d, categoryId: f.category });
  if (!c!.placements.includes(f.placement))
    fail("INVALID_FAMILY", `Category ${f.category} does not allow placement '${f.placement}'.`, { ...d, categoryId: f.category, field: "placement" });
  if (f.description !== undefined && (typeof f.description !== "string" || f.description.length > 1000))
    fail("INVALID_FAMILY", "Description must be at most 1000 characters.", { ...d, field: "description" });
  checkParameterDefinitions(f.parameters, d);
  const r = f.representation;
  if (!r || r.kind !== "box") fail("INVALID_FAMILY", "Representation must be { kind: \"box\", width, depth, height }.", { ...d, field: "representation" });
  for (const axis of ["width", "depth", "height"] as const) {
    const key = r[axis];
    const def = f.parameters.find((p) => p.key === key);
    if (!def || def.scope !== "type" || def.dataType !== "length")
      fail("INVALID_FAMILY", `Box ${axis} must reference a type-scope length parameter (got '${String(key)}').`, { ...d, field: "representation", parameterKey: String(key) });
  }
}

export const familyOfType = (s: BimState, t: ComponentType): Family | undefined => s.families?.[t.family];

/** Resolved BOX dimensions of a component type (from type parameters + defaults). */
export function boxDimensions(s: BimState, typeId: string): { width: number; depth: number; height: number } {
  const t = s.types[typeId] as ComponentType;
  const f = familyOfType(s, t)!;
  const v = resolveParameters(f.parameters, "type", t.parameters);
  return { width: v[f.representation.width] as number, depth: v[f.representation.depth] as number, height: v[f.representation.height] as number };
}

/** A component type matches its family's type-scope schema and resolves to a real box. */
export function checkComponentType(s: BimState, t: ComponentType) {
  const d: ErrorDetails = { typeId: t.id, familyId: String(t.family) };
  const f = familyOfType(s, t);
  if (!f) fail("INVALID_FAMILY", `Type ${t.name}: family ${t.family} does not exist.`, d);
  checkParameterValues(f!.parameters, "type", t.parameters, d);
  const dims = boxDimensions(s, t.id);
  for (const axis of ["width", "depth", "height"] as const)
    if (!(dims[axis] > GEOMETRY_EPSILON))
      fail("INVALID_PARAMETER_VALUE", `Type ${t.name}: box ${axis} ('${f!.representation[axis]}') must be greater than ${GEOMETRY_EPSILON} m.`, { ...d, parameterKey: f!.representation[axis] });
  if (t.material !== undefined && !s.materials[t.material]) fail("INVALID_REFERENCE", `Type ${t.name}: material ${t.material} does not exist.`, { ...d, field: "material" });
}

/** A component instance: component type, known category, allowed placement, finite placement, instance parameters. */
export function checkComponent(s: BimState, el: Component) {
  const d: ErrorDetails = { elementId: el.id, elementKind: el.kind, typeId: String(el.type) };
  const t = s.types[el.type] as ComponentType | undefined;
  if (!t) fail("INVALID_REFERENCE", `${el.id}: type ${el.type} does not exist.`, { ...d, field: "type" });
  if (t!.kind !== "component") fail("INCOMPATIBLE_COMPONENT_TYPE", `${el.id}: ${t!.id} is a ${t!.kind} type, not a component type.`, d);
  const f = familyOfType(s, t!);
  if (!f) fail("INVALID_FAMILY", `${el.id}: family ${t!.family} does not exist.`, { ...d, familyId: t!.family });
  const c = findCategory(f!.category);
  if (!c) fail("INVALID_CATEGORY", `${el.id}: unknown category '${f!.category}'.`, { ...d, categoryId: f!.category });
  const pl = el.placement;
  if (!pl || pl.kind !== f!.placement || !c!.placements.includes(pl.kind))
    fail("INVALID_COMPONENT_PLACEMENT", `${el.id}: placement must be '${f!.placement}'.`, { ...d, categoryId: f!.category, field: "placement" });
  for (const k of ["x", "y", "offset", "rotation"] as const)
    if (typeof pl[k] !== "number" || !Number.isFinite(pl[k])) fail("INVALID_COMPONENT_PLACEMENT", `${el.id}: placement.${k} must be finite.`, { ...d, field: k });
  if (pl.rotation < 0 || pl.rotation >= 360) fail("INVALID_COMPONENT_PLACEMENT", `${el.id}: rotation must be in [0, 360) degrees.`, { ...d, field: "rotation" });
  checkParameterValues(f!.parameters, "instance", el.parameters, { ...d, familyId: f!.id });
}

/** Normalises degrees to [0, 360) deterministically (no -0, 360 -> 0). */
export function normalizeRotation(deg: number): number {
  const v = Math.round((((deg % 360) + 360) % 360) * 1e9) / 1e9;
  return v >= 360 || v === 0 ? 0 : v;
}

/**
 * Derived BOX geometry (never persisted). Origin: bottom centre at (x, y, storey.elevation + offset);
 * width along local X, depth along local Y, height up; rotation in degrees, counter-clockwise about Z.
 * corners: world XY, counter-clockwise starting at local (-w/2, -d/2).
 */
export function componentBox(s: BimState, el: Component) {
  const { width, depth, height } = boxDimensions(s, el.type);
  const a = (el.placement.rotation * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const local: P2[] = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];
  const corners = local.map(([u, v]) => [el.placement.x + u * c - v * sn, el.placement.y + u * sn + v * c] as P2);
  const zBottom = (s.storeys[el.storey]?.elevation ?? 0) + el.placement.offset;
  return { width, depth, height, corners, zBottom, zTop: zBottom + height };
}
