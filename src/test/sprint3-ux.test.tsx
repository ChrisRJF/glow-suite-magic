import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { canAccessRoute, ROUTE_PERMISSIONS } from "@/hooks/useUserRole";

const mock = vi.hoisted(() => ({
  roles: ["eigenaar"], count: 0 as number | null, fail: false,
  writes: [] as string[], reads: [] as string[], insert: vi.fn(async () => ({ id: "synthetic-service" })),
  invoke: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "synthetic", email: "test@example.invalid" }, signOut: vi.fn() }) }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));
vi.mock("@/hooks/useDemoMode", () => ({ useDemoMode: () => ({ demoMode: false }) }));
vi.mock("@/hooks/useCrud", () => ({ useCrud: () => ({ insert: mock.insert }) }));
vi.mock("@/hooks/useUserRole", async importOriginal => ({
  ...await importOriginal<typeof import("@/hooks/useUserRole")>(),
  useUserRole: () => ({ roles: mock.roles, isOwner: mock.roles.includes("eigenaar") }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    let write = false;
    const q: any = {
      select: () => { mock.reads.push(table); return q; }, update: () => { write = true; mock.writes.push(table); return q; },
      eq: () => q, limit: () => q, order: () => q,
      maybeSingle: () => Promise.resolve({ data: table === "settings" ? { id: "synthetic-settings" } : null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: [], count: mock.count, error: mock.fail && (write || table === "services") ? new Error("offline") : null }).then(resolve),
    };
    return q;
  }, functions: { invoke: mock.invoke }, storage: { from: vi.fn(() => { throw new Error("Storage writes forbidden in preview"); }) },
} }));

const draftKey = "glowsuite_onboarding_v3_synthetic";
function wizard(preview = false, callbacks = {}) {
  return render(<MemoryRouter><OnboardingWizard open onOpenChange={vi.fn()} previewMode={preview} {...callbacks} /></MemoryRouter>);
}
function salonDraft(preview = false, extra = {}) {
  localStorage.setItem(preview ? "glowsuite_onboarding_v3_preview_synthetic" : draftKey,
    JSON.stringify({ step: 1, salonType: "kapper", salonName: "Fictieve salon", ...extra }));
}
beforeEach(() => { localStorage.clear(); mock.roles = ["eigenaar"]; mock.count = 0; mock.fail = false; mock.writes = []; mock.reads = []; vi.clearAllMocks(); });
afterEach(cleanup);

describe("Sprint 3 menu", () => {
  it("toont Dagelijks eerst en alleen deze standaard open", () => {
    render(<MemoryRouter><AppSidebar /></MemoryRouter>);
    const controls = screen.getAllByRole("button").filter(b => b.hasAttribute("aria-expanded"));
    expect(controls.map(b => b.textContent)).toEqual(["Dagelijks", "Groei", "Verkoop", "Geldzaken", "Slimme functies", "Beheer"]);
    expect(controls.map(b => b.getAttribute("aria-expanded"))).toEqual(["true", "false", "false", "false", "false", "false"]);
  });
  it.each(["/ai", "/ai#insights", "/ai#activity"])("opent actieve AI-route %s en migreert oude defaults", path => {
    localStorage.setItem("glowsuite:sidebar:open-groups", JSON.stringify({ "AI Systemen": true, Operatie: true, Commerce: true }));
    render(<MemoryRouter initialEntries={[path]}><AppSidebar /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Slimme functies" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Verkoop" })).toHaveAttribute("aria-expanded", "true");
    for (const href of ["/ai", "/ai#insights", "/ai#activity"]) expect(document.querySelectorAll(`nav a[href='${href}']`)).toHaveLength(1);
  });
  it("laat de oude AI-default niet herleven buiten een AI-route", () => {
    localStorage.setItem("glowsuite:sidebar:open-groups", JSON.stringify({ "AI Systemen": true }));
    render(<MemoryRouter><AppSidebar /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Slimme functies" })).toHaveAttribute("aria-expanded", "false");
  });
  it.each(["eigenaar", "admin", "medewerker"])("behoudt elk toegestaan menu-item eenmaal voor %s", role => {
    mock.roles = [role]; render(<MemoryRouter><AppSidebar /></MemoryRouter>);
    screen.getAllByRole("button").filter(b => b.getAttribute("aria-expanded") === "false").forEach(b => fireEvent.click(b));
    const links = Array.from(document.querySelectorAll("nav a"));
    const paths = links.map(a => a.getAttribute("href"));
    expect(new Set(paths).size).toBe(paths.length);
    const menuPaths = Object.keys(ROUTE_PERMISSIONS).filter(p => !["/dashboard", "/automations", "/mijn-abonnement"].includes(p));
    for (const path of [...menuPaths, "/ai#insights", "/ai#activity"]) {
      const allowed = canAccessRoute(path.split("#")[0], [role as any]) && (path !== "/eigenaar" || role === "eigenaar");
      expect(paths.filter(p => p === path).length, path).toBe(allowed ? 1 : 0);
    }
  });
  it("respecteert nieuw opgeslagen keuzes", () => {
    localStorage.setItem("glowsuite:sidebar:open-groups:v2", JSON.stringify({ Groei: true, "Slimme functies": true, Verkoop: false }));
    render(<MemoryRouter><AppSidebar /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Groei" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Verkoop" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Sprint 3 snelle start", () => {
  it("vereist naam en type voordat gestart kan worden", () => {
    salonDraft(false, { salonName: " " }); wizard();
    expect(screen.getByRole("button", { name: "Start met GlowSuite" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Hoe heet jouw salon?"), { target: { value: "Fictief" } });
    expect(screen.getByRole("button", { name: "Start met GlowSuite" })).toBeEnabled();
  });
  it("bewaart salon eenmaal, seedt lege salon en toont PostWelcome zonder extra diensten aan te roepen", async () => {
    salonDraft(); wizard(); const start = screen.getByRole("button", { name: "Start met GlowSuite" });
    fireEvent.click(start); fireEvent.click(start);
    await screen.findByRole("button", { name: /Eerste afspraak maken/ });
    expect(mock.writes).toEqual(["profiles", "settings"]);
    expect(mock.insert).toHaveBeenCalledTimes(4);
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(mock.reads).not.toContain("viva_terminals");
    expect(localStorage.getItem("glowsuite_onboarding_v4_synthetic")).toBe("done");
    expect(localStorage.getItem("glowsuite_onboarding_synthetic")).toBe("done");
    expect(localStorage.getItem(draftKey)).toBeNull();
    expect(localStorage.getItem("glowsuite_automations_synthetic")).toBeNull();
  });
  it("seedt geen behandelingen als er al behandelingen zijn", async () => {
    mock.count = 3; salonDraft(); wizard(); fireEvent.click(screen.getByRole("button", { name: "Start met GlowSuite" }));
    await screen.findByRole("button", { name: /Eerste afspraak maken/ }); expect(mock.insert).not.toHaveBeenCalled();
  });
  it("preview verandert geen DB of completionflags, ook bij logo", async () => {
    salonDraft(true); const close = vi.fn(); wizard(true, { onOpenChange: close });
    const original = URL.createObjectURL; URL.createObjectURL = vi.fn(() => "blob:synthetic");
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(["fake"], "fake.png")] } });
    fireEvent.click(screen.getByRole("button", { name: "Start met GlowSuite" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mock.writes).toEqual([]); expect(mock.insert).not.toHaveBeenCalled();
    expect(localStorage.getItem("glowsuite_onboarding_v4_synthetic")).toBeNull(); URL.createObjectURL = original;
  });
  it("houdt bestaande volledige stappen inclusief terugknop bereikbaar", async () => {
    salonDraft(); wizard(); fireEvent.click(screen.getByRole("button", { name: "Meer instellen" }));
    await screen.findByRole("heading", { name: "Betalingen instellen (optioneel)" });
    fireEvent.click(screen.getByRole("button", { name: "Terug", exact: true }));
    expect(screen.getByLabelText("Hoe heet jouw salon?")).toHaveValue("Fictieve salon");
    fireEvent.click(screen.getByRole("button", { name: "Meer instellen" }));
    await screen.findByRole("heading", { name: "Betalingen instellen (optioneel)" });
    fireEvent.click(screen.getByRole("button", { name: "Volgende" }));
    await screen.findByRole("button", { name: "Ik heb al een terminal" });
    fireEvent.click(screen.getByRole("button", { name: "Volgende" }));
    await screen.findByRole("heading", { name: "Systeemcontrole" });
    fireEvent.click(screen.getByRole("button", { name: "Volgende" }));
    await screen.findByRole("heading", { name: "Slimme automatiseringen" });
    fireEvent.click(screen.getByRole("button", { name: "Volgende" }));
    await screen.findByRole("heading", { name: /Je salon is klaar/ });
    fireEvent.click(screen.getByRole("button", { name: "Start met GlowSuite" }));
    await screen.findByRole("button", { name: /Eerste afspraak maken/ });
    expect(localStorage.getItem("glowsuite_automations_synthetic")).not.toBeNull();
  });
  it("blijft bij fouten op Salon zonder afronding en kan herstellen", async () => {
    mock.fail = true; salonDraft(); wizard(); fireEvent.click(screen.getByRole("button", { name: "Start met GlowSuite" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start met GlowSuite" })).toBeEnabled());
    expect(localStorage.getItem("glowsuite_onboarding_v4_synthetic")).toBeNull();
    mock.fail = false; fireEvent.click(screen.getByRole("button", { name: "Start met GlowSuite" }));
    await screen.findByRole("button", { name: /Eerste afspraak maken/ });
  });
  it("onzekere service count blokkeert seeding en afronding", async () => {
    mock.count = null; salonDraft(); wizard(); fireEvent.click(screen.getByRole("button", { name: "Start met GlowSuite" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start met GlowSuite" })).toBeEnabled());
    expect(mock.insert).not.toHaveBeenCalled(); expect(localStorage.getItem("glowsuite_onboarding_v4_synthetic")).toBeNull();
  });
  it("skip behoudt voortgang voor hervatten via instellingen", async () => {
    salonDraft(false, { step: 2 }); const close = vi.fn(); const first = wizard(false, { onOpenChange: close });
    fireEvent.click(screen.getByRole("button", { name: "Nu sluiten" }));
    expect(close).toHaveBeenCalledWith(false);
    expect(localStorage.getItem("glowsuite_onboarding_v4_synthetic")).toBe("skipped"); first.unmount(); wizard();
    await screen.findByRole("heading", { name: "Betalingen instellen (optioneel)" });
    expect(JSON.parse(localStorage.getItem(draftKey) || "{}").step).toBe(2);
  });
});