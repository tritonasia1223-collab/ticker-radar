import { Link, useLocation } from "wouter";
import { Radar, Users, MessageSquareText, Landmark, Settings as SettingsIcon, RefreshCw, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/ThemeProvider";

const NAV = [
  { href: "/", label: "종목 발견", icon: Radar },
  { href: "/accounts", label: "추적 계정", icon: Users },
  { href: "/feed", label: "트윗 피드", icon: MessageSquareText },
  { href: "/congress", label: "정치인 거래", icon: Landmark },
  { href: "/settings", label: "설정", icon: SettingsIcon },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-label="Ticker Radar logo">
        <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
        <circle cx="16" cy="16" r="7" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
        <circle cx="16" cy="16" r="2.5" fill="hsl(var(--primary))" />
        <path d="M16 16 L26 6" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="9" r="2" fill="hsl(var(--primary))" />
      </svg>
      <div className="leading-tight">
        <div className="font-semibold text-sm">Ticker Radar</div>
        <div className="text-[11px] text-muted-foreground">SNS 종목 발견</div>
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { toast } = useToast();
  const { theme, toggle } = useTheme();

  const collect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/collect")).json(),
    onSuccess: (r: any) => {
      if (r.ok) {
        toast({ title: "수집 완료", description: `새 트윗 ${r.tweetsNew}건 · 새 언급 ${r.mentionsNew}건` });
      } else {
        toast({ title: "수집 실패", description: r.error ?? "알 수 없는 오류", variant: "destructive" });
      }
      queryClient.invalidateQueries();
    },
    onError: (e: any) => toast({ title: "수집 실패", description: String(e?.message || e), variant: "destructive" }),
  });

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="h-16 flex items-center border-b border-sidebar-border">
          <Logo />
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => {
            const active = location === n.href;
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} data-testid={`link-${n.href.replace("/", "") || "discover"}`}>
                <div className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm cursor-pointer hover-elevate ${active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/80"}`}>
                  <Icon className="h-4 w-4" />
                  {n.label}
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <Button onClick={() => collect.mutate()} disabled={collect.isPending} className="w-full" data-testid="button-collect">
            <RefreshCw className={`h-4 w-4 mr-2 ${collect.isPending ? "animate-spin" : ""}`} />
            {collect.isPending ? "수집 중…" : "지금 수집"}
          </Button>
          <Button variant="outline" onClick={toggle} className="w-full" data-testid="button-theme">
            {theme === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
            {theme === "dark" ? "라이트" : "다크"}
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
