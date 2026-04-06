import { useMemo } from "react";

interface PaymentSettings {
  deposit_new_client?: boolean;
  deposit_percentage?: number;
  full_prepay_threshold?: number;
  skip_prepay_vip?: boolean;
  deposit_noshow_risk?: boolean;
  demo_mode?: boolean;
}

interface Customer {
  id: string;
  is_vip?: boolean;
  no_show_count?: number;
  cancellation_count?: number;
  total_spent?: number;
}

interface PaymentDecision {
  required: boolean;
  type: "none" | "deposit" | "full";
  amount: number;
  reason: string;
}

export function usePaymentRules(settings: PaymentSettings | null) {
  return useMemo(() => {
    const decide = (
      servicePrice: number,
      customer: Customer | null,
      isNewCustomer: boolean
    ): PaymentDecision => {
      const s = settings || {
        deposit_new_client: true,
        deposit_percentage: 50,
        full_prepay_threshold: 150,
        skip_prepay_vip: true,
        deposit_noshow_risk: true,
      };

      // VIP skip
      if (s.skip_prepay_vip && customer?.is_vip) {
        return { required: false, type: "none", amount: 0, reason: "VIP klant — geen betaling vereist" };
      }

      // Full prepayment for expensive services
      if (s.full_prepay_threshold && servicePrice >= s.full_prepay_threshold) {
        return { required: true, type: "full", amount: servicePrice, reason: `Volledige betaling vereist (boven €${s.full_prepay_threshold})` };
      }

      // No-show risk
      if (s.deposit_noshow_risk && customer && ((customer.no_show_count || 0) > 0 || (customer.cancellation_count || 0) >= 2)) {
        const depositAmount = Math.round(servicePrice * (s.deposit_percentage || 50) / 100 * 100) / 100;
        return { required: true, type: "deposit", amount: depositAmount, reason: "Aanbetaling vereist (no-show risico)" };
      }

      // New client
      if (s.deposit_new_client && isNewCustomer) {
        const depositAmount = Math.round(servicePrice * (s.deposit_percentage || 50) / 100 * 100) / 100;
        return { required: true, type: "deposit", amount: depositAmount, reason: "Aanbetaling vereist (nieuwe klant)" };
      }

      return { required: false, type: "none", amount: 0, reason: "Geen betaling vereist" };
    };

    return { decide };
  }, [settings]);
}
