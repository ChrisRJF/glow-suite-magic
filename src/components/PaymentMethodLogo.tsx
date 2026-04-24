import idealWeroLogo from "@/assets/payment-logos/ideal-wero.svg";
import bancontactLogo from "@/assets/payment-logos/bancontact.svg";
import visaLogo from "@/assets/payment-logos/visa.svg";
import mastercardLogo from "@/assets/payment-logos/mastercard.svg";
import { cn } from "@/lib/utils";

type PaymentMethodLogoProps = {
  method: string;
  className?: string;
};

export function PaymentMethodLogo({ method, className }: PaymentMethodLogoProps) {
  if (method === "ideal") {
    return <img src={idealWeroLogo} alt="iDEAL | Wero" className={cn("h-5 w-auto object-contain", className)} />;
  }

  if (method === "bancontact") {
    return <img src={bancontactLogo} alt="Bancontact" className={cn("h-5 w-auto object-contain", className)} />;
  }

  if (method === "creditcard") {
    return (
      <span className={cn("inline-flex h-5 items-center gap-1", className)} aria-label="Visa en Mastercard">
        <img src={visaLogo} alt="Visa" className="h-5 w-auto object-contain" />
        <img src={mastercardLogo} alt="Mastercard" className="h-5 w-auto object-contain" />
      </span>
    );
  }

  return null;
}