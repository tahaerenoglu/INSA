/**
 * path engine (Phase 11): elements whose geometry follows a semantic polyline (railings). Intent: the path (open or closed), a base
 * offset above the storey and a height; the type supplies the dimensions. Posts and rails are DERIVED (arch.pathPosts), never stored.
 * Policy: consecutive duplicate vertices (zero-length segments) are REJECTED, not silently canonicalised.
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, PathElement, RailingType } from "../model.js";
import { GEOMETRY_EPSILON as E, distance } from "../geometry.js";
import { fail, finite, positive, point } from "./kit.js";
import { pathSegments, pathLength, pathPosts } from "../arch.js";

export function validatePath(s: BimState, el: PathElement, d: ErrorDetails) {
  if (!Array.isArray(el.path)) fail("INVALID_PATH_ELEMENT", `${el.id}: path must be a list of points.`, { ...d, field: "path" });
  if (typeof el.closed !== "boolean") fail("INVALID_PATH_ELEMENT", `${el.id}: closed must be true or false.`, { ...d, field: "closed" });
  const min = el.closed ? 3 : 2;
  if (el.path.length < min) fail("INVALID_PATH_ELEMENT", `${el.id}: a ${el.closed ? "closed" : "open"} path needs at least ${min} points (got ${el.path.length}).`, { ...d, field: "path" });
  el.path.forEach((p, i) => point(p, `${el.id} path point ${i}`, { ...d, field: "path", index: i }));
  pathSegments(el).forEach(([a, b], i) => {
    if (distance(a, b) <= E) fail("INVALID_PATH_ELEMENT", `${el.id}: segment ${i} has zero length (duplicate adjacent vertices).`, { ...d, field: "path", segmentIndex: i });
  });
  finite(el.offset, `${el.id} offset`, { ...d, field: "offset" });
  positive(el.height, `${el.id} height`, { ...d, field: "height" });
}
export const pathPlacement = (el: PathElement) => ({ kind: "path" as const, storey: el.storey, path: el.path, closed: el.closed, offset: el.offset });
/** top rail along every segment, posts per the documented spacing rule, dimensions from the type */
export function pathRepresentation(s: BimState, el: PathElement) {
  const t = s.types[el.type] as RailingType;
  return { kind: "path_sweep" as const, path: el.path, closed: el.closed, baseZ: el.offset, height: el.height, length: pathLength(el),
           topRail: t.topRail, post: t.post, segments: pathSegments(el), posts: pathPosts(el, t.maxPostSpacing) };
}
