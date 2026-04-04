import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { User, Building, Bell, Palette, Shield, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function InstellingenPage() {
  const [salonName, setSalonName] = useState("Glow Studio");
  const [ownerName, setOwnerName] = useState("Jessica Alberts");
  const [email, setEmail] = useState("jessica@glowstudio.nl");
  const [phone, setPhone] = useState("+31 6 12345678");
  const [notifications, setNotifications] = useState({ email: true, whatsapp: true, push: false });

  const handleSave = () => toast.success("Instellingen opgeslagen!");

  return (
    <AppLayout title="Instellingen" subtitle="Account en saloninstellingen">
      <div className="grid gap-6 max-w-2xl">
        {/* Salon */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Building className="w-4 h-4 text-primary" /> Salon
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">Salonnaam</label>
              <input value={salonName} onChange={(e) => setSalonName(e.target.value)}
                className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Telefoon</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-primary" /> Account
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">Naam</label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
                className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">E-mail</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" /> Notificaties
          </h3>
          <div className="space-y-3">
            {Object.entries(notifications).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between py-2">
                <span className="text-sm capitalize">{key === "whatsapp" ? "WhatsApp" : key === "email" ? "E-mail" : "Push"}</span>
                <button
                  onClick={() => setNotifications((p) => ({ ...p, [key]: !val }))}
                  className={`w-10 h-6 rounded-full transition-colors ${val ? "bg-primary" : "bg-secondary"}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${val ? "translate-x-5" : "translate-x-1"}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <Button onClick={handleSave} className="w-full" size="lg">
          <Save className="w-4 h-4 mr-2" /> Opslaan
        </Button>
      </div>
    </AppLayout>
  );
}
