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
import ServicesPage from "./pages/ServicesPage";
import BookingPage from "./pages/BookingPage";
import WhatsAppPage from "./pages/WhatsAppPage";
import MembershipsPage from "./pages/MembershipsPage";
import OmzetPage from "./pages/OmzetPage";
import HerboekingenPage from "./pages/HerboekingenPage";
import MarketingPage from "./pages/MarketingPage";
import ActiesPage from "./pages/ActiesPage";
import KassaPage from "./pages/KassaPage";
import GlowPayPage from "./pages/GlowPayPage";
import ProductenPage from "./pages/ProductenPage";
import RapportenPage from "./pages/RapportenPage";
import InstellingenPage from "./pages/InstellingenPage";
import SupportPage from "./pages/SupportPage";
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import LaunchStatusPage from "./pages/LaunchStatusPage";
import NotFound from "./pages/NotFound";
import AutomatiseringenPage from "./pages/AutomatiseringenPage";
import WachtlijstPage from "./pages/WachtlijstPage";
import CadeaubonnenPage from "./pages/CadeaubonnenPage";
import WebshopPage from "./pages/WebshopPage";
import SocialStudioPage from "./pages/SocialStudioPage";
import LeadsPage from "./pages/LeadsPage";
import { useLeadAutomation } from "@/hooks/useLeadAutomation";

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
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <LeadAutomationRunner />
            <Routes>
              <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/boeken" element={<BookingPage />} />
              <Route path="/" element={<RoleProtectedRoute><DashboardPage /></RoleProtectedRoute>} />
              <Route path="/agenda" element={<RoleProtectedRoute><CalendarPage /></RoleProtectedRoute>} />
              <Route path="/klanten" element={<RoleProtectedRoute><CustomersPage /></RoleProtectedRoute>} />
              <Route path="/behandelingen" element={<RoleProtectedRoute><ServicesPage /></RoleProtectedRoute>} />
              <Route path="/whatsapp" element={<RoleProtectedRoute><WhatsAppPage /></RoleProtectedRoute>} />
              <Route path="/abonnementen" element={<RoleProtectedRoute><MembershipsPage /></RoleProtectedRoute>} />
              <Route path="/omzet" element={<RoleProtectedRoute><OmzetPage /></RoleProtectedRoute>} />
              <Route path="/herboekingen" element={<RoleProtectedRoute><HerboekingenPage /></RoleProtectedRoute>} />
              <Route path="/marketing" element={<RoleProtectedRoute><MarketingPage /></RoleProtectedRoute>} />
              <Route path="/acties" element={<RoleProtectedRoute><ActiesPage /></RoleProtectedRoute>} />
              <Route path="/glowpay" element={<RoleProtectedRoute><GlowPayPage /></RoleProtectedRoute>} />
              <Route path="/kassa" element={<RoleProtectedRoute><KassaPage /></RoleProtectedRoute>} />
              <Route path="/producten" element={<RoleProtectedRoute><ProductenPage /></RoleProtectedRoute>} />
              <Route path="/rapporten" element={<RoleProtectedRoute><RapportenPage /></RoleProtectedRoute>} />
              <Route path="/instellingen" element={<RoleProtectedRoute><InstellingenPage /></RoleProtectedRoute>} />
              <Route path="/automatiseringen" element={<RoleProtectedRoute><AutomatiseringenPage /></RoleProtectedRoute>} />
              <Route path="/wachtlijst" element={<RoleProtectedRoute><WachtlijstPage /></RoleProtectedRoute>} />
              <Route path="/cadeaubonnen" element={<RoleProtectedRoute><CadeaubonnenPage /></RoleProtectedRoute>} />
              <Route path="/webshop" element={<RoleProtectedRoute><WebshopPage /></RoleProtectedRoute>} />
              <Route path="/social-studio" element={<RoleProtectedRoute><SocialStudioPage /></RoleProtectedRoute>} />
              <Route path="/leads" element={<RoleProtectedRoute><LeadsPage /></RoleProtectedRoute>} />
              <Route path="/support" element={<RoleProtectedRoute><SupportPage /></RoleProtectedRoute>} />
              <Route path="/launch-status" element={<RoleProtectedRoute allow={["eigenaar"]}><LaunchStatusPage /></RoleProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
