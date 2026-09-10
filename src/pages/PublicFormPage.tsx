import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, FileText } from "lucide-react";
import { toast } from "sonner";

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "radio";

interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
}

interface FormData {
  completed: boolean;
  salon_name: string;
  customer_name?: string;
  title: string;
  require_signature?: boolean;
  schema?: { fields: FormField[]; intro?: string };
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height };
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        width={600}
        height={200}
        className="w-full h-40 rounded-xl border border-border bg-background touch-none"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = ref.current!.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext("2d")!;
          ctx.lineWidth = 2.5;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#111827";
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(ref.current!.toDataURL("image/png"));
        }}
        onPointerLeave={() => {
          if (drawing.current) {
            drawing.current = false;
            onChange(ref.current!.toDataURL("image/png"));
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          const canvas = ref.current!;
          canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
          onChange(null);
        }}
      >
        Opnieuw tekenen
      </Button>
    </div>
  );
}

export default function PublicFormPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<"loading" | "ready" | "done" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState<FormData | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [signerName, setSignerName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [showDrawing, setShowDrawing] = useState(false);
  const [signedAt, setSignedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("customer-forms", { body: { action: "get", token } });
      const res = data as (FormData & { error?: string }) | null;
      if (error || !res || res.error) {
        setState("error");
        setErrorMessage("Deze link is niet meer geldig. Vraag de salon om een nieuwe link.");
        return;
      }
      setForm(res);
      setSignerName(res.customer_name || "");
      setState(res.completed ? "done" : "ready");
    })();
  }, [token]);

  const submit = async () => {
    if (form?.require_signature) {
      if (signerName.trim().length < 2) {
        toast.error("Vul je volledige naam in.");
        return;
      }
      if (!consent) {
        toast.error("Zet een vinkje bij het akkoord om te ondertekenen.");
        return;
      }
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("customer-forms", {
      body: { action: "submit", token, answers, signer_name: signerName, signature_data: signature, consent },
    });
    setSubmitting(false);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) {
      toast.error("Niet alle verplichte velden zijn ingevuld.");
      return;
    }
    setSignedAt(new Date());
    setState("done");
  };

  if (state === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Laden...</div>;
  }

  if (state === "error") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-2">
          <h1 className="text-xl font-semibold text-foreground">Link niet geldig</h1>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
        </div>
      </main>
    );
  }

  if (state === "done") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
          <h1 className="text-xl font-semibold text-foreground">
            {form?.require_signature ? "Digitaal ondertekend" : "Bedankt, het formulier is ontvangen"}
          </h1>
          {form?.require_signature && signedAt && (
            <p className="text-sm text-foreground">
              {signedAt.toLocaleDateString("nl-NL", { dateStyle: "long" })} om{" "}
              {signedAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{form?.salon_name} heeft je antwoorden binnen.</p>
        </div>
      </main>
    );
  }

  const fields = form?.schema?.fields ?? [];

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-6">
        <header className="space-y-1 text-center">
          <FileText className="h-6 w-6 text-primary mx-auto" />
          <h1 className="text-xl font-semibold text-foreground">{form?.title}</h1>
          <p className="text-sm text-muted-foreground">{form?.salon_name}</p>
        </header>

        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          {form?.schema?.intro && (
            <p className="text-sm text-muted-foreground border-b border-border pb-4">{form.schema.intro}</p>
          )}
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              {f.type !== "checkbox" && (
                <Label htmlFor={f.key} className="text-sm">
                  {f.label}
                  {f.required && <span className="text-destructive"> *</span>}
                </Label>
              )}
              {f.type === "textarea" ? (
                <Textarea id={f.key} value={String(answers[f.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))} />
              ) : f.type === "select" ? (
                <select
                  id={f.key}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={String(answers[f.key] ?? "")}
                  onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                >
                  <option value="">Kies...</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : f.type === "radio" ? (
                <div className="flex flex-wrap gap-3">
                  {(f.options ?? []).map((o) => (
                    <label key={o} className="flex items-center gap-1.5 text-sm text-foreground">
                      <input type="radio" name={f.key} value={o} checked={answers[f.key] === o} onChange={() => setAnswers((a) => ({ ...a, [f.key]: o }))} />
                      {o}
                    </label>
                  ))}
                </div>
              ) : f.type === "checkbox" ? (
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={Boolean(answers[f.key])}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.checked }))}
                  />
                  <span>
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </span>
                </label>
              ) : (
                <Input
                  id={f.key}
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  value={String(answers[f.key] ?? "")}
                  onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}

          {form?.require_signature && (
            <div className="space-y-2 border-t border-border pt-4">
              <Label htmlFor="signer" className="text-sm">Naam ondertekenaar <span className="text-destructive">*</span></Label>
              <Input id="signer" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
              <Label className="text-sm">Handtekening <span className="text-destructive">*</span></Label>
              <SignaturePad onChange={setSignature} />
            </div>
          )}
        </div>

        <Button className="w-full" size="lg" disabled={submitting} onClick={submit}>
          {submitting ? "Versturen..." : "Versturen"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Je gegevens worden alleen gedeeld met {form?.salon_name}.</p>
      </div>
    </main>
  );
}
