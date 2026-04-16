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
    <div className="flex min-h-screen w-full">
      <AppSidebar />
      <main className="flex-1 min-w-0 lg:pl-0 pl-0">
        <div className="p-6 lg:p-10 max-w-[1400px] mx-auto space-y-8">
          {/* Page header */}
          <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-10 lg:pt-0">
            <div className="page-enter space-y-2">
              <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-balance">{title}</h1>
              {subtitle && <p className="text-muted-foreground text-sm leading-relaxed">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-3 page-enter stagger-1">
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
