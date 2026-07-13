/**
 * Converts a wire decimal only at a rendering/calculation boundary.
 *
 * API contracts intentionally retain decimal strings so they are not silently
 * rounded by JSON. Components that need a JavaScript number must opt in here.
 */
export function decimalToDisplayNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
