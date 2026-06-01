import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GlowSuiteLogo } from "@/components/GlowSuiteLogo";
import { toast } from "sonner";
import { Play, Loader2, Check, Sparkles, ShieldCheck, Clock, Gift } from "lucide-react";
import { trackEvent } from "@/hooks/useAnalytics";
import { useTranslation } from "react-i18next";
import { useLanguagePersistence } from "@/hooks/useLanguagePersistence";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const REF_STORAGE_KEY = "gs_ref_code";

export default function LoginPage() {
  useLanguagePersistence();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [salonName, setSalonName] = useState("");
  const [fullName, setFullName] = useState("");
  const [isSignUp, setIsSignUp] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("mode") === "signup";
  });
  const [refCode, setRefCode] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const fromUrl = new URLSearchParams(window.location.search).get("ref");
    if (fromUrl) {
      try { localStorage.setItem(REF_STORAGE_KEY, fromUrl.toUpperCase()); } catch (_e) { /* */ }
      return fromUrl.toUpperCase();
    }
    try { return localStorage.getItem(REF_STORAGE_KEY); } catch (_e) { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams(window.location.search);
      const plan = params.get("plan") || undefined;
      const wantsCheckout = params.get("checkout") === "1";
      if (isSignUp) {
        trackEvent("signup_started", { plan, ref_code: refCode });
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/${wantsCheckout && plan ? `?checkout=1&plan=${plan}` : ""}`,
            data: {
              ...(plan ? { plan } : {}),
              ...(salonName.trim() ? { salon_name: salonName.trim() } : {}),
              ...(fullName.trim() ? { full_name: fullName.trim() } : {}),
              ...(refCode ? { ref_code: refCode } : {}),
            },
          },
        });
        if (error) throw error;
        trackEvent("signup_completed", { plan, ref_code: refCode });
        if (refCode) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              await supabase.functions.invoke("referral-attach", { body: { code: refCode } });
              trackEvent("referral_signup", { ref_code: refCode });
              try { localStorage.removeItem(REF_STORAGE_KEY); } catch (_e) { /* */ }
            }
          } catch (_e) { /* noop */ }
        }
        toast.success(t("auth.toasts.accountCreated"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success(t("auth.toasts.welcomeBack"));
        if (wantsCheckout && plan) {
          window.location.href = `/?checkout=1&plan=${plan}`;
          return;
        }
      }
    } catch (err: any) {
      toast.error(err.message || t("auth.toasts.genericError"));
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotLoading) return;
    if (!forgotEmail.trim()) { toast.error(t("auth.toasts.enterEmail")); return; }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success(t("auth.toasts.resetSent"));
      setForgotOpen(false);
      setForgotEmail("");
    } catch (err: any) {
      toast.error(err.message || t("auth.toasts.sendFailed"));
    } finally {
      setForgotLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    if (demoLoading) return;
    setDemoLoading(true);
    try {
      const demoEmail = "demo@glowsuite.nl";
      const demoPassword = "demo123456";

      let { error } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPassword });
      if (error) {
        const { error: signUpError } = await supabase.auth.signUp({ email: demoEmail, password: demoPassword });
        if (signUpError) throw signUpError;
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPassword });
        if (signInError) throw signInError;
      }

      toast.loading(t("auth.toasts.demoLoading"));
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data, error: seedError } = await supabase.functions.invoke("seed-demo-data", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (seedError || data?.error) throw new Error(data?.error || seedError?.message || "Demo failed");
      }
      toast.dismiss();
      toast.success(t("auth.toasts.demoWelcome"));
    } catch (err: any) {
      toast.dismiss();
      toast.error(err.message || t("auth.toasts.demoFailed"));
    } finally {
      setDemoLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") {
      handleDemoLogin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="min-h-[100dvh] bg-background flex items-start sm:items-center justify-center p-4 sm:p-6"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-2">
          <LanguageSwitcher />
        </div>
        <div className="flex flex-col items-center mb-7 sm:mb-9 gap-3">
          <GlowSuiteLogo size="xl" priority />
          <p className="text-sm text-muted-foreground tracking-wide">{t("auth.tagline")}</p>
        </div>

        {forgotOpen ? (
          <form onSubmit={handleForgot} className="glass-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-center">{t("auth.forgotTitle")}</h2>
            <p className="text-xs text-muted-foreground text-center">{t("auth.forgotIntro")}</p>
            <div>
              <label className="text-xs text-muted-foreground">{t("auth.email")}</label>
              <input type="email" required value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={t("auth.emailPlaceholder")} />
            </div>
            <Button type="submit" variant="gradient" className="w-full h-11" disabled={forgotLoading}>
              {forgotLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {forgotLoading ? t("auth.forgotSubmitLoading") : t("auth.forgotSubmit")}
            </Button>
            <button type="button" onClick={() => setForgotOpen(false)} className="text-xs text-primary hover:underline w-full text-center py-2">
              {t("auth.backToLogin")}
            </button>
          </form>
        ) : isSignUp ? (
          <form onSubmit={handleSubmit} className="glass-card p-6 sm:p-7 space-y-4">
            <div className="text-center space-y-1.5">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-medium mb-1">
                <Sparkles className="w-3 h-3" /> {t("auth.trialBadge")}
              </div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
                {t("auth.signupTitle")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("auth.signupSubtitle")}
              </p>
            </div>

            {refCode && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-success/10 border border-success/30 text-success text-xs">
                <Gift className="w-4 h-4 shrink-0" />
                <span>
                  <strong>{t("auth.referralGift")}</strong> {t("auth.referralBonusText")}{" "}
                  <span className="font-mono font-semibold">{refCode}</span>
                </span>
              </div>
            )}

            <div className="space-y-3 pt-1">
              <div>
                <label className="text-xs text-muted-foreground">{t("auth.salonName")}</label>
                <input type="text" required value={salonName} onChange={(e) => setSalonName(e.target.value)}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={t("auth.salonNamePlaceholder")} autoComplete="organization" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("auth.yourName")}</label>
                <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={t("auth.yourNamePlaceholder")} autoComplete="name" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("auth.email")}</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={t("auth.emailPlaceholder")} autoComplete="email" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("auth.password")}</label>
                <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={t("auth.passwordPlaceholder")} autoComplete="new-password" />
              </div>
            </div>

            <Button type="submit" variant="gradient" className="w-full h-11 text-base font-semibold" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {loading ? t("auth.submitSignupLoading") : t("auth.submitSignup")}
            </Button>

            <ul className="grid grid-cols-1 gap-1.5 pt-1">
              {[
                { icon: ShieldCheck, text: t("auth.perks.noCard") },
                { icon: Clock, text: t("auth.perks.fastLaunch") },
                { icon: Check, text: t("auth.perks.freeMigration") },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                  {text}
                </li>
              ))}
            </ul>

            <p className="text-[11px] text-center text-muted-foreground/80 pt-1">
              {t("auth.termsNotice")}
            </p>

            <p className="text-xs text-center text-muted-foreground">
              {t("auth.hasAccount")}{" "}
              <button type="button" onClick={() => setIsSignUp(false)} className="text-primary hover:underline font-medium">
                {t("auth.login")}
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-center">{t("auth.loginTitle")}</h2>
            <div>
              <label className="text-xs text-muted-foreground">{t("auth.email")}</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={t("auth.emailPlaceholder")} autoComplete="email" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("auth.password")}</label>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={t("auth.passwordHiddenPlaceholder")} autoComplete="current-password" />
            </div>
            <Button type="submit" variant="gradient" className="w-full h-11" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {loading ? t("auth.submitLoginLoading") : t("auth.submitLogin")}
            </Button>
            <button type="button" onClick={() => setForgotOpen(true)} className="text-xs text-primary hover:underline w-full text-center py-2">
              {t("auth.forgotPassword")}
            </button>
            <p className="text-xs text-center text-muted-foreground">
              {t("auth.noAccount")}{" "}
              <button type="button" onClick={() => setIsSignUp(true)} className="text-primary hover:underline font-medium">
                {t("auth.startFreeTrial")}
              </button>
            </p>
          </form>
        )}

        <div className="mt-4">
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center"><span className="bg-background px-3 text-xs text-muted-foreground">{t("common.or")}</span></div>
          </div>
          <Button variant="outline" className="w-full h-11 border-primary/30 hover:bg-primary/5" onClick={handleDemoLogin} disabled={demoLoading}>
            {demoLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {demoLoading ? t("auth.demoCtaLoading") : t("auth.demoCta")}
          </Button>
          <p className="text-[11px] text-center text-muted-foreground/60 mt-2">
            {t("auth.demoHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
