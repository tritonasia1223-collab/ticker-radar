import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import Layout from "@/components/Layout";
import Discover from "@/pages/Discover";
import Accounts from "@/pages/Accounts";
import Feed from "@/pages/Feed";
import Congress from "@/pages/Congress";
import Insider from "@/pages/Insider";
import Interest from "@/pages/Interest";
import Capitalism from "@/pages/Capitalism";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Discover} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/feed" component={Feed} />
      <Route path="/congress" component={Congress} />
      <Route path="/insider" component={Insider} />
      <Route path="/interest" component={Interest} />
      <Route path="/capitalism" component={Capitalism} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <Layout>
              <AppRouter />
            </Layout>
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
