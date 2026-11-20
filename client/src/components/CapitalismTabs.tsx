import { Link } from "wouter";

export function CapitalismTabs({ active }: { active: "timeline" | "insights" | "international" }) {
  return <nav aria-label="자본주의 경제사 보기" className="mb-3 inline-flex shrink-0 self-start items-center rounded-md border border-border bg-card/40 p-0.5 font-sans">
    {([
      { id: "timeline", label: "타임라인", href: "/capitalism" },
      { id: "insights", label: "인사이트", href: "/capitalism/insights" },
      { id: "international", label: "국제 연표", href: "/international-timeline" },
    ] as const).map(tab => <Link key={tab.id} href={tab.href} aria-current={active === tab.id ? "page" : undefined} data-testid={`viewmode-${tab.id}`}
      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${active === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{tab.label}</Link>)}
  </nav>;
}
