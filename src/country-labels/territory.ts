/**
 * Rivers cut zero-ID channels through otherwise valid territory. The
 * navigation mask identifies those channels reliably; the coast field does
 * not, because it is generated from the already-separated province geometry.
 */
export function isValidCountryLabelPoint(
  countryId: number,
  provinceId: number,
  waterway: boolean,
  provinceOwners: Uint32Array,
): boolean {
  return provinceId > 0 ? provinceOwners[provinceId] === countryId : waterway;
}
