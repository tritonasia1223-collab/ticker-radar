// 사건 인사이트 패널 — 오른쪽(그래프 자리)에 떠서 과거↔현재 연결 인사이트를 편집/표시.
// 본문은 '블록 스택'(텍스트·표·이미지·그래프를 순서대로 섞어 배치) — BlockStack 컴포넌트가 담당.
import { useState, useRef, useEffect } from "react";
import { X, Star, Plus, Pencil, Check, Trash2 } from "lucide-react";
import { toFracYear } from "@/lib/capitalism-config";
import {
  BlockStack, insightToBlocks, blocksToInsight, blocksHaveContent, metaCardToBlocks, blocksToMetaFields,
} from "@/components/CapBlocks";
import type { FlowDTO, CapInsight, CapMetaCard, CapBlock } from "@/lib/capitalism-types";
import { useCapEditScope } from "@/lib/use-cap-edit-scope";
import { collaboration } from "@/lib/cap-collab-client";
import { acceptRemote, changeDraft, isSaveShortcut, seedDraft, shouldSaveOnLeave, takeDraftForSave, type DraftState } from "@/lib/capitalism-insight-draft";

// 편집 중에는 페이지·서버로 아무것도 보내지 않는다(키 입력마다 캐시 갱신·협업 저장이 타이핑을 버벅이게 했다).
// 저장은 "저장" 버튼·Ctrl+S, 그리고 이탈(패널 닫기·다른 카드로 전환·언마운트·페이지 숨김)에서 dirty 일 때만 한 번.
// 이탈 저장은 협업 저장기를 즉시 흘려보내 페이지를 떠나도 남게 한다.
function useLeaveSave(draftRef: { current: DraftState<unknown> }, save: () => void, key: string) {
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden" && shouldSaveOnLeave(draftRef.current)) { saveRef.current(); void collaboration.flushAll(); } };
    const onUnload = () => { if (shouldSaveOnLeave(draftRef.current)) { saveRef.current(); void collaboration.flushAll(); } };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      if (shouldSaveOnLeave(draftRef.current)) saveRef.current(); // 언마운트·대상 전환(key 변경) 시
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// 본문 블록 중 보일 게 하나라도 있나(텍스트는 비어있지 않을 때만, 표/이미지/그래프는 항상).
const hasVisibleBlock = (blocks: CapBlock[]) => blocks.some((b) => (b.type === "text" ? !!b.text.trim() : true));

export function InsightPanel({
  flow, onCommit, onClose, variant = "panel", editable = true,
}: {
  flow: FlowDTO;
  onCommit: (slug: string, insight: CapInsight) => void;
  onClose: () => void;
  // "panel" = 우측 단일 패널(✕그래프 닫기 버튼 노출).
  // "inline" = 사건 카드 옆 메모형(닫기는 전역 종료라 카드별 버튼 숨김).
  variant?: "panel" | "inline";
  editable?: boolean; // false(보기 모드)면 편집 버튼·에디터 숨김(읽기 전용)
}) {
  // 새 인사이트면 빈 텍스트 블록 1개로 시작(바로 입력 가능).
  const seedBlocks = (f: FlowDTO): CapBlock[] => {
    const b = insightToBlocks(f.insight);
    return b.length ? b : [{ type: "text", text: "" }];
  };
  const [draft, setDraft] = useState<DraftState<CapBlock[]>>(() => seedDraft(seedBlocks(flow)));
  const draftRef = useRef(draft); draftRef.current = draft;
  const blocks = draft.value;
  // 편집기 안에 포커스가 있는 동안 협업 엔진이 이 카드의 원격 변경 반영을 미룬다(노드 칸과 같은 규칙).
  const editScope = useCapEditScope(`flow:${flow.slug}`);
  // 내용이 있으면 읽기 뷰로(가독성), 비어 있으면(새 인사이트) 바로 편집. 보기 모드면 항상 읽기.
  const [editing, setEditing] = useState(editable && !hasVisibleBlock(insightToBlocks(flow.insight)));
  const showEditor = editing && editable;

  // 다른 카드의 별을 누르면 그 사건 인사이트로 재시드.
  useEffect(() => {
    setDraft(seedDraft(seedBlocks(flow)));
    setEditing(editable && !hasVisibleBlock(insightToBlocks(flow.insight)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.slug, editable]);
  // 서버본(폴링·저장 응답)이 바뀌면 재시드 — 단, 저장 안 된 변경이 있는 동안은 타이핑을 지키려고 무시한다.
  useEffect(() => { setDraft((d) => acceptRemote(d, seedBlocks(flow))); }, [flow.insight]);

  // 사건 시점(소수 연도) — 참고 그래프에 점선 마커로 표시.
  const eventFrac = toFracYear(flow.date);

  // 타이핑·블록 구조 변경은 로컬 초안만 바꾼다(doCommit 무시). 저장은 아래 save 에서만.
  const handleChange = (next: CapBlock[], _doCommit: boolean) => setDraft((d) => changeDraft(d, next));
  // dirty 일 때만 그 시점의 블록을 한 번 부모 저장기(onCommit → 캐시 갱신 + 협업 저장)로 보낸다.
  const save = () => {
    const { next, toSave } = takeDraftForSave(draftRef.current);
    if (toSave) onCommit(flow.slug, blocksToInsight(toSave));
    draftRef.current = next; setDraft(next);
    return toSave !== null;
  };
  const finishEditing = () => { save(); setEditing(false); };
  const closePanel = () => { save(); onClose(); };
  const onKeyDownCapture = (e: React.KeyboardEvent) => { if (showEditor && isSaveShortcut(e)) { e.preventDefault(); save(); } };
  useLeaveSave(draftRef, save, flow.slug);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3" {...editScope} onKeyDownCapture={onKeyDownCapture}>
      <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2">
        <div className="min-w-0">
          <div className="text-[11px] tabular-nums text-muted-foreground">
            {flow.endDate ? `${flow.date} ~ ${flow.endDate}` : flow.date}
            {draft.dirty ? <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600" data-testid="insight-unsaved">저장 안 됨</span> : null}
          </div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Star className="h-3.5 w-3.5 shrink-0 text-red-500" fill="currentColor" />
            <span className="truncate">{flow.title}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {editable ? (showEditor ? (
            <button
              type="button"
              onClick={finishEditing}
              className="flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
              title="저장하고 읽기 화면으로 (편집 중 Ctrl+S: 저장만)"
              data-testid="insight-done"
            >
              <Check className="h-3.5 w-3.5" /> 저장
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
          )) : null}
          {variant !== "inline" ? (
            <button
              type="button"
              onClick={closePanel}
              className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              title="그래프로 돌아가기 (저장 안 된 변경은 저장)"
              data-testid="insight-close"
            >
              <X className="h-3.5 w-3.5" /> 그래프
            </button>
          ) : null}
        </div>
      </div>

      {showEditor ? (
        <>
          <div className="text-[11px] text-muted-foreground/70">
            이 사건과 <b className="text-foreground/80">지금</b>을 어떻게 연결할 수 있을까? — 과거↔현재 인사이트
          </div>
          <BlockStack
            blocks={blocks} editing allow={{ text: true, table: true, image: true, chart: true, html: true, divider: true }}
            eventFrac={eventFrac} onChange={handleChange}
          />
        </>
      ) : hasVisibleBlock(blocks) ? (
        <BlockStack blocks={blocks} editing={false} allow={{}} eventFrac={eventFrac} onChange={() => {}} />
      ) : (
        <div className="py-2 text-[12px] italic text-muted-foreground/60">
          {editable ? "아직 인사이트가 비어 있습니다. ‘편집’을 눌러 작성하세요." : "아직 인사이트가 없습니다."}
        </div>
      )}
    </div>
  );
}

const newMetaCard = (): CapMetaCard =>
  ({ id: `meta-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, title: "", text: "", tables: [], images: [], blocks: [] });

// 메타 인사이트 카드 1장 — 소제목 + 블록 스택(텍스트·표·이미지). 읽기/편집 토글.
function MetaCard({ card, onChange, onDelete, onJump, editable = true }: {
  card: CapMetaCard;
  onChange: (next: CapMetaCard) => void;
  onDelete: () => void;
  onJump?: (slug: string) => void;
  editable?: boolean;
}) {
  const seedBlocks = (c: CapMetaCard): CapBlock[] => {
    const b = metaCardToBlocks(c);
    return b.length ? b : [{ type: "text", text: "" }];
  };
  const [draft, setDraft] = useState<DraftState<{ title: string; blocks: CapBlock[] }>>(() => seedDraft({ title: card.title ?? "", blocks: seedBlocks(card) }));
  const draftRef = useRef(draft); draftRef.current = draft;
  const title = draft.value.title, blocks = draft.value.blocks;
  const editScope = useCapEditScope(`meta:${card.id}`);
  const hasContent = !!(card.title ?? "").trim() || hasVisibleBlock(metaCardToBlocks(card));
  const [editing, setEditing] = useState(editable && !hasContent);
  const showEditor = editing && editable;

  // 서버본이 바뀌면 재시드 — 저장 안 된 변경이 있는 동안은 무시(타이핑 보호).
  useEffect(() => { setDraft((d) => acceptRemote(d, { title: card.title ?? "", blocks: seedBlocks(card) })); }, [card.title, card.blocks, card.text, card.tables, card.images]);
  // 제목·본문 타이핑은 로컬 초안만. 저장은 save 에서만(dirty 일 때 한 번).
  const handleChange = (next: CapBlock[], _doCommit: boolean) => setDraft((d) => changeDraft(d, { ...d.value, blocks: next }));
  const save = () => {
    const { next, toSave } = takeDraftForSave(draftRef.current);
    if (toSave) onChange({ ...card, title: toSave.title, ...blocksToMetaFields(toSave.blocks) });
    draftRef.current = next; setDraft(next);
    return toSave !== null;
  };
  const finishEditing = () => { save(); setEditing(false); };
  const onKeyDownCapture = (e: React.KeyboardEvent) => { if (showEditor && isSaveShortcut(e)) { e.preventDefault(); save(); } };
  useLeaveSave(draftRef, save, card.id);

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/[0.06] p-4" {...editScope} onKeyDownCapture={onKeyDownCapture}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {showEditor ? (
          <input
            type="text" value={title} onChange={(e) => { const v = e.target.value; setDraft((d) => changeDraft(d, { ...d.value, title: v })); }}
            placeholder="소제목 (선택)"
            className="min-w-0 flex-1 rounded border-0 bg-transparent text-sm font-bold text-primary outline-none placeholder:font-medium placeholder:text-primary/40 focus:bg-background/40"
            data-testid="meta-title"
          />
        ) : card.title?.trim() ? (
          <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{card.title}</h3>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {editable ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {draft.dirty ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600" data-testid="meta-unsaved">저장 안 됨</span> : null}
            {showEditor ? (
              <button type="button" onClick={finishEditing} title="저장하고 읽기 화면으로 (편집 중 Ctrl+S: 저장만)"
                className="flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                data-testid="meta-done"><Check className="h-3.5 w-3.5" /> 저장</button>
            ) : (
              <button type="button" onClick={() => setEditing(true)}
                className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                data-testid="meta-edit"><Pencil className="h-3 w-3" /> 편집</button>
            )}
            <button type="button" onClick={onDelete} title="카드 삭제"
              className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground/70 transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
              data-testid="meta-delete"><Trash2 className="h-3 w-3" /></button>
          </div>
        ) : null}
      </div>

      {showEditor ? (
        <BlockStack
          blocks={blocks} editing allow={{ text: true, table: true, image: true, html: true, divider: true }}
          onChange={handleChange} onJump={onJump}
        />
      ) : hasVisibleBlock(blocks) ? (
        <BlockStack blocks={blocks} editing={false} allow={{}} onChange={() => {}} onJump={onJump} />
      ) : editable ? (
        <button type="button" onClick={() => setEditing(true)} className="text-[12px] text-muted-foreground/70 hover:text-primary">+ 메타 인사이트 작성</button>
      ) : null}
    </section>
  );
}

// 메타 인사이트 카드 묶음 — 모아보기 최상단. 카드 추가/삭제/편집.
function MetaCards({ cards, onSave, onJump, editable = true }: {
  cards: CapMetaCard[];
  onSave: (next: CapMetaCard[]) => void;
  onJump?: (slug: string) => void;
  editable?: boolean;
}) {
  const updateAt = (i: number, next: CapMetaCard) => onSave(cards.map((c, j) => (j === i ? next : c)));
  const removeAt = (i: number) => onSave(cards.filter((_, j) => j !== i));
  const addCard = () => onSave([...cards, newMetaCard()]);
  if (!editable && cards.length === 0) return null; // 보기 모드 + 내용 없음 → 섹션 숨김
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-primary">전체 관통 — 메타 인사이트</h2>
      {cards.map((c, i) => (
        <MetaCard key={c.id} card={c} onChange={(n) => updateAt(i, n)} onDelete={() => removeAt(i)} onJump={onJump} editable={editable} />
      ))}
      {editable ? (
        <button type="button" onClick={addCard}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 py-2.5 text-[12px] font-medium text-primary/80 transition-colors hover:border-primary/70 hover:bg-primary/[0.04] hover:text-primary"
          data-testid="meta-add-card">
          <Plus className="h-4 w-4" /> 메타 인사이트 카드 추가
        </button>
      ) : null}
    </div>
  );
}

// 인사이트 있는 사건인가(텍스트/그래프/표/블록 중 하나라도).
const hasInsightContent = (i?: CapInsight | null) =>
  !!i && (i.text.trim() !== "" || i.charts.length > 0 || (i.tables?.length ?? 0) > 0 || (i.blocks?.length ?? 0) > 0);

// 인사이트 모아보기 — 인사이트가 있는 사건을 시간순으로 한 편의 글처럼 읽는 뷰 + 메타 테제.
export function InsightsCollection({
  flows, metaCards, onSaveMetaCards, onOpenInsight, onJump, editable = true,
}: {
  flows: FlowDTO[];
  metaCards: CapMetaCard[];
  onSaveMetaCards: (next: CapMetaCard[]) => void;
  onOpenInsight: (slug: string) => void;
  onJump?: (slug: string) => void;
  editable?: boolean;
}) {
  const items = flows
    .filter((f) => hasInsightContent(f.insight))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 py-2">
      <MetaCards cards={metaCards} onSave={onSaveMetaCards} onJump={onJump} editable={editable} />

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
            {editable ? (
              <button
                type="button"
                onClick={() => onOpenInsight(f.slug)}
                className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                title="타임라인에서 편집"
                data-testid={`insight-edit-${f.slug}`}
              >
                <Pencil className="h-3 w-3" /> 편집
              </button>
            ) : null}
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
