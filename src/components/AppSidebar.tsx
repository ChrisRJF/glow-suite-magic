import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Calendar, Users, Scissors, X, Globe,
  MessageCircle, CreditCard, TrendingUp, RefreshCw, Megaphone,
  Zap, ShoppingBag, Package, BarChart3, Settings, HelpCircle, LogOut,
  Sun, Moon, Bot, Clock, Gift, ShoppingCart, Share2, UserPlus, Crown, RotateCcw, Mail, Wallet, Flame, Sparkles, ChevronDown, Database, ShieldCheck, Rocket,
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
  badge?: string;
  accent?: boolean;
  ai?: boolean;
  ownerOnly?: boolean;
  staffOnly?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
  defaultOpenMobile?: boolean;
}

const aiItem: NavItem = {
  label: "GlowSuite AI",
  icon: Sparkles,
  path: "/ai",
  badge: "AI",
  ai: true,
};

const navGroups: NavGroup[] = [
  {
    title: "Operatie",
    defaultOpenMobile: true,
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
    title: "Auto Revenue",
    items: [
      { label: "🔥 Auto Revenue", icon: Flame, path: "/auto-revenue", accent: true, badge: "AI" },
      { label: "Autopilot", icon: Zap, path: "/acties" },
    ],
  },
  {
    title: "Commerce",
    items: [
      { label: "GlowPay", icon: CreditCard, path: "/glowpay", accent: true },
      { label: "Kassa", icon: ShoppingBag, path: "/kassa" },
      { label: "Producten", icon: Package, path: "/producten" },
      { label: "Webshop", icon: ShoppingCart, path: "/webshop" },
      { label: "Cadeaubonnen", icon: Gift, path: "/cadeaubonnen" },
      { label: "Abonnementen", icon: CreditCard, path: "/abonnementen" },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Omzet", icon: TrendingUp, path: "/omzet" },
      { label: "Eigenaar", icon: Crown, path: "/eigenaar", accent: true },
      { label: "Payroll", icon: Wallet, path: "/payroll" },
      { label: "Rapporten", icon: BarChart3, path: "/rapporten" },
      { label: "Refunds", icon: RotateCcw, path: "/refunds" },
    ],
  },
  {
    title: "Beheer",
    items: [
      { label: "Instellingen", icon: Settings, path: "/instellingen" },
      { label: "Launch Status", icon: Rocket, path: "/launch-status", ownerOnly: true },
      { label: "QA Status", icon: ShieldCheck, path: "/qa-status", staffOnly: true },
      { label: "Email previews", icon: Mail, path: "/admin/email-templates", staffOnly: true },
      { label: "Demo verzoeken", icon: Database, path: "/admin/demo-requests", staffOnly: true },
      { label: "Support", icon: HelpCircle, path: "/support" },
    ],
  },
];

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
            return canAccessRoute(item.path, roles);
          }),
        }))
        .filter((group) => group.items.length > 0),
    [roles, isOwner, isStaffAdmin]
  );

  // Track which group contains the active route to auto-open it
  const activeGroupTitle = useMemo(() => {
    for (const g of visibleGroups) {
      if (g.items.some((i) => i.path === location.pathname)) return g.title;
    }
    return null;
  }, [visibleGroups, location.pathname]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Initialize / sync defaults whenever the active group changes
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const g of visibleGroups) {
        if (next[g.title] === undefined) {
          next[g.title] = g.defaultOpenMobile === true || g.title === activeGroupTitle;
        }
      }
      if (activeGroupTitle) next[activeGroupTitle] = true;
      return next;
    });
  }, [activeGroupTitle, visibleGroups]);

  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("glowsuite:open-sidebar", open);
    return () => window.removeEventListener("glowsuite:open-sidebar", open);
  }, []);

  const toggleGroup = (title: string) =>
    setOpenGroups((p) => ({ ...p, [title]: !p[title] }));

  const renderItem = (item: NavItem) => {
    const isActive = location.pathname === item.path;
    const tourAttr = item.path === "/eigenaar" ? "owner-mode" : undefined;
    return (
      <Link
        key={item.path}
        to={item.path}
        data-tour={tourAttr}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "relative flex items-center gap-3 px-3 py-1.5 rounded-xl text-[13.5px] transition-all duration-150",
          isActive
            ? item.ai
              ? "bg-gradient-to-r from-primary/20 via-fuchsia-500/15 to-primary/10 text-primary font-semibold shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
              : "bg-secondary text-foreground font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
          item.ai && !isActive && "text-primary/90 hover:text-primary",
          item.accent && !isActive && !item.ai && "text-primary/85"
        )}
      >
        {isActive && !item.ai && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
        )}
        <item.icon className={cn("w-[17px] h-[17px] shrink-0", item.ai && "text-primary")} />
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && (
          <span
            className={cn(
              "text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md",
              item.ai
                ? "bg-gradient-to-r from-primary to-fuchsia-500 text-white"
                : isActive
                ? "bg-primary/20 text-primary"
                : item.accent
                ? "bg-primary/15 text-primary"
                : "bg-secondary text-muted-foreground"
            )}
          >
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  const aiActive = location.pathname === aiItem.path;

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
          "fixed lg:sticky top-0 left-0 z-50 h-[100dvh] w-[86vw] max-w-[300px] lg:w-[260px] flex flex-col bg-card/95 lg:bg-card/60 backdrop-blur-xl border-r border-border transition-transform duration-300 overflow-y-auto overscroll-contain",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Menu sluiten"
          className="absolute top-3 right-3 lg:hidden inline-flex items-center justify-center h-11 w-11 rounded-xl hover:bg-secondary active:scale-95 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="px-5 pt-6 pb-3">
          <img src={logoFull} alt="GlowSuite" className="hidden lg:block h-9 w-auto object-contain" />
          <img src={logoIcon} alt="GlowSuite" className="lg:hidden h-9 w-9 rounded-xl object-contain" />
        </div>

        {/* Pinned AI item */}
        <div className="px-3 pb-2">
          <Link
            to={aiItem.path}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "group relative flex items-center gap-3 px-3 py-2.5 rounded-2xl text-[14px] font-semibold transition-all overflow-hidden",
              "border border-primary/20",
              aiActive
                ? "bg-gradient-to-r from-primary/25 via-fuchsia-500/20 to-primary/15 text-primary shadow-[0_4px_24px_-8px_hsl(var(--primary)/0.45)]"
                : "bg-gradient-to-r from-primary/10 via-fuchsia-500/10 to-primary/5 text-primary/95 hover:from-primary/15 hover:via-fuchsia-500/15 hover:to-primary/10"
            )}
          >
            <Sparkles className="w-[18px] h-[18px] shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate">GlowSuite AI</span>
                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md bg-gradient-to-r from-primary to-fuchsia-500 text-white">
                  AI
                </span>
              </div>
              <p className="hidden lg:block text-[10.5px] font-normal text-muted-foreground truncate">
                Je salon assistent
              </p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 pb-2">
          {visibleGroups.map((group) => {
            const isOpen = openGroups[group.title] ?? false;
            return (
              <div key={group.title} className="mb-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title)}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg group hover:bg-secondary/40 transition"
                >
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold">
                    {group.title}
                  </span>
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 text-muted-foreground/60 transition-transform duration-200",
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

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 px-2">
            <img src={logoIcon} alt="GlowSuite" className="w-8 h-8 rounded-lg object-contain" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.email?.split("@")[0] || "Gebruiker"}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
            </div>
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title={theme === "dark" ? "Licht thema" : "Donker thema"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={signOut} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Uitloggen">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
