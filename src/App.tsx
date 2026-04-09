import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
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
import NotFound from "./pages/NotFound";
import AutomatiseringenPage from "./pages/AutomatiseringenPage";
import WachtlijstPage from "./pages/WachtlijstPage";
import CadeaubonnenPage from "./pages/CadeaubonnenPage";
import WebshopPage from "./pages/WebshopPage";
import SocialStudioPage from "./pages/SocialStudioPage";
const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-pulse text-muted-foreground">Laden...</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-pulse text-muted-foreground">Laden...</div></div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <ThemeProvider>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
            <Route path="/boeken" element={<BookingPage />} />
            <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/agenda" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
            <Route path="/klanten" element={<ProtectedRoute><CustomersPage /></ProtectedRoute>} />
            <Route path="/behandelingen" element={<ProtectedRoute><ServicesPage /></ProtectedRoute>} />
            <Route path="/whatsapp" element={<ProtectedRoute><WhatsAppPage /></ProtectedRoute>} />
            <Route path="/abonnementen" element={<ProtectedRoute><MembershipsPage /></ProtectedRoute>} />
            <Route path="/omzet" element={<ProtectedRoute><OmzetPage /></ProtectedRoute>} />
            <Route path="/herboekingen" element={<ProtectedRoute><HerboekingenPage /></ProtectedRoute>} />
            <Route path="/marketing" element={<ProtectedRoute><MarketingPage /></ProtectedRoute>} />
            <Route path="/acties" element={<ProtectedRoute><ActiesPage /></ProtectedRoute>} />
            <Route path="/glowpay" element={<ProtectedRoute><GlowPayPage /></ProtectedRoute>} />
            <Route path="/kassa" element={<ProtectedRoute><KassaPage /></ProtectedRoute>} />
            <Route path="/producten" element={<ProtectedRoute><ProductenPage /></ProtectedRoute>} />
            <Route path="/rapporten" element={<ProtectedRoute><RapportenPage /></ProtectedRoute>} />
            <Route path="/instellingen" element={<ProtectedRoute><InstellingenPage /></ProtectedRoute>} />
            <Route path="/automatiseringen" element={<ProtectedRoute><AutomatiseringenPage /></ProtectedRoute>} />
            <Route path="/wachtlijst" element={<ProtectedRoute><WachtlijstPage /></ProtectedRoute>} />
            <Route path="/cadeaubonnen" element={<ProtectedRoute><CadeaubonnenPage /></ProtectedRoute>} />
            <Route path="/webshop" element={<ProtectedRoute><WebshopPage /></ProtectedRoute>} />
            <Route path="/social-studio" element={<ProtectedRoute><SocialStudioPage /></ProtectedRoute>} />
            <Route path="/support" element={<ProtectedRoute><SupportPage /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
