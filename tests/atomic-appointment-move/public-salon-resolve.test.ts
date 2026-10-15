import { describe, it, expect } from "vitest";
import { resolvePublicSalon, canonicalBookingPath, LEGACY_SCAN_LIMIT } from "../../docs/prepared-patches/atomic-appointment-move/public-slug/publicSalonResolve";
import { buildAtomicBookingArgs } from "../../docs/prepared-patches/atomic-appointment-move/publicBookingAtomic";

// Fictional salons only.
const A = { user_id: "u-a", salon_name: "Salon Zon", public_slug: "salon-zon", is_demo: false };
const B = { user_id: "u-b", salon_name: "Salon Zon", public_slug: "salon-zon-1a2b3c", is_demo: false };
const C = { user_id: "u-c", salon_name: "Studio Maan", public_slug: "maan-groningen", is_demo: false };
const D = { user_id: "u-d", salon_name: "Demo Ster", public_slug: null, is_demo: true };
const E = { user_id: "u-e", salon_name: "Kapsalon Wolk", public_slug: "wolk-live", is_demo: false };
const F = { user_id: "u-f", salon_name: "Kapsalon Wolk", public_slug: "wolk-demo", is_demo: true };
const G = { user_id: "u-g", salon_name: "Nagelstudio Regen", public_slug: "gx7k2p", is_demo: false };
const H = { user_id: "u-h", salon_name: "Salon Zonder Link", public_slug: null, is_demo: false };
const rows = [A, B, C, D, E, F, G, H];

const args = (slug: string | null) => buildAtomicBookingArgs({
  slug, date: "2026-11-02", notes: "", depositTag: null, customerId: "c0000000-0000-0000-0000-000000000001",
  paymentRequired: false, paymentAmount: 0, paymentType: "deposit", rebook: false,
  acceptedGlowsuiteTerms: true, acceptedSalonTerms: true, acceptedTermsAt: undefined, nowIso: "2026-10-15T19:00:00.000Z",
  rows: [{ name: "Test", time: "10:00", employee: "e0000000-0000-0000-0000-00000000000a", service: { id: "a0000000-0000-0000-0000-000000000060" } }],
});

describe("public salon resolution (prepared)", () => {
  it("canonical slug wins, also for the suffixed duplicate", () => {
    expect(resolvePublicSalon("salon-zon", rows)).toMatchObject({ row: { user_id: "u-a" }, via: "slug" });
    expect(resolvePublicSalon("salon-zon-1a2b3c", rows)).toMatchObject({ row: { user_id: "u-b" }, via: "slug" });
    expect(resolvePublicSalon("Maan-Groningen", rows)).toMatchObject({ row: { user_id: "u-c" }, via: "slug" });
  });
  it("short-code slug resolves by slug (case-insensitive)", () => {
    expect(resolvePublicSalon("GX7K2P", rows)).toMatchObject({ row: { user_id: "u-g" }, via: "slug", canonicalSlug: "gx7k2p" });
  });
  it("unique legacy name with a different slug resolves, with canonical slug", () => {
    expect(resolvePublicSalon("studio-maan", rows)).toEqual({ row: C, via: "legacy_name", canonicalSlug: "maan-groningen" });
    expect(resolvePublicSalon("nagelstudio-regen", rows)).toMatchObject({ row: { user_id: "u-g" }, canonicalSlug: "gx7k2p" });
  });
  it("duplicate live names without a matching slug: refused", () => {
    expect(resolvePublicSalon("salon-zon", [B, { ...A, public_slug: "zon-noord" }])).toBeNull();
  });
  it("duplicate name across demo and live: only the live salon, demo never selected", () => {
    expect(resolvePublicSalon("kapsalon-wolk", rows)).toMatchObject({ row: { user_id: "u-e" }, canonicalSlug: "wolk-live" });
    expect(resolvePublicSalon("kapsalon-wolk", [F])).toBeNull();
  });
  it("missing slug / demo without slug / empty / unknown: refused", () => {
    expect(resolvePublicSalon("salon-zonder-link", rows)).toBeNull();
    expect(resolvePublicSalon("demo-ster", rows)).toBeNull();
    expect(resolvePublicSalon("", rows)).toBeNull();
    expect(resolvePublicSalon("onbekend", rows)).toBeNull();
  });
  it("possibly truncated row list: legacy name refused, slug still works", () => {
    const many = [C, ...Array.from({ length: LEGACY_SCAN_LIMIT }, (_, i) => ({ user_id: `x${i}`, salon_name: `X ${i}`, public_slug: `x-${i}`, is_demo: false }))];
    expect(resolvePublicSalon("studio-maan", many)).toBeNull();
    expect(resolvePublicSalon("maan-groningen", many)).toMatchObject({ row: { user_id: "u-c" } });
  });
});

describe("downstream uses the canonical slug", () => {
  it("availability/create: a legacy link and its canonical slug resolve to the same tenant", () => {
    const viaName = resolvePublicSalon("studio-maan", rows)!;
    const viaSlug = resolvePublicSalon(viaName.canonicalSlug, rows)!;
    expect(viaSlug.row.user_id).toBe(viaName.row.user_id);
    const a = args(viaName.row.public_slug)!;
    expect(a._slug).toBe("maan-groningen");
    expect(a._lines[0].employee_id).toBe("e0000000-0000-0000-0000-00000000000a");
  });
  it("no stored slug never reaches the atomic booking (safe error)", () => {
    expect(args(H.public_slug)).toBeNull();
  });
  it("frontend handoff replaces only the salon segment and keeps the query", () => {
    expect(canonicalBookingPath("/boeken/studio-maan", "?rb=abc", "studio-maan", "maan-groningen")).toBe("/boeken/maan-groningen?rb=abc");
    expect(canonicalBookingPath("/boeken/studio-maan/afspraak/tok1", "", "studio-maan", "maan-groningen")).toBe("/boeken/maan-groningen/afspraak/tok1");
    expect(canonicalBookingPath("/boeken/maan-groningen", "", "maan-groningen", "maan-groningen")).toBeNull();
    expect(canonicalBookingPath("/boeken/x", "", "x", null)).toBeNull();
    expect(canonicalBookingPath("/boeken/x", "", "x", "../evil")).toBeNull();
  });
});
