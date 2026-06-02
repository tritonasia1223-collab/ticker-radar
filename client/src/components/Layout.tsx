import { Link, useLocation } from "wouter";
import { Radar, Users, Landmark, UserSearch, Star, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";

const NAV = [
  { href: "/", label: "종목 발견", icon: Radar },
  { href: "/accounts", label: "추적 계정", icon: Users },
  { href: "/congress", label: "정치인 거래", icon: Landmark },
  { href: "/insider", label: "내부자 거래", icon: UserSearch },
  { href: "/interest", label: "관심종목", icon: Star },
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
  const { theme, toggle } = useTheme();

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
        <div className="p-3 border-t border-sidebar-border">
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
