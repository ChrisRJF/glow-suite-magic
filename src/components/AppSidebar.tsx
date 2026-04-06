import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Calendar, Users, Scissors, Menu, X, Globe,
  MessageCircle, CreditCard, TrendingUp, RefreshCw, Megaphone,
  Zap, ShoppingBag, Package, BarChart3, Settings, HelpCircle, LogOut,
  Sun, Moon,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import logoFull from "@/assets/logo-full.png";
import logoIcon from "@/assets/logo-icon.png";

interface NavItem {
  label: string;
  icon: typeof LayoutDashboard;
  path: string;
  badge?: string;
  accent?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: "Hoofdmenu",
    items: [
      { label: "Overzicht", icon: LayoutDashboard, path: "/" },
      { label: "Omzet", icon: TrendingUp, path: "/omzet" },
      { label: "Agenda", icon: Calendar, path: "/agenda" },
    ],
  },
  {
    title: "Groei & Actie",
    items: [
      { label: "Klanten", icon: Users, path: "/klanten" },
      { label: "Herboekingen", icon: RefreshCw, path: "/herboekingen" },
      { label: "Marketing", icon: Megaphone, path: "/marketing" },
      { label: "Acties", icon: Zap, path: "/acties", accent: true },
    ],
  },
  {
    title: "Beheer",
    items: [
      { label: "Behandelingen", icon: Scissors, path: "/behandelingen" },
      { label: "Online Boeken", icon: Globe, path: "/boeken" },
      { label: "GlowPay", icon: CreditCard, path: "/glowpay", accent: true },
      { label: "Kassa", icon: ShoppingBag, path: "/kassa" },
      { label: "Producten", icon: Package, path: "/producten" },
      { label: "Abonnementen", icon: CreditCard, path: "/abonnementen" },
      { label: "Rapporten", icon: BarChart3, path: "/rapporten" },
    ],
  },
];

const bottomItems: NavItem[] = [
  { label: "Instellingen", icon: Settings, path: "/instellingen" },
  { label: "Support", icon: HelpCircle, path: "/support" },
];

export function AppSidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-xl bg-card border border-border"
      >
        <Menu className="w-5 h-5" />
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-50 h-screen w-[260px] flex flex-col bg-card/50 backdrop-blur-xl border-r border-border transition-transform duration-300 overflow-y-auto",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 lg:hidden p-1 rounded-lg hover:bg-secondary"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-5 pb-2">
          <img src={logoFull} alt="GlowSuite" className="hidden lg:block h-10 w-auto object-contain" />
          <img src={logoIcon} alt="GlowSuite" className="lg:hidden h-10 w-10 rounded-xl object-contain" />
        </div>

        <nav className="flex-1 px-3 py-2">
          {navGroups.map((group) => (
            <div key={group.title} className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-3 mb-1.5">
                {group.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all",
                        isActive
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                        item.accent && !isActive && "text-primary/80"
                      )}
                    >
                      <item.icon className="w-[18px] h-[18px] shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span
                          className={cn(
                            "text-[10px] font-semibold px-1.5 py-0.5 rounded-md",
                            isActive
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
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 pb-2 border-t border-border pt-2">
          {bottomItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all",
                  isActive
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
              >
                <item.icon className="w-[18px] h-[18px]" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

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
