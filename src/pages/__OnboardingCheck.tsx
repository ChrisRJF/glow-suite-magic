// TIJDELIJK: alleen voor lokale visuele controle van de wizard-bovenbalk. Verwijderen na controle.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OnboardingWizard } from "@/components/OnboardingWizard";

export default function OnboardingCheckPage() {
  const [params] = useSearchParams();
  const preview = params.get("mode") === "preview";
  const [open, setOpen] = useState(true);
  return (
    <div className="min-h-screen bg-background">
      <OnboardingWizard open={open} onOpenChange={setOpen} previewMode={preview} />
      {!open && <button onClick={() => setOpen(true)}>heropen</button>}
    </div>
  );
}
