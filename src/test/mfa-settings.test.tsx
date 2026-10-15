import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { canOfferRemoval, verifiedTotpFactors } from "@/lib/mfaFactors";

const mfa = {
  listFactors: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  unenroll: vi.fn(),
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { mfa, refreshSession: vi.fn() } },
}));
let platform = { loading: false, owner: false, aal2: true };
vi.mock("@/hooks/usePlatformAccess", () => ({ usePlatformAccess: () => platform }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MfaSettingsCard } from "@/components/MfaSettingsCard";

const v = (id: string) => ({ id, status: "verified", factor_type: "totp" });
const u = (id: string) => ({ id, status: "unverified", factor_type: "totp" });

function setFactors(all: any[]) {
  mfa.listFactors.mockResolvedValue({ data: { all, totp: all.filter((f) => f.status === "verified") } });
}

beforeEach(() => {
  Object.values(mfa).forEach((f) => f.mockReset());
  mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2" } });
  mfa.unenroll.mockResolvedValue({ error: null });
  platform = { loading: false, owner: false, aal2: true };
});

describe("mfa factor rules", () => {
  it("counts only verified TOTP factors", () => {
    expect(verifiedTotpFactors([v("a"), u("b"), { id: "c", status: "verified", factor_type: "phone" }]).map((f) => f.id)).toEqual(["a"]);
  });
  it("owner cannot remove final factor", () => {
    expect(canOfferRemoval({ verifiedCount: 1, ownerStatus: "owner", aal2: true })).toBe(false);
  });
  it("unknown owner status is treated as owner", () => {
    expect(canOfferRemoval({ verifiedCount: 1, ownerStatus: "unknown", aal2: true })).toBe(false);
  });
  it("owner with two factors may remove one", () => {
    expect(canOfferRemoval({ verifiedCount: 2, ownerStatus: "owner", aal2: true })).toBe(true);
  });
  it("non-owner may remove final factor at aal2", () => {
    expect(canOfferRemoval({ verifiedCount: 1, ownerStatus: "not_owner", aal2: true })).toBe(true);
  });
  it("no removal without aal2", () => {
    expect(canOfferRemoval({ verifiedCount: 2, ownerStatus: "not_owner", aal2: false })).toBe(false);
  });
});

describe("MfaSettingsCard", () => {
  it("first enrollment still works and shows no secret", async () => {
    setFactors([]);
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1" } });
    mfa.enroll.mockResolvedValue({ data: { id: "new", totp: { qr_code: "data:qr", secret: "SECRETXYZ" } }, error: null });
    render(<MfaSettingsCard />);
    fireEvent.click(await screen.findByRole("button", { name: /Activeren/ }));
    await screen.findByAltText(/QR-code/);
    expect(screen.queryByText(/SECRETXYZ/)).toBeNull();
  });

  it("adds a second factor without removing the verified one; counts only after verification", async () => {
    platform = { loading: false, owner: true, aal2: true };
    setFactors([v("f1"), u("stale")]);
    mfa.enroll.mockResolvedValue({ data: { id: "f2", totp: { qr_code: "data:qr", secret: "S" } }, error: null });
    render(<MfaSettingsCard />);
    expect((await screen.findByTestId("mfa-count")).textContent).toContain("1 authenticator");
    fireEvent.click(screen.getByRole("button", { name: /Extra authenticator toevoegen/ }));
    await screen.findByAltText(/QR-code/);
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "stale" });
    expect(mfa.unenroll).not.toHaveBeenCalledWith({ factorId: "f1" });
    expect(screen.getByTestId("mfa-count").textContent).toContain("1 authenticator");

    mfa.challengeAndVerify.mockResolvedValue({ error: null });
    setFactors([v("f1"), v("f2")]);
    fireEvent.change(screen.getByLabelText("Verificatiecode"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Bevestigen/ }));
    await waitFor(() => expect(screen.getByTestId("mfa-count").textContent).toContain("2 authenticators"));
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f2", code: "123456" });
  });

  it("failed verification does not activate the new factor", async () => {
    setFactors([v("f1")]);
    mfa.enroll.mockResolvedValue({ data: { id: "f2", totp: { qr_code: "data:qr", secret: "S" } }, error: null });
    mfa.challengeAndVerify.mockResolvedValue({ error: new Error("bad") });
    render(<MfaSettingsCard />);
    fireEvent.click(await screen.findByRole("button", { name: /Extra authenticator toevoegen/ }));
    await screen.findByAltText(/QR-code/);
    fireEvent.change(screen.getByLabelText("Verificatiecode"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Bevestigen/ }));
    await waitFor(() => expect(mfa.challengeAndVerify).toHaveBeenCalled());
    expect(screen.getByTestId("mfa-count").textContent).toContain("1 authenticator");
    expect(screen.getByAltText(/QR-code/)).toBeTruthy();
  });

  it("platform owner with one factor sees no remove button", async () => {
    platform = { loading: false, owner: true, aal2: true };
    setFactors([v("f1")]);
    render(<MfaSettingsCard />);
    await screen.findByTestId("mfa-owner-note");
    expect(screen.queryByRole("button", { name: "Verwijderen" })).toBeNull();
  });

  it("platform owner with two factors can remove one", async () => {
    platform = { loading: false, owner: true, aal2: true };
    setFactors([v("f1"), v("f2")]);
    render(<MfaSettingsCard />);
    await screen.findByTestId("mfa-count");
    expect(screen.getAllByRole("button", { name: "Verwijderen" })).toHaveLength(2);
  });

  it("non-owner keeps the option to remove their only factor", async () => {
    setFactors([v("f1")]);
    render(<MfaSettingsCard />);
    await screen.findByTestId("mfa-count");
    expect(screen.getByRole("button", { name: "Verwijderen" })).toBeTruthy();
    expect(screen.queryByTestId("mfa-owner-note")).toBeNull();
  });
});
