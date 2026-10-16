export interface SeedService {
  name: string;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("nl-NL");

/**
 * Decide which default services still need to be inserted for one salon.
 * - No services yet: all seeds.
 * - Only services that match seed names (an earlier, partly failed seed): only the missing seeds.
 * - Any own (non-seed) service: nothing, so the salon's own setup is never extended or overwritten.
 * Existing services are never returned, so re-running cannot create duplicates.
 */
export function missingSeedServices<T extends SeedService>(
  seeds: T[],
  existingNames: string[],
): T[] {
  const seedNames = new Set(seeds.map((s) => norm(s.name)));
  const existing = new Set(existingNames.map(norm));
  if ([...existing].some((n) => !seedNames.has(n))) return [];
  const seen = new Set<string>();
  return seeds.filter((s) => {
    const n = norm(s.name);
    if (existing.has(n) || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}
