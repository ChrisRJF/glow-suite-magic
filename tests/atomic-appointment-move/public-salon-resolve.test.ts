import { describe, it, expect } from "vitest";
import { resolvePublicSalon } from "../../docs/prepared-patches/atomic-appointment-move/public-slug/publicSalonResolve";
import { buildAtomicBookingArgs } from "../../docs/prepared-patches/atomic-appointment-move/publicBookingAtomic";

// Fictional salons only.
const A = { user_id: "u-a", salon_name: "Salon Zon", public_slug: "salon-zon", is_demo: false };
const B = { user_id: "u-b", salon_name: "Salon Zon", public_slug: "salon-zon-1a2b3c", is_demo: false };
const C = { user_id: "u-c", salon_name: "Studio Maan", public_slug: "maan-groningen", is_demo: false };
const D = { user_id: "u-d", salon_name: "Demo Ster", public_slug: null, is_demo: true };
const rows = [A, B, C, D];

describe("public salon resolution (prepared)", () => {
  it("stored slug wins, also for the suffixed duplicate", () => {
    expect(resolvePublicSalon("salon-zon", rows)).toMatchObject({ row: { user_id: "u-a" }, via: "slug" });
    expect(resolvePublicSalon("salon-zon-1a2b3c", rows)).toMatchObject({ row: { user_id: "u-b" }, via: "slug" });
    expect(resolvePublicSalon("Maan-Groningen", rows)).toMatchObject({ row: { user_id: "u-c" } });
  });
  it("legacy name link resolves only when unique, with canonical slug", () => {
    expect(resolvePublicSalon("studio-maan", rows)).toEqual({ row: C, via: "legacy_name", canonicalSlug: "maan-groningen" });
  });
  it("duplicate names without a matching slug: refused, never a random salon", () => {
    expect(resolvePublicSalon("salon-zon", [B, { ...A, public_slug: "zon-noord" }])).toBeNull();
  });
  it("no slug / demo row / empty request: refused", () => {
    expect(resolvePublicSalon("demo-ster", rows)).toBeNull();
    expect(resolvePublicSalon("", rows)).toBeNull();
    expect(resolvePublicSalon("onbekend", rows)).toBeNull();
  });
  it("resolved salon feeds the atomic booking with its stored slug (agenda link via employee UUID)", () => {
    const r = resolvePublicSalon("studio-maan", rows)!;
    const args = buildAtomicBookingArgs({
      slug: r.row.public_slug, date: "2026-11-02", notes: "", depositTag: null, customerId: "c0000000-0000-0000-0000-000000000001",
      paymentRequired: false, paymentAmount: 0, paymentType: "deposit", rebook: false,
      acceptedGlowsuiteTerms: true, acceptedSalonTerms: true, acceptedTermsAt: undefined, nowIso: "2026-10-15T19:00:00.000Z",
      rows: [{ name: "Test", time: "10:00", employee: "e0000000-0000-0000-0000-00000000000a", service: { id: "a0000000-0000-0000-0000-000000000060" } }],
    })!;
    expect(args._slug).toBe("maan-groningen");
    expect(args._lines[0].employee_id).toBe("e0000000-0000-0000-0000-00000000000a");
    expect(buildAtomicBookingArgs({ ...({} as any), slug: D.public_slug, rows: [] })).toBeNull();
  });
});
