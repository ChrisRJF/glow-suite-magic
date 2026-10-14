// Pure helpers for the platform-owner dashboard. No data access here.
export type FinanceRow = {
  tenant_id: string;
  gross_cents: number | null;
  refund_cents: number | null;
  net_cents: number | null;
  expected_cents: number | null;
  confirmed_cents: number | null;
  reversed_cents: number | null;
  legacy_margin_cents: number | null;
  unconfirmed_count: number | null;
};

export type FinanceTotals = {
  grossCents: number;
  refundCents: number;
  netCents: number;
  expectedIsvCents: number;
  confirmedIsvCents: number;
  reversedIsvCents: number;
  legacyMarginCents: number;
  /** Confirmed ISV commission minus reversals. Expected commission is never included. */
  confirmedIncomeCents: number;
  unconfirmedCount: number;
};

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export function sumFinance(rows: FinanceRow[] | null | undefined): FinanceTotals {
  const t: FinanceTotals = {
    grossCents: 0, refundCents: 0, netCents: 0, expectedIsvCents: 0, confirmedIsvCents: 0,
    reversedIsvCents: 0, legacyMarginCents: 0, confirmedIncomeCents: 0, unconfirmedCount: 0,
  };
  for (const r of rows ?? []) {
    t.grossCents += n(r.gross_cents);
    t.refundCents += n(r.refund_cents);
    t.netCents += n(r.net_cents);
    t.expectedIsvCents += n(r.expected_cents);
    t.confirmedIsvCents += n(r.confirmed_cents);
    t.reversedIsvCents += n(r.reversed_cents);
    t.legacyMarginCents += n(r.legacy_margin_cents);
    t.unconfirmedCount += n(r.unconfirmed_count);
  }
  t.confirmedIncomeCents = t.confirmedIsvCents - t.reversedIsvCents;
  return t;
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "Niet beschikbaar";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function currentPeriod(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

export function lastPeriods(count: number, from = new Date()): string[] {
  const [y, m] = currentPeriod(from).split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

const STATUS_LABELS: Record<string, string> = {
  active: "Actief", trialing: "Proefperiode", expired: "Verlopen", pending: "In afwachting",
  past_due: "Achterstallig", canceled: "Opgezegd",
};
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "Geen abonnement";
  return STATUS_LABELS[status] ?? status;
}

export function platformErrorMessage(message: string | undefined): string {
  if (!message) return "Gegevens konden niet worden geladen.";
  if (message.includes("mfa_required")) return "Log in met je verificatiecode (MFA) om deze gegevens te zien.";
  if (message.includes("not_platform_owner")) return "Je hebt geen toegang tot het platformoverzicht.";
  return "Gegevens konden niet worden geladen.";
}
