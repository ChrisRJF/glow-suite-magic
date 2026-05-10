import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Calendar, Users, Scissors, X, Globe,
  MessageCircle, CreditCard, TrendingUp, RefreshCw, Megaphone,
  Zap, ShoppingBag, Package, BarChart3, Settings, HelpCircle, LogOut,
  Sun, Moon, Bot, Clock, Gift, ShoppingCart, Share2, UserPlus, RotateCcw, Mail, Wallet, Sparkles, ChevronDown, ShieldCheck, Rocket, Brain, Activity, Flame, Crown,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useUserRole, canAccessRoute } from "@/hooks/useUserRole";
import logoFull from "@/assets/logo-full.png";
import logoIcon from "@/assets/logo-icon.png";

interface NavItem {
  label: string;
  icon: typeof LayoutDashboard;
  path: string;
  /** Optional path used purely for permission/route check when `path` contains a hash. */
  routePath?: string;
  badge?: string;
  accent?: boolean;
  ai?: boolean;
  live?: boolean;
  ownerOnly?: boolean;
  staffOnly?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
  ai?: boolean;
}

// ───────────────────────────────────────────────────────────
// ONE centralized sidebar config
// ───────────────────────────────────────────────────────────
const navGroups: NavGroup[] = [
  {
    title: "GlowSuite AI",
    ai: true,
    defaultOpen: true,
    items: [
      { label: "AI Command Center", icon: Sparkles, path: "/ai", ai: true, badge: "AI" },
      { label: "Auto Revenue", icon: Flame, path: "/auto-revenue", accent: true },
      { label: "Omzet Autopilot", icon: Zap, path: "/acties" },
      { label: "AI Insights", icon: Brain, path: "/ai#insights", routePath: "/ai" },
      { label: "AI Activiteit", icon: Activity, path: "/ai#activity", routePath: "/ai" },
    ],
  },
  {
    title: "Operatie",
    defaultOpen: true,
    items: [
      { label: "Overzicht", icon: LayoutDashboard, path: "/" },
      { label: "Agenda", icon: Calendar, path: "/agenda" },
      { label: "Klanten", icon: Users, path: "/klanten" },
      { label: "Medewerkers", icon: UserPlus, path: "/medewerkers" },
      { label: "Behandelingen", icon: Scissors, path: "/behandelingen" },
      { label: "Online Boeken", icon: Globe, path: "/boeken" },
    ],
  },
  {
    title: "Groei",
    items: [
      { label: "Marketing", icon: Megaphone, path: "/marketing" },
      { label: "WhatsApp", icon: MessageCircle, path: "/whatsapp" },
      { label: "Leads", icon: UserPlus, path: "/leads" },
      { label: "Wachtlijst", icon: Clock, path: "/wachtlijst" },
      { label: "Herboekingen", icon: RefreshCw, path: "/herboekingen" },
      { label: "Social Studio", icon: Share2, path: "/social-studio" },
      { label: "Automations", icon: Bot, path: "/automatiseringen" },
    ],
  },
  {
    title: "Commerce",
    items: [
      { label: "Kassa", icon: ShoppingBag, path: "/kassa" },
      { label: "Producten", icon: Package, path: "/producten" },
      { label: "Cadeaubonnen", icon: Gift, path: "/cadeaubonnen" },
      { label: "Webshop", icon: ShoppingCart, path: "/webshop" },
      { label: "Abonnementen", icon: CreditCard, path: "/abonnementen" },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Omzet", icon: TrendingUp, path: "/omzet" },
      { label: "Eigenaar", icon: Crown, path: "/eigenaar", accent: true, ownerOnly: true },
      { label: "Payroll", icon: Wallet, path: "/payroll" },
      { label: "GlowPay", icon: CreditCard, path: "/glowpay", accent: true },
      { label: "Refunds", icon: RotateCcw, path: "/refunds" },
      { label: "Rapporten", icon: BarChart3, path: "/rapporten" },
    ],
  },
  {
    title: "Beheer",
    items: [
      { label: "Instellingen", icon: Settings, path: "/instellingen" },
      { label: "Support", icon: HelpCircle, path: "/support" },
      { label: "Launch Status", icon: Rocket, path: "/launch-status", ownerOnly: true },
      { label: "QA Status", icon: ShieldCheck, path: "/qa-status", staffOnly: true },
      { label: "Email previews", icon: Mail, path: "/admin/email-templates", staffOnly: true },
    ],
  },
];

const STORAGE_KEY = "glowsuite:sidebar:open-groups";

export function AppSidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { roles, isOwner } = useUserRole();

  const isStaffAdmin = roles.some((r) => ["eigenaar", "manager", "admin"].includes(r));

  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (item.ownerOnly && !isOwner) return false;
            if (item.staffOnly && !isStaffAdmin) return false;
            return canAccessRoute(item.routePath ?? item.path, roles);
          }),
        }))
        .filter((group) => group.items.length > 0),
    [roles, isOwner, isStaffAdmin]
  );

  const isItemActive = (item: NavItem) => {
    const [path, hash] = item.path.split("#");
    if (location.pathname !== path) return false;
    if (hash) return location.hash === `#${hash}`;
    return !location.hash || !visibleGroups.some(g => g.items.some(i => i.path.startsWith(`${path}#`) && i.path !== item.path && location.hash === `#${i.path.split("#")[1]}`));
  };

  // Track which group contains the active route to auto-open it
  const activeGroupTitle = useMemo(() => {
    for (const g of visibleGroups) {
      if (g.items.some(isItemActive)) return g.title;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleGroups, location.pathname, location.hash]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });

  // Initialize / sync defaults
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const g of visibleGroups) {
        if (next[g.title] === undefined) {
          next[g.title] = g.defaultOpen === true || g.title === activeGroupTitle;
        }
      }
      if (activeGroupTitle) next[activeGroupTitle] = true;
      return next;
    });
  }, [activeGroupTitle, visibleGroups]);

  // Persist collapse state
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups)); } catch {}
  }, [openGroups]);

  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("glowsuite:open-sidebar", open);
    return () => window.removeEventListener("glowsuite:open-sidebar", open);
  }, []);

  const toggleGroup = (title: string) =>
    setOpenGroups((p) => ({ ...p, [title]: !p[title] }));

  const renderItem = (item: NavItem) => {
    const isActive = isItemActive(item);
    const tourAttr = item.path === "/eigenaar" ? "owner-mode" : undefined;
    return (
      <Link
        key={item.path}
        to={item.path}
        data-tour={tourAttr}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "relative flex items-center gap-3 px-3 min-h-11 lg:min-h-9 py-2 lg:py-1.5 rounded-xl text-[14px] lg:text-[13.5px] transition-all duration-150",
          isActive
            ? item.ai
              ? "bg-gradient-to-r from-primary/20 via-fuchsia-500/15 to-primary/10 text-primary font-semibold shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
              : "bg-secondary text-foreground font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:bg-secondary",
          item.ai && !isActive && "text-primary/90 hover:text-primary",
          item.accent && !isActive && !item.ai && "text-primary/85"
        )}
      >
        {isActive && !item.ai && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
        )}
        <item.icon className={cn("w-[18px] h-[18px] shrink-0", item.ai && "text-primary", item.accent && !item.ai && "text-primary/85")} />
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && (
          <span
            className={cn(
              "text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md",
              item.ai
                ? "bg-gradient-to-r from-primary to-fuchsia-500 text-white"
                : isActive
                ? "bg-primary/20 text-primary"
                : "bg-secondary text-muted-foreground"
            )}
          >
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-50 h-[100dvh] w-[84vw] max-w-[296px] lg:w-[260px] flex flex-col bg-card/95 lg:bg-card/60 backdrop-blur-xl border-r border-border transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 lg:px-5 pt-4 lg:pt-6 pb-2 shrink-0">
          <Link to="/ai" onClick={() => setMobileOpen(false)} className="flex items-center gap-2">
            <img src={logoFull} alt="GlowSuite" className="hidden lg:block h-9 w-auto object-contain" />
            <img src={logoIcon} alt="GlowSuite" className="lg:hidden h-9 w-9 rounded-xl object-contain" />
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Menu sluiten"
            className="lg:hidden inline-flex items-center justify-center h-10 w-10 rounded-xl hover:bg-secondary active:scale-95 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pinned premium AI CTA card */}
        <div className="px-3 pb-2 shrink-0">
          <Link
            to="/ai"
            onClick={() => setMobileOpen(false)}
            className={cn(
              "group relative flex items-center gap-3 px-3 py-3 rounded-2xl text-[14px] font-semibold transition-all overflow-hidden",
              "border border-primary/25 bg-gradient-to-r from-primary/15 via-fuchsia-500/12 to-primary/5",
              "hover:from-primary/20 hover:via-fuchsia-500/18 hover:to-primary/10 active:scale-[0.99]",
              location.pathname === "/ai" && !location.hash && "shadow-[0_4px_24px_-8px_hsl(var(--primary)/0.45)]"
            )}
          >
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white flex items-center justify-center shrink-0 shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.6)]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-foreground">GlowSuite AI</span>
                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md bg-gradient-to-r from-primary to-fuchsia-500 text-white">
                  AI
                </span>
              </div>
              <p className="text-[11px] font-normal text-muted-foreground truncate">
                Command Center
              </p>
            </div>
          </Link>
        </div>

        {/* Scrollable nav */}
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-4">
          {visibleGroups.map((group, idx) => {
            const isOpen = openGroups[group.title] ?? false;
            return (
              <div
                key={group.title}
                className={cn(
                  "mb-1.5",
                  idx > 0 && "mt-1",
                  group.ai && "rounded-2xl bg-gradient-to-b from-primary/[0.06] to-transparent border border-primary/15 p-1.5"
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-secondary/40 transition"
                >
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-[0.14em] font-semibold",
                      group.ai ? "text-primary/90" : "text-muted-foreground/70"
                    )}
                  >
                    {group.title}
                  </span>
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 transition-transform duration-200",
                      group.ai ? "text-primary/70" : "text-muted-foreground/60",
                      isOpen ? "rotate-0" : "-rotate-90"
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-0.5 mt-1">
                    {group.items.map(renderItem)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sticky bottom user profile */}
        <div className="p-3 border-t border-border bg-card/95 backdrop-blur-xl shrink-0">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-fuchsia-500/20 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
              {(user?.email?.[0] || "G").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.email?.split("@")[0] || "Gebruiker"}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
            </div>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title={theme === "dark" ? "Licht thema" : "Donker thema"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={signOut}
              className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Uitloggen"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
