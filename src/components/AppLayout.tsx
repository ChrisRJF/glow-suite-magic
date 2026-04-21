import { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
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
        <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-[1400px] mx-auto space-y-8 safe-bottom">
          {/* Page header */}
          <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-12 lg:pt-0">
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
          <div className="space-y-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
