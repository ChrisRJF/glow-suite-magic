/** Pure MFA factor rules for the settings UI. UI hints only: Supabase Auth itself does not block unenrolling the last factor. */
export type FactorLike = { id: string; status: string; factor_type?: string; friendly_name?: string | null; created_at?: string };

export function verifiedTotpFactors<T extends FactorLike>(factors: T[] | null | undefined): T[] {
  return (factors ?? []).filter((f) => (f.factor_type ?? "totp") === "totp" && f.status === "verified");
}

export function unverifiedTotpFactors<T extends FactorLike>(factors: T[] | null | undefined): T[] {
  return (factors ?? []).filter((f) => (f.factor_type ?? "totp") === "totp" && f.status !== "verified");
}

/**
 * Whether the normal UI may offer removal of a verified factor.
 * Platform owners (or unknown owner status) never get to remove their final verified factor.
 */
export function canOfferRemoval(opts: { verifiedCount: number; ownerStatus: "owner" | "not_owner" | "unknown"; aal2: boolean }): boolean {
  if (!opts.aal2 || opts.verifiedCount < 1) return false;
  if (opts.verifiedCount > 1) return true;
  return opts.ownerStatus === "not_owner";
}
