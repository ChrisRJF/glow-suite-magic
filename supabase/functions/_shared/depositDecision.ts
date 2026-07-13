// Canonical server-side deposit decision.
// Frontend never gets to choose whether a deposit is required — this helper does.
import { calculateNoShowRisk } from "./noShowRisk.ts";

export interface DepositSettingsInput {
  deposit_new_client?: boolean | null;
  deposit_percentage?: number | null;
  full_prepay_threshold?: number | null;
  skip_prepay_vip?: boolean | null;
  deposit_noshow_risk?: boolean | null;
}

export interface DepositCustomerInput {
  id?: string | null;
  is_vip?: boolean | null;
  no_show_count?: number | null;
  cancellation_count?: number | null;
  total_visits?: number | null;
}

export type DepositType = "none" | "deposit" | "full";

export interface DepositDecision {
  required: boolean;
  type: DepositType;
  amount_cents: number;
  amount_euros: number;
  percentage: number;
  risk_score: number;
  risk_level: "laag" | "gemiddeld" | "hoog";
  reason: string;
}

/**
 * Decide whether a booking requires a deposit — ONE source of truth.
 * Inputs are the salon's settings, the customer (may be null for brand-new customers)
 * and the service price in euros. Never trust anything from the browser here.
 */
export function decideDeposit(params: {
  settings: DepositSettingsInput | null | undefined;
  customer: DepositCustomerInput | null | undefined;
  isNewCustomer: boolean;
  servicePriceEuros: number;
}): DepositDecision {
  const s = params.settings || {};
  const percentage = Math.max(0, Math.min(100, Number(s.deposit_percentage ?? 50)));
  const threshold = Number(s.full_prepay_threshold ?? 150);
  const skipVip = s.skip_prepay_vip ?? false;
  const useRisk = s.deposit_noshow_risk ?? true;
  const useNewClient = s.deposit_new_client ?? true;

  const price = Math.max(0, Number(params.servicePriceEuros) || 0);
  const risk = calculateNoShowRisk(params.customer || null);

  const build = (
    required: boolean,
    type: DepositType,
    amountEuros: number,
    reason: string,
  ): DepositDecision => {
    const cents = Math.round(amountEuros * 100);
    return {
      required,
      type,
      amount_cents: cents,
      amount_euros: cents / 100,
      percentage,
      risk_score: risk.score,
      risk_level: risk.level,
      reason,
    };
  };

  // VIP override
  if (skipVip && params.customer?.is_vip) {
    return build(false, "none", 0, "VIP klant — geen aanbetaling vereist");
  }

  // Full prepayment for expensive services
  if (threshold > 0 && price >= threshold) {
    return build(true, "full", price, `Volledige betaling vereist (boven €${threshold})`);
  }

  // No-show risk
  if (useRisk && risk.isElevated) {
    const deposit = Math.round((price * percentage) / 100 * 100) / 100;
    return build(true, "deposit", deposit, "Aanbetaling vereist (no-show risico)");
  }

  // New client
  if (useNewClient && params.isNewCustomer) {
    const deposit = Math.round((price * percentage) / 100 * 100) / 100;
    return build(true, "deposit", deposit, "Aanbetaling vereist (nieuwe klant)");
  }

  return build(false, "none", 0, "Geen aanbetaling vereist");
}
