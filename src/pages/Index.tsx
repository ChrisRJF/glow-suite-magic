// Landing/splash — not currently routed; dashboard is at /
import { GlowSuiteLogo } from "@/components/GlowSuiteLogo";

export default function Index() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5 animate-pulse">
        <GlowSuiteLogo size="xl" priority />
        <span className="text-sm text-muted-foreground tracking-wide">Salon business system</span>
      </div>
    </div>
  );
}
