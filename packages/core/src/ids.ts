/**
 * Canonical project identifier rule. The ONLY place project ids are validated;
 * Platform, stores, artifact storage and every adapter call parseProjectId.
 *
 * Allowed: 1-64 characters, letters (any script), digits, '_', '-', '.';
 * must start with a letter or digit; no '..', no trailing '.', no Windows
 * reserved device names. This keeps ids safe as directory names and keys.
 */
import { DomainError } from "./errors.js";

export type ProjectId = string & { readonly __projectId: unique symbol };

const SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export function isValidProjectId(v: unknown): v is ProjectId {
  return typeof v === "string" && SHAPE.test(v) && !v.includes("..") && !v.endsWith(".") && !RESERVED.test(v);
}

export function parseProjectId(v: unknown): ProjectId {
  if (!isValidProjectId(v)) {
    const shown = typeof v === "string" ? JSON.stringify(v.slice(0, 80)) : typeof v;
    throw new DomainError(`Invalid project id ${shown}: use 1-64 letters, digits, '_', '-' or '.', starting with a letter or digit, without '..'.`,
      "INVALID_PROJECT_ID");
  }
  return v;
}
