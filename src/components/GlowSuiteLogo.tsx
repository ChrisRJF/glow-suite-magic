import { cn } from "@/lib/utils";
import logoMark from "@/assets/glowsuite-logo.png";

type Size = "sm" | "md" | "lg" | "xl";

interface GlowSuiteLogoProps {
  size?: Size;
  /** Show "GlowSuite" wordmark next to the icon. */
  withWordmark?: boolean;
  /** Render only the icon (alias for withWordmark=false). */
  iconOnly?: boolean;
  /** Prioritize image load (above-the-fold logos). */
  priority?: boolean;
  /** Render wordmark in current text color instead of brand gradient. */
  monochrome?: boolean;
  className?: string;
}

const ICON_SIZE: Record<Size, string> = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-10 w-10",
  xl: "h-14 w-14",
};

const WORDMARK_SIZE: Record<Size, string> = {
  sm: "text-[15px]",
  md: "text-lg",
  lg: "text-xl",
  xl: "text-2xl",
};

const GAP: Record<Size, string> = {
  sm: "gap-2",
  md: "gap-2.5",
  lg: "gap-3",
  xl: "gap-3.5",
};

/**
 * Single source of truth for the GlowSuite brand mark.
 * Uses the transparent primary logo asset — never wrap in dark squares.
 */
export function GlowSuiteLogo({
  size = "md",
  withWordmark = false,
  iconOnly = false,
  priority = false,
  monochrome = false,
  className,
}: GlowSuiteLogoProps) {
  const showWordmark = withWordmark && !iconOnly;

  return (
    <span className={cn("inline-flex items-center", showWordmark && GAP[size], className)}>
      <img
        src={logoMark}
        alt="GlowSuite"
        width={224}
        height={224}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className={cn(ICON_SIZE[size], "object-contain shrink-0 select-none")}
        draggable={false}
      />
      {showWordmark && (
        <span
          className={cn(
            "font-semibold tracking-tight leading-none",
            WORDMARK_SIZE[size],
            monochrome
              ? "text-foreground"
              : "bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent",
          )}
        >
          GlowSuite
        </span>
      )}
    </span>
  );
}

export default GlowSuiteLogo;
