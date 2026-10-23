/**
 * Typed platform errors. `code` is the coarse class adapters map to transport
 * status (domain -> 400, permission -> 403, concurrency -> 409); `reason` is a
 * stable machine-readable identifier (e.g. INVALID_PROJECT_ID).
 */
export type ErrorReason =
  | 'INVALID_COMPOSITION' | 'CONFLICTING_TYPE' | 'MODEL_ALREADY_EXISTS' | 'SYSTEM_ALREADY_EXISTS' | 'UNSUPPORTED_GEOMETRY'
  | 'SHARED_TYPE_REQUIRED' | 'SOURCE_REQUIRES_REVIEW' | 'INVALID_SOURCE_REFERENCE' | 'REQUEST_ALREADY_APPLIED'
  | 'UNSUPPORTED_CAPABILITY' | 'STALE_MODEL_PLAN' | 'MODEL_VALIDATION_FAILED' | 'INVALID_QUERY'
  | "DOMAIN_ERROR" | "INVALID_INPUT" | "INVALID_PROJECT_ID" | "INVALID_EXPORT_PATH" | "ARTIFACT_NOT_FOUND"
  | "UNAUTHORIZED" | "CONFLICT" | "INVALID_TERRAIN" | "INCOMPATIBLE_CRS" | "INCOMPATIBLE_DATUM"
  | "PROPOSAL_NOT_FOUND" | "PROPOSAL_NOT_PENDING" | "PROPOSAL_ALREADY_APPLIED"
  | "NOTHING_TO_UNDO" | "COMMAND_NOT_FOUND" | "COMMAND_ALREADY_REVERTED" | "NOT_LATEST_COMMAND" | "UNKNOWN_TOOL" | "TOOL_NOT_AVAILABLE_FOR_PROJECT_TYPE"
  // BIM domain validation (Phase 2)
  | "ELEMENT_NOT_FOUND" | "INVALID_ELEMENT_UPDATE" | "INVALID_DIMENSION" | "INVALID_GEOMETRY" | "DEGENERATE_GEOMETRY"
  | "SELF_INTERSECTING_POLYGON" | "INVALID_SLAB_HOLE" | "INVALID_HOST_RELATION" | "DEPENDENT_ELEMENT_INVALID" | "INVALID_REFERENCE"
  // event log / snapshot integrity (Phase 3)
  | "UNSUPPORTED_EVENT_VERSION" | "EVENT_UPCAST_FAILED" | "EVENT_SEQUENCE_ERROR"
  | "INVALID_SNAPSHOT" | "UNSUPPORTED_SNAPSHOT_VERSION" | "SNAPSHOT_CORRUPTED"
  // BIM resource lifecycle (Phase 4)
  | "RESOURCE_NOT_FOUND" | "RESOURCE_IN_USE" | "DUPLICATE_RESOURCE" | "INVALID_RESOURCE_UPDATE" | "RESOURCE_KIND_MISMATCH"
  | "INVALID_RESOURCE_NAME" | "AMBIGUOUS_RESOURCE_REFERENCE"
  // vertical constraints (Phase 5)
  | "INVALID_VERTICAL_CONSTRAINT"
  // wall topology and element lifecycle (Phase 6)
  | "INVALID_WALL_JOIN" | "DUPLICATE_WALL_JOIN" | "WALL_JOIN_CONFLICT" | "WALL_ENDPOINT_ALREADY_CONSTRAINED" | "CONSTRAINED_ENDPOINT" | "WALL_INTERSECTION"
  | "TOPOLOGY_INCONSISTENT" | "JOIN_NOT_FOUND" | "ELEMENT_IN_USE" | "INVALID_REHOST"
  // taxonomy, families and generic components (Phase 7)
  | "INVALID_CATEGORY" | "CATEGORY_ENGINE_MISMATCH" | "INVALID_FAMILY" | "INVALID_FAMILY_UPDATE" | "INVALID_PARAMETER_SCHEMA"
  | "INVALID_PARAMETER_VALUE" | "MISSING_REQUIRED_PARAMETER" | "UNKNOWN_PARAMETER" | "INVALID_COMPONENT_PLACEMENT" | "INCOMPATIBLE_COMPONENT_TYPE"
  // spatial elements (Phase 8)
  | "INVALID_SPATIAL_ELEMENT" | "INVALID_SPATIAL_CATEGORY" | "INVALID_SPATIAL_POINT" | "SPATIAL_POINT_ON_BOUNDARY"
  | "SPATIAL_REGION_NOT_FOUND" | "SPATIAL_REGION_OCCUPIED" | "DUPLICATE_SPATIAL_NUMBER"
  // universal engine architecture (Phase 9)
  | "UNKNOWN_ENGINE" | "ENGINE_NOT_IMPLEMENTED" | "ENGINE_TYPE_MISMATCH" | "INVALID_ENGINE_PLACEMENT" | "ENGINE_OPERATION_UNSUPPORTED"
  // authoring primitives (Phase 10)
  | "INVALID_SPLIT" | "SPLIT_INTERSECTS_HOSTED_OPENING" | "MERGE_INCOMPATIBLE" | "MERGE_PROPERTY_CONFLICT" | "MERGE_NOT_CONNECTED"
  | "MERGE_AMBIGUOUS_JUNCTION" | "INVALID_TRIM_TARGET" | "INVALID_EXTEND_TARGET" | "WALL_EDIT_ENDPOINT_JOINED" | "WALL_EDIT_HOSTED_CONFLICT"
  | "AUTHORING_PLAN_MISMATCH"
  // architecture expansion (Phase 11)
  | "INVALID_ROUTE" | "MEP_SYSTEM_DOMAIN_MISMATCH" | "MEP_CONNECTOR_NOT_FOUND" | "MEP_CONNECTOR_IN_USE" | "MEP_DOMAIN_MISMATCH" | "MEP_SYSTEM_MISMATCH"
  | "MEP_CONNECTOR_INCOMPATIBLE" | "MEP_FLOW_CONFLICT" | "MEP_CONNECTION_DISTANCE" | "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT" | "MEP_JUNCTION_MERGE_UNSUPPORTED"
  | "INVALID_CONNECTOR_DEFINITION" | "INVALID_PREDEFINED_TYPE" | "UNSUPPORTED_IFC_SCHEMA" | "INVALID_ASSEMBLY_RELATION" | "IFC_ELEMENT_NOT_EXPORTED" | "INVALID_RAMP_GEOMETRY" | "INVALID_CURTAIN_GRID" | "INVALID_ROOF_GEOMETRY" | "INVALID_SPATIAL_UNIT" | "GEOREFERENCE_NOT_SET" | "INVALID_GEOREFERENCE" | "RAMP_TYPE_LIMIT_EXCEEDED"
  | "INVALID_ROOF_PLANE" | "INVALID_STAIR_GEOMETRY" | "STAIR_VERTICAL_CONSTRAINT_INVALID" | "STAIR_TYPE_LIMIT_EXCEEDED" | "INVALID_PATH_ELEMENT";

/** Safe, caller-visible context (ids, field names, indices) — never paths, SQL or stack traces. */
export type ErrorDetails = Record<string, string | number | boolean>;

export class DomainError extends Error {
  readonly code = "domain";
  constructor(message: string, readonly reason: ErrorReason = "DOMAIN_ERROR", readonly details?: ErrorDetails) { super(message); }
}
export class PermissionError extends Error {
  readonly code = "permission";
  readonly reason: ErrorReason = "UNAUTHORIZED";
}
/**
 * Stored data the running code cannot use safely (future event version, broken
 * event sequence, failed upcast). Not the caller's fault: maps to 500, but the
 * message and reason are safe to show (no paths, SQL or stack traces).
 */
export class IntegrityError extends Error {
  readonly code = "integrity";
  constructor(message: string, readonly reason: ErrorReason, readonly details?: ErrorDetails) { super(message); }
}

export class ConcurrencyError extends Error {
  readonly code = "concurrency";
  readonly reason: ErrorReason = "CONFLICT";
}

/**
 * The only error shape adapters (HTTP, MCP, agent) may show to callers.
 * Unknown errors (filesystem, database, bugs) are reduced to a generic message.
 */
export function publicError(e: unknown): { status: number; code: string; reason: string; message: string; internal: boolean; details?: ErrorDetails } {
  const err = e as { code?: string; reason?: string; message?: string; details?: ErrorDetails };
  if (err?.code === "domain")
    return { status: 400, code: "domain", reason: err.reason ?? "DOMAIN_ERROR", message: String(err.message), internal: false,
             ...(err.details ? { details: err.details } : {}) };
  if (err?.code === "integrity")
    return { status: 500, code: "integrity", reason: err.reason ?? "INVALID_SNAPSHOT", message: String(err.message), internal: false,
             ...(err.details ? { details: err.details } : {}) };
  if (err?.code === "permission") return { status: 403, code: "permission", reason: "UNAUTHORIZED", message: String(err.message), internal: false };
  if (err?.code === "concurrency") return { status: 409, code: "concurrency", reason: "CONFLICT", message: String(err.message), internal: false };
  return { status: 500, code: "internal", reason: "INTERNAL_ERROR", message: "Internal error. The details were logged on the server.", internal: true };
}
