import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { services, formatEuro } from "@/lib/data";
import { Plus, Clock, Euro, Pencil } from "lucide-react";

const categories = [...new Set(services.map((s) => s.category))];

export default function ServicesPage() {
  return (
    <AppLayout
      title="Behandelingen"
      subtitle="Beheer je behandelmenu."
      actions={
        <Button variant="gradient" size="sm">
          <Plus className="w-4 h-4" /> Behandeling Toevoegen
        </Button>
      }
    >
      <div className="space-y-8">
        {categories.map((category, ci) => (
          <div
            key={category}
            className="opacity-0 animate-fade-in-up"
            style={{ animationDelay: `${ci * 100 + 100}ms` }}
          >
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{category}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {services
                .filter((s) => s.category === category)
                .map((service) => (
                  <div
                    key={service.id}
                    className="glass-card p-5 group hover:border-primary/20 transition-all duration-200 hover:shadow-[0_0_20px_-5px_hsl(var(--glow-purple)/0.1)]"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div
                        className="w-2.5 h-2.5 rounded-full mt-1.5"
                        style={{ backgroundColor: service.color }}
                      />
                      <button className="p-1.5 rounded-lg hover:bg-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <h4 className="text-sm font-semibold mb-3">{service.name}</h4>
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" /> {service.duration} min
                      </span>
                      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                        <Euro className="w-3.5 h-3.5 text-muted-foreground" />{formatEuro(service.price)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  );
}
