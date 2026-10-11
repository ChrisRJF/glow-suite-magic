import { describe, expect, it } from "vitest";
import { senderLocalPart, slugify } from "../../supabase/functions/_shared/inactive/senderLocalPart";

// Copy of the live uniqueSalonSlug rule (send-white-label-email), for before/after comparison.
const RESERVED = new Set(["admin", "administrator", "abuse", "billing", "bookings", "contact", "hello", "help", "info", "mail", "noreply", "postmaster", "security", "support"]);
function live(a: { requested?: string; publicSlug?: string | null; salonName: string; userId: string }) {
  const stable = Boolean(a.requested || a.publicSlug);
  const base = slugify(a.requested || a.publicSlug || a.salonName);
  const safe = RESERVED.has(base) ? `salon${base}` : base;
  if (stable) return safe.slice(0, 60);
  return `${safe.slice(0, 48)}${a.userId.replace(/-/g, "").slice(0, 8)}`.slice(0, 60);
}

// Fictitious salons; filled = slug the backfill would write (suffix for name conflicts).
const salons = [
  { name: "Studio Fictief", id: "aaaaaaaa-1111-4111-8111-111111111111", filled: "studio-fictief" },
  { name: "Studio Fictief", id: "bbbbbbbb-2222-4222-8222-222222222222", filled: "studio-fictief-bbbbbb" },
  { name: "Salon Één & Co", id: "cccccccc-3333-4333-8333-333333333333", filled: "salon-een-co" },
  { name: "Info", id: "dddddddd-4444-4444-8444-444444444444", filled: "info" },
];
// How each sender builds salon_slug from settings today (empty slug) and after the fill.
type Caller = { name: string; slug: (p: string | null, n: string) => string | undefined; legacyNameId?: boolean };
const callers: Caller[] = [
  { name: "public-booking (bevestiging)", slug: (p, n) => p || slugify(n) },
  { name: "mollie-webhook (betaal)", slug: (p, n) => p || slugify(n) },
  { name: "viva-webhook (betaal)", slug: (p, n) => p || slugify(n) },
  { name: "public-memberships", slug: (p, n) => p || slugify(n) },
  { name: "automation-scheduler (herinnering/review)", slug: (p, n) => slugify(p || n) },
  { name: "sendAppointmentReminder", slug: (_p, n) => slugify(n) },
  { name: "whatsapp-reminder-scheduler (herinnering)", slug: (p) => p || undefined, legacyNameId: true },
  { name: "auto-rebook-send (herboek)", slug: (p) => p || undefined, legacyNameId: true },
  { name: "autoRebookPass (herboek)", slug: (p) => p || undefined, legacyNameId: true },
];

describe("sender From stays identical before and after public_slug fill (fictief)", () => {
  for (const c of callers) for (const s of salons) {
    it(`${c.name} / ${s.name} ${s.id.slice(0, 2)}`, () => {
      const today = live({ requested: c.slug(null, s.name), publicSlug: null, salonName: s.name, userId: s.id });
      const after = senderLocalPart({ requested: c.slug(s.filled, s.name), publicSlug: s.filled, salonName: s.name, userId: s.id, legacyNameId: c.legacyNameId });
      const edited = senderLocalPart({ requested: c.slug("later-gewijzigd", s.name), publicSlug: "later-gewijzigd", salonName: s.name, userId: s.id, legacyNameId: c.legacyNameId });
      expect(after).toBe(today);
      expect(edited).toBe(today);
    });
  }
  it("live rule alone (or old patch) would change reminder/rebook From after fill", () => {
    const s = salons[0];
    const today = live({ requested: undefined, publicSlug: null, salonName: s.name, userId: s.id });
    expect(live({ requested: s.filled, publicSlug: s.filled, salonName: s.name, userId: s.id })).not.toBe(today);
    // old patch-sender-stable.diff: still uses requested, so same change
    expect(slugify(s.filled)).not.toBe(today);
  });
  it("live rule changes suffixed duplicate salon's payment From after fill", () => {
    const s = salons[1];
    expect(live({ requested: s.filled, publicSlug: s.filled, salonName: s.name, userId: s.id }))
      .not.toBe(live({ requested: slugify(s.name), publicSlug: null, salonName: s.name, userId: s.id }));
  });
  it("explicit different caller slug still respected", () => {
    expect(senderLocalPart({ requested: "andere-naam", publicSlug: "studio-fictief", salonName: "Studio Fictief", userId: salons[0].id })).toBe("anderenaam");
  });
});
