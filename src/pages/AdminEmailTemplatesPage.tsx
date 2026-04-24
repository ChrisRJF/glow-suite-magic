import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Link2, RefreshCw } from "lucide-react";

type TemplateKey = "booking_confirmation" | "payment_receipt" | "appointment_reminder" | "booking_cancellation" | "membership_notification" | "review_request";

type Salon = {
  user_id: string;
  salon_name: string | null;
  public_slug: string | null;
  appointment_reminder_schedule?: Array<{ label?: string; hours_before?: number; enabled?: boolean }> | null;
};

type Service = {
  id: string;
  name: string;
  duration_minutes: number;
  category: string | null;
};

type PreviewResult = {
  from: string;
  subject: string;
  preview: string;
  html: string;
  text: string;
};

type ReminderPreview = {
  service: Service;
  schedule: { label: string; hoursBefore: number };
  calendarUrl: string;
  buttonStyle: string;
  preview: PreviewResult;
};

const templates: Array<{ key: TemplateKey; label: string }> = [
  { key: "booking_confirmation", label: "Boekingsbevestiging" },
  { key: "payment_receipt", label: "Betaalbewijs" },
  { key: "appointment_reminder", label: "Afspraakherinnering" },
  { key: "booking_cancellation", label: "Annulering" },
  { key: "membership_notification", label: "Membership" },
  { key: "review_request", label: "Reviewverzoek" },
];

const sampleData: Record<TemplateKey, Record<string, unknown>> = {
  booking_confirmation: { customer_name: "Sophie de Vries", service_name: "Glow Facial", appointment_date: "2026-04-24T10:00:00+02:00", time: "10:00", employee: "Nora", reference: "GS-8F42A1C9", total_amount: 89 },
  payment_receipt: { amount: 89, method: "iDEAL", description: "Glow Facial", reference: "PAY-2048" },
  appointment_reminder: { customer_name: "Sophie de Vries", service_name: "Glow Facial", appointment_date: "2026-04-24T10:00:00+02:00", time: "10:00", employee: "Nora" },
  booking_cancellation: { service_name: "Glow Facial", appointment_date: "2026-04-24T10:00:00+02:00", time: "10:00", reference: "GS-8F42A1C9" },
  membership_notification: { membership_name: "Glow VIP", status: "Actief", credits: "2 behandelingen beschikbaar", next_payment_at: "2026-05-24", amount: 149 },
  review_request: { customer_name: "Sophie de Vries", review_url: "https://glowsuite.nl/review" },
};

const fallbackServices: Service[] = [
  { id: "glow-facial", name: "Glow Facial", duration_minutes: 60, category: "Facial" },
  { id: "lash-lift", name: "Lash Lift", duration_minutes: 45, category: "Lashes" },
  { id: "brow-styling", name: "Brow Styling", duration_minutes: 30, category: "Brows" },
];

const fallbackSchedules = [
  { label: "24 uur vooraf", hoursBefore: 24 },
  { label: "2 uur vooraf", hoursBefore: 2 },
];

const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "afspraak";

const extractCalendarButtonStyle = (html: string, calendarUrl: string) => {
  const escapedUrl = calendarUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<a[^>]+href="${escapedUrl}"[^>]+style="([^"]+)"`, "i"))?.[1] || "";
};

export default function AdminEmailTemplatesPage() {
  const [salons, setSalons] = useState<Salon[]>([]);
  const [services, setServices] = useState<Service[]>(fallbackServices);
  const [selectedSalonId, setSelectedSalonId] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>("booking_confirmation");
  const [recipientEmail, setRecipientEmail] = useState("preview@glowsuite.nl");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [reminderPreviews, setReminderPreviews] = useState<ReminderPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");

  const selectedSalon = useMemo(() => salons.find((salon) => salon.user_id === selectedSalonId) || null, [salons, selectedSalonId]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("settings")
        .select("user_id, salon_name, public_slug, appointment_reminder_schedule")
        .eq("is_demo", false)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) setError(error.message);
      const rows = (data || []) as Salon[];
      setSalons(rows);
      setSelectedSalonId((current) => current || rows[0]?.user_id || "");
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedSalonId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("services")
        .select("id, name, duration_minutes, category")
        .eq("user_id", selectedSalonId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (active) setServices(((data || []) as Service[]).length ? (data as Service[]) : fallbackServices);
    })();
    return () => { active = false; };
  }, [selectedSalonId]);

  const renderPreview = async () => {
    if (!selectedSalon) return;
    setRendering(true);
    setError("");
    const { data, error } = await supabase.functions.invoke("send-white-label-email", {
      body: {
        user_id: selectedSalon.user_id,
        salon_slug: selectedSalon.public_slug || selectedSalon.salon_name || "salon",
        salon_name: selectedSalon.salon_name || "Salon",
        recipient_email: recipientEmail,
        recipient_name: "Sophie de Vries",
        template_key: selectedTemplate,
        template_data: sampleData[selectedTemplate],
        preview_only: true,
        idempotency_key: `admin-preview-${selectedSalon.user_id}-${selectedTemplate}`,
      },
    });
    if (error) {
      setError(error.message);
      setPreview(null);
    } else {
      setPreview(data as PreviewResult);
    }
    setRendering(false);
  };

  useEffect(() => {
    if (selectedSalonId) renderPreview();
  }, [selectedSalonId, selectedTemplate]);

  return (
    <AppLayout title="Email templates" subtitle="Interne preview van white-label e-mails per salon">
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview instellingen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="salon">Salon</Label>
              <select id="salon" value={selectedSalonId} onChange={(event) => setSelectedSalonId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {loading ? <option>Laden...</option> : salons.map((salon) => <option key={salon.user_id} value={salon.user_id}>{salon.salon_name || "Salon"}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template">Template</Label>
              <select id="template" value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value as TemplateKey)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {templates.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipient">Voorbeeld ontvanger</Label>
              <Input id="recipient" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} onBlur={renderPreview} />
            </div>
            <Button className="w-full" variant="gradient" onClick={renderPreview} disabled={rendering || !selectedSalon}>
              <RefreshCw className={rendering ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Preview vernieuwen
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <div className="space-y-4 min-w-0">
          <Card>
            <CardContent className="p-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Afzender</p>
                <p className="text-sm font-medium break-all">{preview?.from || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Onderwerp</p>
                <p className="text-sm font-medium">{preview?.subject || "—"}</p>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="visual" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="visual">HTML preview</TabsTrigger>
              <TabsTrigger value="html">HTML output</TabsTrigger>
              <TabsTrigger value="text">Tekst output</TabsTrigger>
            </TabsList>
            <TabsContent value="visual" className="mt-4">
              <Card>
                <CardContent className="p-0 overflow-hidden">
                  <iframe title="Email template preview" srcDoc={preview?.html || ""} className="h-[620px] w-full bg-background" />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="html" className="mt-4">
              <Textarea value={preview?.html || ""} readOnly className="min-h-[620px] font-mono text-xs" />
            </TabsContent>
            <TabsContent value="text" className="mt-4">
              <Textarea value={preview?.text || ""} readOnly className="min-h-[360px] font-mono text-sm" />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}