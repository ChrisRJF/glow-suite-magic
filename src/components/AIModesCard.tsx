import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AI_CATEGORY_LABELS, AI_MODE_LABELS,
  type AICategory, type AIMode,
  useAIModes,
} from "@/lib/aiModes";
import { useDemoMode } from "@/hooks/useDemoMode";

const MODES: AIMode[] = ["off", "suggestions", "autopilot"];

function Segmented({
  value, onChange, disabled,
}: { value: AIMode; onChange: (m: AIMode) => void; disabled?: boolean }) {
  return (
    <div
      role="radiogroup"
      className="inline-flex w-full sm:w-auto rounded-xl bg-muted/60 p-1 border border-border/60"
    >
      {MODES.map((m) => {
        const active = value === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(m)}
            className={cn(
              "flex-1 sm:flex-none px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all whitespace-nowrap min-h-[40px]",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {AI_MODE_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

export function AIModesCard() {
  const { modes, loading, saving, setGlobal, setCategory } = useAIModes();
  const { demoMode } = useDemoMode();
  const cats = Object.keys(AI_CATEGORY_LABELS) as AICategory[];

  return (
    <Card className="animate-fade-in border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="inline-flex w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </span>
              GlowSuite AI instellingen
            </CardTitle>
            <CardDescription className="mt-1">
              Kies of GlowSuite alleen adviseert of acties automatisch uitvoert.
            </CardDescription>
          </div>
          {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {demoMode && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            Demo: instellingen staan op <strong>Suggesties</strong> zodat je rustig kunt verkennen.
            In je live salon kun je per categorie kiezen.
          </p>
        )}

        <div className="rounded-2xl bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/15 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Algemene modus</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Geldt voor alles. Per categorie kun je verfijnen.
              </p>
            </div>
            <Segmented value={modes.global} onChange={setGlobal} disabled={loading} />
          </div>
        </div>

        <div className="space-y-2.5">
          {cats.map((c) => (
            <div
              key={c}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border/60 bg-card p-3.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{AI_CATEGORY_LABELS[c]}</p>
              </div>
              <Segmented
                value={modes.categories[c]}
                onChange={(m) => setCategory(c, m)}
                disabled={loading || modes.global === "off"}
              />
            </div>
          ))}
        </div>

        <ul className="text-xs text-muted-foreground space-y-1.5 pt-1">
          <li><strong className="text-foreground">Uit</strong> — geen suggesties of acties voor deze categorie.</li>
          <li><strong className="text-foreground">Suggesties</strong> — GlowSuite stelt voor, jij beslist.</li>
          <li><strong className="text-foreground">Automatisch uitvoeren</strong> — toegestane automatiseringen lopen zelf, met logging.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
