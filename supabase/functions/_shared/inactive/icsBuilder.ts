// INACTIVE: prepared .ics builder for a future, separately approved calendar endpoint.
// Not imported by any entrypoint. No public endpoint is built or activated.
// Intended use: endpoint looks up the appointment by the random booking_token (uuid)
// server-side, checks salon + status, then returns buildIcs(...). Never by appointment id.

export type IcsInput = {
  uid: string;          // stable, non-guessable (e.g. booking_token@glowsuite.nl)
  date: string;         // YYYY-MM-DD (salon local, Europe/Amsterdam)
  time: string;         // HH:MM (salon local)
  durationMinutes: number;
  summary: string;
  location?: string;
  now?: Date;
};

const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Amsterdam",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
const pad = (n: number) => String(n).padStart(2, "0");

export function buildIcs(i: IcsInput): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(i.date);
  const t = /^(\d{2}):(\d{2})$/.exec(i.time);
  if (!d || !t) throw new Error("invalid_datetime");
  const [y, mo, da, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  const check = new Date(Date.UTC(y, mo - 1, da, h, mi));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== da || h > 23 || mi > 59) throw new Error("invalid_datetime");
  if (!Number.isInteger(i.durationMinutes) || i.durationMinutes <= 0 || i.durationMinutes > 24 * 60) throw new Error("invalid_duration");
  // Wall-clock arithmetic in local time (TZID), so DST is handled by the calendar client.
  const end = new Date(check.getTime() + i.durationMinutes * 60000);
  const local = (x: Date) => `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}00`;
  const now = i.now ?? new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GlowSuite//Afspraak//NL", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    ...VTIMEZONE,
    "BEGIN:VEVENT",
    `UID:${esc(i.uid)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Amsterdam:${local(check)}`,
    `DTEND;TZID=Europe/Amsterdam:${local(end)}`,
    `SUMMARY:${esc(i.summary)}`,
    ...(i.location ? [`LOCATION:${esc(i.location)}`] : []),
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
