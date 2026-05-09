import { useCallback, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Download, Loader2, ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";

type ImportType = "customers" | "services" | "appointments" | "employees" | "waitlist";
type SourceSystem = "salonized" | "fresha" | "treatwell" | "other";

const TYPE_LABELS: Record<ImportType, string> = {
  customers: "Klanten",
  services: "Behandelingen / Diensten",
  appointments: "Afspraken",
  employees: "Medewerkers / Team",
  waitlist: "Wachtlijst",
};

const SOURCE_LABELS: Record<SourceSystem, string> = {
  salonized: "Salonized",
  fresha: "Fresha",
  treatwell: "Treatwell",
  other: "Excel / Anders",
};

// Target field definitions per import type
const FIELDS: Record<ImportType, { key: string; label: string; required?: boolean }[]> = {
  customers: [
    { key: "name", label: "Naam", required: true },
    { key: "email", label: "E-mail" },
    { key: "phone", label: "Telefoon" },
    { key: "birthday", label: "Geboortedatum" },
    { key: "notes", label: "Notities" },
    { key: "total_spent", label: "Totaal besteed" },
    { key: "tags", label: "Tags" },
  ],
  services: [
    { key: "name", label: "Naam", required: true },
    { key: "duration_minutes", label: "Duur (minuten)" },
    { key: "price", label: "Prijs" },
    { key: "category", label: "Categorie" },
    { key: "description", label: "Beschrijving" },
    { key: "is_active", label: "Actief" },
  ],
  appointments: [
    { key: "customer_name", label: "Klant naam" },
    { key: "customer_email", label: "Klant e-mail" },
    { key: "customer_phone", label: "Klant telefoon" },
    { key: "service_name", label: "Behandeling" },
    { key: "employee_name", label: "Medewerker" },
    { key: "date", label: "Datum", required: true },
    { key: "start_time", label: "Starttijd" },
    { key: "end_time", label: "Eindtijd" },
    { key: "status", label: "Status" },
    { key: "price", label: "Prijs" },
    { key: "notes", label: "Notities" },
  ],
  employees: [
    { key: "name", label: "Naam", required: true },
    { key: "email", label: "E-mail" },
    { key: "phone", label: "Telefoon" },
    { key: "role", label: "Functie" },
    { key: "working_days", label: "Werkdagen" },
    { key: "color", label: "Kleur" },
  ],
  waitlist: [
    { key: "customer_name", label: "Klant naam" },
    { key: "customer_email", label: "Klant e-mail" },
    { key: "customer_phone", label: "Klant telefoon" },
    { key: "service_name", label: "Behandeling" },
    { key: "preferred_day", label: "Voorkeursdag" },
    { key: "preferred_time", label: "Voorkeurstijd" },
    { key: "notes", label: "Notities" },
  ],
};

// Auto-detect: aliases from various sources to target fields
const ALIASES: Record<ImportType, Record<string, string[]>> = {
  customers: {
    name: ["name", "naam", "klant", "customer", "full name", "voornaam achternaam", "klantnaam", "first name last name"],
    email: ["email", "e-mail", "mail", "e mail"],
    phone: ["phone", "telefoon", "mobile", "mobiel", "tel", "phone number", "telefoonnummer"],
    birthday: ["birthday", "geboortedatum", "dob", "date of birth", "verjaardag"],
    notes: ["notes", "notitie", "notities", "opmerking", "comments"],
    total_spent: ["total spent", "totaal", "total revenue", "lifetime value", "ltv", "totaal besteed"],
    tags: ["tags", "labels", "label"],
  },
  services: {
    name: ["name", "naam", "service", "behandeling", "treatment"],
    duration_minutes: ["duration", "duur", "minutes", "minuten", "duration_minutes", "tijd"],
    price: ["price", "prijs", "amount", "bedrag", "cost"],
    category: ["category", "categorie", "group", "groep"],
    description: ["description", "beschrijving", "omschrijving"],
    is_active: ["active", "actief", "enabled", "is_active"],
  },
  appointments: {
    customer_name: ["customer", "klant", "customer name", "klantnaam", "name", "naam"],
    customer_email: ["email", "customer email", "klant email", "e-mail"],
    customer_phone: ["phone", "customer phone", "klant telefoon", "telefoon"],
    service_name: ["service", "behandeling", "treatment", "service name"],
    employee_name: ["employee", "medewerker", "staff", "stylist", "therapist", "with"],
    date: ["date", "datum", "appointment date", "afspraakdatum"],
    start_time: ["start", "starttijd", "from", "begin", "time", "tijd", "start time"],
    end_time: ["end", "eindtijd", "to", "tot", "end time"],
    status: ["status", "state"],
    price: ["price", "prijs", "amount"],
    notes: ["notes", "notities", "comments", "opmerking"],
  },
  employees: {
    name: ["name", "naam", "employee", "medewerker"],
    email: ["email", "e-mail"],
    phone: ["phone", "telefoon"],
    role: ["role", "functie", "title", "job"],
    working_days: ["working days", "werkdagen", "days"],
    color: ["color", "colour", "kleur"],
  },
  waitlist: {
    customer_name: ["customer", "klant", "name", "naam"],
    customer_email: ["email", "e-mail"],
    customer_phone: ["phone", "telefoon"],
    service_name: ["service", "behandeling"],
    preferred_day: ["preferred day", "voorkeursdag", "day", "dag"],
    preferred_time: ["preferred time", "voorkeurstijd", "time"],
    notes: ["notes", "notities"],
  },
};

function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/[^\d+]/g, "");
  if (!p) return null;
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (p.startsWith("06") || p.startsWith("0")) p = "+31" + p.slice(1);
  if (!p.startsWith("+")) p = "+" + p;
  return p;
}

function parseDutchDate(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // dd-mm-yyyy or dd/mm/yyyy
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const yyyy = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${yyyy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // Excel serial date
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseTime(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/(\d{1,2})[:.](\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}:00`;
  // Excel fraction of day
  if (/^\d*\.\d+$/.test(s)) {
    const n = Number(s);
    const totalMin = Math.round(n * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
  }
  return null;
}

function parseNumber(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function parseBool(raw: any): boolean {
  const s = String(raw ?? "").toLowerCase().trim();
  return ["1", "true", "yes", "ja", "actief", "active", "y"].includes(s);
}

function autoDetect(headers: string[], type: ImportType): Record<string, string> {
  const map: Record<string, string> = {};
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const [field, aliases] of Object.entries(ALIASES[type])) {
    for (const alias of aliases) {
      const idx = lower.findIndex((h) => h === alias);
      if (idx >= 0) {
        map[field] = headers[idx];
        break;
      }
    }
    if (!map[field]) {
      for (const alias of aliases) {
        const idx = lower.findIndex((h) => h.includes(alias));
        if (idx >= 0) {
          map[field] = headers[idx];
          break;
        }
      }
    }
  }
  return map;
}

type Step = 0 | 1 | 2 | 3 | 4 | 5;

interface Summary {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

export function ImportWizard() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(0);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [source, setSource] = useState<SourceSystem>("other");
  const [type, setType] = useState<ImportType>("customers");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);

  const reset = () => {
    setStep(0);
    setFileName("");
    setRows([]);
    setHeaders([]);
    setMapping({});
    setSummary(null);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase();
    try {
      let parsed: Record<string, any>[] = [];
      let cols: string[] = [];
      if (ext === "csv" || ext === "txt") {
        const text = await file.text();
        const result = Papa.parse<Record<string, any>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim(),
        });
        parsed = result.data as Record<string, any>[];
        cols = result.meta.fields ?? [];
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        parsed = XLSX.utils.sheet_to_json(ws, { defval: "" });
        cols = parsed.length > 0 ? Object.keys(parsed[0]) : [];
      } else {
        toast.error("Bestandstype niet ondersteund. Gebruik CSV of XLSX.");
        return;
      }
      if (parsed.length === 0) {
        toast.error("Bestand bevat geen rijen.");
        return;
      }
      setRows(parsed);
      setHeaders(cols);
      setStep(1);
    } catch (e: any) {
      toast.error("Kon bestand niet lezen: " + e.message);
    }
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const detected = useMemo(() => autoDetect(headers, type), [headers, type]);

  const goToMapping = () => {
    setMapping(detected);
    setStep(3);
  };

  const previewRows = useMemo(() => rows.slice(0, 20), [rows]);

  const getValue = (row: Record<string, any>, field: string): string => {
    const col = mapping[field];
    if (!col) return "";
    return row[col] === undefined || row[col] === null ? "" : String(row[col]).trim();
  };

  // Validate a single row
  const validateRow = (row: Record<string, any>, idx: number): { ok: boolean; reason?: string } => {
    if (type === "customers" || type === "services" || type === "employees") {
      const name = getValue(row, "name");
      if (!name) return { ok: false, reason: "Naam ontbreekt" };
    }
    if (type === "appointments") {
      const date = parseDutchDate(getValue(row, "date"));
      if (!date) return { ok: false, reason: "Ongeldige of ontbrekende datum" };
      const hasCustomer = getValue(row, "customer_name") || getValue(row, "customer_email") || getValue(row, "customer_phone");
      if (!hasCustomer) return { ok: false, reason: "Klant ontbreekt" };
    }
    if (type === "waitlist") {
      const hasCustomer = getValue(row, "customer_name") || getValue(row, "customer_email") || getValue(row, "customer_phone");
      if (!hasCustomer) return { ok: false, reason: "Klant ontbreekt" };
    }
    return { ok: true };
  };

  const runImport = async () => {
    if (!user) {
      toast.error("Niet ingelogd.");
      return;
    }
    setImporting(true);
    setProgress(0);
    const errors: { row: number; reason: string }[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    try {
      // Pre-load existing for dedupe
      const [existingCustomersRes, existingServicesRes, existingEmployeesRes] = await Promise.all([
        supabase.from("customers").select("id, name, email, phone").eq("user_id", user.id).eq("is_demo", demoMode),
        supabase.from("services").select("id, name").eq("user_id", user.id).eq("is_demo", demoMode),
        supabase.from("employees").select("id, name").eq("user_id", user.id).eq("is_demo", demoMode),
      ]);
      const existingCustomers = existingCustomersRes.data ?? [];
      const existingServices = existingServicesRes.data ?? [];
      const existingEmployees = existingEmployeesRes.data ?? [];

      const customerByEmail = new Map<string, string>();
      const customerByPhone = new Map<string, string>();
      const customerByName = new Map<string, string>();
      existingCustomers.forEach((c: any) => {
        if (c.email) customerByEmail.set(c.email.toLowerCase(), c.id);
        if (c.phone) customerByPhone.set(c.phone, c.id);
        if (c.name) customerByName.set(c.name.toLowerCase().trim(), c.id);
      });
      const serviceByName = new Map<string, { id: string }>();
      existingServices.forEach((s: any) => serviceByName.set(s.name.toLowerCase().trim(), { id: s.id }));
      const employeeByName = new Map<string, { id: string }>();
      existingEmployees.forEach((e: any) => employeeByName.set(e.name.toLowerCase().trim(), { id: e.id }));

      // Helpers to ensure entity exists
      const ensureCustomer = async (name: string, email: string, phone: string): Promise<string | null> => {
        const e = email ? email.toLowerCase().trim() : "";
        const p = phone ? normalizePhone(phone) ?? "" : "";
        const n = name ? name.toLowerCase().trim() : "";
        if (e && customerByEmail.has(e)) return customerByEmail.get(e)!;
        if (p && customerByPhone.has(p)) return customerByPhone.get(p)!;
        if (n && customerByName.has(n)) return customerByName.get(n)!;
        if (!name && !email && !phone) return null;
        const { data, error } = await supabase
          .from("customers")
          .insert({ user_id: user.id, is_demo: demoMode, name: name || email || phone, email: e || null, phone: p || null })
          .select("id")
          .single();
        if (error || !data) return null;
        if (e) customerByEmail.set(e, data.id);
        if (p) customerByPhone.set(p, data.id);
        if (n) customerByName.set(n, data.id);
        return data.id;
      };
      const ensureService = async (name: string): Promise<string | null> => {
        if (!name) return null;
        const k = name.toLowerCase().trim();
        if (serviceByName.has(k)) return serviceByName.get(k)!.id;
        const { data, error } = await supabase
          .from("services")
          .insert({ user_id: user.id, is_demo: demoMode, name, duration_minutes: 30, price: 0 })
          .select("id")
          .single();
        if (error || !data) return null;
        serviceByName.set(k, { id: data.id });
        return data.id;
      };
      const ensureEmployee = async (name: string): Promise<string | null> => {
        if (!name) return null;
        const k = name.toLowerCase().trim();
        if (employeeByName.has(k)) return employeeByName.get(k)!.id;
        const { data, error } = await supabase
          .from("employees")
          .insert({ user_id: user.id, is_demo: demoMode, name })
          .select("id")
          .single();
        if (error || !data) return null;
        employeeByName.set(k, { id: data.id });
        return data.id;
      };

      // Build records
      const total = rows.length;
      const BATCH = 100;
      const seenAppts = new Set<string>();

      // Existing appointments for dedupe
      let existingAppts: any[] = [];
      if (type === "appointments") {
        const r = await supabase
          .from("appointments")
          .select("customer_id, appointment_date, start_time")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode);
        existingAppts = r.data ?? [];
        existingAppts.forEach((a: any) => {
          seenAppts.add(`${a.customer_id}|${a.appointment_date}|${a.start_time}`);
        });
      }

      const inserts: any[] = [];
      const flush = async () => {
        if (inserts.length === 0) return;
        const table = type === "waitlist" ? "waitlist_entries" : type;
        const { error } = await supabase.from(table as any).insert(inserts);
        if (error) {
          errors.push({ row: 0, reason: `Batch fout: ${error.message}` });
        } else {
          imported += inserts.length;
        }
        inserts.length = 0;
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        setProgress(Math.round(((i + 1) / total) * 100));
        const v = validateRow(row, i);
        if (!v.ok) {
          errors.push({ row: i + 2, reason: v.reason ?? "Ongeldige rij" });
          continue;
        }

        if (type === "customers") {
          const name = getValue(row, "name");
          const email = getValue(row, "email").toLowerCase() || null;
          const phone = normalizePhone(getValue(row, "phone"));
          // dedupe
          if (email && customerByEmail.has(email)) {
            skipped++;
            continue;
          }
          if (phone && customerByPhone.has(phone)) {
            skipped++;
            continue;
          }
          const notes = [getValue(row, "notes"), getValue(row, "birthday") ? `Geboortedatum: ${getValue(row, "birthday")}` : "", getValue(row, "tags") ? `Tags: ${getValue(row, "tags")}` : ""]
            .filter(Boolean)
            .join(" | ");
          inserts.push({
            user_id: user.id,
            is_demo: demoMode,
            name,
            email,
            phone,
            notes: notes || null,
            total_spent: parseNumber(getValue(row, "total_spent")) ?? 0,
          });
          if (email) customerByEmail.set(email, "pending");
          if (phone) customerByPhone.set(phone, "pending");
        } else if (type === "services") {
          const name = getValue(row, "name");
          if (serviceByName.has(name.toLowerCase().trim())) {
            skipped++;
            continue;
          }
          inserts.push({
            user_id: user.id,
            is_demo: demoMode,
            name,
            duration_minutes: parseNumber(getValue(row, "duration_minutes")) ?? 30,
            price: parseNumber(getValue(row, "price")) ?? 0,
            category: getValue(row, "category") || null,
            description: getValue(row, "description") || null,
            is_active: getValue(row, "is_active") ? parseBool(getValue(row, "is_active")) : true,
          });
          serviceByName.set(name.toLowerCase().trim(), { id: "pending" });
        } else if (type === "employees") {
          const name = getValue(row, "name");
          if (employeeByName.has(name.toLowerCase().trim())) {
            skipped++;
            continue;
          }
          const wd = getValue(row, "working_days");
          const workingDays = wd
            ? wd.split(/[,;\s]+/).map((d) => Number(d)).filter((n) => !isNaN(n) && n >= 0 && n <= 6)
            : [1, 2, 3, 4, 5];
          inserts.push({
            user_id: user.id,
            is_demo: demoMode,
            name,
            email: getValue(row, "email").toLowerCase() || null,
            phone: normalizePhone(getValue(row, "phone")),
            role: getValue(row, "role") || "medewerker",
            color: getValue(row, "color") || "#7B61FF",
            working_days: workingDays,
          });
          employeeByName.set(name.toLowerCase().trim(), { id: "pending" });
        } else if (type === "appointments") {
          // resolve refs (must flush before to keep customer ids in sync)
          await flush();
          const cName = getValue(row, "customer_name");
          const cEmail = getValue(row, "customer_email");
          const cPhone = getValue(row, "customer_phone");
          const customerId = await ensureCustomer(cName, cEmail, cPhone);
          if (!customerId) {
            errors.push({ row: i + 2, reason: "Kon klant niet aanmaken" });
            continue;
          }
          const sName = getValue(row, "service_name");
          const serviceId = sName ? await ensureService(sName) : null;
          const eName = getValue(row, "employee_name");
          const employeeId = eName ? await ensureEmployee(eName) : null;
          const date = parseDutchDate(getValue(row, "date"))!;
          const start = parseTime(getValue(row, "start_time")) || "09:00:00";
          const end = parseTime(getValue(row, "end_time"));
          const dedupeKey = `${customerId}|${date}|${start}`;
          if (seenAppts.has(dedupeKey)) {
            skipped++;
            continue;
          }
          seenAppts.add(dedupeKey);
          inserts.push({
            user_id: user.id,
            is_demo: demoMode,
            customer_id: customerId,
            service_id: serviceId,
            employee_id: employeeId,
            appointment_date: date,
            start_time: start,
            end_time: end,
            status: getValue(row, "status") || "scheduled",
            price: parseNumber(getValue(row, "price")),
            notes: getValue(row, "notes") || null,
            source: "import",
          });
        } else if (type === "waitlist") {
          await flush();
          const cName = getValue(row, "customer_name");
          const cEmail = getValue(row, "customer_email");
          const cPhone = getValue(row, "customer_phone");
          const customerId = await ensureCustomer(cName, cEmail, cPhone);
          if (!customerId) {
            errors.push({ row: i + 2, reason: "Kon klant niet aanmaken" });
            continue;
          }
          const sName = getValue(row, "service_name");
          const serviceId = sName ? await ensureService(sName) : null;
          inserts.push({
            user_id: user.id,
            is_demo: demoMode,
            customer_id: customerId,
            service_id: serviceId,
            preferred_day: getValue(row, "preferred_day") || null,
            preferred_time: getValue(row, "preferred_time") || null,
            notes: getValue(row, "notes") || null,
            status: "active",
          });
        }

        if (inserts.length >= BATCH) await flush();
      }
      await flush();

      setSummary({ imported, updated, skipped, errors });
      setStep(5);
      if (errors.length === 0) toast.success(`${imported} rijen geïmporteerd.`);
      else toast.warning(`${imported} geïmporteerd, ${errors.length} fouten.`);
    } catch (e: any) {
      toast.error("Importfout: " + e.message);
    } finally {
      setImporting(false);
    }
  };

  const downloadErrorReport = () => {
    if (!summary) return;
    const csv = "rij,reden\n" + summary.errors.map((e) => `${e.row},"${e.reason.replace(/"/g, '""')}"`).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-fouten-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const targetFields = FIELDS[type];

  return (
    <div className="glass-card p-4 sm:p-6 space-y-6 w-full max-w-full overflow-x-hidden">
      <div>
        <h2 className="text-xl font-semibold mb-1">Data importeren</h2>
        <p className="text-sm text-muted-foreground">
          Migreer klanten, afspraken, behandelingen en team vanuit Salonized, Fresha, Treatwell of Excel.
          {demoMode ? " (Demo modus actief — import gaat naar demo data.)" : ""}
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {["Upload", "Bron", "Type", "Mapping", "Preview", "Klaar"].map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                i <= step ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-xs whitespace-nowrap ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {label}
            </span>
            {i < 5 && <div className="w-6 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 0: Upload */}
      {step === 0 && (
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:bg-secondary/30 transition"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">Sleep een CSV of XLSX hierheen</p>
          <p className="text-sm text-muted-foreground mt-1">of klik om te bladeren</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            className="hidden"
            onChange={onPickFile}
          />
        </div>
      )}

      {/* Step 1: Source */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileSpreadsheet className="w-4 h-4" />
            {fileName} • {rows.length} rijen
          </div>
          <div>
            <label className="text-sm font-medium block mb-2">Bron systeem</label>
            <Select value={source} onValueChange={(v) => setSource(v as SourceSystem)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-between">
            <Button variant="outline" onClick={reset}><ArrowLeft className="w-4 h-4" />Opnieuw</Button>
            <Button onClick={() => setStep(2)}>Volgende<ArrowRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* Step 2: Type */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-2">Wat wil je importeren?</label>
            <Select value={type} onValueChange={(v) => setType(v as ImportType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4" />Terug</Button>
            <Button onClick={goToMapping}>Auto-detecteer kolommen<ArrowRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* Step 3: Mapping */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Controleer de kolomtoewijzing. Auto-detectie gevonden voor {Object.keys(detected).length} velden.
          </p>
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-left p-3">GlowSuite veld</th>
                  <th className="text-left p-3">Kolom in bestand</th>
                </tr>
              </thead>
              <tbody>
                {targetFields.map((f) => (
                  <tr key={f.key} className="border-t border-border">
                    <td className="p-3">
                      {f.label}
                      {f.required && <span className="text-destructive ml-1">*</span>}
                    </td>
                    <td className="p-3">
                      <Select
                        value={mapping[f.key] || "__none__"}
                        onValueChange={(v) =>
                          setMapping((m) => {
                            const n = { ...m };
                            if (v === "__none__") delete n[f.key];
                            else n[f.key] = v;
                            return n;
                          })
                        }
                      >
                        <SelectTrigger><SelectValue placeholder="— niet toewijzen —" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— niet toewijzen —</SelectItem>
                          {headers.map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="w-4 h-4" />Terug</Button>
            <Button onClick={() => setStep(4)}>Preview<ArrowRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* Step 4: Preview */}
      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Voorbeeld eerste 20 rijen. {rows.length} rijen totaal worden geïmporteerd ({SOURCE_LABELS[source]} → {TYPE_LABELS[type]}).
          </p>
          <div className="border border-border rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-left p-2">#</th>
                  {targetFields.filter((f) => mapping[f.key]).map((f) => (
                    <th key={f.key} className="text-left p-2 whitespace-nowrap">{f.label}</th>
                  ))}
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => {
                  const v = validateRow(row, i);
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 text-muted-foreground">{i + 2}</td>
                      {targetFields.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="p-2 max-w-[200px] truncate">{getValue(row, f.key)}</td>
                      ))}
                      <td className="p-2">
                        {v.ok ? (
                          <span className="text-success inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />OK</span>
                        ) : (
                          <span className="text-destructive inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{v.reason}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {importing && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground text-center">{progress}% • importeren…</p>
            </div>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(3)} disabled={importing}><ArrowLeft className="w-4 h-4" />Terug</Button>
            <Button onClick={runImport} disabled={importing}>
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {importing ? "Bezig…" : `Importeer ${rows.length} rijen`}
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: Summary */}
      {step === 5 && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Geïmporteerd" value={summary.imported} variant="success" />
            <SummaryCard label="Bijgewerkt" value={summary.updated} />
            <SummaryCard label="Duplicaten" value={summary.skipped} />
            <SummaryCard label="Fouten" value={summary.errors.length} variant={summary.errors.length > 0 ? "destructive" : undefined} />
          </div>
          {summary.errors.length > 0 && (
            <>
              <div className="border border-border rounded-xl max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/50 sticky top-0">
                    <tr><th className="text-left p-2">Rij</th><th className="text-left p-2">Reden</th></tr>
                  </thead>
                  <tbody>
                    {summary.errors.slice(0, 100).map((e, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-2">{e.row}</td>
                        <td className="p-2 text-destructive">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" onClick={downloadErrorReport}>
                <Download className="w-4 h-4" />Foutenrapport downloaden (CSV)
              </Button>
            </>
          )}
          <div className="flex justify-end">
            <Button onClick={reset}>Nieuwe import</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, variant }: { label: string; value: number; variant?: "success" | "destructive" }) {
  const color =
    variant === "success" ? "text-success" : variant === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="bg-secondary/30 rounded-xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
