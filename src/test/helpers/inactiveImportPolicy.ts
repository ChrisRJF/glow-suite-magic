import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// Active code may only import the Viva LIVE ISV modules the owner explicitly
// approved and wired (each behind its own default-off LIVE switch). Every
// other inactive module (WhatsApp, email, etc.) must stay unwired, also
// transitively through an approved module.
export const APPROVED_ACTIVE_INACTIVE_IMPORTS = new Set([
  "isvLiveWebhook.ts",
  "isvLivePaymentGate.ts",
  "isvLiveCreate.ts",
  "isvLiveConfig.ts",
  "isvLiveAccess.ts",
]);
// Modules an approved module may pull in (Viva ISV only).
const APPROVED_TRANSITIVE = /^isv[A-Za-z0-9]*\.ts$/;

const FUNCS = "supabase/functions";
const INACTIVE = join(FUNCS, "_shared", "inactive");
const IMPORT_RE = /from\s+["']([^"']*inactive\/[^"']+|\.\/[^"']+)["']/g;

function inactiveImports(src: string, fromInactive: boolean): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (spec.includes("inactive/")) out.push(spec.split("inactive/")[1]);
    else if (fromInactive && spec.startsWith("./")) out.push(spec.slice(2));
  }
  return out;
}

/** Returns human-readable violations; empty array means the policy holds. */
export function inactiveImportViolations(): string[] {
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (p.includes("/inactive")) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) {
        for (const mod of inactiveImports(readFileSync(p, "utf8"), false)) {
          if (!APPROVED_ACTIVE_INACTIVE_IMPORTS.has(mod)) bad.push(`${p} -> ${mod}`);
        }
      }
    }
  };
  walk(FUNCS);
  const seen = new Set<string>();
  const queue = [...APPROVED_ACTIVE_INACTIVE_IMPORTS];
  while (queue.length) {
    const mod = queue.pop()!;
    if (seen.has(mod)) continue;
    seen.add(mod);
    const p = join(INACTIVE, mod);
    if (!existsSync(p)) { bad.push(`missing approved module ${mod}`); continue; }
    for (const dep of inactiveImports(readFileSync(p, "utf8"), true)) {
      if (dep.startsWith("../")) continue; // active shared code
      if (!APPROVED_TRANSITIVE.test(dep)) bad.push(`${mod} -> ${dep}`);
      else queue.push(dep);
    }
  }
  return bad;
}
