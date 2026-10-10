import { useId, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchCustomers, type SearchableCustomer } from "@/lib/customerSearch";

interface Props {
  customers: SearchableCustomer[];
  value: string;
  onChange: (id: string) => void;
  limit?: number;
}

/** Searchable customer picker: only a chosen customer ID is ever passed on, never free text. */
export function CustomerPicker({ customers, value, onChange, limit = 50 }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const selected = useMemo(() => (value ? customers.find((c) => c.id === value) : undefined), [customers, value]);
  const results = useMemo(() => searchCustomers(customers, query, limit), [customers, query, limit]);

  const choose = (id: string) => { onChange(id); setQuery(""); setActive(0); };

  if (value) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-4 py-2.5 text-sm">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{selected?.name || "Klant laden…"}</p>
          {selected && (selected.phone || selected.email) && (
            <p className="truncate text-xs text-muted-foreground">{[selected.phone, selected.email].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <button type="button" onClick={() => onChange("")} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-label="Andere klant kiezen">
          Wijzig
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          role="combobox"
          aria-expanded={query.trim().length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Zoek klant"
          placeholder="Zoek op naam, e-mail of telefoon"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && results[active]) { e.preventDefault(); choose(results[active].id); }
            else if (e.key === "Escape") setQuery("");
          }}
          className="h-11 rounded-xl pl-9 pr-9"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" aria-label="Zoekopdracht wissen">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {query.trim() && (
        <ul id={listId} role="listbox" aria-label="Gevonden klanten" className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-card">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">Geen klant gevonden</li>
          ) : (
            results.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c.id)}
                  className={cn("w-full px-4 py-2.5 text-left", i === active ? "bg-secondary" : "hover:bg-secondary/60")}
                >
                  <span className="block truncate text-sm font-medium">{c.name || "Naamloos"}</span>
                  {(c.phone || c.email) && <span className="block truncate text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>}
                </button>
              </li>
            ))
          )}
          {results.length >= 50 && <li className="px-4 py-2 text-[11px] text-muted-foreground">Eerste 50 resultaten. Typ verder om te verfijnen.</li>}
        </ul>
      )}
    </div>
  );
}
