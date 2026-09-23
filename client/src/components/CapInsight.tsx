// 사건 인사이트 패널 — 오른쪽(그래프 자리)에 떠서 과거↔현재 연결 인사이트를 편집/표시.
// 본문은 '블록 스택'(텍스트·표·이미지·그래프를 순서대로 섞어 배치) — BlockStack 컴포넌트가 담당.
import { useState, useRef, useEffect, type MutableRefObject, type RefObject } from "react";
import { X, Star, Plus, Pencil, Check, Trash2 } from "lucide-react";
import { toFracYear } from "@/lib/capitalism-config";
import {
  BlockStack, insightToBlocks, blocksToInsight, blocksHaveContent, metaCardToBlocks, blocksToMetaFields,
} from "@/components/CapBlocks";
import type { FlowDTO, CapInsight, CapMetaCard, CapBlock } from "@/lib/capitalism-types";
import { collaboration, collabApi, focusResource } from "@/lib/cap-collab-client";
import { acceptRemote, changeDraft, discardDraft, isNewerVersion, isSaveShortcut, markDraftDirty, removeCardById, seedDraft, shouldSaveOnLeave, takeDraftForSave, upsertCardById, type DraftState } from "@/lib/capitalism-insight-draft";

// 초안 저장기 — 편집 중에는 페이지·서버로 아무것도 보내지 않는다(키 입력마다 캐시 갱신·협업 저장이 타이핑을 버벅이게 했다).
//   · change/markDirty: 로컬 초안만 바꾸고, dirty 가 되는 순간 협업 엔진의 '로컬 편집 잠금'(beginLocalEdit)을 잡아 저장할 때까지
//     이 자원의 비교 기준을 고정한다 — 그래야 저장 시 내가 바꾼 필드만 diff 로 나가고 다른 창의 변경은 병합·충돌로 처리된다.
//   · save: 자식 편집기(리치텍스트·표 셀)의 진행 중 입력을 blur 로 확정한 뒤 dirty 일 때만 한 번 commit 하고 잠금을 푼다.
//     flush 옵션이면 협업 저장기를 즉시 흘려보낸다(이탈·명시 저장).
//   · 이탈(언마운트·대상 전환)은 layout cleanup 에서 처리한다 — DOM 제거 전이라 자식 blur 확정이 가능하다.
//   · discard: 명시적 삭제처럼 저장하면 안 되는 이탈.
function useDraftSaver<T>(key: string, draftRef: MutableRefObject<DraftState<T>>, setDraft: (d: DraftState<T>) => void, commit: (value: T) => void, rootRef: RefObject<HTMLElement>) {
  const lockRef = useRef<(() => void) | null>(null);
  const commitRef = useRef(commit); commitRef.current = commit;
  // 잠금은 '저장 안 된 변경이 있는 동안'만 잡는다. 포커스만으로는 잡지 않는다 — 포커스 잠금은 저장 응답 처리(waitForLocalEdit)까지 막아
  // 포커스를 유지한 연속 저장이 두 번째부터 전송되지 않게 했다. 편집 중 표시(누가 어디를 보는지)는 focusResource 로만 알린다.
  const acquire = () => { if (!lockRef.current) lockRef.current = collaboration.beginLocalEdit(key); };
  // 잠금 중 건너뛴 다른 창의 변경(특히 메타 카드는 전역 버전만 갱신돼 폴링이 다시 안 읽는다)은 '저장 없이 clean 으로 돌아온' 해제에서만 다시 읽는다.
  // 저장한 해제는 저장 응답이 최신 확정값을 주므로 읽지 않는다(늦게 온 옛 조회가 방금 저장한 값을 되돌리는 경쟁 방지).
  // 읽은 결과도 이미 확정된 버전보다 새로울 때만 적용한다.
  const release = (refetch: boolean) => {
    const r = lockRef.current; lockRef.current = null; if (!r) return; r();
    if (!refetch) return;
    void collabApi(`resource?key=${encodeURIComponent(key)}`)
      .then((res) => { if (isNewerVersion(collaboration.confirmed.get(key)?.version, res?.version)) return collaboration.receive(res); })
      .catch(() => {});
  };
  const flushChildren = () => { const a = document.activeElement; if (a instanceof HTMLElement && rootRef.current?.contains(a)) a.blur(); };
  const change = (value: T) => { const n = changeDraft(draftRef.current, value); draftRef.current = n; setDraft(n); if (n.dirty) acquire(); else release(true); }; // clean(원문 복귀·변경 없는 blur)이면 잠금을 남기지 않고 건너뛴 원격 변경을 읽는다
  // 표 셀처럼 blur 때만 값이 올라오는 자식 편집기의 입력: 이벤트 캡처 단계에서 state 를 바꾸면 제어 입력의 첫 글자가 되돌아가므로
  // ref 만 dirty 로 두고 '저장 안 됨' 표시는 이벤트가 끝난 뒤(setTimeout 0) 갱신한다.
  const markDirty = () => { const n = markDraftDirty(draftRef.current); acquire(); if (n === draftRef.current) return; draftRef.current = n; setTimeout(() => setDraft(draftRef.current), 0); };
  const save = (opts: { flush?: boolean; noBlur?: boolean } = {}) => {
    if (!opts.noBlur) flushChildren();
    const { next, toSave } = takeDraftForSave(draftRef.current);
    if (toSave !== null) commitRef.current(toSave);
    draftRef.current = next; setDraft(next);
    release(toSave === null); // 저장했으면 응답이 최신값 — 재조회 없음. 값이 같아 저장이 없었으면 건너뛴 원격 변경을 읽는다
    if (toSave !== null && opts.flush) void collaboration.flushAll();
    return toSave !== null;
  };
  const discard = () => { const n = discardDraft(draftRef.current); draftRef.current = n; setDraft(n); release(true); };
  const saveRef = useRef(save); saveRef.current = save;
  // 언마운트·대상 전환: passive cleanup 은 자식(표 셀 등)의 layout cleanup 이 최신 값을 올린 '뒤'에 돌므로 그 값까지 담아 한 번 저장하고 잠금을 푼다.
  // (layout cleanup 에서 저장하면 자식의 뒤늦은 값 전달이 잠금을 다시 잡아 새고, 표의 마지막 입력이 빠진다. DOM 은 이미 제거돼 blur 확정은 없다.)
  useEffect(() => () => { if (shouldSaveOnLeave(draftRef.current)) saveRef.current({ flush: true, noBlur: true }); else release(false); }, [key]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden" && shouldSaveOnLeave(draftRef.current)) saveRef.current({ flush: true }); };
    // 페이지의 beforeunload 리스너는 엔진 초안이 아직 없고 포커스도 밖이면 확인을 띄우지 않으므로, 여기서 저장(기기 초안 기록)과 함께 직접 확인을 요청한다.
    const onUnload = (e: BeforeUnloadEvent) => { if (!shouldSaveOnLeave(draftRef.current)) return; saveRef.current({ flush: true }); e.preventDefault(); e.returnValue = ""; };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("beforeunload", onUnload); };
  }, [key]);
  return { change, markDirty, save, discard, flushChildren };
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
  const rootRef = useRef<HTMLDivElement>(null);
  const onFocusCapture = () => focusResource(`flow:${flow.slug}`); // 다른 창에 '편집 중' 표시만(엔진 잠금은 dirty 동안 저장기가 잡는다)
  // 내용이 있으면 읽기 뷰로(가독성), 비어 있으면(새 인사이트) 바로 편집. 보기 모드면 항상 읽기.
  const [editing, setEditing] = useState(editable && !hasVisibleBlock(insightToBlocks(flow.insight)));
  const showEditor = editing && editable;

  // 다른 카드의 별을 누르면 그 사건 인사이트로 재시드(이전 카드의 저장 안 된 초안은 저장기 cleanup 이 먼저 저장한다).
  useEffect(() => {
    const next = seedDraft(seedBlocks(flow)); draftRef.current = next; setDraft(next);
    setEditing(editable && !hasVisibleBlock(insightToBlocks(flow.insight)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.slug]);
  // 편집 가능 여부가 꺼지면(보기 모드·다른 카드의 충돌 처리 등) 초안을 버리지 않고 저장한 뒤 읽기 화면으로.
  useEffect(() => { if (!editable) { if (shouldSaveOnLeave(draftRef.current)) saver.save({ flush: true }); setEditing(false); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);
  // 서버본(폴링·저장 응답)이 바뀌면 재시드 — 단, 저장 안 된 변경이 있는 동안은 타이핑을 지키려고 무시한다.
  useEffect(() => {
    if (draftRef.current.dirty) return; // 타이핑 보호 — acceptRemote 가 무시한다
    // 포커스 중인 표 셀·리치텍스트는 props 가 바뀌어도 화면을 갱신하지 않으므로, 먼저 blur 로 (변경 없는) 확정을 시킨 뒤 외부본으로 재시드한다.
    // 그러지 않으면 뒤늦은 blur 가 옛 화면값을 새 변경으로 등록해 다른 창의 저장을 덮어쓴다.
    saver.flushChildren();
    const next = acceptRemote(draftRef.current, seedBlocks(flow)); if (next !== draftRef.current) { draftRef.current = next; setDraft(next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.insight]);

  // 사건 시점(소수 연도) — 참고 그래프에 점선 마커로 표시.
  const eventFrac = toFracYear(flow.date);

  // 타이핑·블록 구조 변경은 로컬 초안만 바꾼다(doCommit 무시). 저장은 saver.save 에서만(부모 onCommit → 캐시 갱신 + 협업 저장).
  const saver = useDraftSaver<CapBlock[]>(`flow:${flow.slug}`, draftRef, setDraft, (blocks) => onCommit(flow.slug, blocksToInsight(blocks)), rootRef);
  const handleChange = (next: CapBlock[], _doCommit: boolean) => saver.change(next);
  const finishEditing = () => { saver.save({ flush: true }); setEditing(false); };
  const closePanel = () => { saver.save({ flush: true }); onClose(); };
  // Ctrl/Cmd+S: 자식 편집기를 확정(blur)한 뒤 저장하고 포커스를 돌려준다 — 편집은 이어진다.
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (!showEditor || !isSaveShortcut(e)) return;
    e.preventDefault();
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    saver.save({ flush: true });
    // 재포커스는 다음 매크로태스크에: blur 로 풀린 포커스 잠금의 해제(microtask)와 엔진 전송이 먼저 끝나야 한다.
    // 동기로 되돌리면 잠금이 곧바로 다시 잡혀 방금 낸 저장이 전송되지 못한다(연속 Ctrl+S 두 번째 유실).
    if (active) setTimeout(() => active.focus(), 0);
  };
  // 표 셀처럼 blur 때만 올라오는 자식 편집기의 입력도 '저장 안 됨'으로 잡는다.
  const onInputCapture = () => { if (showEditor) saver.markDirty(); };

  return (
    <div ref={rootRef} className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3" onFocusCapture={onFocusCapture} onKeyDownCapture={onKeyDownCapture} onInputCapture={onInputCapture}>
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
  const rootRef = useRef<HTMLElement>(null);
  const onFocusCapture = () => focusResource(`meta:${card.id}`);
  const hasContent = !!(card.title ?? "").trim() || hasVisibleBlock(metaCardToBlocks(card));
  const [editing, setEditing] = useState(editable && !hasContent);
  const showEditor = editing && editable;

  const cardRef = useRef(card); cardRef.current = card;
  // 서버본이 바뀌면 재시드 — 저장 안 된 변경이 있는 동안은 무시(타이핑 보호).
  useEffect(() => {
    if (draftRef.current.dirty) return;
    saver.flushChildren(); // 인사이트 패널과 같은 이유(포커스 중인 표 셀·제목·리치텍스트의 옛 값이 blur 에서 새 변경이 되지 않게)
    const next = acceptRemote(draftRef.current, { title: card.title ?? "", blocks: seedBlocks(card) }); if (next !== draftRef.current) { draftRef.current = next; setDraft(next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.title, card.blocks, card.text, card.tables, card.images]);
  // 제목·본문 타이핑은 로컬 초안만. 저장은 saver.save 에서만(dirty 일 때 한 번, 최신 card 위에 내 제목·본문만 얹어서).
  const saver = useDraftSaver<{ title: string; blocks: CapBlock[] }>(`meta:${card.id}`, draftRef, setDraft,
    (v) => onChange({ ...cardRef.current, title: v.title, ...blocksToMetaFields(v.blocks) }), rootRef);
  const handleChange = (next: CapBlock[], _doCommit: boolean) => saver.change({ ...draftRef.current.value, blocks: next });
  const finishEditing = () => { saver.save({ flush: true }); setEditing(false); };
  const removeCard = () => { saver.discard(); onDelete(); }; // 명시적 삭제 — 언마운트 저장이 삭제를 되살리지 않게
  useEffect(() => { if (!editable) { if (shouldSaveOnLeave(draftRef.current)) saver.save({ flush: true }); setEditing(false); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (!showEditor || !isSaveShortcut(e)) return;
    e.preventDefault();
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    saver.save({ flush: true });
    if (active) setTimeout(() => active.focus(), 0); // 인사이트 패널과 같은 이유로 매크로태스크 재포커스
  };
  const onInputCapture = () => { if (showEditor) saver.markDirty(); };

  return (
    <section ref={rootRef} className="rounded-lg border border-primary/30 bg-primary/[0.06] p-4" onFocusCapture={onFocusCapture} onKeyDownCapture={onKeyDownCapture} onInputCapture={onInputCapture}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {showEditor ? (
          <input
            type="text" value={title} onChange={(e) => saver.change({ ...draftRef.current.value, title: e.target.value })}
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
            <button type="button" onClick={removeCard} title="카드 삭제"
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
  // 여러 카드의 이탈 저장이 같은 틱에 몰려도 앞 카드의 변경이 뒤 카드 저장에 덮이지 않게, 마지막으로 보낸 목록을 기준으로 누적한다.
  const latest = useRef(cards);
  useEffect(() => { latest.current = cards; }, [cards]);
  const apply = (next: CapMetaCard[]) => { latest.current = next; onSave(next); };
  const updateCard = (next: CapMetaCard) => apply(upsertCardById(latest.current, next));
  const removeCard = (id: string) => apply(removeCardById(latest.current, id));
  const addCard = () => apply([...latest.current, newMetaCard()]);
  if (!editable && cards.length === 0) return null; // 보기 모드 + 내용 없음 → 섹션 숨김
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-primary">전체 관통 — 메타 인사이트</h2>
      {cards.map((c) => (
        <MetaCard key={c.id} card={c} onChange={updateCard} onDelete={() => removeCard(c.id)} onJump={onJump} editable={editable} />
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
