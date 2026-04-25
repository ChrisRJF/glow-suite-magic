import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SubscriptionPlan {
  id: string;
  slug: string;
  name: string;
  price_eur: number;
  currency: string;
  description: string | null;
  features: string[];
  is_highlighted: boolean;
  requires_demo: boolean;
  sort_order: number;
}

export interface UserSubscription {
  id: string;
  user_id: string;
  plan_slug: string;
  status: string;
  trial_started_at: string;
  trial_ends_at: string;
  current_period_start: string | null;
  current_period_end: string | null;
  mollie_subscription_id: string | null;
  mollie_customer_id: string | null;
  mollie_mandate_id: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  past_due_since: string | null;
  payment_failure_email_sent_at: string | null;
  retry_attempted_at: string | null;
}

export function useSubscriptionPlans() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("subscription_plans" as any)
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (!cancelled) {
        if (!error && data) {
          setPlans(
            (data as any[]).map((p) => ({
              ...p,
              features: Array.isArray(p.features) ? p.features : [],
            })),
          );
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { plans, loading };
}

export function useMySubscription() {
  const [sub, setSub] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setSub(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("subscriptions" as any)
      .select("*")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    setSub((data as any) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  return { sub, loading, refresh };
}

export function trialDaysLeft(sub: UserSubscription | null): number | null {
  if (!sub || sub.status !== "trialing") return null;
  const ms = new Date(sub.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export async function startMollieCheckout(planSlug: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("saas-subscribe", {
    body: { plan_slug: planSlug },
  });
  if (error) throw error;
  if (!data?.checkout_url) throw new Error("Geen checkout-url ontvangen");
  return data.checkout_url as string;
}

export async function manageSubscription(
  action: "cancel" | "reactivate" | "change_plan",
  planSlug?: string,
): Promise<any> {
  const { data, error } = await supabase.functions.invoke(
    "saas-subscription-manage",
    { body: { action, plan_slug: planSlug } },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
