/** Group non-cancelled appointments per customer_id once, newest first (same order as before). */
export function indexAppointmentsByCustomer<T extends { customer_id?: string | null; status?: string | null; appointment_date: string }>(appointments: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const a of appointments) {
    if (!a.customer_id || a.status === "geannuleerd") continue;
    const list = map.get(a.customer_id);
    if (list) list.push(a); else map.set(a.customer_id, [a]);
  }
  for (const list of map.values()) list.sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime());
  return map;
}
