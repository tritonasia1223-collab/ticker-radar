import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { EditModeProvider } from "@/components/EditModeProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
const Fed = lazy(() => import("@/pages/Fed"));
// 블록체인 구조 — 작업 일시 중단(paused). 재개 시 아래 줄과 라우트 주석 해제.
// const BlockchainLearn = lazy(() => import("@/pages/BlockchainLearn"));
// CLO 모니터 — 작업 중단(paused). 라우트/페이지 코드는 보존, 재개 시 아래 두 줄 주석 해제.
// const Clo = lazy(() => import("@/pages/Clo"));
const Settings = lazy(() => import("@/pages/Settings"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

// 페이지 렌더 예외를 여기서 가둔다 — 사이드바(Layout)는 살리고 크래시한 페이지만 폴백.
// resetKey=location 이라 다른 탭으로 이동하면 자동 복구.
function BoundedRouter() {
  const [location] = useLocation();
  return (
    <ErrorBoundary resetKey={location}>
      <AppRouter />
    </ErrorBoundary>
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
        <Route path="/fed" component={Fed} />
        {/* <Route path="/learn/blockchain" component={BlockchainLearn} /> */}
        {/* <Route path="/clo" component={Clo} /> */}
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
        <EditModeProvider>
          <TooltipProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <Layout>
                <BoundedRouter />
              </Layout>
            </Router>
          </TooltipProvider>
        </EditModeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
