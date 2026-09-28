import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useDynamicBranding } from "@/hooks/use-dynamic-branding";
import MobileBlocker from "@/components/MobileBlocker";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import UserManagement from "@/pages/UserManagement";
import CatalogBrowser from "@/pages/CatalogBrowser";
import TestQuotations from "@/pages/TestQuotations";
import BrandSettings from "@/pages/BrandSettings";
import ProjectDetail from "@/pages/ProjectDetail";
import ProjectFolder from "@/pages/ProjectFolder";
import RoomDetail from "@/pages/RoomDetail";
import SharedQuote from "@/pages/SharedQuote";
import ClientCreditsPortal from "@/pages/ClientCreditsPortal";
import Analytics from "@/pages/Analytics";
import CreditsManagement from "@/pages/CreditsManagement";
import ProjectCreditsDetail from "@/pages/ProjectCreditsDetail";
import NotFound from "@/pages/not-found";
import PricingVersions from "@/pages/PricingVersions";
import Offers from "@/pages/Offers";
import MilestoneSettings from "@/pages/MilestoneSettings";
import { saveLoginReturnPath } from "@/lib/auth-redirect";

function DynamicBrandingProvider({ children }: { children: React.ReactNode }) {
  useDynamicBranding();
  return <>{children}</>;
}

function Router() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      saveLoginReturnPath();
    }
  }, [isLoading, user]);

  return (
    <Switch>
      <Route path="/quote/:shareToken" component={SharedQuote} />
      <Route path="/client/credits/:shareToken" component={ClientCreditsPortal} />
      <Route>
        {() => {
          if (isLoading) {
            return (
              <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-muted-foreground">Loading...</div>
              </div>
            );
          }

          if (!user) {
            return <Landing />;
          }

          return (
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/analytics" component={Analytics} />
              <Route path="/admin" component={AdminDashboard} />
              <Route path="/admin/pricing-versions" component={PricingVersions} />
              <Route path="/admin/offers" component={Offers} />
              <Route path="/admin/milestone-settings" component={MilestoneSettings} />
              <Route path="/admin/users" component={UserManagement} />
              <Route path="/admin/catalog" component={CatalogBrowser} />
              <Route path="/admin/settings" component={BrandSettings} />
              <Route path="/admin/test-quotations" component={TestQuotations} />
              <Route path="/admin/credits/:projectId" component={ProjectCreditsDetail} />
              <Route path="/admin/credits" component={CreditsManagement} />
              <Route path="/project/:id" component={ProjectDetail} />
              <Route path="/folder/:pid" component={ProjectFolder} />
              <Route path="/room/:id" component={RoomDetail} />
              <Route component={NotFound} />
            </Switch>
          );
        }}
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DynamicBrandingProvider>
        <TooltipProvider>
          <MobileBlocker>
            <Toaster />
            <Router />
          </MobileBlocker>
        </TooltipProvider>
      </DynamicBrandingProvider>
    </QueryClientProvider>
  );
}
