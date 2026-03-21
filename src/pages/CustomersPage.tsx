import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { customers } from "@/lib/data";
import { useState } from "react";
import { Search, Phone, Mail, Calendar, DollarSign, ArrowRight, X } from "lucide-react";
import type { Customer } from "@/lib/data";
import { cn } from "@/lib/utils";

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout title="Customers" subtitle={`${customers.length} clients in your salon`}>
      {/* Search */}
      <div className="relative mb-6 max-w-md opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
        />
      </div>

      <div className="flex gap-6">
        {/* Customer List */}
        <div className={cn("flex-1 space-y-2 opacity-0 animate-fade-in-up", selectedCustomer && "hidden lg:block")} style={{ animationDelay: '200ms' }}>
          {filtered.map((customer) => (
            <button
              key={customer.id}
              onClick={() => setSelectedCustomer(customer)}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 text-left group",
                selectedCustomer?.id === customer.id
                  ? 'bg-primary/10 border border-primary/20'
                  : 'bg-secondary/50 hover:bg-secondary border border-transparent'
              )}
            >
              <div className="w-10 h-10 rounded-full gradient-bg flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-primary-foreground">{customer.initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{customer.name}</p>
                <p className="text-xs text-muted-foreground">{customer.totalVisits} visits · Last: {customer.lastVisit}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold tabular-nums">${customer.totalSpent.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">total spent</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </button>
          ))}
        </div>

        {/* Customer Detail */}
        {selectedCustomer && (
          <div className="w-full lg:w-[380px] glass-card p-6 opacity-0 animate-fade-in-up flex-shrink-0">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Client Profile</h3>
              <button onClick={() => setSelectedCustomer(null)} className="p-1.5 rounded-lg hover:bg-secondary lg:hidden">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col items-center mb-6">
              <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center mb-3">
                <span className="text-xl font-bold text-primary-foreground">{selectedCustomer.initials}</span>
              </div>
              <h4 className="text-base font-semibold">{selectedCustomer.name}</h4>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{selectedCustomer.phone}</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{selectedCustomer.email}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="p-3 rounded-xl bg-secondary/50 text-center">
                <Calendar className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
                <p className="text-lg font-bold tabular-nums">{selectedCustomer.totalVisits}</p>
                <p className="text-[11px] text-muted-foreground">Visits</p>
              </div>
              <div className="p-3 rounded-xl bg-secondary/50 text-center">
                <DollarSign className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
                <p className="text-lg font-bold tabular-nums">${selectedCustomer.totalSpent.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground">Total Spent</p>
              </div>
            </div>

            <Button variant="gradient" className="w-full">
              <Calendar className="w-4 h-4" /> Book Again
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
