# Legacy salon-name links: activation plan (PREPARED, NOT APPLIED)

Editing `supabase/functions/public-booking/index.ts` deploys it immediately. Separate GO required.

## Server (public-booking/index.ts, getSalon)
Copy `publicSalonResolve.ts` next to index.ts, then replace the two queries:

```diff
-    .or(`public_slug.eq.${normalized},public_slug.eq.${slug}`)
-    .limit(1);
-  let settings = settingsRows?.[0];
-  if (!settings) {
-    const { data: fallbackRows } = await supabase.from("settings").select(COLS).limit(200);
-    settings = fallbackRows?.find((row: any) => slugify(row.salon_name || "") === normalized);
-  }
+    .or(`public_slug.eq.${normalized},public_slug.eq.${slug}`)
+    .limit(2);                                  // 2 = detect a (should-not-happen) duplicate
+  let hit = resolvePublicSalon(slug, settingsRows || []);
+  if (!hit && !(settingsRows || []).length) {
+    const { data: all, error: e2 } = await supabase.from("settings").select(COLS)
+      .not("public_slug", "is", null).limit(LEGACY_SCAN_LIMIT);
+    if (e2) throw e2;
+    hit = resolvePublicSalon(slug, all || []);
+  }
+  const settings = hit?.row;
```
Every later step already uses `ctx.settings` (tenant `user_id`, stored `public_slug` for the atomic RPC),
so get_availability, get_booking, lookup_customer and create_booking act on the resolved tenant only.
`safeSalonPayload` already returns `salon.slug = public_slug` (the canonical value).

## Frontend (src/pages/BookingPage.tsx, after get_salon succeeds)
```diff
+    const next = canonicalBookingPath(location.pathname, location.search, salonSlug, data.salon.slug);
+    if (next) navigate(next, { replace: true });
```
Until then the page keeps sending the legacy name; the server resolves it identically each call, so it is
safe but slower. Frontend publish is separate from the server deploy; server first.

## Behaviour change vs today
- Duplicate live names with no matching slug: today a random row, after: "not found".
- Demo rows are no longer reachable via a name link (still via their own slug).
- Links built from a former salon name: not resolvable today either (no name history exists).
  Keeping them needs a persistent alias table (migration + GO); not built.

## Read-only check before GO (counts only)
For the 4 salons whose slug differs from the derived name: count derived names that are unique among
non-demo rows. Those keep working; the rest (duplicate names) will show "not found" by name.
