import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import ProductenPage from "./pages/ProductenPage";
import RapportenPage from "./pages/RapportenPage";
import InstellingenPage from "./pages/InstellingenPage";
import SupportPage from "./pages/SupportPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/agenda" element={<CalendarPage />} />
          <Route path="/klanten" element={<CustomersPage />} />
          <Route path="/behandelingen" element={<ServicesPage />} />
          <Route path="/boeken" element={<BookingPage />} />
          <Route path="/whatsapp" element={<WhatsAppPage />} />
          <Route path="/abonnementen" element={<MembershipsPage />} />
          <Route path="/omzet" element={<OmzetPage />} />
          <Route path="/herboekingen" element={<HerboekingenPage />} />
          <Route path="/marketing" element={<MarketingPage />} />
          <Route path="/acties" element={<ActiesPage />} />
          <Route path="/kassa" element={<KassaPage />} />
          <Route path="/producten" element={<ProductenPage />} />
          <Route path="/rapporten" element={<RapportenPage />} />
          <Route path="/instellingen" element={<InstellingenPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
