import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Download,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Undo2,
  Sparkles,
  Users,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useUserRole } from "@/hooks/useUserRole";

type ImportType = "customers" | "services" | "appointments" | "employees" | "memberships";
type SourceSystem = "salonized" | "fresha" | "treatwell" | "other";
type DupeStrategy = "skip" | "update" | "new-only";
const SELECTABLE_TYPES: ImportType[] = ["customers", "services"];

const TYPE_LABELS: Record<ImportType, string> = {
  customers: "Klanten",
  services: "Behandelingen / Diensten",
  appointments: "Afspraken",
  employees: "Medewerkers / Team",
  memberships: "Memberships / Abonnementen",
};

const SOURCE_LABELS: Record<SourceSystem, string> = {
  salonized: "Salonized",
  fresha: "Fresha",
  treatwell: "Treatwell",
  other: "Excel / Anders",
};

const FIELDS: Record<ImportType, { key: string; label: string; required?: boolean }[]> = {
  // Privacy: only plain contact fields. No notes, health data or consent flags.
  customers: [
    { key: "name", label: "Naam", required: true },
    { key: "email", label: "E-mail" },
    { key: "phone", label: "Telefoon" },
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
    { key: "start_time", label: "Starttijd", required: true },
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
  memberships: [
    { key: "customer_name", label: "Klant naam" },
    { key: "customer_email", label: "Klant e-mail" },
    { key: "plan_name", label: "Abonnement", required: true },
    { key: "status", label: "Status" },
    { key: "start_date", label: "Startdatum" },
    { key: "end_date", label: "Einddatum" },
    { key: "price", label: "Prijs" },
  ],
};

const ALIASES: Record<ImportType, Record<string, string[]>> = {
  customers: {
    name: ["name", "naam", "klant", "customer", "full name", "klantnaam", "volledige naam", "first name last name"],
    email: ["email", "e-mail", "mail", "e mail", "emailadres"],
    phone: ["phone", "telefoon", "mobile", "mobiel", "tel", "phone number", "telefoonnummer", "gsm"],
    birthday: ["birthday", "geboortedatum", "dob", "date of birth", "verjaardag", "birth date"],
    notes: ["notes", "notitie", "notities", "opmerking", "opmerkingen", "comments", "memo"],
    total_spent: ["total spent", "totaal", "total revenue", "lifetime value", "ltv", "totaal besteed", "omzet", "spent"],
    tags: ["tags", "labels", "label"],
  },
  services: {
    name: ["name", "naam", "service", "behandeling", "treatment", "dienst"],
    duration_minutes: ["duration", "duur", "minutes", "minuten", "duration_minutes", "tijd", "lengte"],
    price: ["price", "prijs", "amount", "bedrag", "cost", "tarief"],
    category: ["category", "categorie", "group", "groep"],
    description: ["description", "beschrijving", "omschrijving"],
    is_active: ["active", "actief", "enabled", "is_active"],
  },
  appointments: {
    customer_name: ["customer", "klant", "customer name", "klantnaam", "name", "naam"],
    customer_email: ["email", "customer email", "klant email", "e-mail", "klant e-mail"],
    customer_phone: ["phone", "customer phone", "klant telefoon", "telefoon"],
    service_name: ["service", "behandeling", "treatment", "service name", "dienst"],
    employee_name: ["employee", "medewerker", "staff", "stylist", "therapist", "with", "personeel"],
    date: ["date", "datum", "appointment date", "afspraakdatum", "day"],
    start_time: ["start", "starttijd", "from", "begin", "time", "tijd", "start time", "begintijd"],
    end_time: ["end", "eindtijd", "to", "tot", "end time"],
    status: ["status", "state", "toestand"],
    price: ["price", "prijs", "amount", "bedrag"],
    notes: ["notes", "notities", "comments", "opmerking", "opmerkingen"],
  },
  employees: {
    name: ["name", "naam", "employee", "medewerker", "personeel"],
    email: ["email", "e-mail"],
    phone: ["phone", "telefoon"],
    role: ["role", "functie", "title", "job"],
    working_days: ["working days", "werkdagen", "days", "dagen"],
    color: ["color", "colour", "kleur"],
  },
  memberships: {
    customer_name: ["customer", "klant", "name", "naam"],
    customer_email: ["email", "e-mail", "klant email"],
    plan_name: ["plan", "abonnement", "membership", "membership plan", "tier", "pakket"],
    status: ["status", "state"],
    start_date: ["start", "start_date", "startdatum", "begin"],
    end_date: ["end", "end_date", "einddatum", "vervaldatum"],
    price: ["price", "prijs", "amount", "bedrag"],
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/[^\d+]/g, "");
  if (!p) return null;
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (p.startsWith("06") || p.startsWith("0")) p = "+31" + p.slice(1);
  if (!p.startsWith("+")) p = "+" + p;
  return p.length >= 9 ? p : null;
}

function parseDutchDate(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const yyyy = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${yyyy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
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
  if (!/\d/.test(s)) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function isNonNumeric(raw: string): boolean {
  return raw.trim() !== "" && parseNumber(raw) === null;
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

interface ImportError {
  row: number;
  reason: string;
  fix: string;
  original: Record<string, any>;
}

interface Summary {
  imported: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
  batchId: string | null;
}

interface RecentBatch {
  id: string;
  source: string;
  import_type: string;
  file_name: string | null;
  imported_count: number;
  failed_count: number;
  created_at: string;
  undone_at: string | null;
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
  // Duplicates are always skipped: no automatic overwrite or merge.
  const dupeStrategy: DupeStrategy = "skip";
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [confirmed, setConfirmed] = useState(false);
  const [existing, setExisting] = useState<{ emails: Set<string>; phones: Set<string>; names: Set<string> } | null>(null);
  const [importing, setImporting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<RecentBatch[]>([]);
  const [undoing, setUndoing] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("import_batches")
      .select("id, source, import_type, file_name, imported_count, failed_count, created_at, undone_at")
      .eq("user_id", user.id)
      .eq("is_demo", demoMode)
      .order("created_at", { ascending: false })
      .limit(5);
    setRecent((data ?? []) as RecentBatch[]);
  }, [user, demoMode]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const reset = () => {
    setStep(0);
    setFileName("");
    setRows([]);
    setHeaders([]);
    setMapping({});
    setSummary(null);
    setProgress(0);
    setProgressLabel("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    loadRecent();
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

  const validateRow = (row: Record<string, any>): { ok: boolean; reason?: string; fix?: string } => {
    if (type === "customers") {
      const name = getValue(row, "name");
      const email = getValue(row, "email");
      const phone = getValue(row, "phone");
      if (!name && !email && !phone) return { ok: false, reason: "Naam, e-mail of telefoon vereist", fix: "Vul minstens één veld in" };
      if (email && !EMAIL_RE.test(email)) return { ok: false, reason: "Ongeldig e-mailadres", fix: `Controleer "${email}"` };
      if (phone && !normalizePhone(phone)) return { ok: false, reason: "Ongeldig telefoonnummer", fix: "Gebruik +316… of 06…" };
    }
    if (type === "services") {
      const name = getValue(row, "name");
      if (!name) return { ok: false, reason: "Naam ontbreekt", fix: "Vul behandelingsnaam in" };
      if (isNonNumeric(getValue(row, "price"))) return { ok: false, reason: "Ongeldige prijs", fix: "Gebruik een bedrag, bv. 85,00" };
      if (isNonNumeric(getValue(row, "duration_minutes"))) return { ok: false, reason: "Ongeldige duur", fix: "Gebruik minuten, bv. 60" };
      const price = parseNumber(getValue(row, "price"));
      if (price !== null && price < 0) return { ok: false, reason: "Prijs negatief", fix: "Prijs moet ≥ 0 zijn" };
      const dur = parseNumber(getValue(row, "duration_minutes"));
      if (dur !== null && dur <= 0) return { ok: false, reason: "Duur moet > 0 zijn", fix: "Vul minuten in" };
    }
    if (type === "employees") {
      const name = getValue(row, "name");
      if (!name) return { ok: false, reason: "Naam ontbreekt", fix: "Vul medewerker in" };
      const email = getValue(row, "email");
      if (email && !EMAIL_RE.test(email)) return { ok: false, reason: "Ongeldig e-mailadres", fix: `Controleer "${email}"` };
    }
    if (type === "appointments") {
      const date = parseDutchDate(getValue(row, "date"));
      if (!date) return { ok: false, reason: "Ongeldige of ontbrekende datum", fix: "Gebruik bv. 31-12-2025" };
      const start = parseTime(getValue(row, "start_time"));
      if (!start) return { ok: false, reason: "Ongeldige of ontbrekende starttijd", fix: "Gebruik bv. 09:30" };
      const hasCustomer =
        getValue(row, "customer_name") || getValue(row, "customer_email") || getValue(row, "customer_phone");
      if (!hasCustomer) return { ok: false, reason: "Klant ontbreekt", fix: "Vul naam, e-mail of telefoon in" };
      const price = parseNumber(getValue(row, "price"));
      if (price !== null && price < 0) return { ok: false, reason: "Prijs negatief", fix: "Prijs moet ≥ 0 zijn" };
    }
    if (type === "memberships") {
      const plan = getValue(row, "plan_name");
      if (!plan) return { ok: false, reason: "Abonnement ontbreekt", fix: "Vul abonnement-naam in" };
      const hasCustomer = getValue(row, "customer_name") || getValue(row, "customer_email");
      if (!hasCustomer) return { ok: false, reason: "Klant ontbreekt", fix: "Vul klant in" };
    }
    return { ok: true };
  };

  // Load existing keys for duplicate detection in the preview (own account + active mode only, via RLS)
  useEffect(() => {
    if (step !== 4 || !user) return;
    let active = true;
    setExisting(null);
    setConfirmed(false);
    setLoadError(false);
    (async () => {
      if (type === "customers") {
        const { data, error } = await fetchAllRows((from, to) => supabase.from("customers").select("id, name, email, phone").eq("user_id", user.id).eq("is_demo", demoMode).order("id").range(from, to));
        if (!active) return;
        if (error) {
          // Never run duplicate checks against a partial customer list.
          setLoadError(true);
          return;
        }
        setExisting({
          emails: new Set((data ?? []).map((c: any) => (c.email ?? "").toLowerCase()).filter(Boolean)),
          phones: new Set((data ?? []).map((c: any) => c.phone ?? "").filter(Boolean)),
          names: new Set((data ?? []).map((c: any) => (c.name ?? "").toLowerCase().trim()).filter(Boolean)),
        });
      } else {
        const { data } = await supabase.from("services").select("name").eq("user_id", user.id).eq("is_demo", demoMode);
        if (!active) return;
        setExisting({ emails: new Set(), phones: new Set(), names: new Set((data ?? []).map((s: any) => (s.name ?? "").toLowerCase().trim())) });
      }
    })();
    return () => { active = false; };
  }, [step, type, user, demoMode]);

  const analysis = useMemo(() => {
    if (!existing) return null;
    const emails = new Set(existing.emails);
    const phones = new Set(existing.phones);
    const names = new Set(existing.names);
    let fresh = 0, dupes = 0, missing = 0, invalid = 0;
    const rowStatus: { kind: "new" | "dupe" | "error"; reason?: string }[] = [];
    rows.forEach((row, i) => {
      const v = validateRow(row);
      let st: { kind: "new" | "dupe" | "error"; reason?: string };
      if (!v.ok) {
        const isMissing = /ontbreekt|vereist/i.test(v.reason ?? "");
        if (isMissing) missing++; else invalid++;
        st = { kind: "error", reason: v.reason };
      } else if (type === "customers") {
        const e = getValue(row, "email").toLowerCase();
        const p = normalizePhone(getValue(row, "phone")) ?? "";
        const n = (getValue(row, "name") || e || p).toLowerCase().trim();
        const dupe = (e && emails.has(e)) || (p && phones.has(p)) || (!e && !p && names.has(n));
        if (dupe) { dupes++; st = { kind: "dupe" }; }
        else { fresh++; st = { kind: "new" }; if (e) emails.add(e); if (p) phones.add(p); names.add(n); }
      } else {
        const n = getValue(row, "name").toLowerCase().trim();
        if (names.has(n)) { dupes++; st = { kind: "dupe" }; }
        else { fresh++; st = { kind: "new" }; names.add(n); }
      }
      if (i < 20) rowStatus.push(st);
    });
    return { total: rows.length, fresh, dupes, missing, invalid, rowStatus };
  }, [existing, rows, mapping, type]);

  const undoBatch = async (batchId: string) => {
    if (!user) return;
    if (!confirm("Weet je zeker dat je deze import wilt terugdraaien? Rijen uit deze import worden verwijderd.")) return;
    setUndoing(batchId);
    try {
      const { data: items } = await supabase
        .from("import_batch_items")
        .select("table_name, row_id")
        .eq("batch_id", batchId)
        .eq("user_id", user.id);
      const byTable = new Map<string, string[]>();
      (items ?? []).forEach((it: any) => {
        const arr = byTable.get(it.table_name) ?? [];
        arr.push(it.row_id);
        byTable.set(it.table_name, arr);
      });
      for (const [tbl, ids] of byTable) {
        for (let i = 0; i < ids.length; i += 200) {
          await supabase.from(tbl as any).delete().in("id", ids.slice(i, i + 200)).eq("user_id", user.id);
        }
      }
      await supabase.from("import_batch_items").delete().eq("batch_id", batchId).eq("user_id", user.id);
      await supabase
        .from("import_batches")
        .update({ status: "undone", undone_at: new Date().toISOString() })
        .eq("id", batchId)
        .eq("user_id", user.id);
      toast.success("Import teruggedraaid.");
      loadRecent();
      if (summary?.batchId === batchId) setSummary(null);
    } catch (e: any) {
      toast.error("Kon niet terugdraaien: " + e.message);
    } finally {
      setUndoing(null);
    }
  };

  const runImport = async () => {
    if (!user) {
      toast.error("Niet ingelogd.");
      return;
    }
    if (!isAdmin || !confirmed || !SELECTABLE_TYPES.includes(type)) return;
    if (loadError) { toast.error("Niet alle klanten konden worden geladen. Probeer het opnieuw."); return; }
    setImporting(true);
    setProgress(0);
    setProgressLabel("Voorbereiden…");
    const errors: ImportError[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let batchId: string | null = null;

    const trackedItems: { table_name: string; row_id: string }[] = [];

    try {
      // Create batch row
      const { data: batch, error: batchErr } = await supabase
        .from("import_batches")
        .insert({
          user_id: user.id,
          is_demo: demoMode,
          source,
          import_type: type,
          file_name: fileName,
          status: "running",
        })
        .select("id")
        .single();
      if (batchErr || !batch) throw new Error(batchErr?.message ?? "Kon batch niet aanmaken");
      batchId = batch.id;

      // Pre-load existing for dedupe
      const [existingCustomersRes, existingServicesRes, existingEmployeesRes, plansRes] = await Promise.all([
        fetchAllRows((from, to) => supabase.from("customers").select("id, name, email, phone, total_spent, notes").eq("user_id", user.id).eq("is_demo", demoMode).order("id").range(from, to)),
        supabase.from("services").select("id, name, price, duration_minutes").eq("user_id", user.id).eq("is_demo", demoMode),
        supabase.from("employees").select("id, name, email").eq("user_id", user.id).eq("is_demo", demoMode),
        type === "memberships"
          ? supabase.from("membership_plans").select("id, name").eq("user_id", user.id).eq("is_demo", demoMode)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      if (existingCustomersRes.error) {
        // Partial customer list: never dedupe or auto-link against it. Abort before any writes.
        await supabase.from("import_batches").update({ status: "failed" }).eq("id", batchId);
        toast.error("Niet alle klanten konden worden geladen. Probeer het opnieuw.");
        setImporting(false);
        setProgressLabel("");
        return;
      }
      const existingCustomers = existingCustomersRes.data ?? [];
      const existingServices = existingServicesRes.data ?? [];
      const existingEmployees = existingEmployeesRes.data ?? [];
      const existingPlans = plansRes.data ?? [];

      const customerByEmail = new Map<string, string>();
      const customerByPhone = new Map<string, string>();
      const customerByName = new Map<string, string>();
      existingCustomers.forEach((c: any) => {
        if (c.email) customerByEmail.set(c.email.toLowerCase(), c.id);
        if (c.phone) customerByPhone.set(c.phone, c.id);
        if (c.name) customerByName.set(c.name.toLowerCase().trim(), c.id);
      });
      const serviceByName = new Map<string, string>();
      existingServices.forEach((s: any) => serviceByName.set(s.name.toLowerCase().trim(), s.id));
      const employeeByName = new Map<string, string>();
      existingEmployees.forEach((e: any) => employeeByName.set(e.name.toLowerCase().trim(), e.id));
      const planByName = new Map<string, string>();
      existingPlans.forEach((p: any) => planByName.set(p.name.toLowerCase().trim(), p.id));

      const track = (table: string, id: string) => {
        trackedItems.push({ table_name: table, row_id: id });
      };

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
        track("customers", data.id);
        if (e) customerByEmail.set(e, data.id);
        if (p) customerByPhone.set(p, data.id);
        if (n) customerByName.set(n, data.id);
        return data.id;
      };
      const ensureService = async (name: string): Promise<string | null> => {
        if (!name) return null;
        const k = name.toLowerCase().trim();
        if (serviceByName.has(k)) return serviceByName.get(k)!;
        const { data, error } = await supabase
          .from("services")
          .insert({ user_id: user.id, is_demo: demoMode, name, duration_minutes: 30, price: 0 })
          .select("id")
          .single();
        if (error || !data) return null;
        track("services", data.id);
        serviceByName.set(k, data.id);
        return data.id;
      };
      const ensureEmployee = async (name: string): Promise<string | null> => {
        if (!name) return null;
        const k = name.toLowerCase().trim();
        if (employeeByName.has(k)) return employeeByName.get(k)!;
        const { data, error } = await supabase
          .from("employees")
          .insert({ user_id: user.id, is_demo: demoMode, name })
          .select("id")
          .single();
        if (error || !data) return null;
        track("employees", data.id);
        employeeByName.set(k, data.id);
        return data.id;
      };

      const total = rows.length;

      const seenAppts = new Set<string>();
      if (type === "appointments") {
        const r = await supabase
          .from("appointments")
          .select("customer_id, appointment_date, start_time")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode);
        (r.data ?? []).forEach((a: any) => {
          seenAppts.add(`${a.customer_id}|${a.appointment_date}|${a.start_time}`);
        });
      }

      setProgressLabel(`Importeren 0/${total}…`);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        setProgress(Math.round(((i + 1) / total) * 100));
        if (i % 10 === 0) setProgressLabel(`Importeren ${i + 1}/${total}…`);
        const v = validateRow(row);
        if (!v.ok) {
          errors.push({ row: rowNum, reason: v.reason ?? "Ongeldige rij", fix: v.fix ?? "", original: row });
          continue;
        }

        try {
          if (type === "customers") {
            const name = getValue(row, "name") || getValue(row, "email") || getValue(row, "phone");
            const email = getValue(row, "email").toLowerCase() || null;
            const phone = normalizePhone(getValue(row, "phone"));
            const nameKey = name.toLowerCase().trim();
            const existingId =
              (email && customerByEmail.get(email)) ||
              (phone && customerByPhone.get(phone)) ||
              (!email && !phone && customerByName.get(nameKey)) ||
              null;
            if (existingId) {
              skipped++;
              continue;
            }
            const { data, error } = await supabase
              .from("customers")
              .insert({
                user_id: user.id,
                is_demo: demoMode,
                name,
                email,
                phone,
              })
              .select("id")
              .single();
            if (error || !data) {
              errors.push({ row: rowNum, reason: "Kon klant niet aanmaken", fix: "Controleer de gegevens in deze regel", original: row });
              continue;
            }
            track("customers", data.id);
            if (email) customerByEmail.set(email, data.id);
            if (phone) customerByPhone.set(phone, data.id);
            customerByName.set(nameKey, data.id);
            imported++;
          } else if (type === "services") {
            const name = getValue(row, "name");
            const k = name.toLowerCase().trim();
            const existingId = serviceByName.get(k);
            if (existingId) {
              skipped++;
              continue;
            }
            const { data, error } = await supabase
              .from("services")
              .insert({
                user_id: user.id,
                is_demo: demoMode,
                name,
                duration_minutes: parseNumber(getValue(row, "duration_minutes")) ?? 30,
                price: parseNumber(getValue(row, "price")) ?? 0,
                category: getValue(row, "category") || null,
                description: getValue(row, "description") || null,
                is_active: getValue(row, "is_active") ? parseBool(getValue(row, "is_active")) : true,
              })
              .select("id")
              .single();
            if (error || !data) {
              errors.push({ row: rowNum, reason: "Kon dienst niet aanmaken", fix: error?.message ?? "", original: row });
              continue;
            }
            track("services", data.id);
            serviceByName.set(k, data.id);
            imported++;
          } else if (type === "employees") {
            const name = getValue(row, "name");
            const k = name.toLowerCase().trim();
            const email = getValue(row, "email").toLowerCase() || null;
            const existingId = employeeByName.get(k);
            if (existingId) {
              if (dupeStrategy === "skip" || dupeStrategy === "new-only") {
                skipped++;
                continue;
              }
              const { error } = await supabase
                .from("employees")
                .update({
                  name,
                  email,
                  phone: normalizePhone(getValue(row, "phone")),
                  role: getValue(row, "role") || "medewerker",
                })
                .eq("id", existingId)
                .eq("user_id", user.id);
              if (error) errors.push({ row: rowNum, reason: "Kon medewerker niet bijwerken", fix: error.message, original: row });
              else updated++;
              continue;
            }
            const wd = getValue(row, "working_days");
            const workingDays = wd
              ? wd.split(/[,;\s]+/).map((d) => Number(d)).filter((n) => !isNaN(n) && n >= 0 && n <= 6)
              : [1, 2, 3, 4, 5];
            const { data, error } = await supabase
              .from("employees")
              .insert({
                user_id: user.id,
                is_demo: demoMode,
                name,
                email,
                phone: normalizePhone(getValue(row, "phone")),
                role: getValue(row, "role") || "medewerker",
                color: getValue(row, "color") || "#7B61FF",
                working_days: workingDays,
              })
              .select("id")
              .single();
            if (error || !data) {
              errors.push({ row: rowNum, reason: "Kon medewerker niet aanmaken", fix: error?.message ?? "", original: row });
              continue;
            }
            track("employees", data.id);
            employeeByName.set(k, data.id);
            imported++;
          } else if (type === "appointments") {
            const cName = getValue(row, "customer_name");
            const cEmail = getValue(row, "customer_email");
            const cPhone = getValue(row, "customer_phone");
            const customerId = await ensureCustomer(cName, cEmail, cPhone);
            if (!customerId) {
              errors.push({ row: rowNum, reason: "Kon klant niet aanmaken/koppelen", fix: "Controleer klantvelden", original: row });
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
              if (dupeStrategy === "skip" || dupeStrategy === "new-only") {
                skipped++;
                continue;
              }
            }
            const { data, error } = await supabase
              .from("appointments")
              .insert({
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
              })
              .select("id")
              .single();
            if (error || !data) {
              errors.push({ row: rowNum, reason: "Kon afspraak niet aanmaken", fix: error?.message ?? "", original: row });
              continue;
            }
            track("appointments", data.id);
            seenAppts.add(dedupeKey);
            imported++;
          } else if (type === "memberships") {
            const cName = getValue(row, "customer_name");
            const cEmail = getValue(row, "customer_email");
            const customerId = await ensureCustomer(cName, cEmail, "");
            if (!customerId) {
              errors.push({ row: rowNum, reason: "Kon klant niet koppelen", fix: "Controleer klantvelden", original: row });
              continue;
            }
            const planName = getValue(row, "plan_name");
            const pk = planName.toLowerCase().trim();
            let planId = planByName.get(pk);
            if (!planId) {
              const priceVal = parseNumber(getValue(row, "price")) ?? 0;
              const { data, error } = await supabase
                .from("membership_plans")
                .insert({
                  user_id: user.id,
                  is_demo: demoMode,
                  name: planName,
                  price: priceVal,
                  billing_interval: "month",
                  is_active: true,
                })
                .select("id")
                .single();
              if (error || !data) {
                errors.push({ row: rowNum, reason: "Kon abonnement niet aanmaken", fix: error?.message ?? "", original: row });
                continue;
              }
              planId = data.id;
              planByName.set(pk, planId);
              track("membership_plans", planId);
            }
            const start = parseDutchDate(getValue(row, "start_date")) || new Date().toISOString().slice(0, 10);
            const end = parseDutchDate(getValue(row, "end_date"));
            const status = getValue(row, "status") || "active";
            const { data, error } = await supabase
              .from("customer_memberships")
              .insert({
                user_id: user.id,
                is_demo: demoMode,
                customer_id: customerId,
                membership_plan_id: planId,
                status,
                start_date: start,
                current_period_start: start,
                current_period_end: end,
              })
              .select("id")
              .single();
            if (error || !data) {
              errors.push({ row: rowNum, reason: "Kon membership niet aanmaken", fix: error?.message ?? "", original: row });
              continue;
            }
            track("customer_memberships", data.id);
            imported++;
          }
        } catch (rowErr: any) {
          errors.push({ row: rowNum, reason: "Onverwachte fout", fix: rowErr?.message ?? "", original: row });
        }
      }

      // Persist tracked items in batches
      if (trackedItems.length > 0) {
        const payload = trackedItems.map((it) => ({
          batch_id: batchId,
          user_id: user.id,
          table_name: it.table_name,
          row_id: it.row_id,
        }));
        for (let i = 0; i < payload.length; i += 500) {
          await supabase.from("import_batch_items").insert(payload.slice(i, i + 500));
        }
      }

      // Update batch summary
      await supabase
        .from("import_batches")
        .update({
          imported_count: imported,
          updated_count: updated,
          skipped_count: skipped,
          failed_count: errors.length,
          status: errors.length === 0 ? "completed" : "completed_with_errors",
        })
        .eq("id", batchId);

      setSummary({ imported, updated, skipped, errors, batchId });
      setStep(5);
      if (errors.length === 0) toast.success(`${imported} rijen geïmporteerd.`);
      else toast.warning(`${imported} geïmporteerd, ${errors.length} fouten.`);
      loadRecent();
    } catch (e: any) {
      toast.error("Importfout: " + e.message);
      if (batchId) {
        await supabase
          .from("import_batches")
          .update({ status: "failed", failed_count: errors.length })
          .eq("id", batchId);
      }
    } finally {
      setImporting(false);
      setProgressLabel("");
    }
  };

  const downloadErrorReport = () => {
    if (!summary || summary.errors.length === 0) return;
    const originalKeys = Array.from(
      new Set(summary.errors.flatMap((e) => Object.keys(e.original ?? {})))
    );
    const headerRow = ["rij", "reden", "voorgestelde fix", ...originalKeys];
    const escape = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [headerRow.map(escape).join(",")];
    for (const e of summary.errors) {
      lines.push(
        [e.row, e.reason, e.fix, ...originalKeys.map((k) => e.original?.[k] ?? "")].map(escape).join(",")
      );
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-fouten-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const targetFields = FIELDS[type];
  const missingRequired = targetFields.filter((f) => f.required && !mapping[f.key]);

  if (!roleLoading && !isAdmin) {
    return (
      <div className="glass-card p-4 sm:p-6">
        <h2 className="text-xl font-semibold mb-1">Gegevens importeren</h2>
        <p className="text-sm text-muted-foreground">Alleen de eigenaar of een beheerder kan gegevens importeren.</p>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 sm:p-6 space-y-6 w-full max-w-full overflow-x-hidden pb-[env(safe-area-inset-bottom)]">
      <div>
        <h2 className="text-xl font-semibold mb-1">Gegevens importeren</h2>
        <p className="text-sm text-muted-foreground">
          Stap je over vanuit andere salonsoftware? Upload je gegevens en controleer ze voordat je ze importeert.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Klanten (naam, telefoon, e-mail) en behandelingen. Je bestand wordt alleen in je browser gelezen en niet opgeslagen. Er worden geen berichten verstuurd.
          {demoMode ? " Demo-omgeving: import gaat naar demo-gegevens." : ""}
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto max-w-full pb-2 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
        {["Upload", "Bron", "Type", "Mapping", "Preview", "Klaar"].map((label, i) => (
          <div key={i} className="flex items-center gap-1.5 sm:gap-2">
            <div
              className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-semibold ${
                i <= step ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-[10px] sm:text-xs whitespace-nowrap ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {label}
            </span>
            {i < 5 && <div className="w-3 sm:w-6 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 0: Upload */}
      {step === 0 && (
        <div className="space-y-4">
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-border rounded-xl p-6 sm:p-10 text-center cursor-pointer hover:bg-secondary/30 transition w-full max-w-full"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-8 h-8 sm:w-10 sm:h-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium text-sm sm:text-base">Sleep een CSV of XLSX hierheen</p>
            <p className="text-sm text-muted-foreground mt-1">of klik om te bladeren</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              className="hidden"
              onChange={onPickFile}
            />
          </div>

          {recent.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Recente imports</p>
              <div className="space-y-2">
                {recent.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-card">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {TYPE_LABELS[b.import_type as ImportType] ?? b.import_type} · {SOURCE_LABELS[b.source as SourceSystem] ?? b.source}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {new Date(b.created_at).toLocaleString("nl-NL")} · {b.imported_count} geïmporteerd
                        {b.failed_count ? ` · ${b.failed_count} fouten` : ""}
                        {b.undone_at ? " · ongedaan gemaakt" : ""}
                      </p>
                    </div>
                    {!b.undone_at && b.imported_count > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => undoBatch(b.id)}
                        disabled={undoing === b.id}
                        className="shrink-0"
                      >
                        {undoing === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                        <span className="ml-1.5 hidden sm:inline">Ongedaan</span>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 1: Source */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileSpreadsheet className="w-4 h-4" />
            <span className="truncate">{fileName} • {rows.length} rijen</span>
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
            <p className="text-xs text-muted-foreground mt-1">
              Kolommen worden automatisch herkend op basis van het bronsysteem.
            </p>
          </div>
          <div className="flex justify-between flex-wrap gap-2">
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
                {SELECTABLE_TYPES.map((k) => (
                  <SelectItem key={k} value={k}>{TYPE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Bestaande gegevens worden nooit overschreven. Mogelijke dubbelen worden overgeslagen.
            </p>
          </div>
          <div className="flex justify-between flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4" />Terug</Button>
            <Button onClick={goToMapping}>Auto-detecteer kolommen<ArrowRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* Step 3: Mapping */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Controleer de kolomtoewijzing. Auto-detectie vond {Object.keys(detected).length} velden.
          </p>
          <div className="border border-border rounded-xl overflow-x-auto overflow-y-auto max-w-full max-h-[60vh]">
            <table className="w-full text-sm min-w-[300px]">
              <thead className="bg-secondary/50 sticky top-0">
                <tr>
                  <th className="text-left p-3">GlowSuite veld</th>
                  <th className="text-left p-3">Kolom in bestand</th>
                </tr>
              </thead>
              <tbody>
                {targetFields.map((f) => (
                  <tr key={f.key} className="border-t border-border">
                    <td className="p-3 align-top">
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
          {missingRequired.length > 0 && (
            <p className="text-xs text-destructive">
              Vereiste velden ontbreken: {missingRequired.map((f) => f.label).join(", ")}
            </p>
          )}
          <div className="flex justify-between flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="w-4 h-4" />Terug</Button>
            <Button onClick={() => setStep(4)} disabled={missingRequired.length > 0}>
              Preview<ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Preview */}
      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {fileName} ({SOURCE_LABELS[source]} → {TYPE_LABELS[type]})
          </p>
          {loadError && (
            <p className="text-sm text-destructive">Niet alle klanten konden worden geladen. Probeer het opnieuw.</p>
          )}
          {analysis ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <SummaryCard label="Gevonden" value={analysis.total} />
              <SummaryCard label="Nieuw" value={analysis.fresh} variant="success" />
              <SummaryCard label="Mogelijk dubbel" value={analysis.dupes} />
              <SummaryCard label="Gegevens ontbreken" value={analysis.missing} variant={analysis.missing ? "destructive" : undefined} />
              <SummaryCard label="Ongeldige waarden" value={analysis.invalid} variant={analysis.invalid ? "destructive" : undefined} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Bestand controleren…</p>
          )}
          <p className="text-xs text-muted-foreground">Voorbeeld van de eerste 20 regels. Mogelijke dubbelen worden overgeslagen, nooit samengevoegd of overschreven.</p>
          <div className="border border-border rounded-xl overflow-x-auto overflow-y-auto max-w-full max-h-[60vh]">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50 sticky top-0">
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
                  const s = analysis?.rowStatus[i];
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 text-muted-foreground">{i + 2}</td>
                      {targetFields.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="p-2 max-w-[200px] truncate">{getValue(row, f.key)}</td>
                      ))}
                      <td className="p-2 whitespace-nowrap">
                        {!s ? null : s.kind === "new" ? (
                          <span className="text-success inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Nieuw</span>
                        ) : s.kind === "dupe" ? (
                          <span className="text-muted-foreground">Mogelijk dubbel</span>
                        ) : (
                          <span className="text-destructive inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{s.reason}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={importing} />
            <span>Ik heb de gegevens gecontroleerd en wil {analysis?.fresh ?? 0} nieuwe {type === "customers" ? "klanten" : "behandelingen"} importeren.</span>
          </label>
          {importing && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground text-center">{progressLabel || `${progress}%`}</p>
            </div>
          )}
          <div className="flex justify-between flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(3)} disabled={importing}>
              <ArrowLeft className="w-4 h-4" />Terug
            </Button>
            <Button onClick={runImport} disabled={importing || !confirmed || !analysis || analysis.fresh === 0} className="w-full sm:w-auto">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span className="truncate">{importing ? "Bezig…" : `Importeer ${analysis?.fresh ?? 0} nieuwe`}</span>
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: Summary */}
      {step === 5 && summary && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 space-y-1 text-sm">
            <p className="font-semibold text-success">{summary.imported} {type === "customers" ? "klanten" : "behandelingen"} toegevoegd</p>
            <p className="text-muted-foreground">{summary.skipped} mogelijke dubbelen overgeslagen</p>
            <p className={summary.errors.length > 0 ? "text-destructive" : "text-muted-foreground"}>{summary.errors.length} regels niet geïmporteerd</p>
            <p className="text-xs text-muted-foreground pt-1">Er zijn geen berichten verstuurd. Bestaande gegevens zijn niet aangepast.</p>
          </div>

          {summary.imported > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link to={type === "customers" ? "/klanten" : "/behandelingen"}>
                {type === "customers" ? "Bekijk klanten" : "Bekijk behandelingen"}
              </Link>
            </Button>
          )}


          {summary.errors.length > 0 && (
            <>
              <div className="border border-border rounded-xl max-h-64 overflow-y-auto overflow-x-auto max-w-full">
                <table className="w-full text-xs min-w-[300px]">
                  <thead className="bg-secondary/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Rij</th>
                      <th className="text-left p-2">Reden</th>
                      <th className="text-left p-2">Fix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.errors.slice(0, 100).map((e, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-2">{e.row}</td>
                        <td className="p-2 text-destructive">{e.reason}</td>
                        <td className="p-2 text-muted-foreground">{e.fix}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" onClick={downloadErrorReport} className="w-full sm:w-auto">
                <Download className="w-4 h-4" />Foutbestand downloaden (CSV)
              </Button>
            </>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            {summary.batchId && summary.imported > 0 && (
              <Button
                variant="outline"
                onClick={() => undoBatch(summary.batchId!)}
                disabled={undoing === summary.batchId}
                className="w-full sm:w-auto"
              >
                {undoing === summary.batchId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                Import ongedaan maken
              </Button>
            )}
            <Button onClick={reset} className="w-full sm:w-auto">Nieuwe import</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "success" | "destructive";
}) {
  const tone =
    variant === "success"
      ? "text-success"
      : variant === "destructive"
      ? "text-destructive"
      : "text-foreground";
  return (
    <div className="p-3 rounded-xl border border-border bg-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
