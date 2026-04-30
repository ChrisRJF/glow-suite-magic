import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useWaitlist, useCustomers, useServices } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { Clock, Plus, UserPlus, CalendarPlus, Send, Trash2, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_WHATSAPP_TEMPLATES, renderTemplate } from "@/lib/whatsappTemplates";

const MEDEWERKERS = ["Bas", "Roos", "Lisa", "Emma"];
const FLEX_OPTIONS = ["flexibel", "alleen ochtend", "alleen middag", "specifieke dag"];

type OfferTarget = {
  entry: any;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
};

export default function WachtlijstPage() {
  const { user } = useAuth();
  const { data: waitlist, refetch } = useWaitlist();
  const { data: customers } = useCustomers();
  const { data: services } = useServices();
  const { insert, update, remove } = useCrud("waitlist_entries");
  const { insert: insertAppt } = useCrud("appointments");
  const [searchParams, setSearchParams] = useSearchParams();

  const [showForm, setShowForm] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [offer, setOffer] = useState<OfferTarget | null>(null);
  const [offerSending, setOfferSending] = useState(false);
  const [offerMessage, setOfferMessage] = useState("");
  const [form, setForm] = useState({
    customer_id: "", service_id: "", preferred_employee: "",
    preferred_day: "", preferred_time: "", flexibility: "flexibel", notes: "",
  });

  // Slot suggestion mode (deep link from calendar after cancel/no-show)
  const slotParam = searchParams.get("slot"); // ISO datetime
  const slotServiceId = searchParams.get("service_id");
  const suggestionSlot = useMemo(() => {
    if (!slotParam) return null;
    const d = new Date(slotParam);
    if (isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}`, raw: slotParam };
  }, [slotParam]);

  const matchingEntries = useMemo(() => {
    if (!suggestionSlot) return [] as any[];
    const wachtend = waitlist.filter((w: any) => w.status === "wachtend");
    if (slotServiceId) {
      const byService = wachtend.filter((w: any) => !w.service_id || w.service_id === slotServiceId);
      if (byService.length) return byService;
    }
    return wachtend;
  }, [waitlist, suggestionSlot, slotServiceId]);

  const clearSuggestion = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("slot");
    next.delete("service_id");
    setSearchParams(next, { replace: true });
  };

  const handleAdd = async () => {
    if (addLoading) return;
    if (!form.customer_id) { toast.error("Kies een klant"); return; }
    if (!form.service_id) { toast.error("Kies een behandeling"); return; }
    setAddLoading(true);
    try {
      await insert({ ...form, status: "wachtend" });
      toast.success("Klant toegevoegd aan wachtlijst");
      setShowForm(false);
      setForm({ customer_id: "", service_id: "", preferred_employee: "", preferred_day: "", preferred_time: "", flexibility: "flexibel", notes: "" });
      refetch();
    } finally {
      setAddLoading(false);
    }
  };

  const handlePlace = async (entry: any) => {
    if (placingId) return;
    setPlacingId(entry.id);
    try {
      const svc = services.find(s => s.id === entry.service_id);
      const date = new Date();
      date.setDate(date.getDate() + 1);
      const [hh, mm] = (entry.preferred_time || "10:00").split(":");
      date.setHours(Number(hh) || 10, Number(mm) || 0, 0, 0);
      const result = await insertAppt({
        customer_id: entry.customer_id,
        service_id: entry.service_id,
        appointment_date: date.toISOString(),
        status: "gepland",
        price: svc?.price || 0,
        notes: `Geplaatst vanuit wachtlijst${entry.preferred_employee ? ` | Medewerker: ${entry.preferred_employee}` : ""}`,
      });
      if (!result) throw new Error("Afspraak aanmaken mislukt");
      await update(entry.id, { status: "geplaatst" });
      toast.success("Klant ingepland — bekijk de agenda");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Plaatsen mislukt");
    } finally {
      setPlacingId(null);
    }
  };

  const openOffer = (entry: any, date?: string, time?: string) => {
    const finalDate = date || (() => {
      const d = new Date(); d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    const finalTime = time || entry.preferred_time || "10:00";
    setOffer({ entry, date: finalDate, time: finalTime });
    setOfferMessage(buildOfferMessage(entry, finalDate, finalTime));
  };

  const buildOfferMessage = (entry: any, date: string, time: string) => {
    const customer = customers.find((c: any) => c.id === entry.customer_id);
    const service = services.find((s: any) => s.id === entry.service_id);
    const dateNice = new Date(`${date}T${time}:00`).toLocaleDateString("nl-NL", {
      weekday: "long", day: "numeric", month: "long",
    });
    return renderTemplate(DEFAULT_WHATSAPP_TEMPLATES.waitlist_offer, {
      customer_name: customer?.name || "",
      appointment_date: dateNice,
      appointment_time: time,
      service: service?.name || "je behandeling",
      booking_link: `${window.location.origin}/`,
      salon_name: "",
    });
  };

  const sendOffer = async () => {
    if (!offer || !user) return;
    const customer = customers.find((c: any) => c.id === offer.entry.customer_id);
    if (!customer?.phone) {
      toast.error("Klant heeft geen telefoonnummer");
      return;
    }
    if (customer.whatsapp_opt_in === false) {
      toast.error("Klant heeft WhatsApp uitgezet");
      return;
    }
    const slotKey = `${offer.date}T${offer.time}`;
    if (offer.entry.last_offered_slot === slotKey) {
      toast.info("Dit tijdslot is al aangeboden aan deze klant");
      return;
    }
    setOfferSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          user_id: user.id,
          to: customer.phone,
          message: offerMessage,
          customer_id: customer.id,
          kind: "waitlist_offer",
          meta: {
            waitlist_entry_id: offer.entry.id,
            slot: slotKey,
            service_id: offer.entry.service_id,
          },
        },
      });
      if (error) throw error;
      if (!(data as any)?.success) throw new Error((data as any)?.error || "Verzenden mislukt");

      await update(offer.entry.id, {
        status: "aangeboden",
        last_offer_sent_at: new Date().toISOString(),
        last_offered_slot: slotKey,
      });
      toast.success("Aanbieding verstuurd via WhatsApp");
      setOffer(null);
      refetch();
      clearSuggestion();
    } catch (e: any) {
      toast.error(e?.message || "Versturen mislukt");
    } finally {
      setOfferSending(false);
    }
  };

  const handleRemove = async (id: string) => {
    await remove(id);
    toast.success("Verwijderd van wachtlijst");
    refetch();
  };

  const getCustomerName = (id: string | null) => customers.find(c => c.id === id)?.name || "Onbekend";
  const getServiceName = (id: string | null) => services.find(s => s.id === id)?.name || "Onbekend";

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      wachtend: "bg-warning/15 text-warning",
      aangeboden: "bg-primary/15 text-primary",
      geplaatst: "bg-success/15 text-success",
      geannuleerd: "bg-muted text-muted-foreground",
    };
    return <span className={cn("px-2 py-0.5 rounded-lg text-[11px] font-medium", map[status] || map.wachtend)}>{status}</span>;
  };

  const wachtend = waitlist.filter((w: any) => w.status === "wachtend" || w.status === "aangeboden");
  const geplaatst = waitlist.filter((w: any) => w.status === "geplaatst");

  // Auto-scroll to suggestion banner when arriving via deep link
  useEffect(() => {
    if (suggestionSlot) {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
    }
  }, [suggestionSlot]);

  return (
    <AppLayout title="Wachtlijst" subtitle="Klanten die wachten op een plek"
      actions={<Button variant="gradient" size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Toevoegen</Button>}>

      {/* Suggestion banner from cancelled/no-show slot */}
      {suggestionSlot && (
        <div className="mb-4 p-4 rounded-2xl border border-primary/30 bg-primary/5 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Vrijgekomen plek — {new Date(suggestionSlot.raw).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {matchingEntries.length === 0
                ? "Geen klanten op de wachtlijst voor dit slot."
                : `${matchingEntries.length} klant${matchingEntries.length === 1 ? "" : "en"} kunnen dit slot ingeboden krijgen.`}
            </p>
            {matchingEntries.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {matchingEntries.slice(0, 5).map((w: any) => (
                  <Button
                    key={w.id}
                    variant="outline"
                    size="sm"
                    onClick={() => openOffer(w, suggestionSlot.date, suggestionSlot.time)}
                  >
                    <Send className="w-3.5 h-3.5" /> {getCustomerName(w.customer_id)}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={clearSuggestion} aria-label="Sluiten">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" /> Toevoegen aan wachtlijst</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Klant *</label>
                <select value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Kies klant...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Behandeling *</label>
                <select value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Kies behandeling...</option>
                  {services.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Voorkeursmedewerker</label>
                <select value={form.preferred_employee} onChange={e => setForm({ ...form, preferred_employee: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Geen voorkeur</option>
                  {MEDEWERKERS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Voorkeursdag</label>
                  <select value={form.preferred_day} onChange={e => setForm({ ...form, preferred_day: e.target.value })}
                    className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="">Geen voorkeur</option>
                    {["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Voorkeurstijd</label>
                  <input type="time" value={form.preferred_time} onChange={e => setForm({ ...form, preferred_time: e.target.value })}
                    className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Flexibiliteit</label>
                <select value={form.flexibility} onChange={e => setForm({ ...form, flexibility: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  {FLEX_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Notities</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px]" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleAdd} disabled={addLoading}>
                {addLoading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {addLoading ? "Toevoegen..." : "Toevoegen"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Offer dialog */}
      {offer && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setOffer(null)}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" /> Aanbieden via WhatsApp
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Naar {getCustomerName(offer.entry.customer_id)} · {getServiceName(offer.entry.service_id)}
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-muted-foreground">Datum</label>
                <input
                  type="date"
                  value={offer.date}
                  onChange={(e) => {
                    const next = { ...offer, date: e.target.value };
                    setOffer(next);
                    setOfferMessage(buildOfferMessage(next.entry, next.date, next.time));
                  }}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Tijd</label>
                <input
                  type="time"
                  value={offer.time}
                  onChange={(e) => {
                    const next = { ...offer, time: e.target.value };
                    setOffer(next);
                    setOfferMessage(buildOfferMessage(next.entry, next.date, next.time));
                  }}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Bericht</label>
              <textarea
                value={offerMessage}
                onChange={(e) => setOfferMessage(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm min-h-[140px]"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setOffer(null)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={sendOffer} disabled={offerSending}>
                {offerSending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {offerSending ? "Versturen..." : "Verstuur"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmRemoveId}
        onOpenChange={(o) => !o && setConfirmRemoveId(null)}
        title="Verwijderen van wachtlijst?"
        description="Deze actie kan niet ongedaan worden gemaakt."
        confirmLabel="Verwijderen"
        destructive
        onConfirm={() => confirmRemoveId && handleRemove(confirmRemoveId)}
      />

      <div className="grid gap-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="glass-card p-5">
            <p className="text-3xl font-bold text-warning leading-none">{wachtend.length}</p>
            <p className="text-xs text-muted-foreground mt-2">Wachtend</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-3xl font-bold text-success leading-none">{geplaatst.length}</p>
            <p className="text-xs text-muted-foreground mt-2">Geplaatst</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-3xl font-bold leading-none">{waitlist.length}</p>
            <p className="text-xs text-muted-foreground mt-2">Totaal</p>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-5 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> Actieve wachtlijst
          </h3>
          <div className="space-y-3">
            {wachtend.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Geen klanten op de wachtlijst</p>
            ) : wachtend.map((w: any) => (
              <div key={w.id} className="p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{getCustomerName(w.customer_id)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{getServiceName(w.service_id)}</p>
                  </div>
                  <div className="flex-shrink-0">{statusBadge(w.status)}</div>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {w.preferred_employee && <span className="bg-secondary px-2 py-1 rounded-md text-[11px] text-muted-foreground">👤 {w.preferred_employee}</span>}
                  {w.preferred_day && <span className="bg-secondary px-2 py-1 rounded-md text-[11px] text-muted-foreground">📅 {w.preferred_day}</span>}
                  {w.preferred_time && <span className="bg-secondary px-2 py-1 rounded-md text-[11px] text-muted-foreground">🕐 {w.preferred_time}</span>}
                  <span className="bg-secondary px-2 py-1 rounded-md text-[11px] text-muted-foreground">🔄 {w.flexibility}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="gradient" size="sm" onClick={() => handlePlace(w)} disabled={placingId === w.id}>
                    {placingId === w.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />} Plaats in agenda
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openOffer(w, suggestionSlot?.date, suggestionSlot?.time)}>
                    <Send className="w-3.5 h-3.5" /> Aanbieden via WhatsApp
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRemoveId(w.id)} aria-label="Verwijderen">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {geplaatst.length > 0 && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-5 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success" /> Recent geplaatst
            </h3>
            <div className="space-y-3">
              {geplaatst.map((w: any) => (
                <div key={w.id} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-success/5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{getCustomerName(w.customer_id)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{getServiceName(w.service_id)}</p>
                  </div>
                  <div className="flex-shrink-0">{statusBadge(w.status)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
