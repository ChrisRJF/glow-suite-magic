import { Link } from "react-router-dom";
import { XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLanguagePersistence } from "@/hooks/useLanguagePersistence";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function PaymentFailedPage() {
  useLanguagePersistence();
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col bg-background px-4">
      <div className="w-full flex justify-end py-3"><LanguageSwitcher allowedLanguages={allowedLanguages} hidden={!showSwitcher} /></div>
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md w-full text-center space-y-5 p-8 rounded-2xl border border-border bg-card shadow-sm">
          <div className="mx-auto w-14 h-14 rounded-full bg-destructive/15 flex items-center justify-center">
            <XCircle className="w-7 h-7 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold">{t("payment.paymentFailed")}</h1>
          <p className="text-sm text-muted-foreground">{t("payment.paymentFailedText")}</p>
          <Link to="/" className="inline-block text-sm text-primary hover:underline">{t("common.backToGlowSuite")}</Link>
        </div>
      </div>
    </div>
  );
}
