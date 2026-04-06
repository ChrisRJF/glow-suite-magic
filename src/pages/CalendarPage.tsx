import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useAppointments, useCustomers, useServices } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus, Clock, Trash2, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type View = 'day' | 'week';

const timeSlots = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00'];

export default function CalendarPage() {
  const { data: appointments, refetch } = useAppointments();
  const { data: customers } = useCustomers();
  const { data: services } = useServices();
  const { insert, update, remove } = useCrud("appointments");
  const [view, setView] = useState<View>('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ customer_id: '', service_id: '', date: '', time: '09:00', notes: '' });
  // Group booking support
  const [subAppts, setSubAppts] = useState<{ person_name: string; service_id: string }[]>([]);

  const dateStr = currentDate.toISOString().split('T')[0];

  const dayAppts = useMemo(() =>
    appointments.filter(a => a.appointment_date.startsWith(dateStr)),
    [appointments, dateStr]
  );

  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }, [currentDate]);

  const weekDays = useMemo(() =>
    Array.from({ length: 6 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    }), [weekStart]
  );

  const dayNames = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];

  const navigate = (dir: number) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + (view === 'day' ? dir : dir * 7));
    setCurrentDate(d);
  };

  // Detect empty slots for the day
  const emptySlotCount = useMemo(() => {
    const bookedTimes = new Set(dayAppts.map(a => {
      const t = new Date(a.appointment_date);
      return `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`;
    }));
    return timeSlots.filter(s => !bookedTimes.has(s)).length;
  }, [dayAppts]);

  const handleAdd = async () => {
    if (!form.customer_id || !form.service_id || !form.date || !form.time) { toast.error("Vul alle velden in"); return; }
    const svc = services.find(s => s.id === form.service_id);
    const dt = `${form.date}T${form.time}:00`;
    const result = await insert({
      customer_id: form.customer_id,
      service_id: form.service_id,
      appointment_date: dt,
      price: svc?.price || 0,
      notes: form.notes,
      status: 'gepland',
    });
    if (result) {
      // Insert sub-appointments if group booking
      if (subAppts.length > 0) {
        const { insert: insertSub } = await import("@/hooks/useCrud").then(m => ({ insert: null }));
        // Use direct supabase for sub_appointments since it's not in typed hooks yet
        for (const sub of subAppts) {
          if (sub.person_name && sub.service_id) {
            const subSvc = services.find(s => s.id === sub.service_id);
            // We'll just create additional appointments for each person
            await insert({
              customer_id: form.customer_id,
              service_id: sub.service_id,
              appointment_date: dt,
              price: subSvc?.price || 0,
              notes: `Groepsboeking: ${sub.person_name}`,
              status: 'gepland',
            });
          }
        }
      }
      toast.success(subAppts.length > 0 ? `Groepsboeking aangemaakt (${subAppts.length + 1} personen)` : "Afspraak aangemaakt");
      setShowAdd(false);
      setSubAppts([]);
      refetch();
    }
  };

  const handleDelete = async (id: string) => {
    if (await remove(id)) { toast.success("Afspraak verwijderd"); refetch(); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    await update(id, { status });
    toast.success(`Status gewijzigd naar ${status}`);
    refetch();
  };

  const openAddModal = (date: string, time: string) => {
    setShowAdd(true);
    setForm({ customer_id: '', service_id: '', date, time, notes: '' });
    setSubAppts([]);
  };

  return (
    <AppLayout title="Agenda" subtitle="Beheer je afspraken en vind lege plekken."
      actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button onClick={() => setView('day')} className={cn("px-4 py-2 text-sm font-medium transition-colors", view === 'day' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground')}>Dag</button>
            <button onClick={() => setView('week')} className={cn("px-4 py-2 text-sm font-medium transition-colors", view === 'week' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground')}>Week</button>
          </div>
          <Button variant="gradient" size="sm" onClick={() => openAddModal(dateStr, '09:00')}>
            <Plus className="w-4 h-4" /> Nieuwe Afspraak
          </Button>
        </div>
      }>

      {/* Empty slot indicator */}
      {view === 'day' && emptySlotCount > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/10 flex items-center gap-2 opacity-0 animate-fade-in-up" style={{ animationDelay: '50ms' }}>
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs text-muted-foreground">
            <strong className="text-foreground">{emptySlotCount} vrije slots</strong> vandaag — klik op een leeg tijdslot om direct te boeken
          </span>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="glass-card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Nieuwe afspraak</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Klant *</label>
                <select value={form.customer_id} onChange={e => setForm({...form, customer_id: e.target.value})}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Selecteer klant</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Behandeling *</label>
                <select value={form.service_id} onChange={e => setForm({...form, service_id: e.target.value})}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Selecteer behandeling</option>
                  {services.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name} — {formatEuro(s.price)}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground">Datum *</label><input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-xs text-muted-foreground">Tijd *</label>
                  <select value={form.time} onChange={e => setForm({...form, time: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    {timeSlots.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="text-xs text-muted-foreground">Notities</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px]" /></div>

              {/* Group booking section */}
              <div className="border-t border-border pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium flex items-center gap-1"><Users className="w-3.5 h-3.5" />Groepsboeking</span>
                  <Button variant="outline" size="sm" onClick={() => setSubAppts(prev => [...prev, { person_name: '', service_id: '' }])}>
                    <Plus className="w-3 h-3 mr-1" />Persoon
                  </Button>
                </div>
                {subAppts.map((sub, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <input placeholder={`Naam persoon ${idx + 2}`} value={sub.person_name}
                      onChange={e => { const updated = [...subAppts]; updated[idx].person_name = e.target.value; setSubAppts(updated); }}
                      className="flex-1 px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm" />
                    <select value={sub.service_id}
                      onChange={e => { const updated = [...subAppts]; updated[idx].service_id = e.target.value; setSubAppts(updated); }}
                      className="flex-1 px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm">
                      <option value="">Behandeling</option>
                      {services.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button onClick={() => setSubAppts(prev => prev.filter((_, i) => i !== idx))} className="p-2 rounded-lg hover:bg-destructive/20">
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleAdd}>Opslaan</Button>
            </div>
          </div>
        </div>
      )}

      <div className="glass-card p-5 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-lg hover:bg-secondary transition-colors" onClick={() => navigate(-1)}><ChevronLeft className="w-4 h-4" /></button>
            <h3 className="text-base font-semibold">
              {view === 'day'
                ? currentDate.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                : `${weekDays[0].toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} – ${weekDays[5].toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}`
              }
            </h3>
            <button className="p-2 rounded-lg hover:bg-secondary transition-colors" onClick={() => navigate(1)}><ChevronRight className="w-4 h-4" /></button>
          </div>
          <span className="text-sm text-muted-foreground">
            {view === 'day' ? `${dayAppts.length} afspraken` : `${appointments.filter(a => weekDays.some(d => a.appointment_date.startsWith(d.toISOString().split('T')[0]))).length} afspraken`}
          </span>
        </div>

        {view === 'day' ? (
          <div className="relative">
            {timeSlots.map((slot) => {
              const apt = dayAppts.find(a => {
                const t = new Date(a.appointment_date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
                return t === slot;
              });
              const svc = apt ? services.find(s => s.id === apt.service_id) : null;
              const cust = apt ? customers.find(c => c.id === apt.customer_id) : null;
              return (
                <div key={slot} className="flex gap-4 group min-h-[48px]">
                  <span className="w-14 text-xs text-muted-foreground py-3 tabular-nums flex-shrink-0">{slot}</span>
                  <div className="flex-1 border-t border-border/50 relative">
                    {apt ? (
                      <div className="absolute inset-x-0 top-1 rounded-xl p-3 transition-all duration-200 hover:scale-[1.01] cursor-pointer"
                        style={{ backgroundColor: `${svc?.color || '#7B61FF'}15`, borderLeft: `3px solid ${svc?.color || '#7B61FF'}`, minHeight: `${((svc?.duration_minutes || 30) / 30) * 48 - 8}px` }}>
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium">{cust?.name || 'Klant'}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-xs text-muted-foreground">{svc?.name || 'Behandeling'}</p>
                              <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Clock className="w-3 h-3" />{svc?.duration_minutes || 30} min</span>
                            </div>
                            {apt.notes?.startsWith('Groepsboeking:') && (
                              <span className="text-[10px] text-primary flex items-center gap-0.5 mt-0.5"><Users className="w-3 h-3" />{apt.notes}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {(apt as any).payment_status && (apt as any).payment_status !== 'none' && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                (apt as any).payment_status === 'betaald' ? 'bg-success/15 text-success' :
                                (apt as any).payment_status === 'mislukt' ? 'bg-destructive/15 text-destructive' :
                                'bg-warning/15 text-warning'
                              }`}>
                                {(apt as any).payment_status === 'betaald' ? '€✓' : (apt as any).payment_status === 'mislukt' ? '€✗' : '€…'}
                              </span>
                            )}
                            <select value={apt.status} onChange={e => handleStatusChange(apt.id, e.target.value)}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border">
                              <option value="gepland">gepland</option>
                              <option value="voltooid">voltooid</option>
                              <option value="geannuleerd">geannuleerd</option>
                              <option value="no-show">no-show</option>
                            </select>
                            <button onClick={() => handleDelete(apt.id)} className="p-1 rounded hover:bg-destructive/20"><Trash2 className="w-3 h-3 text-destructive" /></button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div onClick={() => openAddModal(dateStr, slot)}
                        className="absolute inset-x-0 top-1 h-[40px] rounded-xl border border-dashed border-border/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer hover:bg-primary/5 hover:border-primary/30">
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Direct beschikbaar</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-6 gap-3 min-w-[700px]">
              {weekDays.map((day, i) => {
                const ds = day.toISOString().split('T')[0];
                const apts = appointments.filter(a => a.appointment_date.startsWith(ds));
                const isSelected = ds === dateStr;
                const freeSlots = timeSlots.length - apts.length;
                return (
                  <div key={ds} className="flex flex-col">
                    <button onClick={() => setCurrentDate(day)}
                      className={cn("text-sm font-semibold mb-3 pb-2 border-b-2 transition-colors text-left",
                        isSelected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                      {dayNames[i]} <span className="text-xs">{day.getDate()}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{apts.length}</span>
                      {freeSlots > 10 && <span className="ml-1 text-[10px] text-primary">• {freeSlots} vrij</span>}
                    </button>
                    <div className="space-y-2 flex-1">
                      {apts.map((apt) => {
                        const svc = services.find(s => s.id === apt.service_id);
                        const cust = customers.find(c => c.id === apt.customer_id);
                        const time = new Date(apt.appointment_date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <div key={apt.id} className="p-2.5 rounded-xl cursor-pointer transition-all duration-200 hover:scale-[1.02]"
                            style={{ backgroundColor: `${svc?.color || '#7B61FF'}12`, borderLeft: `2px solid ${svc?.color || '#7B61FF'}` }}>
                            <p className="text-xs font-medium truncate">{cust?.name || 'Klant'}</p>
                            <p className="text-[11px] text-muted-foreground">{time} · {svc?.name || ''}</p>
                          </div>
                        );
                      })}
                      {apts.length < 4 && (
                        <button onClick={() => openAddModal(ds, '09:00')}
                          className="w-full p-2 rounded-xl border border-dashed border-border/50 text-xs text-muted-foreground hover:bg-primary/5 hover:border-primary/30 hover:text-foreground transition-colors">
                          <Plus className="w-3 h-3 inline mr-1" />Vrij
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
