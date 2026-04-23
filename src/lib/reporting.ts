import type { Tables } from "@/integrations/supabase/types";

export type DatePreset = "vandaag" | "7d" | "30d" | "deze_maand" | "vorige_maand" | "custom";
export type DataMode = "live" | "demo" | "all";

type Appointment = Tables<"appointments">;
type Customer = Tables<"customers">;
type Service = Tables<"services">;
type Payment = Tables<"payments">;
type Refund = Tables<"payment_refunds">;

const AMSTERDAM_TZ = "Europe/Amsterdam";
const PAID_STATUSES = new Set(["paid", "betaald", "completed", "succeeded"]);
const REFUND_STATUSES = new Set(["paid", "succeeded", "completed", "refunded", "processed"]);
const CANCELED_STATUSES = new Set(["geannuleerd", "cancelled", "canceled"]);
const FINISHED_STATUSES = new Set(["voltooid", "afgerond", "completed"]);
const NO_SHOW_STATUSES = new Set(["no_show", "no-show", "noshow"]);
const OPEN_PAYMENT_STATUSES = new Set(["unpaid", "partial", "pending", "open", "none", "deels_betaald", "niet_betaald"]);

export const eur = (amount: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(amount || 0);

export function amsterdamDateKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AMSTERDAM_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function iso(d: Date) {
  return d.toISOString().split("T")[0];
}

export function rangeForPreset(preset: DatePreset, customFrom?: string, customTo?: string) {
  const now = new Date();
  const today = startOfDay(now);
  if (preset === "custom") return { from: customFrom || iso(addDays(today, -30)), to: customTo || iso(today) };
  if (preset === "vandaag") return { from: iso(today), to: iso(today) };
  if (preset === "7d") return { from: iso(addDays(today, -6)), to: iso(today) };
  if (preset === "30d") return { from: iso(addDays(today, -29)), to: iso(today) };
  if (preset === "vorige_maand") {
    const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastPrevMonth = addDays(firstThisMonth, -1);
    return { from: iso(firstPrevMonth), to: iso(lastPrevMonth) };
  }
  return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
}

export function inDateRange(value: string | null | undefined, from: string, to: string) {
  if (!value) return false;
  const key = amsterdamDateKey(value);
  return key >= from && key <= to;
}

function modeFilter<T extends { is_demo: boolean }>(rows: T[], mode: DataMode) {
  if (mode === "all") return rows;
  return rows.filter((row) => (mode === "demo" ? row.is_demo : !row.is_demo));
}

function isPaid(payment: Payment) {
  return PAID_STATUSES.has(String(payment.status || "").toLowerCase());
}

function isRefunded(refund: Refund) {
  return REFUND_STATUSES.has(String(refund.status || "").toLowerCase());
}

function isCanceled(appointment: Appointment) {
  return CANCELED_STATUSES.has(String(appointment.status || "").toLowerCase());
}

function isFinished(appointment: Appointment) {
  return FINISHED_STATUSES.has(String(appointment.status || "").toLowerCase());
}

function isNoShow(appointment: Appointment) {
  return NO_SHOW_STATUSES.has(String(appointment.status || "").toLowerCase());
}

function sum(rows: number[]) {
  return rows.reduce((total, value) => total + (Number(value) || 0), 0);
}

function pct(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function previousRange(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
  const prevTo = addDays(fromDate, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: iso(prevFrom), to: iso(prevTo) };
}

export function buildReports(params: {
  appointments: Appointment[];
  customers: Customer[];
  services: Service[];
  payments: Payment[];
  refunds: Refund[];
  mode: DataMode;
  from: string;
  to: string;
}) {
  const { from, to, mode } = params;
  const appointments = modeFilter(params.appointments, mode);
  const customers = modeFilter(params.customers, mode);
  const services = modeFilter(params.services, mode);
  const payments = modeFilter(params.payments, mode);
  const refunds = modeFilter(params.refunds, mode);
  const today = amsterdamDateKey(new Date());
  const weekStart = iso(addDays(startOfDay(new Date()), -6));
  const monthStart = iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const prev = previousRange(from, to);

  const paidPayments = payments.filter(isPaid);
  const periodPayments = paidPayments.filter((p) => inDateRange(p.created_at, from, to));
  const previousPayments = paidPayments.filter((p) => inDateRange(p.created_at, prev.from, prev.to));
  const periodAppointments = appointments.filter((a) => inDateRange(a.appointment_date, from, to));
  const validPeriodAppointments = periodAppointments.filter((a) => !isCanceled(a));
  const previousAppointments = appointments.filter((a) => inDateRange(a.appointment_date, prev.from, prev.to) && !isCanceled(a));
  const periodCustomers = customers.filter((c) => inDateRange(c.created_at, from, to));
  const previousCustomers = customers.filter((c) => inDateRange(c.created_at, prev.from, prev.to));
  const periodRefunds = refunds.filter((r) => isRefunded(r) && inDateRange(r.created_at, from, to));
  const refundTotal = sum(periodRefunds.map((r) => Number(r.amount)));
  const openAppointments = appointments.filter((a) => !isCanceled(a) && OPEN_PAYMENT_STATUSES.has(String(a.payment_status || "none").toLowerCase()));
  const openAmount = sum(openAppointments.map((a) => Math.max(0, Number(a.price || 0) - Number(a.amount_paid || 0))));
  const upcomingAppointments = appointments.filter((a) => !isCanceled(a) && new Date(a.appointment_date) > new Date());
  const upcoming7Revenue = sum(upcomingAppointments.filter((a) => inDateRange(a.appointment_date, today, iso(addDays(startOfDay(new Date()), 7)))).map((a) => Number(a.price)));

  const serviceMap = new Map(services.map((s) => [s.id, s]));
  const serviceTotals = new Map<string, { name: string; bookings: number; revenue: number }>();
  validPeriodAppointments.forEach((appointment) => {
    const service = appointment.service_id ? serviceMap.get(appointment.service_id) : null;
    const name = service?.name || "Onbekend";
    const current = serviceTotals.get(name) || { name, bookings: 0, revenue: 0 };
    current.bookings += 1;
    current.revenue += Number(appointment.price) || 0;
    serviceTotals.set(name, current);
  });

  const dayTotals = new Map<string, { label: string; count: number; revenue: number }>();
  validPeriodAppointments.forEach((appointment) => {
    const date = new Date(appointment.appointment_date);
    const label = new Intl.DateTimeFormat("nl-NL", { timeZone: AMSTERDAM_TZ, weekday: "long" }).format(date);
    const current = dayTotals.get(label) || { label, count: 0, revenue: 0 };
    current.count += 1;
    current.revenue += Number(appointment.price) || 0;
    dayTotals.set(label, current);
  });

  const timeTotals = new Map<string, number>();
  validPeriodAppointments.forEach((appointment) => {
    const label = new Intl.DateTimeFormat("nl-NL", { timeZone: AMSTERDAM_TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(appointment.appointment_date));
    timeTotals.set(label, (timeTotals.get(label) || 0) + 1);
  });

  const customerRevenue = customers.map((customer) => {
    const customerPayments = paidPayments.filter((p) => p.customer_id === customer.id);
    const visits = appointments.filter((a) => a.customer_id === customer.id && !isCanceled(a));
    const lastVisit = visits.sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email || "",
      phone: customer.phone || "",
      revenue: sum(customerPayments.map((p) => Number(p.amount))),
      visits: visits.length,
      lastVisit: lastVisit?.appointment_date || null,
      ltv: sum(customerPayments.map((p) => Number(p.amount))),
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const returningCustomers = customerRevenue.filter((c) => c.visits > 1).length;
  const inactive60 = customerRevenue.filter((customer) => {
    if (!customer.lastVisit) return true;
    return (Date.now() - new Date(customer.lastVisit).getTime()) / 86400000 > 60;
  });
  const visitFrequency = customers.length > 0 ? sum(customerRevenue.map((c) => c.visits)) / customers.length : 0;
  const bestDayEver = Array.from(dayTotals.values()).sort((a, b) => b.revenue - a.revenue)[0] || { label: "—", revenue: 0, count: 0 };
  const bestCustomerThisMonth = customerRevenue.find((customer) => paidPayments.some((p) => p.customer_id === customer.id && inDateRange(p.created_at, monthStart, today))) || customerRevenue[0];
  const totalRevenue = sum(periodPayments.map((p) => Number(p.amount)));
  const previousRevenue = sum(previousPayments.map((p) => Number(p.amount)));
  const avgOrderValue = periodPayments.length ? totalRevenue / periodPayments.length : 0;
  const noShowCount = periodAppointments.filter(isNoShow).length;
  const noShowPct = periodAppointments.length ? Math.round((noShowCount / periodAppointments.length) * 100) : 0;

  return {
    range: { from, to, previousFrom: prev.from, previousTo: prev.to },
    rows: { appointments, customers, services, payments, refunds, paidPayments, periodPayments, periodAppointments, validPeriodAppointments, periodRefunds, customerRevenue, openAppointments },
    revenue: {
      today: sum(paidPayments.filter((p) => inDateRange(p.created_at, today, today)).map((p) => Number(p.amount))),
      week: sum(paidPayments.filter((p) => inDateRange(p.created_at, weekStart, today)).map((p) => Number(p.amount))),
      month: sum(paidPayments.filter((p) => inDateRange(p.created_at, monthStart, today)).map((p) => Number(p.amount))),
      lifetime: sum(paidPayments.map((p) => Number(p.amount))),
      period: totalRevenue,
      averageOrder: avgOrderValue,
      openAmount,
      refundTotal,
      previousPeriod: previousRevenue,
      trend: pct(totalRevenue, previousRevenue),
    },
    appointments: {
      today: appointments.filter((a) => inDateRange(a.appointment_date, today, today) && !isCanceled(a)).length,
      upcoming: upcomingAppointments.length,
      completed: periodAppointments.filter(isFinished).length,
      canceled: periodAppointments.filter(isCanceled).length,
      noShowPct,
      averageValue: validPeriodAppointments.length ? sum(validPeriodAppointments.map((a) => Number(a.price))) / validPeriodAppointments.length : 0,
      mostPopularService: Array.from(serviceTotals.values()).sort((a, b) => b.bookings - a.bookings)[0]?.name || "—",
      busiestDay: Array.from(dayTotals.values()).sort((a, b) => b.count - a.count)[0]?.label || "—",
      busiestTime: Array.from(timeTotals.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "—",
      trend: pct(validPeriodAppointments.length, previousAppointments.length),
    },
    customers: {
      newThisMonth: customers.filter((c) => inDateRange(c.created_at, monthStart, today)).length,
      newPeriod: periodCustomers.length,
      returningPct: customers.length ? Math.round((returningCustomers / customers.length) * 100) : 0,
      top10: customerRevenue.slice(0, 10),
      inactive60,
      averageVisitFrequency: visitFrequency,
      bestThisMonth: bestCustomerThisMonth,
      trend: pct(periodCustomers.length, previousCustomers.length),
    },
    wow: {
      bestDayEver,
      bestCustomerThisMonth,
      upcoming7Revenue,
      monthlyGoal: 5000,
      monthlyGoalProgress: Math.min(100, Math.round((sum(paidPayments.filter((p) => inDateRange(p.created_at, monthStart, today)).map((p) => Number(p.amount))) / 5000) * 100)),
    },
    services: Array.from(serviceTotals.values()).sort((a, b) => b.revenue - a.revenue),
  };
}

export function trendLabel(value: number) {
  if (value > 0) return `+${value}%`;
  return `${value}%`;
}

export function trendClass(value: number) {
  if (value > 0) return "text-success bg-success/10";
  if (value < 0) return "text-destructive bg-destructive/10";
  return "text-muted-foreground bg-secondary/50";
}
