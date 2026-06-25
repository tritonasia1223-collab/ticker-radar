// 사건 인사이트 패널 — 오른쪽(그래프 자리)에 떠서 과거↔현재 연결 인사이트를 편집/표시.
// 본문은 '블록 스택'(텍스트·표·이미지·그래프를 순서대로 섞어 배치) — BlockStack 컴포넌트가 담당.
import { useState, useRef, useEffect } from "react";
import { X, Star, Plus, Pencil, Check, Trash2 } from "lucide-react";
import { toFracYear } from "@/lib/capitalism-config";
import {
  BlockStack, insightToBlocks, blocksToInsight, blocksHaveContent, metaCardToBlocks, blocksToMetaFields,
} from "@/components/CapBlocks";
import type { FlowDTO, CapInsight, CapMetaCard, CapBlock } from "@/lib/capitalism-types";

// 본문 블록 중 보일 게 하나라도 있나(텍스트는 비어있지 않을 때만, 표/이미지/그래프는 항상).
const hasVisibleBlock = (blocks: CapBlock[]) => blocks.some((b) => (b.type === "text" ? !!b.text.trim() : true));

export function InsightPanel({
  flow, onCommit, onClose, variant = "panel",
}: {
  flow: FlowDTO;
  onCommit: (slug: string, insight: CapInsight) => void;
  onClose: () => void;
  // "panel" = 우측 단일 패널(✕그래프 닫기 버튼 노출).
  // "inline" = 사건 카드 옆 메모형(닫기는 전역 종료라 카드별 버튼 숨김).
  variant?: "panel" | "inline";
}) {
  // 새 인사이트면 빈 텍스트 블록 1개로 시작(바로 입력 가능).
  const seedBlocks = (f: FlowDTO): CapBlock[] => {
    const b = insightToBlocks(f.insight);
    return b.length ? b : [{ type: "text", text: "" }];
  };
  const [blocks, setBlocks] = useState<CapBlock[]>(() => seedBlocks(flow));
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  // 내용이 있으면 읽기 뷰로(가독성), 비어 있으면(새 인사이트) 바로 편집.
  const [editing, setEditing] = useState(!hasVisibleBlock(insightToBlocks(flow.insight)));

  // 다른 카드의 별을 누르면 그 사건 인사이트로 재시드.
  useEffect(() => {
    const b = seedBlocks(flow);
    setBlocks(b); blocksRef.current = b;
    setEditing(!hasVisibleBlock(insightToBlocks(flow.insight)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.slug]);

  // 사건 시점(소수 연도) — 참고 그래프에 점선 마커로 표시.
  const eventFrac = toFracYear(flow.date);

  const persist = (next: CapBlock[]) => onCommit(flow.slug, blocksToInsight(next));
  // doCommit=false → 텍스트 입력 중(로컬), true → 구조 변경/blur(저장).
  const handleChange = (next: CapBlock[], doCommit: boolean) => {
    setBlocks(next); blocksRef.current = next;
    if (doCommit) persist(next);
  };
  const finishEditing = () => { persist(blocksRef.current); setEditing(false); };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3">
      <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2">
        <div className="min-w-0">
          <div className="text-[11px] tabular-nums text-muted-foreground">
            {flow.endDate ? `${flow.date} ~ ${flow.endDate}` : flow.date}
          </div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Star className="h-3.5 w-3.5 shrink-0 text-red-500" fill="currentColor" />
            <span className="truncate">{flow.title}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {editing ? (
            <button
              type="button"
              onClick={finishEditing}
              className="flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
              title="작성 완료 — 읽기 화면으로"
              data-testid="insight-done"
            >
              <Check className="h-3.5 w-3.5" /> 완료
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              title="인사이트 편집"
              data-testid="insight-edit"
            >
              <Pencil className="h-3 w-3" /> 편집
            </button>
          )}
          {variant !== "inline" ? (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              title="그래프로 돌아가기"
              data-testid="insight-close"
            >
              <X className="h-3.5 w-3.5" /> 그래프
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <>
          <div className="text-[11px] text-muted-foreground/70">
            이 사건과 <b className="text-foreground/80">지금</b>을 어떻게 연결할 수 있을까? — 과거↔현재 인사이트
          </div>
          <BlockStack
            blocks={blocks} editing allow={{ text: true, table: true, image: true, chart: true }}
            eventFrac={eventFrac} onChange={handleChange}
          />
        </>
      ) : hasVisibleBlock(blocks) ? (
        <BlockStack blocks={blocks} editing={false} allow={{}} eventFrac={eventFrac} onChange={() => {}} />
      ) : (
        <div className="py-2 text-[12px] italic text-muted-foreground/60">
          아직 인사이트가 비어 있습니다. ‘편집’을 눌러 작성하세요.
        </div>
      )}
    </div>
  );
}

const newMetaCard = (): CapMetaCard =>
  ({ id: `meta-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, title: "", text: "", tables: [], images: [], blocks: [] });

// 메타 인사이트 카드 1장 — 소제목 + 블록 스택(텍스트·표·이미지). 읽기/편집 토글.
function MetaCard({ card, onChange, onDelete, onJump }: {
  card: CapMetaCard;
  onChange: (next: CapMetaCard) => void;
  onDelete: () => void;
  onJump?: (slug: string) => void;
}) {
  const seedBlocks = (c: CapMetaCard): CapBlock[] => {
    const b = metaCardToBlocks(c);
    return b.length ? b : [{ type: "text", text: "" }];
  };
  const [title, setTitle] = useState(card.title ?? "");
  const titleRef = useRef(title); titleRef.current = title;
  const [blocks, setBlocks] = useState<CapBlock[]>(() => seedBlocks(card));
  const blocksRef = useRef(blocks); blocksRef.current = blocks;
  const hasContent = !!(card.title ?? "").trim() || hasVisibleBlock(metaCardToBlocks(card));
  const [editing, setEditing] = useState(!hasContent);

  const commit = (nextBlocks: CapBlock[] = blocksRef.current, nextTitle: string = titleRef.current) =>
    onChange({ ...card, title: nextTitle, ...blocksToMetaFields(nextBlocks) });
  const handleChange = (next: CapBlock[], doCommit: boolean) => {
    setBlocks(next); blocksRef.current = next;
    if (doCommit) commit(next);
  };
  const finishEditing = () => { commit(); setEditing(false); };

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/[0.06] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        {editing ? (
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => commit()}
            placeholder="소제목 (선택)"
            className="min-w-0 flex-1 rounded border-0 bg-transparent text-sm font-bold text-primary outline-none placeholder:font-medium placeholder:text-primary/40 focus:bg-background/40"
            data-testid="meta-title"
          />
        ) : card.title?.trim() ? (
          <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{card.title}</h3>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {editing ? (
            <button type="button" onClick={finishEditing}
              className="flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
              data-testid="meta-done"><Check className="h-3.5 w-3.5" /> 완료</button>
          ) : (
            <button type="button" onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              data-testid="meta-edit"><Pencil className="h-3 w-3" /> 편집</button>
          )}
          <button type="button" onClick={onDelete} title="카드 삭제"
            className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground/70 transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
            data-testid="meta-delete"><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>

      {editing ? (
        <BlockStack
          blocks={blocks} editing allow={{ text: true, table: true, image: true }}
          onChange={handleChange} onJump={onJump}
        />
      ) : hasVisibleBlock(blocks) ? (
        <BlockStack blocks={blocks} editing={false} allow={{}} onChange={() => {}} onJump={onJump} />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="text-[12px] text-muted-foreground/70 hover:text-primary">+ 메타 인사이트 작성</button>
      )}
    </section>
  );
}

// 메타 인사이트 카드 묶음 — 모아보기 최상단. 카드 추가/삭제/편집.
function MetaCards({ cards, onSave, onJump }: {
  cards: CapMetaCard[];
  onSave: (next: CapMetaCard[]) => void;
  onJump?: (slug: string) => void;
}) {
  const updateAt = (i: number, next: CapMetaCard) => onSave(cards.map((c, j) => (j === i ? next : c)));
  const removeAt = (i: number) => onSave(cards.filter((_, j) => j !== i));
  const addCard = () => onSave([...cards, newMetaCard()]);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-primary">전체 관통 — 메타 인사이트</h2>
      {cards.map((c, i) => (
        <MetaCard key={c.id} card={c} onChange={(n) => updateAt(i, n)} onDelete={() => removeAt(i)} onJump={onJump} />
      ))}
      <button type="button" onClick={addCard}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 py-2.5 text-[12px] font-medium text-primary/80 transition-colors hover:border-primary/70 hover:bg-primary/[0.04] hover:text-primary"
        data-testid="meta-add-card">
        <Plus className="h-4 w-4" /> 메타 인사이트 카드 추가
      </button>
    </div>
  );
}

// 인사이트 있는 사건인가(텍스트/그래프/표/블록 중 하나라도).
const hasInsightContent = (i?: CapInsight | null) =>
  !!i && (i.text.trim() !== "" || i.charts.length > 0 || (i.tables?.length ?? 0) > 0 || (i.blocks?.length ?? 0) > 0);

// 인사이트 모아보기 — 인사이트가 있는 사건을 시간순으로 한 편의 글처럼 읽는 뷰 + 메타 테제.
export function InsightsCollection({
  flows, metaCards, onSaveMetaCards, onOpenInsight, onJump,
}: {
  flows: FlowDTO[];
  metaCards: CapMetaCard[];
  onSaveMetaCards: (next: CapMetaCard[]) => void;
  onOpenInsight: (slug: string) => void;
  onJump?: (slug: string) => void;
}) {
  const items = flows
    .filter((f) => hasInsightContent(f.insight))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 py-2">
      <MetaCards cards={metaCards} onSave={onSaveMetaCards} onJump={onJump} />

      {items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          아직 사건 인사이트가 없습니다. 타임라인에서 사건 카드의 <Star className="inline h-3.5 w-3.5 text-red-500" fill="currentColor" /> 별을 눌러 적어보세요.
        </div>
      ) : items.map((f) => (
        <article key={f.slug} className="border-b border-border/40 pb-6 last:border-0">
          <header className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] tabular-nums text-muted-foreground">
                {f.endDate ? `${f.date} ~ ${f.endDate}` : f.date}
              </div>
              <h3 className="flex items-center gap-1.5 text-base font-bold">
                <Star className="h-4 w-4 shrink-0 text-red-500" fill="currentColor" />
                {f.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onOpenInsight(f.slug)}
              className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              title="타임라인에서 편집"
              data-testid={`insight-edit-${f.slug}`}
            >
              <Pencil className="h-3 w-3" /> 편집
            </button>
          </header>
          <BlockStack
            blocks={insightToBlocks(f.insight)} editing={false} allow={{}}
            eventFrac={toFracYear(f.date)} onChange={() => {}} onJump={onJump}
          />
        </article>
      ))}
    </div>
  );
}
