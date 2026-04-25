import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { startMollieCheckout } from "@/hooks/useSubscription";
import { toast } from "@/hooks/use-toast";

/**
 * Detecteert ?checkout=1&plan=... in de URL na (eerste) login en start
 * automatisch de Mollie checkout. Draait éénmalig per sessie.
 */
export function CheckoutIntentHandler() {
  const { user, bootstrapReady } = useAuth();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    if (!user || !bootstrapReady) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "1") return;
    const plan = params.get("plan");
    if (!plan || !["starter", "growth", "premium"].includes(plan)) return;

    ranRef.current = true;
    (async () => {
      try {
        const url = await startMollieCheckout(plan);
        window.location.href = url;
      } catch (e: any) {
        toast({
          title: "Kon checkout niet starten",
          description: e?.message || "Probeer het opnieuw via Prijzen.",
          variant: "destructive",
        });
      }
    })();
  }, [user, bootstrapReady]);

  return null;
}
