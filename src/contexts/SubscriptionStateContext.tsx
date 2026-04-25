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
  isPastDue: boolean;
  pastDueDays: number | null;
  isCanceledScheduled: boolean;
  refresh: () => Promise<void>;
}

const PAST_DUE_GRACE_DAYS = 7;

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
  const isPastDue = status === "past_due";

  // Days since past_due began
  const pastDueDays =
    isPastDue && sub?.past_due_since
      ? Math.floor(
          (Date.now() - new Date(sub.past_due_since).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : isPastDue
        ? 0
        : null;

  // Read-only triggers:
  // - hard expired/canceled
  // - past_due longer than grace period
  const pastDueReadOnly =
    isPastDue && (pastDueDays ?? 0) >= PAST_DUE_GRACE_DAYS;
  const isReadOnly = !!sub && !isActive && (isExpired || pastDueReadOnly);

  const isCanceledScheduled =
    !!sub && sub.cancel_at_period_end === true && status !== "canceled";

  return (
    <Ctx.Provider
      value={{
        sub,
        loading,
        daysLeft,
        isReadOnly,
        isTrialing,
        isExpired,
        isActive,
        isPastDue,
        pastDueDays,
        isCanceledScheduled,
        refresh,
      }}
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
      isPastDue: false,
      pastDueDays: null,
      isCanceledScheduled: false,
      refresh: async () => {},
    };
  }
  return v;
}
