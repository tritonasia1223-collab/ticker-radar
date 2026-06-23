import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import Layout from "@/components/Layout";

// 라우트별 코드 스플릿 — 페이지를 처음 열 때만 해당 청크를 받아온다.
// 특히 /capitalism 은 357KB 시계열 JSON + framer-motion + 리치에디터를 끌고 와서,
// 분리하면 초기 번들에서 그만큼이 빠진다(다른 페이지 첫 로딩이 가벼워짐).
const Discover = lazy(() => import("@/pages/Discover"));
const Accounts = lazy(() => import("@/pages/Accounts"));
const Feed = lazy(() => import("@/pages/Feed"));
const Congress = lazy(() => import("@/pages/Congress"));
const Insider = lazy(() => import("@/pages/Insider"));
const Interest = lazy(() => import("@/pages/Interest"));
const Capitalism = lazy(() => import("@/pages/Capitalism"));
const Settings = lazy(() => import("@/pages/Settings"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

function AppRouter() {
  return (
    <Suspense fallback={<PageFallback />}>
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
    </Suspense>
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
