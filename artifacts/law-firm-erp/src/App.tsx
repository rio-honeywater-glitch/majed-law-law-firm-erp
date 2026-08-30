import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeInjector } from "@/components/ThemeInjector";
import { DocumentBranding } from "@/components/DocumentBranding";
import NotFound from "@/pages/not-found";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import ClientDetail from "@/pages/client-detail";
import Cases from "@/pages/cases";
import CaseDetail from "@/pages/case-detail";
import CaseNew from "@/pages/case-new";
import Contracts from "@/pages/contracts";
import ContractNew from "@/pages/contract-new";
import Hearings from "@/pages/hearings";
import Executions from "@/pages/executions";
import Notifications from "@/pages/notifications";
import MojDirectory from "@/pages/moj-directory";
import Tasks from "@/pages/tasks";
import Settings from "@/pages/settings";
import UsersPage from "@/pages/users";
import ProfilePage from "@/pages/profile";
import AiAssistant from "@/pages/ai-assistant";
import Meetings from "@/pages/meetings";
import MeetingDetail from "@/pages/meeting-detail";
import ClientReportPage from "@/pages/client-report";
import FinancesPage from "@/pages/finances";

const queryClient = new QueryClient();

// Protected Route Wrapper
function ProtectedRoute({ component: Component, requiredRole, ...rest }: any) {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (!user) return <Redirect to="/login" />;
  if (requiredRole && user.role !== requiredRole) return <Redirect to="/dashboard" />;

  return <Component {...rest} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/clients" component={() => <ProtectedRoute component={Clients} />} />
      <Route path="/clients/:id" component={() => <ProtectedRoute component={ClientDetail} />} />
      <Route path="/cases" component={() => <ProtectedRoute component={Cases} />} />
      <Route path="/cases/new" component={() => <ProtectedRoute component={CaseNew} />} />
      <Route path="/cases/:id/client-report" component={() => <ProtectedRoute component={ClientReportPage} />} />
      <Route path="/cases/:id" component={() => <ProtectedRoute component={CaseDetail} />} />
      <Route
        path="/contracts/new"
        component={() => <ProtectedRoute component={ContractNew} requiredRole="SYSTEM_MANAGER" />}
      />
      <Route
        path="/contracts"
        component={() => <ProtectedRoute component={Contracts} requiredRole="SYSTEM_MANAGER" />}
      />
      <Route path="/hearings" component={() => <ProtectedRoute component={Hearings} />} />
      <Route path="/executions" component={() => <ProtectedRoute component={Executions} />} />
      <Route path="/notifications" component={() => <ProtectedRoute component={Notifications} />} />
      <Route path="/moj-directory" component={() => <ProtectedRoute component={MojDirectory} />} />
      <Route path="/tasks" component={() => <ProtectedRoute component={Tasks} />} />
      <Route
        path="/settings"
        component={() => <ProtectedRoute component={Settings} requiredRole="SYSTEM_MANAGER" />}
      />
      <Route path="/users" component={() => <ProtectedRoute component={UsersPage} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={ProfilePage} />} />
      <Route path="/ai-assistant" component={() => <ProtectedRoute component={AiAssistant} />} />
      <Route path="/meetings/:id" component={() => <ProtectedRoute component={MeetingDetail} />} />
      <Route path="/meetings" component={() => <ProtectedRoute component={Meetings} />} />
      <Route path="/finances" component={() => <ProtectedRoute component={FinancesPage} />} />
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <ThemeInjector />
            <DocumentBranding />
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
