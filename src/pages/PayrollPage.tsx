import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { useEmployees, useAppointments, useAppointmentEmployees } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useUserRole } from "@/hooks/useUserRole";
import { Download, Plus, Clock, Trash2, ChevronRight, Wallet } from "lucide-react";
import { toast } from "sonner";

const fmtEUR = (v: number) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(v || 0);

const COMPLETED_STATUSES = new Set(["voltooid", "completed", "afgerond", "betaald"]);

type TimeEntry = {
  id: string;
  employee_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number;
  notes: string;
};

type PayrollSettings = {
  id?: string;
  employee_id: string;
  hourly_rate_cents: number;
  commission_percentage_bps: number;
  fixed_commission_cents: number;
  tips_enabled: boolean;
};

type Adjustment = {
  id: string;
  employee_id: string;
  period_month: string;
  type: "bonus" | "deduction" | "tip" | "correction";
  amount_cents: number;
  note: string;
  created_at: string;
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}
function lastNMonths(n: number) {
  const arr: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push(monthKey(d));
  }
  return arr;
}
function diffMinutes(a: string, b: string) {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}

export default function PayrollPage() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const { isOwner, hasAny, loading: roleLoading } = useUserRole();
  const allowed = isOwner || hasAny("manager");

  const { data: employees } = useEmployees();
  const { data: appointments } = useAppointments();
  const { data: apptEmployees } = useAppointmentEmployees();

  const [period, setPeriod] = useState<string>(monthKey(new Date()));
  const months = useMemo(() => lastNMonths(12), []);

  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [settingsByEmp, setSettingsByEmp] = useState<Record<string, PayrollSettings>>({});
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [openEmpId, setOpenEmpId] = useState<string | null>(null);
  const [timeDialog, setTimeDialog] = useState<{ employee_id: string } | null>(null);
  const [adjDialog, setAdjDialog] = useState<{ employee_id: string; type: Adjustment["type"] } | null>(null);

  async function refetch() {
    if (!user) return;
    setLoading(true);
    const [te, ps, ad] = await Promise.all([
      supabase.from("employee_time_entries").select("*").order("date", { ascending: false }),
      supabase.from("employee_payroll_settings").select("*"),
      supabase.from("employee_payroll_adjustments").select("*").order("created_at", { ascending: false }),
    ]);
    setTimeEntries((te.data as any) || []);
    const map: Record<string, PayrollSettings> = {};
    ((ps.data as any) || []).forEach((r: PayrollSettings) => { map[r.employee_id] = r; });
    setSettingsByEmp(map);
    setAdjustments((ad.data as any) || []);
    setLoading(false);
  }

  useEffect(() => { refetch(); /* eslint-disable-next-line */ }, [user, demoMode]);

  // Per-employee monthly aggregation
  const periodStart = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }, [period]);
  const periodEnd = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    return new Date(y, m, 1);
  }, [period]);

  function aggregateForEmployee(empId: string, empName: string) {
    const settings: PayrollSettings = settingsByEmp[empId] || {
      employee_id: empId,
      hourly_rate_cents: 0,
      commission_percentage_bps: 0,
      fixed_commission_cents: 0,
      tips_enabled: true,
    };

    const entries = timeEntries.filter(
      (t) => t.employee_id === empId && t.date >= period + "-01" &&
        new Date(t.date) < periodEnd
    );

    let totalMin = 0;
    for (const e of entries) {
      if (e.clock_in && e.clock_out) {
        totalMin += Math.max(0, diffMinutes(e.clock_in, e.clock_out) - (e.break_minutes || 0));
      }
    }
    const hours = totalMin / 60;
    const hourlyPay = (settings.hourly_rate_cents / 100) * hours;

    // Appointments: status completed AND linked to this employee in window
    const empMatchSet = new Set(
      apptEmployees.filter((ae: any) => ae.employee_id === empId).map((ae: any) => ae.appointment_id)
    );
    let revenue = 0;
    let completedCount = 0;
    for (const a of appointments as any[]) {
      const date = new Date(a.appointment_date);
      if (date < periodStart || date >= periodEnd) continue;
      if (!COMPLETED_STATUSES.has(String(a.status || "").toLowerCase())) continue;
      const linked =
        empMatchSet.has(a.id) ||
        a.employee_id === empId ||
        (typeof a.notes === "string" && a.notes.toLowerCase().includes(`medewerker: ${empName.toLowerCase()}`));
      if (!linked) continue;
      revenue += Number(a.price || 0);
      completedCount += 1;
    }

    const commissionPct = settings.commission_percentage_bps / 10000;
    const commission = revenue * commissionPct + settings.fixed_commission_cents / 100;

    const adj = adjustments.filter((x) => x.employee_id === empId && x.period_month === period);
    const tips = adj.filter((x) => x.type === "tip").reduce((s, x) => s + x.amount_cents / 100, 0);
    const bonuses = adj.filter((x) => x.type === "bonus" || x.type === "correction").reduce((s, x) => s + x.amount_cents / 100, 0);
    const deductions = adj.filter((x) => x.type === "deduction").reduce((s, x) => s + Math.abs(x.amount_cents) / 100, 0);

    const payout = hourlyPay + commission + tips + bonuses - deductions;
    return { hours, hourlyPay, revenue, completedCount, commission, tips, bonuses, deductions, payout, settings, entries, adj };
  }

  const summary = useMemo(() => {
    return (employees || []).filter((e: any) => e.is_active !== false).map((e: any) => ({
      employee: e,
      ...aggregateForEmployee(e.id, e.name),
    }));
    // eslint-disable-next-line
  }, [employees, timeEntries, settingsByEmp, adjustments, appointments, apptEmployees, period]);

  function exportCsv() {
    const header = ["Medewerker", "Rol", "Uren", "Afspraken", "Omzet", "Commissie", "Fooi", "Bonus", "Inhouding", "Uitbetaling"];
    const rows = summary.map((s) => [
      s.employee.name,
      s.employee.role || "",
      s.hours.toFixed(2),
      s.completedCount,
      s.revenue.toFixed(2),
      s.commission.toFixed(2),
      s.tips.toFixed(2),
      s.bonuses.toFixed(2),
      s.deductions.toFixed(2),
      s.payout.toFixed(2),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `salaris-${period}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("CSV geëxporteerd");
  }

  if (!roleLoading && !allowed) {
    return (
      <AppLayout title="Salaris & uitbetalingen">
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Alleen eigenaren en managers kunnen salaris bekijken.</CardContent></Card>
      </AppLayout>
    );
  }

  const openEmp = openEmpId ? summary.find((s) => s.employee.id === openEmpId) : null;

  return (
    <AppLayout
      title="Salaris & uitbetalingen"
      subtitle="Schatting / interne administratie. Geen officiële loonstrook."
      actions={
        <div className="grid grid-cols-2 lg:flex gap-2 w-full lg:w-auto">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-12 lg:h-9 rounded-2xl lg:rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={exportCsv} variant="outline" className="h-12 lg:h-9 rounded-2xl lg:rounded-xl truncate">
            <Download className="w-4 h-4 mr-2" /> CSV
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {summary.map((s) => (
          <button
            key={s.employee.id}
            onClick={() => setOpenEmpId(s.employee.id)}
            className="text-left"
          >
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-3 min-w-0">
                  <EmployeeAvatar employee={s.employee} size="xl" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{s.employee.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.employee.role || "Medewerker"}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-secondary/50 p-2">
                    <div className="text-muted-foreground">Uren</div>
                    <div className="font-semibold text-foreground text-sm">{s.hours.toFixed(1)} u</div>
                  </div>
                  <div className="rounded-xl bg-secondary/50 p-2">
                    <div className="text-muted-foreground">Afspraken</div>
                    <div className="font-semibold text-foreground text-sm">{s.completedCount}</div>
                  </div>
                  <div className="rounded-xl bg-secondary/50 p-2">
                    <div className="text-muted-foreground">Omzet</div>
                    <div className="font-semibold text-foreground text-sm">{fmtEUR(s.revenue)}</div>
                  </div>
                  <div className="rounded-xl bg-secondary/50 p-2">
                    <div className="text-muted-foreground">Commissie</div>
                    <div className="font-semibold text-foreground text-sm">{fmtEUR(s.commission)}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">Geschatte uitbetaling</span>
                  <span className="text-lg font-bold text-primary">{fmtEUR(s.payout)}</span>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
        {summary.length === 0 && !loading && (
          <Card className="col-span-full"><CardContent className="p-6 text-sm text-muted-foreground">Voeg eerst medewerkers toe.</CardContent></Card>
        )}
      </div>

      {/* Drawer */}
      <Sheet open={!!openEmp} onOpenChange={(o) => !o && setOpenEmpId(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {openEmp && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <EmployeeAvatar employee={openEmp.employee} size="lg" />
                  <div className="min-w-0">
                    <div className="truncate">{openEmp.employee.name}</div>
                    <div className="text-xs text-muted-foreground font-normal">{monthLabel(period)}</div>
                  </div>
                </SheetTitle>
                <SheetDescription>Schatting / interne administratie</SheetDescription>
              </SheetHeader>

              <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
                <Stat label="Uren" value={`${openEmp.hours.toFixed(2)} u`} />
                <Stat label="Uurloon" value={fmtEUR(openEmp.hourlyPay)} />
                <Stat label="Omzet" value={fmtEUR(openEmp.revenue)} />
                <Stat label="Commissie" value={fmtEUR(openEmp.commission)} />
                <Stat label="Fooi" value={fmtEUR(openEmp.tips)} />
                <Stat label="Bonus" value={fmtEUR(openEmp.bonuses)} />
                <Stat label="Inhouding" value={fmtEUR(openEmp.deductions)} />
                <Stat label="Uitbetaling" value={fmtEUR(openEmp.payout)} highlight />
              </div>

              <Tabs defaultValue="time" className="mt-6">
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="time">Uren</TabsTrigger>
                  <TabsTrigger value="adj">Aanpassingen</TabsTrigger>
                  <TabsTrigger value="settings">Instellingen</TabsTrigger>
                </TabsList>

                <TabsContent value="time" className="space-y-2 pt-3">
                  <Button size="sm" onClick={() => setTimeDialog({ employee_id: openEmp.employee.id })}>
                    <Plus className="w-4 h-4 mr-1" /> Uren toevoegen
                  </Button>
                  <div className="space-y-1.5 mt-2">
                    {openEmp.entries.length === 0 && <p className="text-xs text-muted-foreground">Geen uren in deze maand.</p>}
                    {openEmp.entries.map((e) => (
                      <div key={e.id} className="flex items-center justify-between rounded-xl border border-border p-2.5 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{new Date(e.date).toLocaleDateString("nl-NL")}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {e.clock_in?.slice(0, 5)}–{e.clock_out?.slice(0, 5)} · pauze {e.break_minutes}m
                            </div>
                          </div>
                        </div>
                        <Button size="icon" variant="ghost" onClick={async () => {
                          await supabase.from("employee_time_entries").delete().eq("id", e.id);
                          refetch();
                        }}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="adj" className="space-y-2 pt-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAdjDialog({ employee_id: openEmp.employee.id, type: "bonus" })}>+ Bonus</Button>
                    <Button size="sm" variant="outline" onClick={() => setAdjDialog({ employee_id: openEmp.employee.id, type: "tip" })}>+ Fooi</Button>
                    <Button size="sm" variant="outline" onClick={() => setAdjDialog({ employee_id: openEmp.employee.id, type: "deduction" })}>− Inhouding</Button>
                    <Button size="sm" variant="outline" onClick={() => setAdjDialog({ employee_id: openEmp.employee.id, type: "correction" })}>± Correctie</Button>
                  </div>
                  <div className="space-y-1.5 mt-2">
                    {openEmp.adj.length === 0 && <p className="text-xs text-muted-foreground">Geen aanpassingen.</p>}
                    {openEmp.adj.map((a) => (
                      <div key={a.id} className="flex items-center justify-between rounded-xl border border-border p-2.5 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium capitalize">{a.type}</div>
                          {a.note && <div className="text-xs text-muted-foreground truncate">{a.note}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={a.type === "deduction" ? "text-destructive font-medium" : "text-foreground font-medium"}>
                            {a.type === "deduction" ? "−" : "+"}{fmtEUR(Math.abs(a.amount_cents) / 100)}
                          </span>
                          <Button size="icon" variant="ghost" onClick={async () => {
                            await supabase.from("employee_payroll_adjustments").delete().eq("id", a.id);
                            refetch();
                          }}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="settings" className="pt-3">
                  <SettingsForm
                    employeeId={openEmp.employee.id}
                    initial={openEmp.settings}
                    onSaved={refetch}
                  />
                </TabsContent>
              </Tabs>

              <div className="mt-6">
                <Button className="w-full" disabled>
                  <Wallet className="w-4 h-4 mr-2" /> Markeer als verwerkt (binnenkort)
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Time entry dialog */}
      <TimeEntryDialog
        open={!!timeDialog}
        employeeId={timeDialog?.employee_id || ""}
        onClose={() => setTimeDialog(null)}
        onSaved={refetch}
      />

      {/* Adjustment dialog */}
      <AdjustmentDialog
        open={!!adjDialog}
        employeeId={adjDialog?.employee_id || ""}
        type={adjDialog?.type || "bonus"}
        period={period}
        onClose={() => setAdjDialog(null)}
        onSaved={refetch}
      />
    </AppLayout>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${highlight ? "bg-primary/10 border border-primary/20" : "bg-secondary/50"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold text-sm ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function SettingsForm({ employeeId, initial, onSaved }: { employeeId: string; initial: PayrollSettings; onSaved: () => void }) {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const [hourly, setHourly] = useState((initial.hourly_rate_cents / 100).toString());
  const [pct, setPct] = useState((initial.commission_percentage_bps / 100).toString());
  const [fixed, setFixed] = useState((initial.fixed_commission_cents / 100).toString());
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      employee_id: employeeId,
      hourly_rate_cents: Math.round(parseFloat(hourly || "0") * 100),
      commission_percentage_bps: Math.round(parseFloat(pct || "0") * 100),
      fixed_commission_cents: Math.round(parseFloat(fixed || "0") * 100),
      tips_enabled: true,
      is_demo: demoMode,
    };
    let error;
    if (initial.id) {
      ({ error } = await supabase.from("employee_payroll_settings").update(payload).eq("id", initial.id));
    } else {
      ({ error } = await supabase.from("employee_payroll_settings").insert(payload));
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Instellingen opgeslagen");
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Uurloon (€/u)</Label>
        <Input type="number" step="0.01" value={hourly} onChange={(e) => setHourly(e.target.value)} />
      </div>
      <div>
        <Label>Commissie (%)</Label>
        <Input type="number" step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} />
      </div>
      <div>
        <Label>Vaste commissie (€/maand)</Label>
        <Input type="number" step="0.01" value={fixed} onChange={(e) => setFixed(e.target.value)} />
      </div>
      <Button onClick={save} disabled={saving} className="w-full">{saving ? "Opslaan…" : "Opslaan"}</Button>
    </div>
  );
}

function TimeEntryDialog({ open, employeeId, onClose, onSaved }: {
  open: boolean; employeeId: string; onClose: () => void; onSaved: () => void;
}) {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [clockIn, setClockIn] = useState("09:00");
  const [clockOut, setClockOut] = useState("17:00");
  const [breakMin, setBreakMin] = useState("30");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("employee_time_entries").insert({
      user_id: user.id,
      employee_id: employeeId,
      date,
      clock_in: clockIn,
      clock_out: clockOut,
      break_minutes: parseInt(breakMin || "0", 10),
      notes,
      is_demo: demoMode,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Uren opgeslagen");
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Uren toevoegen</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Datum</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start</Label><Input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} /></div>
            <div><Label>Eind</Label><Input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} /></div>
          </div>
          <div><Label>Pauze (minuten)</Label><Input type="number" value={breakMin} onChange={(e) => setBreakMin(e.target.value)} /></div>
          <div><Label>Notitie</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuleren</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Opslaan…" : "Opslaan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentDialog({ open, employeeId, type, period, onClose, onSaved }: {
  open: boolean; employeeId: string; type: Adjustment["type"]; period: string; onClose: () => void; onSaved: () => void;
}) {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setAmount(""); setNote(""); } }, [open]);

  async function save() {
    if (!user) return;
    const v = parseFloat(amount || "0");
    if (!v) { toast.error("Vul een bedrag in"); return; }
    setSaving(true);
    const { error } = await supabase.from("employee_payroll_adjustments").insert({
      user_id: user.id,
      employee_id: employeeId,
      period_month: period,
      type,
      amount_cents: Math.round(Math.abs(v) * 100),
      note,
      is_demo: demoMode,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Toegevoegd");
    onSaved();
    onClose();
  }

  const labels: Record<string, string> = { bonus: "Bonus", deduction: "Inhouding", tip: "Fooi", correction: "Correctie" };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{labels[type]} toevoegen</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Bedrag (€)</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><Label>Notitie</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuleren</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Opslaan…" : "Opslaan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
