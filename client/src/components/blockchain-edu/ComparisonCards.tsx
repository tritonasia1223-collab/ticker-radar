// 블록체인 학습 탭 — 다항목 비교 카드 그리드(§5). Ch1 L2 스펙트럼, Ch8 권리 스펙트럼에서 재사용.
//   로고 없이 색상+이니셜 칩으로 구분(레이어 색상 규칙과 별개의 카드별 액센트).
export interface CompareRow { label: string; value: string; on?: boolean } // on: 권리 스위치 켜짐 여부(Ch8)
export interface CompareCard { name: string; initial: string; accent: string; rows: CompareRow[]; note?: string }

export default function ComparisonCards({ cards, rightsMode }: { cards: CompareCard[]; rightsMode?: boolean }) {
  return (
    <div className="grid w-full gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <div key={c.name} className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-bold text-white" style={{ background: c.accent }}>{c.initial}</span>
            <span className="text-[13px] font-bold leading-tight">{c.name}</span>
          </div>
          <dl className="space-y-1">
            {c.rows.map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-2 text-[11.5px]">
                <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
                <dd className={`text-right font-medium ${rightsMode ? (r.on ? "text-emerald-600" : "text-red-500 line-through decoration-red-400/60") : "text-foreground"}`}>
                  {rightsMode && (r.on ? "✓ " : "✗ ")}{r.value}
                </dd>
              </div>
            ))}
          </dl>
          {c.note && <p className="mt-2 border-t border-border pt-1.5 text-[10.5px] text-muted-foreground">{c.note}</p>}
        </div>
      ))}
    </div>
  );
}
