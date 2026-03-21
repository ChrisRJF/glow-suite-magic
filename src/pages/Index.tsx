// Landing/splash — not currently routed; dashboard is at /
import logoFull from "@/assets/logo-full.png";
import logoIcon from "@/assets/logo-icon.png";

export default function Index() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8">
        <img
          src={logoIcon}
          alt="GlowSuite"
          className="w-20 h-20 rounded-2xl animate-pulse"
          style={{ filter: "drop-shadow(0 0 24px hsl(270 80% 60% / 0.4))" }}
        />
        <img
          src={logoFull}
          alt="GlowSuite — Salon Business System"
          className="h-12 w-auto object-contain"
        />
      </div>
    </div>
  );
}
