import { Menu, Bell } from "lucide-react";
import { useEffect, useState } from "react";

interface MobileTopbarProps {
  title: string;
  onMenuOpen: () => void;
}

/**
 * Premium sticky mobile topbar — replaces the floating hamburger bubble.
 * - Aligns with content grid
 * - Soft white background with subtle bottom border
 * - Becomes slightly more opaque on scroll for a layered feel
 */
export function MobileTopbar({ title, onMenuOpen }: MobileTopbarProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`lg:hidden sticky top-0 z-30 w-full backdrop-blur-xl transition-colors duration-200 ${
        scrolled ? "bg-card/90 border-b border-border/70" : "bg-card/70 border-b border-transparent"
      }`}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-2 h-14 px-3">
        <button
          onClick={onMenuOpen}
          aria-label="Menu openen"
          className="h-10 w-10 inline-flex items-center justify-center rounded-xl text-foreground hover:bg-secondary active:scale-95 transition-all"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="flex-1 text-center text-[15px] font-semibold tracking-tight truncate px-2">
          {title}
        </h1>
        <button
          aria-label="Meldingen"
          className="h-10 w-10 inline-flex items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all"
        >
          <Bell className="w-[18px] h-[18px]" />
        </button>
      </div>
    </header>
  );
}
