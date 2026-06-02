import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useLanguagePersistence } from "@/hooks/useLanguagePersistence";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useEnforceSalonLanguage } from "@/i18n/useEnforceSalonLanguage";
import { readSalonLanguageConfig } from "@/i18n/salonLanguageCache";

export default function PaymentSuccessPage() {
  useLanguagePersistence();
  const { t } = useTranslation();
  const { allowedLanguages, showSwitcher } = useEnforceSalonLanguage(readSalonLanguageConfig());
  const [params] = useSearchParams();
  const transactionId = params.get("t") || params.get("transaction_id");
  const orderCode = params.get("s") || params.get("order_code");
  const [state, setState] = useState<"checking" | "paid" | "pending" | "failed">(
    transactionId || orderCode ? "checking" : "pending",
  );

  useEffect(() => {
    if (!transactionId && !orderCode) return;
    let cancelled = false;
    const delays = [1500, 2500, 4000, 6000, 8000];
    let attempt = 0;
    const tick = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("verify-viva-payment", {
          body: { transaction_id: transactionId, order_code: orderCode },
        });
        if (cancelled) return;
        if (!error) {
          const status = (data as any)?.status;
          if (status === "paid") { setState("paid"); return; }
          if (status === "failed" || status === "cancelled") { setState("failed"); return; }
        }
      } catch { /* swallow */ }
      attempt += 1;
      if (cancelled) return;
      if (attempt < delays.length) {
        setTimeout(tick, delays[attempt]);
      } else {
        setState("pending");
      }
    };
    const t = setTimeout(tick, delays[0]);
    return () => { cancelled = true; clearTimeout(t); };
  }, [transactionId, orderCode]);

  return (
    <div className="min-h-screen flex flex-col bg-background px-4">
      <div className="w-full flex justify-end py-3"><LanguageSwitcher /></div>
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md w-full text-center space-y-5 p-8 rounded-2xl border border-border bg-card shadow-sm">
          <div className="mx-auto w-14 h-14 rounded-full bg-success/15 flex items-center justify-center">
            {state === "checking" ? <Loader2 className="w-7 h-7 text-success animate-spin" /> : <CheckCircle2 className="w-7 h-7 text-success" />}
          </div>
          <h1 className="text-xl font-semibold">
            {state === "paid" ? t("payment.confirmed") : state === "failed" ? t("payment.notCompleted") : t("payment.received")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {state === "checking"
              ? t("payment.checking")
              : state === "failed"
              ? t("payment.notCompletedText")
              : t("payment.processingBooking")}
          </p>
          <Link to="/" className="inline-block text-sm text-primary hover:underline">{t("common.backToGlowSuite")}</Link>
        </div>
      </div>
    </div>
  );
}
