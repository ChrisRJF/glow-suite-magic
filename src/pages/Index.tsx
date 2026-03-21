import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import logoIcon from "@/assets/logo-icon.png";

export default function Index() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => navigate("/", { replace: true }), 300);
    }, 1500);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className={`flex flex-col items-center gap-6 transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
      >
        <img
          src={logoIcon}
          alt="GlowSuite"
          className="w-20 h-20 rounded-2xl animate-pulse"
          style={{ filter: "drop-shadow(0 0 24px hsl(270 80% 60% / 0.4))" }}
        />
        <p className="text-sm text-muted-foreground font-medium tracking-widest uppercase">
          Laden...
        </p>
      </div>
    </div>
  );
}
