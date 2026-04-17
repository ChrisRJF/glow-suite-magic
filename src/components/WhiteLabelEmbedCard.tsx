import { useEffect, useState } from "react";
import { Globe, Copy, Check, Eye, Palette } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBranding, saveBranding, type WhiteLabelBranding } from "@/lib/whitelabel";

export function WhiteLabelEmbedCard() {
  const [branding, setBranding] = useState<WhiteLabelBranding>(() => getBranding());
  const [copied, setCopied] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    saveBranding(branding);
  }, [branding]);

  const update = (patch: Partial<WhiteLabelBranding>) => setBranding((b) => ({ ...b, ...patch }));

  const embedUrl = `${window.location.origin}/boeken?embed=1`;
  const embedCode = `<iframe src="${embedUrl}" width="100%" height="800" style="border:0;border-radius:12px;overflow:hidden;" title="${branding.salon_name} - Online boeken"></iframe>`;

  const buttonCode = `<a href="${embedUrl.replace("?embed=1", "")}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;background:${branding.primary_color};color:#fff;border-radius:${branding.button_radius}px;text-decoration:none;font-weight:600;">Boek nu</a>`;

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(`${label} gekopieerd`);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="glass-card p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" /> White-label embed
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Plaats de boekingsmodule op je eigen website met je eigen branding.
        </p>
      </div>

      {/* Branding */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
          <Palette className="w-3.5 h-3.5" /> Branding
        </h4>

        <div>
          <label className="text-xs text-muted-foreground">Salonnaam (in widget)</label>
          <input
            value={branding.salon_name}
            onChange={(e) => update({ salon_name: e.target.value })}
            className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Logo URL</label>
          <input
            placeholder="https://..."
            value={branding.logo_url}
            onChange={(e) => update({ logo_url: e.target.value })}
            className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Hoofdkleur</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={branding.primary_color}
                onChange={(e) => update({ primary_color: e.target.value })}
                className="h-10 w-12 rounded-xl border border-border cursor-pointer bg-transparent"
              />
              <input
                value={branding.primary_color}
                onChange={(e) => update({ primary_color: e.target.value })}
                className="flex-1 px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm font-mono"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Accentkleur</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={branding.secondary_color}
                onChange={(e) => update({ secondary_color: e.target.value })}
                className="h-10 w-12 rounded-xl border border-border cursor-pointer bg-transparent"
              />
              <input
                value={branding.secondary_color}
                onChange={(e) => update({ secondary_color: e.target.value })}
                className="flex-1 px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm font-mono"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Hoekradius (px)</label>
            <input
              type="number"
              min={0}
              max={32}
              value={branding.button_radius}
              onChange={(e) => update({ button_radius: Number(e.target.value) })}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Lettertype</label>
            <select
              value={branding.font_preset}
              onChange={(e) => update({ font_preset: e.target.value as WhiteLabelBranding["font_preset"] })}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm"
            >
              <option value="inter">Inter (modern)</option>
              <option value="system">Systeem</option>
              <option value="serif">Serif (klassiek)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <span className="text-sm">Logo tonen in widget</span>
            <p className="text-[11px] text-muted-foreground">Toon je salonlogo in de embed</p>
          </div>
          <button
            onClick={() => update({ show_logo: !branding.show_logo })}
            className={`w-10 h-6 rounded-full transition-colors ${branding.show_logo ? "bg-primary" : "bg-secondary"}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${branding.show_logo ? "translate-x-5" : "translate-x-1"}`} />
          </button>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <span className="text-sm">"Powered by GlowSuite" verbergen</span>
            <p className="text-[11px] text-muted-foreground">Volledig white-label</p>
          </div>
          <button
            onClick={() => update({ hide_glowsuite_branding: !branding.hide_glowsuite_branding })}
            className={`w-10 h-6 rounded-full transition-colors ${branding.hide_glowsuite_branding ? "bg-primary" : "bg-secondary"}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${branding.hide_glowsuite_branding ? "translate-x-5" : "translate-x-1"}`} />
          </button>
        </div>
      </div>

      {/* Embed code */}
      <div className="space-y-2 pt-3 border-t border-border">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Inline embed (iframe)</h4>
        <div className="relative">
          <pre className="text-[11px] bg-secondary/50 border border-border rounded-xl p-3 overflow-x-auto font-mono whitespace-pre-wrap break-all">
            {embedCode}
          </pre>
          <Button
            size="sm"
            variant="outline"
            className="absolute top-2 right-2"
            onClick={() => copy(embedCode, "Embed-code")}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Plak dit in je website (HTML, WordPress, Wix, Squarespace, Shopify) waar je het boekingsformulier wil tonen.
        </p>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">"Boek nu" knop</h4>
        <div className="relative">
          <pre className="text-[11px] bg-secondary/50 border border-border rounded-xl p-3 overflow-x-auto font-mono whitespace-pre-wrap break-all">
            {buttonCode}
          </pre>
          <Button
            size="sm"
            variant="outline"
            className="absolute top-2 right-2"
            onClick={() => copy(buttonCode, "Knop-code")}
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-2 pt-3 border-t border-border">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Eye className="w-3.5 h-3.5" /> Live preview
          </h4>
          <Button size="sm" variant="ghost" onClick={() => setPreviewKey((k) => k + 1)}>
            Vernieuwen
          </Button>
        </div>
        <div className="rounded-xl border border-border overflow-hidden bg-background">
          <iframe
            key={previewKey}
            src={embedUrl}
            title="White-label preview"
            className="w-full h-[500px] border-0"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Zo ziet de boekingsmodule eruit op je website. Wijzigingen worden direct toegepast.
        </p>
      </div>
    </div>
  );
}
