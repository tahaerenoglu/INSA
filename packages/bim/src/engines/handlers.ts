/**
 * Typed element-capability registry (Phase 14, Milestone A).
 *
 * An engine owns ONE storage variant (element.kind) and REGISTERS what it can do for it here; every central lifecycle module (dispatch, invariants,
 * resources, model quantities, move / update tools, plan, IFC export) asks `handlersOf(element)` instead of switching on `element.kind`. A new engine is a
 * new module + one `defineHandlers(...)` + one `registerEngine(...)`: no case in an unrelated lifecycle module.
 *
 * Deliberately NOT here: platform event governance (commands, events, reducers, replay, snapshots, undo stay central), IFC class or category choosing
 * geometry (the category selects the engine; the engine alone derives geometry), and a generic "component" model.
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, Element } from "../model.js";
import type { ElementReference } from "../resources.js";
import type { PlacementKind } from "./registry.js";
import type { IfcWriteContext } from "../ifc.js";

/** The minimum every persisted element is: an engine variant discriminant, an id and a storey. Builtin variants are the `Element` union; extensions extend this. */
export interface ElementLike { readonly kind: string; readonly id: string; readonly storey: string }
export type P2 = [number, number];

/** How the engine's elements reach IFC. `writer`: the engine writes its own products (the contract the coverage report can trust); `central`: written by the
 * legacy block of ifc.ts (declared, and ENFORCED: toIfc throws if such an element ends up without a product); `none`: no IFC product (reason required). */
export type IfcCapability<E extends ElementLike> =
  | { readonly mode: "writer"; readonly phase?: "product" | "relationship"; write(ctx: IfcWriteContext, els: readonly E[]): void; productKeys?(s: BimState, el: E): readonly string[] }
  | { readonly mode: "central"; productKeys?(s: BimState, el: E): readonly string[] }
  | { readonly mode: "none"; readonly reason: string };
/** How the engine's elements reach the plan drawing: `draw` (engine-owned), `central` (legacy block of plan.ts), `none`. */
export type PlanCapability<E extends ElementLike> =
  | { readonly mode: "draw"; draw(ctx: PlanDrawContext, els: readonly E[]): string[] }
  | { readonly mode: "central" }
  | { readonly mode: "none"; readonly reason: string };
export interface PlanDrawContext { readonly s: BimState; readonly sc: number; X(x: number): string; Y(y: number): string; poly(pts: readonly P2[]): string }

export interface ElementHandlers<E extends ElementLike = ElementLike> {
  readonly kind: E["kind"];
  /** which of the engine's placements this element uses */
  placementKind(el: E): PlacementKind;
  /** normalised, DERIVED placement (where / how it is positioned; never what it is) */
  placement(s: BimState, el: E): unknown;
  /** the derived, storey-local representation every consumer reads (never persisted); `ctx` lets a caller share one context */
  representation(s: BimState, el: E, ctx?: unknown): unknown;
  /** "the same physical thing twice" key for bim_validate; null = no stored geometry of its own */
  signature(s: BimState, el: E, category: string): string | null;
  /** FULL engine validation of one element (the handler decides the order of its own checks and runs the central engine-chain check) */
  validate(s: BimState, el: E, d: ErrorDetails): void;
  /** net quantities (derived) */
  quantities(s: BimState, el: E): Record<string, number>;
  /** true: the public label is the SEMANTIC category (floor / ceiling / stair / structure.brace ...), not the storage variant */
  readonly semanticLabel?: boolean;
  /** optional label override; undefined falls back to semanticLabel / the kind */
  label?(s: BimState, el: E): string | undefined;
  /** ids of OTHER elements whose change or deletion re-validates this element (host, members, opening ...) */
  dependsOn?(s: BimState, el: E): readonly string[];
  /** storeys this element is constrained to / derives world geometry from: an elevation or identity change re-validates it */
  storeysOf?(el: E): readonly string[];
  /** references this element HOLDS to other elements (delete protection reads them): `target` is the referenced element */
  references?(el: E): readonly { readonly target: string; readonly ref: ElementReference }[];
  /** where the element is CONTAINED when it is not a building element: a spatial unit (facility / facility part) instead of a storey. Absent = contained in its storey. */
  container?(el: E): { readonly kind: "spatial_unit"; readonly id: string } | undefined;
  /** the persisted changes that translate this element by [dx, dy] in plan; null = it moves only with its host */
  translate?(el: E, dx: number, dy: number, r: (n: number) => number): Record<string, unknown> | null;
  /** plan-extent contribution (x, y points) */
  planBounds?(s: BimState, el: E): readonly P2[];
  readonly ifc: IfcCapability<E>;
  readonly plan: PlanCapability<E>;
}

const HANDLERS = new Map<string, ElementHandlers<any>>();
/** Register the handlers of ONE element variant. Typed per element type; a kind can be registered once. */
export function defineHandlers<E extends ElementLike>(h: ElementHandlers<E>): void {
  if (HANDLERS.has(h.kind)) throw new Error(`handlers for element kind '${h.kind}' are already registered`);
  HANDLERS.set(h.kind, h);
}
/** test hygiene for extension engines only */
export const undefineHandlers = (kind: string): boolean => HANDLERS.delete(kind);
/** every registered handler set, in registration order (deterministic: builtin.ts registers in a fixed order) */
export const allHandlers = (): ElementHandlers<Element>[] => [...HANDLERS.values()] as ElementHandlers<Element>[];
export const hasHandlers = (kind: string) => HANDLERS.has(kind);
export const registeredKinds = (): string[] => [...HANDLERS.keys()].sort();
/** The handlers of an element. An unregistered kind is a programming error, never a silent default. */
export function handlersOf(el: Element | ElementLike): ElementHandlers<Element> {
  const h = HANDLERS.get(el.kind);
  if (!h) throw new Error(`no engine handlers registered for element kind '${el.kind}' (engines/builtin.ts registers the builtin ones)`);
  return h as ElementHandlers<Element>;
}
