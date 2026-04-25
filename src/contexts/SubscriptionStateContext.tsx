import { createContext, useContext, ReactNode } from "react";
import { useMySubscription, trialDaysLeft, UserSubscription } from "@/hooks/useSubscription";

interface SubscriptionStateValue {
  sub: UserSubscription | null;
  loading: boolean;
  daysLeft: number | null;
  isReadOnly: boolean;
  isTrialing: boolean;
  isExpired: boolean;
  isActive: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SubscriptionStateValue | null>(null);

export function SubscriptionStateProvider({ children }: { children: ReactNode }) {
  const { sub, loading, refresh } = useMySubscription();
  const daysLeft = trialDaysLeft(sub);
  const status = sub?.status ?? null;
  const isActive = status === "active";
  const isTrialing = status === "trialing" && (daysLeft ?? 0) > 0;
  const trialEndPassed = sub
    ? new Date(sub.trial_ends_at).getTime() <= Date.now()
    : false;
  const isExpired =
    status === "expired" ||
    status === "canceled" ||
    (status === "trialing" && trialEndPassed);
  const isReadOnly = !!sub && !isActive && isExpired;

  return (
    <Ctx.Provider
      value={{ sub, loading, daysLeft, isReadOnly, isTrialing, isExpired, isActive, refresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSubscriptionState(): SubscriptionStateValue {
  const v = useContext(Ctx);
  if (!v) {
    return {
      sub: null,
      loading: true,
      daysLeft: null,
      isReadOnly: false,
      isTrialing: false,
      isExpired: false,
      isActive: false,
      refresh: async () => {},
    };
  }
  return v;
}
