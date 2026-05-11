import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

export default function PaymentSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-5 p-8 rounded-2xl border border-border bg-card shadow-sm">
        <div className="mx-auto w-14 h-14 rounded-full bg-success/15 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-success" />
        </div>
        <h1 className="text-xl font-semibold">Betaling ontvangen</h1>
        <p className="text-sm text-muted-foreground">
          We verwerken je afspraak. Je ontvangt zo een bevestiging per e-mail of WhatsApp.
        </p>
        <Link to="/" className="inline-block text-sm text-primary hover:underline">Terug naar GlowSuite</Link>
      </div>
    </div>
  );
}
