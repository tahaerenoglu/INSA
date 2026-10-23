/**
 * hosted_component engine (Phase 9): components filling an opening (the internal void) of a host wall.
 * Doors and windows are CATEGORIES of this one engine. Wall -> Opening -> fill is preserved exactly.
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, HostedComponent, Opening, OpeningType } from "../model.js";
import { GEOMETRY_EPSILON as E } from "../geometry.js";
import { fail } from "./kit.js";

export function validateHosted(s: BimState, el: HostedComponent, d: ErrorDetails) {
  const t = s.types[el.type] as OpeningType;
  const o = s.elements[el.opening];
  if (!o || o.kind !== "opening") fail("INVALID_HOST_RELATION", `${el.id}: its opening ${el.opening} does not exist.`, { ...d, field: "opening" });
  const op = o as Opening;
  if (op.host !== el.host || op.filledBy !== el.id)
    fail("INVALID_HOST_RELATION", `${el.id}: opening ${op.id} is not linked to it in wall ${el.host}.`, { ...d, hostId: el.host });
  if (el.storey !== op.storey)
    fail("INVALID_HOST_RELATION", `${el.id}: it must be on the storey of its opening ${op.id} / wall ${el.host}.`, { ...d, hostId: el.host, field: "storey" });
  if (Math.abs(op.width - t.width) > E || Math.abs(op.height - t.height) > E)
    fail("INVALID_HOST_RELATION", `${el.id}: opening ${op.id} size does not match type ${t.name}.`, { ...d, hostId: el.host });
}
export function hostedPlacement(s: BimState, el: HostedComponent) {
  const op = s.elements[el.opening] as Opening | undefined;
  return { kind: "host" as const, storey: el.storey, host: el.host, opening: el.opening, along: op?.along ?? null, sill: op?.sill ?? null };
}
/** Existing insert geometry: the type's width x height, a thin leaf, positioned by the opening. */
export function hostedRepresentation(s: BimState, el: HostedComponent) {
  const t = s.types[el.type] as OpeningType;
  return { kind: "hosted_insert" as const, opening: el.opening, width: t.width, height: t.height, depth: 0.06 };
}
