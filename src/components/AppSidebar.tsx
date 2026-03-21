import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Calendar,
  Users,
  Scissors,
  Menu,
  X,
  Globe,
  MessageCircle,
  CreditCard,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { label: "Overzicht", icon: LayoutDashboard, path: "/" },
  { label: "Agenda", icon: Calendar, path: "/agenda" },
  { label: "Klanten", icon: Users, path: "/klanten" },
  { label: "Behandelingen", icon: Scissors, path: "/behandelingen" },
  { label: "Online Boeken", icon: Globe, path: "/boeken" },
  { label: "WhatsApp", icon: MessageCircle, path: "/whatsapp" },
  { label: "Abonnementen", icon: CreditCard, path: "/abonnementen" },
];

export function AppSidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-xl bg-card border border-border"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-50 h-screen w-[260px] flex flex-col bg-card/50 backdrop-blur-xl border-r border-border p-5 transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Close button mobile */}
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 lg:hidden p-1 rounded-lg hover:bg-secondary"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-3 mb-10 px-1">
          <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center">
            <span className="text-sm font-bold text-primary-foreground">GS</span>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">GlowSuite</h1>
            <p className="text-[11px] text-muted-foreground font-medium tracking-wide uppercase">Salon System</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={cn("nav-item", isActive && "active")}
              >
                <item.icon className="w-[18px] h-[18px]" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center gap-3 px-1">
            <div className="w-8 h-8 rounded-full gradient-bg flex items-center justify-center">
              <span className="text-xs font-semibold text-primary-foreground">JA</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">Jessica A.</p>
              <p className="text-xs text-muted-foreground truncate">Glow Studio</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
