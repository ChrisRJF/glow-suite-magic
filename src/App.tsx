import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { RoleProtectedRoute } from "@/components/RoleProtectedRoute";
import DashboardPage from "./pages/DashboardPage";
import CalendarPage from "./pages/CalendarPage";
import CustomersPage from "./pages/CustomersPage";
import CustomerSegmentsPage from "./pages/CustomerSegmentsPage";
import ServicesPage from "./pages/ServicesPage";
import BookingPage from "./pages/BookingPage";
import WhatsAppPage from "./pages/WhatsAppPage";
import MembershipsPage from "./pages/MembershipsPage";
import OmzetPage from "./pages/OmzetPage";
import HerboekingenPage from "./pages/HerboekingenPage";
import MarketingPage from "./pages/MarketingPage";
import ActiesPage from "./pages/ActiesPage";
import AutoRevenuePage from "./pages/AutoRevenuePage";
import GlowSuiteAIPage from "./pages/GlowSuiteAIPage";
import KassaPage from "./pages/KassaPage";
import GlowPayPage from "./pages/GlowPayPage";
import ProductenPage from "./pages/ProductenPage";
import RapportenPage from "./pages/RapportenPage";
import InstellingenPage from "./pages/InstellingenPage";
import SupportPage from "./pages/SupportPage";
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import LaunchStatusPage from "./pages/LaunchStatusPage";
import MollieCallbackPage from "./pages/MollieCallbackPage";
import PaymentSuccessPage from "./pages/PaymentSuccessPage";
import PaymentFailedPage from "./pages/PaymentFailedPage";
import NotFound from "./pages/NotFound";
import AutomatiseringenPage from "./pages/AutomatiseringenPage";
import WachtlijstPage from "./pages/WachtlijstPage";
import CadeaubonnenPage from "./pages/CadeaubonnenPage";
import WebshopPage from "./pages/WebshopPage";
import SocialStudioPage from "./pages/SocialStudioPage";
import LeadsPage from "./pages/LeadsPage";
import EigenaarPage from "./pages/EigenaarPage";
import EmployeesPage from "./pages/EmployeesPage";
import PayrollPage from "./pages/PayrollPage";
import QAStatusPage from "./pages/QAStatusPage";
import AdminEmailTemplatesPage from "./pages/AdminEmailTemplatesPage";
import AdminDemoRequestsPage from "./pages/AdminDemoRequestsPage";
import ShopPage from "./pages/ShopPage";
import MembershipPortalPage from "./pages/MembershipPortalPage";
import RefundsPage from "./pages/RefundsPage";
import PublicActionPage from "./pages/PublicActionPage";
import LandingPage from "./pages/LandingPage";
import PricingPage from "./pages/PricingPage";
import MijnAbonnementPage from "./pages/MijnAbonnementPage";
import { useLeadAutomation } from "@/hooks/useLeadAutomation";
import { OnboardingGate } from "@/components/OnboardingGate";
import { GlowPayActivationGate } from "@/components/GlowPayActivationGate";
import { GuidedTour } from "@/components/GuidedTour";
import { CheckoutIntentHandler } from "@/components/CheckoutIntentHandler";
import { SubscriptionConfirmHandler } from "@/components/SubscriptionConfirmHandler";
import { SubscriptionStateProvider } from "@/contexts/SubscriptionStateContext";
import { TrialExpiredModal } from "@/components/TrialExpiredModal";
import { ReviewPromptModal } from "@/components/ReviewPromptModal";

function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-pulse text-muted-foreground text-sm">Laden...</div></div>;
  if (!user) return <LandingPage />;
  return <RoleProtectedRoute><DashboardPage /></RoleProtectedRoute>;
}

const queryClient = new QueryClient();

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-pulse text-muted-foreground">Laden...</div></div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function LeadAutomationRunner() {
  useLeadAutomation();
  return null;
}

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SubscriptionStateProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <LeadAutomationRunner />
            <OnboardingGate />
            <GuidedTour />
            <CheckoutIntentHandler />
            <SubscriptionConfirmHandler />
            <TrialExpiredModal />
            <ReviewPromptModal />
            <Routes>
              <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/integrations/mollie/callback" element={<MollieCallbackPage />} />
              <Route path="/payment/success" element={<PaymentSuccessPage />} />
              <Route path="/payment/failed" element={<PaymentFailedPage />} />
              <Route path="/boeken" element={<BookingPage />} />
              <Route path="/boeken/:salonSlug" element={<BookingPage />} />
              <Route path="/shop/:salonSlug" element={<ShopPage />} />
              <Route path="/memberships/:salonSlug" element={<MembershipPortalPage />} />
              <Route path="/abonnementen/:salonSlug" element={<MembershipPortalPage />} />
              <Route path="/salonvoorwaarden" element={<PublicActionPage />} />
              <Route path="/route-contact" element={<PublicActionPage />} />
              <Route path="/route-contact/:templateKey" element={<PublicActionPage />} />
              <Route path="/afspraak/:token" element={<PublicActionPage />} />
              <Route path="/afspraak/:token/:action" element={<PublicActionPage />} />
              <Route path="/betaalbewijs" element={<PublicActionPage />} />
              <Route path="/abonnement-beheren" element={<PublicActionPage />} />
              <Route path="/review" element={<PublicActionPage />} />
              <Route path="/review/:templateKey" element={<PublicActionPage />} />
              <Route path="/" element={<RootRoute />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/prijzen" element={<PricingPage />} />
              <Route path="/agenda" element={<RoleProtectedRoute><CalendarPage /></RoleProtectedRoute>} />
              <Route path="/klanten" element={<RoleProtectedRoute><CustomersPage /></RoleProtectedRoute>} />
              <Route path="/segmenten" element={<RoleProtectedRoute><CustomerSegmentsPage /></RoleProtectedRoute>} />
              <Route path="/behandelingen" element={<RoleProtectedRoute><ServicesPage /></RoleProtectedRoute>} />
              <Route path="/whatsapp" element={<RoleProtectedRoute><WhatsAppPage /></RoleProtectedRoute>} />
              <Route path="/abonnementen" element={<RoleProtectedRoute><MembershipsPage /></RoleProtectedRoute>} />
              <Route path="/omzet" element={<RoleProtectedRoute><OmzetPage /></RoleProtectedRoute>} />
              <Route path="/herboekingen" element={<RoleProtectedRoute><HerboekingenPage /></RoleProtectedRoute>} />
              <Route path="/marketing" element={<RoleProtectedRoute><MarketingPage /></RoleProtectedRoute>} />
              <Route path="/acties" element={<RoleProtectedRoute><ActiesPage /></RoleProtectedRoute>} />
              <Route path="/auto-revenue" element={<RoleProtectedRoute><AutoRevenuePage /></RoleProtectedRoute>} />
              <Route path="/ai" element={<RoleProtectedRoute><GlowSuiteAIPage /></RoleProtectedRoute>} />
              <Route path="/glowpay" element={<RoleProtectedRoute><GlowPayPage /></RoleProtectedRoute>} />
              <Route path="/refunds" element={<RoleProtectedRoute><RefundsPage /></RoleProtectedRoute>} />
              <Route path="/kassa" element={<RoleProtectedRoute><KassaPage /></RoleProtectedRoute>} />
              <Route path="/producten" element={<RoleProtectedRoute><ProductenPage /></RoleProtectedRoute>} />
              <Route path="/rapporten" element={<RoleProtectedRoute><RapportenPage /></RoleProtectedRoute>} />
              <Route path="/instellingen" element={<RoleProtectedRoute><InstellingenPage /></RoleProtectedRoute>} />
              <Route path="/automatiseringen" element={<RoleProtectedRoute><AutomatiseringenPage /></RoleProtectedRoute>} />
              <Route path="/automations" element={<RoleProtectedRoute><AutomatiseringenPage /></RoleProtectedRoute>} />
              <Route path="/wachtlijst" element={<RoleProtectedRoute><WachtlijstPage /></RoleProtectedRoute>} />
              <Route path="/cadeaubonnen" element={<RoleProtectedRoute><CadeaubonnenPage /></RoleProtectedRoute>} />
              <Route path="/webshop" element={<RoleProtectedRoute><WebshopPage /></RoleProtectedRoute>} />
              <Route path="/social-studio" element={<RoleProtectedRoute><SocialStudioPage /></RoleProtectedRoute>} />
              <Route path="/leads" element={<RoleProtectedRoute><LeadsPage /></RoleProtectedRoute>} />
              <Route path="/eigenaar" element={<RoleProtectedRoute allow={["eigenaar","manager"]}><EigenaarPage /></RoleProtectedRoute>} />
              <Route path="/medewerkers" element={<RoleProtectedRoute><EmployeesPage /></RoleProtectedRoute>} />
              <Route path="/payroll" element={<RoleProtectedRoute allow={["eigenaar","manager"]}><PayrollPage /></RoleProtectedRoute>} />
              <Route path="/support" element={<RoleProtectedRoute><SupportPage /></RoleProtectedRoute>} />
              <Route path="/mijn-abonnement" element={<RoleProtectedRoute><MijnAbonnementPage /></RoleProtectedRoute>} />
              <Route path="/launch-status" element={<RoleProtectedRoute allow={["eigenaar"]}><LaunchStatusPage /></RoleProtectedRoute>} />
              <Route path="/qa-status" element={<RoleProtectedRoute allow={["eigenaar","manager","admin"]}><QAStatusPage /></RoleProtectedRoute>} />
              <Route path="/admin/email-templates" element={<RoleProtectedRoute allow={["eigenaar","manager","admin"]}><AdminEmailTemplatesPage /></RoleProtectedRoute>} />
              <Route path="/admin/demo-requests" element={<RoleProtectedRoute allow={["eigenaar","manager","admin"]}><AdminDemoRequestsPage /></RoleProtectedRoute>} />
              <Route path="*" element={<RoleProtectedRoute><NotFound /></RoleProtectedRoute>} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
        </SubscriptionStateProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
