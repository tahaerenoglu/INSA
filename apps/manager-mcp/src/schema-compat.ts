/** Convert tuple schemas to array schemas accepted by Codex tool discovery.
 * Runtime validation still uses the original Zod schemas.
 */
export function compatibleSchema(value: unknown): any {
  if (Array.isArray(value)) return value.map(compatibleSchema);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, compatibleSchema(child)]));
  if (Array.isArray(result.items)) {
    const alternatives = [...new Map(result.items.map((item: unknown) => [JSON.stringify(item), item])).values()];
    result.items = alternatives.length === 1 ? alternatives[0] : { anyOf: alternatives };
    delete result.additionalItems;
  }
  return result;
}
