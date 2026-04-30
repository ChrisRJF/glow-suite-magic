import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useAppointments, useCustomers, useServices, useEmployees, useAppointmentEmployees } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, Clock, Trash2, Sparkles, Users, AlertCircle, CheckCircle2, Zap, CalendarDays, Filter, User, UserPlus2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { EmployeeAvatar, EmployeeAvatarStack } from "@/components/EmployeeAvatar";

type View = 'day' | 'week';

const timeSlots = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00'];

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getAppointmentDate = (appointment: { appointment_date: string }) => appointment.appointment_date.slice(0, 10);
const getAppointmentTime = (appointment: { appointment_date: string; start_time?: string | null }) => {
  if (appointment.start_time) return appointment.start_time.slice(0, 5);
  const match = appointment.appointment_date.match(/T(\d{2}:\d{2})/);
  return match?.[1] || '';
};

const addMinutes = (time: string, minutes: number) => {
  const [hours, mins] = time.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// Demo medewerkers with capabilities and availability
const MEDEWERKERS = [
  { name: 'Bas', role: 'Kapper', services: ['Kinder knippen', 'Heren knippen', 'Heren baard trimmen'], days: [1,2,3,4,5], pauze: '12:00-12:30', color: '#7B61FF' },
  { name: 'Roos', role: 'Kapster', services: ['Dames knippen', 'Kleuren', 'Knippen + föhnen', 'Full balayage', 'Kinder knippen'], days: [1,2,3,4,5,6], pauze: '12:30-13:00', color: '#FF6B9D' },
  { name: 'Lisa', role: 'Allround stylist', services: ['Kinder knippen', 'Heren knippen', 'Dames knippen', 'Kleuren', 'Knippen + föhnen', 'Brow treatment', 'Lash lift', 'Manicure'], days: [1,2,4,5,6], pauze: '12:00-12:30', color: '#4ECDC4' },
  { name: 'Emma', role: 'Junior stylist', services: ['Kinder knippen', 'Knippen + föhnen', 'Brow treatment', 'BIAB behandeling', 'Manicure'], days: [1,3,5], pauze: '13:00-13:30', color: '#FFB347' },
];

interface SubApptForm {
  person_name: string;
  service_id: string;
  assignment_mode: 'manual' | 'auto';
  assigned_employee: string;
  assigned_time: string;
}

interface PlacementOption {
  label: string;
  description: string;
  placements: { person: string; employee: string; time: string; service: string }[];
  isSimultaneous: boolean;
}

export default function CalendarPage() {
  const { user } = useAuth();
  const { data: appointments, refetch } = useAppointments();
  const { data: customers } = useCustomers();
  const { data: services } = useServices();
  const { data: dbEmployees } = useEmployees();
  const { data: apptEmployees, refetch: refetchApptEmps } = useAppointmentEmployees();
  const { insert, update, remove } = useCrud("appointments");
  const [view, setView] = useState<View>('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ customer_id: '', service_id: '', date: '', time: '09:00', notes: '' });
  const [subAppts, setSubAppts] = useState<SubApptForm[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [placementOptions, setPlacementOptions] = useState<PlacementOption[]>([]);
  const [selectedOption, setSelectedOption] = useState(0);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('alle');
  const [showFilters, setShowFilters] = useState(false);
  const [filterAvailability, setFilterAvailability] = useState<string>('alle'); // alle, beschikbaar, afwezig

  // Active DB employees (preferred over hardcoded list when present)
  const activeDbEmployees = useMemo(
    () => (dbEmployees || []).filter((e: any) => e.is_active !== false),
    [dbEmployees]
  );

  // Unified display list — DB employees if any, otherwise hardcoded fallback.
  // Normalized shape used by chips, cards, filters and slot logic.
  const displayEmployees = useMemo(() => {
    if (activeDbEmployees.length > 0) {
      return activeDbEmployees.map((e: any) => {
        const breakStart = e.break_start ? String(e.break_start).slice(0, 5) : null;
        const breakEnd = e.break_end ? String(e.break_end).slice(0, 5) : null;
        return {
          id: e.id as string,
          name: e.name as string,
          role: e.role || '',
          color: e.color || '#7B61FF',
          photo_url: e.photo_url || null,
          days: Array.isArray(e.working_days) && e.working_days.length ? e.working_days.map((n: any) => Number(n)) : [1,2,3,4,5],
          pauze: breakStart && breakEnd ? `${breakStart}-${breakEnd}` : null,
          services: Array.isArray(e.services) ? e.services : [],
        };
      });
    }
    // Fallback to hardcoded list
    return MEDEWERKERS.map(m => ({
      id: m.name,
      name: m.name,
      role: m.role,
      color: m.color,
      photo_url: null as string | null,
      days: m.days,
      pauze: m.pauze,
      services: m.services,
    }));
  }, [activeDbEmployees]);

  // Resolve employee record by name (used for legacy notes "Medewerker: X")
  const resolveEmployee = (name: string | undefined | null) => {
    if (!name) return null;
    const match = displayEmployees.find((e: any) => e.name?.toLowerCase() === name.toLowerCase());
    if (match) return match;
    return { id: name, name, role: '', color: '#7B61FF', photo_url: null };
  };

  // Get employees assigned to a given appointment via join table
  const getEmployeesForAppt = (apptId: string) => {
    const links = (apptEmployees || []).filter((l: any) => l.appointment_id === apptId);
    return links
      .map((l: any) => activeDbEmployees.find((e: any) => e.id === l.employee_id))
      .filter(Boolean);
  };

  // Combined view: assigned employees from join table + name from notes (legacy)
  const getDisplayEmployees = (apt: any): any[] => {
    const fromJoin = getEmployeesForAppt(apt.id);
    if (fromJoin.length) return fromJoin;
    const legacyName = apt?.notes?.match(/Medewerker: (\w+)/)?.[1];
    const resolved = legacyName ? resolveEmployee(legacyName) : null;
    return resolved ? [resolved] : [];
  };


  const dateStr = formatLocalDate(currentDate);
  const currentDayOfWeek = currentDate.getDay() === 0 ? 7 : currentDate.getDay(); // 1=ma..7=zo

  type DisplayEmp = (typeof displayEmployees)[number];

  // Employee availability for current date
  const getEmployeeStatus = (emp: DisplayEmp, date: Date) => {
    const dow = date.getDay() === 0 ? 7 : date.getDay();
    if (!emp.days.includes(dow)) return 'afwezig';
    return 'beschikbaar';
  };

  const getEmployeePauze = (emp: DisplayEmp) => {
    if (!emp.pauze) return null;
    const [start, end] = emp.pauze.split('-');
    return { start, end };
  };

  const isSlotPauze = (emp: DisplayEmp, slot: string) => {
    const p = getEmployeePauze(emp);
    if (!p) return false;
    return slot >= p.start && slot < p.end;
  };

  // Count appointments per employee for a given date.
  // Counts via appointment_employees join (DB id) AND legacy notes (name).
  const getEmployeeApptCount = (emp: DisplayEmp, date: string) => {
    const dayAppts = appointments.filter(a => getAppointmentDate(a) === date);
    const linkedIds = new Set(
      (apptEmployees || [])
        .filter((l: any) => l.employee_id === emp.id)
        .map((l: any) => l.appointment_id)
    );
    return dayAppts.filter(a =>
      linkedIds.has(a.id) || a.notes?.includes(`Medewerker: ${emp.name}`)
    ).length;
  };

  // Get workload label
  const getWorkloadLabel = (emp: DisplayEmp, date: string) => {
    const count = getEmployeeApptCount(emp, date);
    const status = getEmployeeStatus(emp, new Date(date));
    if (status === 'afwezig') return { label: 'Afwezig', variant: 'destructive' as const };
    if (count >= 8) return { label: 'Vol', variant: 'destructive' as const };
    if (count >= 5) return { label: 'Druk', variant: 'warning' as const };
    if (count >= 2) return { label: 'Normaal', variant: 'default' as const };
    return { label: 'Ruimte', variant: 'success' as const };
  };

  // Free slots per employee
  const getEmployeeFreeSlots = (emp: DisplayEmp, date: string) => {
    const status = getEmployeeStatus(emp, new Date(date));
    if (status === 'afwezig') return 0;
    const linkedIds = new Set(
      (apptEmployees || [])
        .filter((l: any) => l.employee_id === emp.id)
        .map((l: any) => l.appointment_id)
    );
    const bookedTimes = new Set(
      appointments
        .filter(a => getAppointmentDate(a) === date && (linkedIds.has(a.id) || a.notes?.includes(`Medewerker: ${emp.name}`)))
        .map(a => getAppointmentTime(a))
    );
    return timeSlots.filter(s => !bookedTimes.has(s) && !isSlotPauze(emp, s)).length;
  };

  // Filter appointments by selected employee (selectedEmployee = 'alle' | DB id | legacy name)
  const filterByEmployee = (appts: typeof appointments) => {
    if (selectedEmployee === 'alle') return appts;
    const emp = displayEmployees.find((e: any) => e.id === selectedEmployee)
      || displayEmployees.find((e: any) => e.name === selectedEmployee);
    const empName = emp?.name || selectedEmployee;
    const empId = emp?.id;
    const linkedIds = new Set(
      (apptEmployees || [])
        .filter((l: any) => l.employee_id === empId)
        .map((l: any) => l.appointment_id)
    );
    return appts.filter(a => linkedIds.has(a.id) || a.notes?.includes(`Medewerker: ${empName}`));
  };

  // Filter employees by availability
  const filteredMedewerkers = useMemo(() => {
    if (filterAvailability === 'beschikbaar') {
      return displayEmployees.filter((m: any) => getEmployeeStatus(m, currentDate) === 'beschikbaar');
    }
    if (filterAvailability === 'afwezig') {
      return displayEmployees.filter((m: any) => getEmployeeStatus(m, currentDate) === 'afwezig');
    }
    return displayEmployees;
  }, [filterAvailability, currentDate, displayEmployees]);

  const dayAppts = useMemo(() =>
    filterByEmployee(appointments.filter(a => getAppointmentDate(a) === dateStr)),
    [appointments, dateStr, selectedEmployee]
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

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const emptySlotCount = useMemo(() => {
    const bookedTimes = new Set(dayAppts.map(a => {
      return getAppointmentTime(a);
    }));
    return timeSlots.filter(s => !bookedTimes.has(s)).length;
  }, [dayAppts]);

  const getAvailableEmployees = (serviceName: string) => {
    return MEDEWERKERS.filter(m => m.services.includes(serviceName));
  };

  const getBookedSlots = (date: string, excludeSubIdx?: number): Map<string, Set<string>> => {
    const booked = new Map<string, Set<string>>();
    appointments.filter(a => getAppointmentDate(a) === date).forEach(a => {
      const time = getAppointmentTime(a);
      const emp = a.notes?.match(/Medewerker: (\w+)/)?.[1];
      if (emp) {
        if (!booked.has(emp)) booked.set(emp, new Set());
        booked.get(emp)!.add(time);
        const svc = services.find(s => s.id === a.service_id);
        if (svc) {
          const durationSlots = Math.ceil(svc.duration_minutes / 30);
          const startIdx = timeSlots.indexOf(time);
          for (let i = 1; i < durationSlots && startIdx + i < timeSlots.length; i++) {
            booked.get(emp)!.add(timeSlots[startIdx + i]);
          }
        }
      }
    });
    subAppts.forEach((s, i) => {
      if (i !== excludeSubIdx && s.assigned_employee && s.assigned_time) {
        if (!booked.has(s.assigned_employee)) booked.set(s.assigned_employee, new Set());
        booked.get(s.assigned_employee)!.add(s.assigned_time);
      }
    });
    return booked;
  };

  const generatePlacementOptions = (): PlacementOption[] => {
    const mainSvc = services.find(s => s.id === form.service_id);
    if (!mainSvc) return [];

    const allPersons = [
      { person: customers.find(c => c.id === form.customer_id)?.name || 'Hoofdpersoon', service_id: form.service_id, service_name: mainSvc.name, assignment_mode: 'manual' as const, assigned_employee: '', assigned_time: form.time },
      ...subAppts.map(s => ({
        person: s.person_name || 'Persoon',
        service_id: s.service_id,
        service_name: services.find(sv => sv.id === s.service_id)?.name || '',
        assignment_mode: s.assignment_mode,
        assigned_employee: s.assigned_employee,
        assigned_time: s.assigned_time,
      })),
    ];

    const booked = getBookedSlots(form.date);
    const options: PlacementOption[] = [];

    // OPTION 1: Try simultaneous
    const simultaneousPlacements: { person: string; employee: string; time: string; service: string }[] = [];
    const targetTime = form.time;
    const usedEmps = new Set<string>();
    let allSimultaneous = true;

    for (const p of allPersons) {
      if (p.assignment_mode === 'manual' && p.assigned_employee) {
        const empBooked = booked.get(p.assigned_employee);
        if (empBooked && empBooked.has(targetTime)) { allSimultaneous = false; break; }
        simultaneousPlacements.push({ person: p.person, employee: p.assigned_employee, time: targetTime, service: p.service_name });
        usedEmps.add(p.assigned_employee);
      } else {
        const available = getAvailableEmployees(p.service_name).filter(m =>
          !usedEmps.has(m.name) && !(booked.get(m.name)?.has(targetTime))
        );
        if (available.length === 0) { allSimultaneous = false; break; }
        simultaneousPlacements.push({ person: p.person, employee: available[0].name, time: targetTime, service: p.service_name });
        usedEmps.add(available[0].name);
      }
    }

    if (allSimultaneous && simultaneousPlacements.length === allPersons.length) {
      options.push({ label: 'Tegelijk', description: 'Alle personen worden tegelijkertijd behandeld', placements: simultaneousPlacements, isSimultaneous: true });
    }

    // OPTION 2: Sequential
    const sequentialPlacements: { person: string; employee: string; time: string; service: string }[] = [];
    const seqBooked = new Map(booked);
    let currentSlotIdx = timeSlots.indexOf(targetTime);
    if (currentSlotIdx < 0) currentSlotIdx = 0;
    let allSequential = true;

    for (const p of allPersons) {
      const svc = services.find(s => s.id === p.service_id);
      const durationSlots = svc ? Math.ceil(svc.duration_minutes / 30) : 1;
      let placed = false;
      for (let si = currentSlotIdx; si < timeSlots.length && !placed; si++) {
        const tryTime = timeSlots[si];
        if (p.assignment_mode === 'manual' && p.assigned_employee) {
          const empBooked = seqBooked.get(p.assigned_employee);
          let canPlace = true;
          for (let d = 0; d < durationSlots; d++) {
            if (si + d >= timeSlots.length || empBooked?.has(timeSlots[si + d])) { canPlace = false; break; }
          }
          if (canPlace) {
            sequentialPlacements.push({ person: p.person, employee: p.assigned_employee, time: tryTime, service: p.service_name });
            if (!seqBooked.has(p.assigned_employee)) seqBooked.set(p.assigned_employee, new Set());
            for (let d = 0; d < durationSlots; d++) seqBooked.get(p.assigned_employee)!.add(timeSlots[si + d]);
            placed = true;
          }
        } else {
          const available = getAvailableEmployees(p.service_name);
          for (const emp of available) {
            const empBooked = seqBooked.get(emp.name);
            let canPlace = true;
            for (let d = 0; d < durationSlots; d++) {
              if (si + d >= timeSlots.length || empBooked?.has(timeSlots[si + d])) { canPlace = false; break; }
            }
            if (canPlace) {
              sequentialPlacements.push({ person: p.person, employee: emp.name, time: tryTime, service: p.service_name });
              if (!seqBooked.has(emp.name)) seqBooked.set(emp.name, new Set());
              for (let d = 0; d < durationSlots; d++) seqBooked.get(emp.name)!.add(timeSlots[si + d]);
              placed = true;
              break;
            }
          }
        }
      }
      if (!placed) { allSequential = false; break; }
    }

    if (allSequential && sequentialPlacements.length === allPersons.length) {
      const isActuallySequential = new Set(sequentialPlacements.map(p => p.time)).size > 1;
      if (isActuallySequential || options.length === 0) {
        options.push({
          label: isActuallySequential ? 'Na elkaar' : 'Tegelijk',
          description: isActuallySequential ? 'Personen worden achter elkaar ingepland met minimale wachttijd' : 'Alle personen op hetzelfde moment',
          placements: sequentialPlacements,
          isSimultaneous: !isActuallySequential,
        });
      }
    }

    if (options.length === 0) {
      toast.error("Niet alle personen tegelijk beschikbaar. Probeer een andere tijd of medewerker.");
    }

    return options;
  };

  const handlePrepareConfirmation = () => {
    if (!form.customer_id || !form.service_id || !form.date || !form.time) { toast.error("Vul alle velden in"); return; }
    if (subAppts.length > 0) {
      const options = generatePlacementOptions();
      if (options.length === 0) return;
      setPlacementOptions(options);
      setSelectedOption(0);
      const chosen = options[0];
      const updatedSubs = subAppts.map((sub, idx) => {
        const placement = chosen.placements[idx + 1];
        if (placement) return { ...sub, assigned_employee: placement.employee, assigned_time: placement.time };
        return sub;
      });
      setSubAppts(updatedSubs);
      setShowConfirmation(true);
    } else {
      handleAdd();
    }
  };

  const selectPlacementOption = (optIdx: number) => {
    setSelectedOption(optIdx);
    const chosen = placementOptions[optIdx];
    const updatedSubs = subAppts.map((sub, idx) => {
      const placement = chosen.placements[idx + 1];
      if (placement) return { ...sub, assigned_employee: placement.employee, assigned_time: placement.time };
      return sub;
    });
    setSubAppts(updatedSubs);
  };

  const handleAdd = async () => {
    if (!form.customer_id || !form.service_id || !form.date || !form.time) { toast.error("Vul alle velden in"); return; }
    const svc = services.find(s => s.id === form.service_id);
    const mainEmployee = placementOptions.length > 0 ? placementOptions[selectedOption].placements[0]?.employee : '';
    const dt = `${form.date}T${form.time}:00`;
    const endTime = addMinutes(form.time, svc?.duration_minutes || 30);

    // Multi-employee availability check (DB employees)
    if (selectedEmployeeIds.length > 0) {
      const conflictIds = new Set<string>();
      for (const empId of selectedEmployeeIds) {
        const conflict = (apptEmployees || []).some((link: any) => {
          if (link.employee_id !== empId) return false;
          const otherAppt = appointments.find((a: any) => a.id === link.appointment_id);
          if (!otherAppt) return false;
          if (getAppointmentDate(otherAppt) !== form.date) return false;
          return getAppointmentTime(otherAppt) === form.time;
        });
        if (conflict) conflictIds.add(empId);
      }
      if (conflictIds.size > 0) {
        toast.error("Een van de medewerkers is niet beschikbaar op dit tijdstip.");
        return;
      }
    }

    // Build employee names list for legacy notes (so existing logic keeps working)
    const selectedEmpNames = selectedEmployeeIds
      .map(id => activeDbEmployees.find((e: any) => e.id === id)?.name)
      .filter(Boolean) as string[];
    const employeeLabel = selectedEmpNames.length > 0
      ? selectedEmpNames.join(' & ')
      : (mainEmployee || 'Niet toegewezen');

    const result = await insert({
      customer_id: form.customer_id,
      service_id: form.service_id,
      appointment_date: dt,
      start_time: form.time,
      end_time: endTime,
      price: svc?.price || 0,
      notes: subAppts.length > 0
        ? `Groepsboeking: ${subAppts.length + 1} personen | Medewerker: ${employeeLabel}`
        : `Medewerker: ${employeeLabel}`,
      status: 'gepland',
    });

    // Persist multi-employee links
    if (result && selectedEmployeeIds.length > 0 && user) {
      const rows = selectedEmployeeIds.map((eid, i) => ({
        appointment_id: result.id,
        employee_id: eid,
        user_id: user.id,
        is_primary: i === 0,
        is_demo: (result as any).is_demo === true,
      }));
      const { error: aeErr } = await (supabase.from("appointment_employees") as any).insert(rows);
      if (aeErr) console.error("appointment_employees insert error", aeErr);
    }

    if (result && subAppts.length > 0 && user) {
      for (const sub of subAppts) {
        if (sub.person_name && sub.service_id) {
          const subSvc = services.find(s => s.id === sub.service_id);
          const subTime = sub.assigned_time || form.time;
          await (supabase.from("sub_appointments") as any).insert({
            parent_appointment_id: result.id,
            person_name: sub.person_name,
            service_id: sub.service_id,
            price: subSvc?.price || 0,
            user_id: user.id,
            assigned_employee_id: null,
            assignment_mode: sub.assignment_mode,
            notes: `Medewerker: ${sub.assigned_employee || 'Niet toegewezen'} | Tijd: ${subTime}${sub.assignment_mode === 'auto' ? ' | ⚡ Automatisch geplaatst' : ' | ✋ Handmatig gekozen'}`,
          });
        }
      }
    }
    if (result) {
      toast.success(subAppts.length > 0 ? `Groepsboeking aangemaakt (${subAppts.length + 1} personen)` : "Afspraak aangemaakt");
      setShowAdd(false);
      setShowConfirmation(false);
      setSubAppts([]);
      setSelectedEmployeeIds([]);
      setPlacementOptions([]);
      refetch();
      refetchApptEmps();
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
    setShowConfirmation(false);
    setPlacementOptions([]);
    setForm({ customer_id: '', service_id: '', date, time, notes: '' });
    setSubAppts([]);
    setSelectedEmployeeIds([]);
  };

  const addSubAppt = () => {
    setSubAppts(prev => [...prev, { person_name: '', service_id: '', assignment_mode: 'auto', assigned_employee: '', assigned_time: form.time }]);
  };

  const getEmployeesForService = (serviceId: string) => {
    const svc = services.find(s => s.id === serviceId);
    if (!svc) return MEDEWERKERS;
    return getAvailableEmployees(svc.name);
  };

  const isToday = dateStr === formatLocalDate(new Date());

  // Workload variant colors using semantic tokens
  const workloadColors: Record<string, string> = {
    success: 'text-primary bg-primary/10',
    warning: 'text-foreground bg-accent',
    destructive: 'text-destructive bg-destructive/10',
    default: 'text-muted-foreground bg-secondary',
    muted: 'text-muted-foreground bg-secondary/50',
  };

  return (
    <AppLayout title="Agenda" subtitle="Beheer je afspraken en vind lege plekken."
      actions={
        <div className="flex items-center gap-2">
          {!isToday && (
            <Button variant="outline" size="sm" onClick={goToToday}>
              <CalendarDays className="w-4 h-4 mr-1" /> Vandaag
            </Button>
          )}
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button onClick={() => setView('day')} className={cn("px-4 py-2 text-sm font-medium transition-colors", view === 'day' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground')}>Dag</button>
            <button onClick={() => setView('week')} className={cn("px-4 py-2 text-sm font-medium transition-colors", view === 'week' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground')}>Week</button>
          </div>
          <Button variant="gradient" size="sm" onClick={() => openAddModal(dateStr, '09:00')}>
            <Plus className="w-4 h-4" /> Nieuwe Afspraak
          </Button>
        </div>
      }>

      {/* Employee selector & workload overview */}
      <div className="mb-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '30ms' }}>
        {/* Employee quick-switch bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSelectedEmployee('alle')}
            className={cn("px-3 py-1.5 rounded-xl text-xs font-medium border transition-all",
              selectedEmployee === 'alle' ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary")}
          >
            Alle medewerkers
          </button>
          {displayEmployees.map((emp: any) => {
            const status = getEmployeeStatus(emp, currentDate);
            const wl = getWorkloadLabel(emp, dateStr);
            const apptCount = getEmployeeApptCount(emp, dateStr);
            const isSelected = selectedEmployee === emp.id;
            return (
              <button key={emp.id} onClick={() => setSelectedEmployee(emp.id)}
                className={cn("px-3 py-1.5 rounded-xl text-xs font-medium border transition-all flex items-center gap-1.5",
                  isSelected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary",
                  status === 'afwezig' && !isSelected && "opacity-50"
                )}
              >
                <EmployeeAvatar employee={emp} size="xs" ring={false} />
                {emp.name}
                {status === 'afwezig' ? (
                  <span className="text-[10px] text-destructive">Afwezig</span>
                ) : (
                  <span className={cn("text-[10px] px-1 py-0.5 rounded", workloadColors[wl.variant])}>{apptCount}</span>
                )}
              </button>
            );
          })}
          <button onClick={() => setShowFilters(!showFilters)}
            className={cn("px-2 py-1.5 rounded-xl border transition-all",
              showFilters ? "border-primary text-primary bg-primary/5" : "border-border text-muted-foreground hover:text-foreground")}>
            <Filter className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="mt-2 p-3 rounded-xl bg-secondary/30 border border-border flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">Filter:</span>
            {['alle', 'beschikbaar', 'afwezig'].map(f => (
              <button key={f} onClick={() => setFilterAvailability(f)}
                className={cn("px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                  filterAvailability === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                {f === 'alle' ? 'Alle' : f === 'beschikbaar' ? 'Beschikbaar' : 'Afwezig'}
              </button>
            ))}
            <span className="text-[10px] text-muted-foreground ml-auto">
              {filteredMedewerkers.length} medewerker{filteredMedewerkers.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Compact workload overview */}
        {selectedEmployee === 'alle' && (
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {filteredMedewerkers.map((emp: any) => {
              const status = getEmployeeStatus(emp, currentDate);
              const wl = getWorkloadLabel(emp, dateStr);
              const freeSlots = getEmployeeFreeSlots(emp, dateStr);
              const apptCount = getEmployeeApptCount(emp, dateStr);
              return (
                <button key={emp.id} onClick={() => setSelectedEmployee(emp.id)}
                  className="p-2.5 rounded-xl bg-secondary/30 border border-border hover:bg-secondary/50 transition-all text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <EmployeeAvatar employee={emp} size="sm" ring={false} />
                    <span className="text-xs font-medium truncate">{emp.name}</span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded ml-auto", workloadColors[wl.variant])}>{wl.label}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {status === 'afwezig' ? 'Niet werkzaam vandaag' : (
                      <>{apptCount} afspraken · {freeSlots} vrij</>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{emp.role}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Empty slot indicator */}
      {view === 'day' && emptySlotCount > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/10 flex items-center gap-2 opacity-0 animate-fade-in-up" style={{ animationDelay: '50ms' }}>
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs text-muted-foreground">
            <strong className="text-foreground">{emptySlotCount} vrije slots</strong> vandaag
            {selectedEmployee !== 'alle' && ` voor ${displayEmployees.find((e: any) => e.id === selectedEmployee || e.name === selectedEmployee)?.name || selectedEmployee}`}
            {' '}— klik op een leeg tijdslot om direct te boeken
          </span>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowAdd(false); setShowConfirmation(false); }}>
          <div className="glass-card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

            {showConfirmation ? (
              <>
                <h3 className="text-lg font-semibold mb-4">Groepsboeking bevestigen</h3>
                {placementOptions.length > 1 && (
                  <div className="mb-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Kies een plaatsingsoptie:</p>
                    {placementOptions.map((opt, idx) => (
                      <button key={idx} onClick={() => selectPlacementOption(idx)}
                        className={cn("w-full text-left p-3 rounded-xl border transition-all",
                          selectedOption === idx ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/50")}>
                        <div className="flex items-center gap-2">
                          {opt.isSimultaneous ? <Users className="w-4 h-4 text-primary" /> : <Clock className="w-4 h-4 text-primary" />}
                          <div>
                            <span className="text-sm font-medium">{opt.label}</span>
                            <p className="text-[11px] text-muted-foreground">{opt.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="space-y-2.5">
                  {(placementOptions[selectedOption]?.placements || []).map((p, idx) => (
                    <div key={idx} className={cn("p-3 rounded-xl border flex items-center gap-3",
                      idx === 0 ? "bg-primary/5 border-primary/10" : "bg-secondary/30 border-border")}>
                      <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{p.person}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.service} · {p.time} · <span className="font-medium">{p.employee}</span>
                        </p>
                        <span className="text-[10px] text-primary">
                          {idx === 0 ? '✋ Hoofdpersoon' :
                            subAppts[idx - 1]?.assignment_mode === 'auto' ? '⚡ Automatisch geplaatst' : '✋ Handmatig gekozen'}
                        </span>
                      </div>
                      <span className="text-xs font-medium">
                        {formatEuro(idx === 0
                          ? (services.find(s => s.id === form.service_id)?.price || 0)
                          : (services.find(s => s.id === subAppts[idx - 1]?.service_id)?.price || 0)
                        )}
                      </span>
                    </div>
                  ))}
                  <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-sm font-semibold flex justify-between">
                    <span>Totaal ({(placementOptions[selectedOption]?.placements.length || 0)} personen)</span>
                    <span>{formatEuro(
                      (services.find(s => s.id === form.service_id)?.price || 0) +
                      subAppts.reduce((sum, s) => sum + (services.find(sv => sv.id === s.service_id)?.price || 0), 0)
                    )}</span>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" className="flex-1" onClick={() => setShowConfirmation(false)}>Terug</Button>
                  <Button variant="gradient" className="flex-1" onClick={handleAdd}>Bevestigen & Opslaan</Button>
                </div>
              </>
            ) : (
              <>
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

                  {/* Multi-employee assignment (DB employees) */}
                  {activeDbEmployees.length > 0 && (
                    <div className="border-t border-border pt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium flex items-center gap-1.5">
                          <UserPlus2 className="w-3.5 h-3.5" />Medewerker(s)
                          {selectedEmployeeIds.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">({selectedEmployeeIds.length} geselecteerd)</span>
                          )}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {activeDbEmployees.map((emp: any) => {
                          const selected = selectedEmployeeIds.includes(emp.id);
                          return (
                            <button
                              type="button"
                              key={emp.id}
                              onClick={() => setSelectedEmployeeIds(prev =>
                                prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id]
                              )}
                              className={cn(
                                "flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all text-xs",
                                selected
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border bg-card hover:border-primary/40"
                              )}
                            >
                              <EmployeeAvatar employee={emp} size="sm" ring={false} />
                              <span className="font-medium">{emp.name}</span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Selecteer één of meerdere medewerkers. Dubbele boekingen worden gecontroleerd.
                      </p>
                    </div>
                  )}

                  {/* Group booking section */}
                  <div className="border-t border-border pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium flex items-center gap-1"><Users className="w-3.5 h-3.5" />Groepsboeking</span>
                      <Button variant="outline" size="sm" onClick={addSubAppt}>
                        <Plus className="w-3 h-3 mr-1" />Persoon
                      </Button>
                    </div>
                    {subAppts.map((sub, idx) => {
                      const availableEmps = getEmployeesForService(sub.service_id);
                      return (
                        <div key={idx} className="p-3 rounded-xl bg-secondary/30 border border-border mb-2 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">Persoon {idx + 2}</span>
                            <button onClick={() => setSubAppts(prev => prev.filter((_, i) => i !== idx))} className="p-1 rounded hover:bg-destructive/20">
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </button>
                          </div>
                          <input placeholder="Naam (bijv. Kind 1, Moeder)" value={sub.person_name}
                            onChange={e => { const updated = [...subAppts]; updated[idx].person_name = e.target.value; setSubAppts(updated); }}
                            className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm" />
                          <select value={sub.service_id}
                            onChange={e => { const updated = [...subAppts]; updated[idx].service_id = e.target.value; updated[idx].assigned_employee = ''; setSubAppts(updated); }}
                            className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm">
                            <option value="">Behandeling</option>
                            {services.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name} — {formatEuro(s.price)}</option>)}
                          </select>
                          <div className="flex gap-2">
                            <button onClick={() => { const u = [...subAppts]; u[idx].assignment_mode = 'manual'; setSubAppts(u); }}
                              className={cn("flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                                sub.assignment_mode === 'manual' ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                              ✋ Handmatig
                            </button>
                            <button onClick={() => { const u = [...subAppts]; u[idx].assignment_mode = 'auto'; u[idx].assigned_employee = ''; setSubAppts(u); }}
                              className={cn("flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                                sub.assignment_mode === 'auto' ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                              <Zap className="w-3 h-3 inline mr-0.5" />Automatisch
                            </button>
                          </div>
                          {sub.assignment_mode === 'manual' && (
                            <div className="grid grid-cols-2 gap-2">
                              <select value={sub.assigned_employee}
                                onChange={e => { const u = [...subAppts]; u[idx].assigned_employee = e.target.value; setSubAppts(u); }}
                                className="px-3 py-2 rounded-xl bg-background border border-border text-sm">
                                <option value="">Medewerker</option>
                                {availableEmps.map(emp => (
                                  <option key={emp.name} value={emp.name}>{emp.name} ({emp.role})</option>
                                ))}
                              </select>
                              <select value={sub.assigned_time}
                                onChange={e => { const u = [...subAppts]; u[idx].assigned_time = e.target.value; setSubAppts(u); }}
                                className="px-3 py-2 rounded-xl bg-background border border-border text-sm">
                                {timeSlots.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                          )}
                          {sub.assignment_mode === 'auto' && sub.service_id && (
                            <div className="px-2 py-1.5 rounded-lg bg-primary/5 border border-primary/10">
                              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Zap className="w-3 h-3 text-primary" />
                                Beschikbare medewerkers: {availableEmps.map(e => e.name).join(', ')}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">Wordt automatisch bij beste slot geplaatst</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {subAppts.length > 0 && form.service_id && (
                      <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 text-sm mt-2">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Totaalprijs:</span>
                          <span className="font-bold">{formatEuro(
                            (services.find(s => s.id === form.service_id)?.price || 0) +
                            subAppts.reduce((sum, s) => sum + (services.find(sv => sv.id === s.service_id)?.price || 0), 0)
                          )}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">{subAppts.length + 1} personen</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" className="flex-1" onClick={() => { setShowAdd(false); setShowConfirmation(false); }}>Annuleren</Button>
                  <Button variant="gradient" className="flex-1" onClick={handlePrepareConfirmation}>
                    {subAppts.length > 0 ? 'Bekijk plaatsing' : 'Opslaan'}
                  </Button>
                </div>
              </>
            )}
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
            {view === 'day' ? `${dayAppts.length} afspraken` : `${filterByEmployee(appointments.filter(a => weekDays.some(d => getAppointmentDate(a) === formatLocalDate(d)))).length} afspraken`}
            {selectedEmployee !== 'alle' && ` · ${displayEmployees.find((e: any) => e.id === selectedEmployee || e.name === selectedEmployee)?.name || selectedEmployee}`}
          </span>
        </div>

        {view === 'day' ? (
          <div className="relative">
            {timeSlots.map((slot) => {
              const apt = dayAppts.find(a => {
                return getAppointmentTime(a) === slot;
              });
              const svc = apt ? services.find(s => s.id === apt.service_id) : null;
              const cust = apt ? customers.find(c => c.id === apt.customer_id) : null;
              const isGroupBooking = apt?.notes?.includes('Groepsboeking');
              const employeeName = apt?.notes?.match(/Medewerker: (\w+)/)?.[1];

              // Check if this slot is a pause for the selected employee
              const selectedEmp = displayEmployees.find((m: any) => m.id === selectedEmployee || m.name === selectedEmployee);
              const isPauzeSlot = selectedEmp && isSlotPauze(selectedEmp, slot);

              return (
                <div key={slot} className="flex gap-4 group min-h-[48px]">
                  <span className="w-14 text-xs text-muted-foreground py-3 tabular-nums flex-shrink-0">{slot}</span>
                  <div className="flex-1 border-t border-border/50 relative">
                    {isPauzeSlot && !apt ? (
                      <div className="absolute inset-x-0 top-1 h-[40px] rounded-xl bg-accent/50 border border-border/30 flex items-center justify-center">
                        <span className="text-[11px] text-muted-foreground">☕ Pauze — {selectedEmp?.name || selectedEmployee}</span>
                      </div>
                    ) : apt ? (() => {
                      const displayEmps = getDisplayEmployees(apt);
                      return (
                      <div className="absolute inset-x-0 top-1 rounded-xl p-3 transition-all duration-200 hover:scale-[1.01] cursor-pointer"
                        style={{ backgroundColor: `${svc?.color || '#7B61FF'}15`, borderLeft: `3px solid ${svc?.color || '#7B61FF'}`, minHeight: `${((svc?.duration_minutes || 30) / 30) * 48 - 8}px` }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            {displayEmps.length > 0 && (
                              <div className="pt-0.5 shrink-0">
                                <EmployeeAvatarStack employees={displayEmps} size="md" max={3} />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{cust?.name || 'Klant'}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <p className="text-xs text-muted-foreground truncate">{svc?.name || 'Behandeling'}</p>
                                <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Clock className="w-3 h-3" />{svc?.duration_minutes || 30} min</span>
                              </div>
                              {displayEmps.length > 0 && (
                                <span className="text-[11px] text-foreground/70 mt-0.5 block truncate">
                                  {displayEmps.map((e: any) => e.name).join(', ')}
                                </span>
                              )}
                              {isGroupBooking && (
                                <span className="text-[10px] text-primary flex items-center gap-0.5 mt-0.5"><Users className="w-3 h-3" />Groepsboeking</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {(apt as any).payment_status && (apt as any).payment_status !== 'none' && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                (apt as any).payment_status === 'betaald' ? 'bg-primary/15 text-primary' :
                                (apt as any).payment_status === 'mislukt' ? 'bg-destructive/15 text-destructive' :
                                'bg-accent text-foreground'
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
                      );
                    })() : (
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
                const ds = formatLocalDate(day);
                const apts = filterByEmployee(appointments.filter(a => getAppointmentDate(a) === ds));
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
                        const time = getAppointmentTime(apt);
                        const displayEmps = getDisplayEmployees(apt);
                        return (
                          <div key={apt.id} className="p-2.5 rounded-xl cursor-pointer transition-all duration-200 hover:scale-[1.02]"
                            style={{ backgroundColor: `${svc?.color || '#7B61FF'}12`, borderLeft: `2px solid ${svc?.color || '#7B61FF'}` }}>
                            <div className="flex items-start gap-2">
                              {displayEmps.length > 0 && (
                                <div className="shrink-0 pt-0.5">
                                  <EmployeeAvatarStack employees={displayEmps} size="xs" max={2} />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">{cust?.name || 'Klant'}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{time} · {svc?.name || ''}</p>
                                {displayEmps.length > 0 && (
                                  <p className="text-[10px] text-foreground/60 truncate">{displayEmps.map((e: any) => e.name).join(', ')}</p>
                                )}
                              </div>
                            </div>
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
