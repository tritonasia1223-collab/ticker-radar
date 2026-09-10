import { Link, useLocation } from "wouter";
import { Radar, Users, Landmark, UserSearch, Star, Moon, Sun, History, Layers, Building2, Blocks, Presentation, Pencil, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";
import { useEditMode } from "@/components/EditModeProvider";
import GlobalTooltip from "@/components/GlobalTooltip";

// 네비 = 클릭 안 되는 단순 구분 라벨(그룹)로만 묶음. 계층 라우팅 아님 — 라벨은 표시 전용.
const NAV_GROUPS: { group: string; items: { href: string; label: string; icon: typeof Radar }[] }[] = [
  { group: "매크로", items: [
    { href: "/capitalism", label: "자본주의 경제사", icon: History },
    { href: "/fed", label: "미국 유동성", icon: Building2 },
    { href: "/world", label: "세계 현황판", icon: Globe },
  ] },
  { group: "종목 트래킹", items: [
    { href: "/", label: "종목 발견", icon: Radar },
    { href: "/accounts", label: "추적 계정", icon: Users },
    { href: "/congress", label: "정치인 거래", icon: Landmark },
    { href: "/insider", label: "내부자 거래", icon: UserSearch },
  ] },
  // 일시 중단(paused) — nav 숨김, 라우트·페이지·엔진은 그대로. 재개 시 위 그룹에 복원.
  //   블록체인 구조 { href: "/learn/blockchain", icon: Blocks } · CLO 모니터 { href: "/clo", icon: Layers } · 관심종목 { href: "/interest", icon: Star }
];

// 금고 문 다이얼 — 사각 문판 + 원형 다이얼 + 스포크 4개. 단일 스트로크(currentColor)라 다크 모드 자동 대응.
function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-label="피스쿠스 FISCUS logo">
        <rect x="4.5" y="4.5" width="23" height="23" rx="6.5" />
        <circle cx="16" cy="16" r="7.5" />
        <path d="M16 8.5V12.4M16 19.6V23.5M8.5 16H12.4M19.6 16H23.5" />
        <circle cx="16" cy="16" r="1.7" fill="currentColor" stroke="none" />
      </svg>
      <div className="leading-tight">
        <div className="text-sm font-semibold">피스쿠스 <span className="text-[11px] font-normal text-muted-foreground">FISCUS</span></div>
        <div className="text-[11px] text-muted-foreground">매크로 리서치 · 종목 트래킹</div>
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const { present, toggle: toggleMode } = useEditMode();

  // 발표 모드: 네비 숨김 + 본문 확대(zoom) + 나가는 플로팅 버튼(네비가 없으니 여기서 나감).
  if (present) {
    return (
      <div className="relative h-screen overflow-hidden bg-background text-foreground">
        <main className="h-full overflow-auto" style={{ zoom: 1.2 }}>{children}</main>
        <button
          type="button"
          onClick={toggleMode}
          className="fixed right-4 top-4 z-50 flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-[12px] font-medium text-muted-foreground shadow-md backdrop-blur transition-colors hover:border-primary/60 hover:text-foreground"
          data-testid="button-exit-present"
          title="발표 모드 종료 → 편집 모드"
        >
          <Pencil className="h-3.5 w-3.5" /> 편집 모드
        </button>
        <GlobalTooltip />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="h-16 flex items-center border-b border-sidebar-border">
          <Logo />
        </div>
        <nav className="flex-1 overflow-auto p-3 space-y-0.5">
          {NAV_GROUPS.map((g) => (
            <div key={g.group} className="pt-3 first:pt-0">
              <div className="select-none px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-sidebar-foreground/45">{g.group}</div>
              {g.items.map((n) => {
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
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <Button
            variant="outline"
            onClick={toggleMode}
            className="w-full"
            data-testid="button-present-mode"
            title="발표 모드 — 네비를 숨기고 본문을 크게 (읽기 전용)"
          >
            <Presentation className="h-4 w-4 mr-2" /> 발표 모드
          </Button>
          <Button variant="outline" onClick={toggle} className="w-full" data-testid="button-theme">
            {theme === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
            {theme === "dark" ? "라이트" : "다크"}
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
      <GlobalTooltip />
    </div>
  );
}
