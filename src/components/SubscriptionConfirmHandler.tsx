import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

const PLAN_LABEL: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  premium: "Premium",
};

const STORAGE_KEY = "gs_subscribed_toast_shown";

/**
 * Detecteert ?subscribed=1 in de URL na succesvolle Mollie checkout en toont
 * een toast met plan + ingangsdatum. Polled kort op 'active' status omdat
 * de webhook asynchroon is. Draait éénmalig per sessie.
 */
export function SubscriptionConfirmHandler() {
  const { user, bootstrapReady } = useAuth();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    if (!user || !bootstrapReady) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("subscribed") !== "1") return;

    // Voorkom dubbele toast bij re-mounts in dezelfde sessie
    if (sessionStorage.getItem(STORAGE_KEY) === "1") {
      cleanUrl();
      return;
    }

    ranRef.current = true;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12; // ~24s

    const fetchSub = async () => {
      const { data } = await supabase
        .from("subscriptions" as any)
        .select("plan_slug,status,current_period_start,current_period_end")
        .eq("user_id", user.id)
        .maybeSingle();
      return data as
        | {
            plan_slug: string;
            status: string;
            current_period_start: string | null;
            current_period_end: string | null;
          }
        | null;
    };

    const showSuccess = (sub: {
      plan_slug: string;
      current_period_start: string | null;
      current_period_end: string | null;
    }) => {
      const planName = PLAN_LABEL[sub.plan_slug] || sub.plan_slug;
      const start = sub.current_period_start
        ? new Date(sub.current_period_start)
        : new Date();
      const startStr = start.toLocaleDateString("nl-NL", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const nextStr = sub.current_period_end
        ? new Date(sub.current_period_end).toLocaleDateString("nl-NL", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : null;

      sessionStorage.setItem(STORAGE_KEY, "1");
      toast.success(`Abonnement actief — ${planName}`, {
        description: `Ingangsdatum: ${startStr}.${
          nextStr ? ` Volgende incasso: ${nextStr}.` : ""
        } Welkom bij GlowSuite!`,
        duration: 9000,
        icon: <CheckCircle2 className="w-4 h-4 text-success" />,
      });
    };

    const poll = async () => {
      if (cancelled) return;
      attempts += 1;
      const sub = await fetchSub();
      if (cancelled) return;

      if (sub && sub.status === "active") {
        showSuccess(sub);
        cleanUrl();
        return;
      }

      if (attempts >= maxAttempts) {
        // Webhook nog niet klaar — laat een vriendelijke fallback zien
        sessionStorage.setItem(STORAGE_KEY, "1");
        toast("Betaling ontvangen", {
          description:
            "We activeren je abonnement nu. Een moment, het verschijnt zo in je dashboard.",
          duration: 7000,
        });
        cleanUrl();
        return;
      }

      setTimeout(poll, 2000);
    };

    poll();

    return () => {
      cancelled = true;
    };
  }, [user, bootstrapReady]);

  return null;
}

function cleanUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("subscribed");
  url.searchParams.delete("email");
  window.history.replaceState({}, "", url.toString());
}
