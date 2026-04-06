import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import logoFull from "@/assets/logo-full.png";
import { toast } from "sonner";
import { Play, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Account aangemaakt! Controleer je e-mail.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welkom terug!");
      }
    } catch (err: any) {
      toast.error(err.message || "Er ging iets mis");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setDemoLoading(true);
    try {
      const demoEmail = "demo@glowsuite.nl";
      const demoPassword = "demo123456";

      // Try to sign in first
      let { error } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPassword });
      
      if (error) {
        // If user doesn't exist, sign up
        const { error: signUpError } = await supabase.auth.signUp({ email: demoEmail, password: demoPassword });
        if (signUpError) throw signUpError;
        
        // Sign in after signup
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPassword });
        if (signInError) throw signInError;
      }

      // Seed demo data
      toast.loading("Demo omgeving laden...");
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.functions.invoke("seed-demo-data", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      }
      toast.dismiss();
      toast.success("Welkom bij de GlowSuite demo!");
    } catch (err: any) {
      toast.dismiss();
      toast.error(err.message || "Demo laden mislukt");
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={logoFull} alt="GlowSuite" className="h-12 w-auto mb-3" />
          <p className="text-sm text-muted-foreground">Salon business system</p>
        </div>

        <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-center">
            {isSignUp ? "Account aanmaken" : "Inloggen"}
          </h2>
          <div>
            <label className="text-xs text-muted-foreground">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="jouw@email.nl"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Wachtwoord</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" variant="gradient" className="w-full" disabled={loading}>
            {loading ? "Even geduld..." : isSignUp ? "Registreren" : "Inloggen"}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            {isSignUp ? "Al een account?" : "Nog geen account?"}{" "}
            <button type="button" onClick={() => setIsSignUp(!isSignUp)} className="text-primary hover:underline">
              {isSignUp ? "Inloggen" : "Registreren"}
            </button>
          </p>
        </form>

        <div className="mt-4">
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center"><span className="bg-background px-3 text-xs text-muted-foreground">of</span></div>
          </div>
          <Button
            variant="outline"
            className="w-full border-primary/30 hover:bg-primary/5"
            onClick={handleDemoLogin}
            disabled={demoLoading}
          >
            {demoLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {demoLoading ? "Demo laden..." : "Bekijk demo"}
          </Button>
          <p className="text-[11px] text-center text-muted-foreground/60 mt-2">
            Ontdek GlowSuite met realistische voorbeelddata
          </p>
        </div>
      </div>
    </div>
  );
}
