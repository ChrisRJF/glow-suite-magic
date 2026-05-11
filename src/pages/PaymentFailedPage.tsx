import { Link } from "react-router-dom";
import { XCircle } from "lucide-react";

export default function PaymentFailedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-5 p-8 rounded-2xl border border-border bg-card shadow-sm">
        <div className="mx-auto w-14 h-14 rounded-full bg-destructive/15 flex items-center justify-center">
          <XCircle className="w-7 h-7 text-destructive" />
        </div>
        <h1 className="text-xl font-semibold">Betaling niet gelukt</h1>
        <p className="text-sm text-muted-foreground">
          De betaling is geannuleerd of niet voltooid. Je kunt het opnieuw proberen via je boekingslink.
        </p>
        <Link to="/" className="inline-block text-sm text-primary hover:underline">Terug naar GlowSuite</Link>
      </div>
    </div>
  );
}
