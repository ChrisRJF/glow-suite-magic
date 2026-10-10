const TZ = "Europe/Amsterdam";

/** Kalenderdatum (YYYY-MM-DD) en ISO-weekdag (1=ma..7=zo) in Europe/Amsterdam. */
function amsterdamParts(date: Date): { ymd: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, weekday: map[get("weekday")] ?? 1 };
}

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Maandag en zondag (YYYY-MM-DD, Amsterdamse kalender) van de week waarin `now` valt. */
export function amsterdamWeekBounds(now: Date = new Date()): { monday: string; sunday: string } {
  const { ymd, weekday } = amsterdamParts(now);
  const monday = shiftYmd(ymd, -(weekday - 1));
  return { monday, sunday: shiftYmd(monday, 6) };
}

/** Aantal klanten aangemaakt in de huidige kalenderweek (ma t/m zo, Europe/Amsterdam). */
export function countNewCustomersThisWeek(
  customers: Array<{ created_at?: string | null }>,
  now: Date = new Date(),
): number {
  const { monday, sunday } = amsterdamWeekBounds(now);
  let n = 0;
  for (const c of customers) {
    if (!c.created_at) continue;
    const d = new Date(c.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const { ymd } = amsterdamParts(d);
    if (ymd >= monday && ymd <= sunday) n++;
  }
  return n;
}
