/** Equality tolerance for a scene of the given diameter (§7.2). */
export function tol(sceneDiameter: number): number {
  return 1e-9 * sceneDiameter;
}
