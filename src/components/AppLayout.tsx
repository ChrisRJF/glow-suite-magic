import { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { MobileTopbar } from "./MobileTopbar";
import logoIcon from "@/assets/logo-icon.png";

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AppLayout({ children, title, subtitle, actions }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <main className="flex-1 min-w-0">
        <MobileTopbar
          title={title}
          onMenuOpen={() => window.dispatchEvent(new Event("glowsuite:open-sidebar"))}
        />
        <div className="px-4 sm:px-6 lg:px-10 pt-4 pb-6 lg:pt-10 lg:pb-10 max-w-[1400px] mx-auto space-y-7 safe-bottom">
          {/* Page header — desktop shows full title; mobile relies on sticky topbar */}
          <header className="hidden lg:flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="page-enter space-y-1.5 min-w-0">
              <h1 className="text-page-title text-balance">{title}</h1>
              {subtitle && <p className="text-meta leading-relaxed">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-3 page-enter stagger-1 flex-shrink-0">
              {actions}
              <img
                src={logoIcon}
                alt="GlowSuite"
                className="hidden sm:block w-9 h-9 rounded-xl object-contain opacity-80 hover:opacity-100 transition-opacity"
              />
            </div>
          </header>

          {/* Mobile subtitle + actions row (title is in topbar) */}
          <div className="lg:hidden flex items-center justify-between gap-3 page-enter">
            {subtitle ? (
              <p className="text-meta leading-relaxed truncate">{subtitle}</p>
            ) : (
              <span />
            )}
            {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
          </div>

          <div className="space-y-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
