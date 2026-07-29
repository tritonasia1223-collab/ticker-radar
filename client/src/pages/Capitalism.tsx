// 자본주의 경제사 타임라인 — 상단 인과 플로우(연도 그룹) + 하단 FRED 그래프 스택.
// 연도가 대분류, 그 안의 사건들이 소분류로 묶인다. 슬라이더로 연도 스크럽.
// 편집은 전부 인라인(팝업 없음): 카드 클릭→텍스트 편집, 호버 +버튼→칸 추가, X→칸 삭제.
import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback, Fragment } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion, LayoutGroup } from "framer-motion";
import { spring, fadeRise, reducedTransition } from "@/lib/motion-presets";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Undo2, X, CornerUpLeft } from "lucide-react";
import { FlowColumn, type MutateNodes, type MutateMeta, type LinkNodes } from "@/components/CapFlow";
import { CapLinkOverlay } from "@/components/CapLinkOverlay";
import { CapChartPanel } from "@/components/CapChartPanel";
import { InsightPanel, InsightsCollection } from "@/components/CapInsight";
import { PANELS, CATEGORIES, toFracYear, fracYearToLabel, leadersForYear } from "@/lib/capitalism-config";
import { persistNodes, toInput, newNodeKey, nodeHasContent, enqueueSave, withRetry, patchNodeContent, putInsight } from "@/lib/capitalism-flowops";
import type { NodeContentPatch } from "@/lib/capitalism-types";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { applyUndo, makeFlowEntry, makeLinksEntry, type UndoEntry } from "@/lib/capitalism-undo";
import type { FlowDTO, FlowNodeDTO, FlowInputDTO, LinkDTO, CapInsight, CapMetaCard } from "@/lib/capitalism-types";
import seriesData from "@/data/capitalism-series.json";

type SeriesMap = Record<string, [string, number][]>;
const SERIES = seriesData as unknown as SeriesMap;

// 각 패널(시리즈)의 데이터 시작 소수 연도. 슬라이더 현재 시점이 이보다 이르면
// 아직 데이터가 없으므로 체크박스 라벨을 회색으로 흐리게 표시한다.
// (예: 연준 유동성 walcl/wresbal=2002년, rrp=2003년부터 시작)
const PANEL_START_FRAC: Record<string, number> = Object.fromEntries(
  PANELS.map((p) => {
    const arr = SERIES[p.series];
    const firstDate = arr && arr.length > 0 ? arr[0][0] : null;
    return [p.id, firstDate ? toFracYear(firstDate) : -Infinity];
  }),
);

const YEAR_MIN = 1971;
const YEAR_MAX = 1980;

// 소수 연도 → YYYY-MM-DD (월 1일). 새 사건 기본 날짜 산출용.
function fracYearToDate(frac: number): string {
  const year = Math.floor(frac);
  let month = Math.floor((frac - year) * 12) + 1;
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export default function Capitalism() {
  const qc = useQueryClient();
  const { data: flows, isLoading } = useQuery<FlowDTO[]>({ queryKey: ["/api/capitalism/flows"] });
  // 보드 전역 화살표(카드 내/간 드래그앤드롭 연결).
  const { data: links } = useQuery<LinkDTO[]>({ queryKey: ["/api/capitalism/links"] });
  // 메타 인사이트(전체 관통 논증) — 사건에 안 묶이는 app-level 카드들(표·이미지 포함).
  //   v2 키(insight_overview_v2)에 { cards } JSON 으로 저장. 레거시 단일 문자열(insight_overview)은
  //   손실 방지를 위해 그대로 두고, v2 가 비어 있을 때만 첫 카드로 시드(수동 편집본 보존).
  const { data: metaV2 } = useQuery<{ value: string | null }>({ queryKey: ["/api/capitalism/settings/insight_overview_v2"] });
  const { data: overviewData } = useQuery<{ value: string | null }>({ queryKey: ["/api/capitalism/settings/insight_overview"] });
  const metaCards = useMemo<CapMetaCard[]>(() => {
    if (metaV2?.value) {
      try { const parsed = JSON.parse(metaV2.value); if (Array.isArray(parsed?.cards)) return parsed.cards; } catch { /* fall through */ }
    }
    const legacy = overviewData?.value;
    if (legacy && legacy.trim()) return [{ id: "meta-legacy", title: "", text: legacy, tables: [], images: [] }];
    return [];
  }, [metaV2?.value, overviewData?.value]);
  const saveMetaCards = (next: CapMetaCard[]) => {
    const value = JSON.stringify({ cards: next });
    qc.setQueryData(["/api/capitalism/settings/insight_overview_v2"], { value });
    // 실패를 삼키지 않고 사용자에게 알림(조용한 손실 금지). 화면 값은 낙관적 캐시로 유지된다.
    apiRequest("PUT", "/api/capitalism/settings/insight_overview_v2", { value })
      .catch(() => toast({ description: "메타 카드 저장 실패 — 편집 내용은 화면에 남아 있어요. 잠시 후 다시 시도하세요.", variant: "destructive" }));
  };

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PANELS.map((p) => [p.id, p.on]))
  );
  const [playYear, setPlayYear] = useState(1973.8);
  // Y축 범위 모드: "window"=보이는 시점 구간에 맞춰 유동 조절(기본), "full"=전체 데이터 범위 고정.
  const [yMode, setYMode] = useState<"full" | "window">("window");
  // 인사이트 모드 — 별 클릭 시 그 사건 slug. 설정되면 오른쪽 패널이 그래프 대신 인사이트를 보여준다.
  const [activeInsightSlug, setActiveInsightSlug] = useState<string | null>(null);
  // 상단 탭 — 타임라인 vs 인사이트 모아보기(시간순 읽기).
  const [viewMode, setViewMode] = useState<"timeline" | "insights">("timeline");
  // 어느 노드가 인라인 편집 중인지 — 전역으로 1개만.
  const [editingId, setEditingId] = useState<string | null>(null);
  // '모아보기'에서 편집 클릭 → 타임라인으로 전환 후 '그 카드'로 스크롤할 대상 slug(보드 마운트 뒤 처리).
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  // 링크 점프 되돌아가기 스택 — 링크 클릭 시 직전 {스크롤위치, playYear} 를 쌓아, "돌아가기"로 되돌린다.
  //   체인 점프(A→B→C) 도 한 단계씩 거슬러 올라감. 타임라인을 떠나면(모아보기 전환) 위치가 무효라 비운다.
  const [backStack, setBackStack] = useState<{ top: number; year: number }[]>([]);
  // 세로 타임라인 스크롤 컨테이너 ref — 스크롤 위치 ↔ playYear 동기화 + 화살표 오버레이 기준.
  const boardRef = useRef<HTMLDivElement | null>(null);
  // 프로그램이 스크롤을 움직이는 동안엔 스크롤→playYear 역동기화를 잠가 피드백 루프를 막는다.
  const programScrollRef = useRef(false);
  const programScrollTimer = useRef<number | null>(null);
  // 모아보기→타임라인 전환 후 카드 스크롤용 rAF 핸들(언마운트/재실행 시 취소).
  const pendingRafRef = useRef<number | null>(null);
  const { toast } = useToast();

  // ── 되돌리기(Undo) 스택 ── 텍스트 글자 편집 제외, 구조 변경만.
  // ref 로 보관(렌더와 무관). 최대 50개까지 유지.
  const undoStack = useRef<UndoEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const pushUndo = (entry: UndoEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > 50) undoStack.current.shift();
    setCanUndo(true);
  };
  const doUndo = async () => {
    if (undoBusy) return;
    const entry = undoStack.current.pop();
    setCanUndo(undoStack.current.length > 0);
    if (!entry) return;
    setUndoBusy(true);
    try {
      await applyUndo(entry);
      await qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] });
      await qc.invalidateQueries({ queryKey: ["/api/capitalism/links"] });
      toast({ description: `되돌림: ${entry.label}` });
    } catch {
      toast({ description: "되돌리기에 실패했어요.", variant: "destructive" });
    } finally {
      setUndoBusy(false);
    }
  };

  // 최신 doUndo 를 ref 에 담아 키 핸들러 effect 가 매번 재등록되지 않게 한다.
  const doUndoRef = useRef(doUndo);
  doUndoRef.current = doUndo;

  // Ctrl+Z(⌘Z) → 되돌리기. 단, 입력창/편집창 포커시엔 무시(편집기 글자 단위 Undo 는 브라우저 기본 동작에 맡긴다).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== "z" && e.key !== "Z") return;
      // 입력/편집 중이면 브라우저 기본 Undo 가 처리하도록 건드리지 않음.
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
      }
      e.preventDefault();
      void doUndoRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 탭 전환 시 스크롤 컨테이너를 최상단으로 리셋.
  // 실제 스크롤 컨테이너는 window 가 아니라 레이아웃의 <main overflow-auto> 다.
  // '모아보기'(긴 콘텐츠)에서 편집→타임라인으로 돌아오면 그 scrollTop 이 남아,
  // 좌측 보드(일반 흐름)와 우측 sticky 패널의 상단 정렬이 어긋난다(단차) → 부모를 찾아 0으로.
  const pageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let el = pageRef.current?.parentElement;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") { el.scrollTop = 0; break; }
      el = el.parentElement;
    }
    window.scrollTo({ top: 0 });
  }, [viewMode]);

  const [fromY, toY] = useMemo(() => {
    if (!flows || flows.length === 0) return [YEAR_MIN, YEAR_MAX];
    const years = flows.map((f) => toFracYear(f.date));
    return [Math.floor(Math.min(...years, YEAR_MIN)), Math.ceil(Math.max(...years, YEAR_MAX))];
  }, [flows]);

  // 그래프 X축은 현재 위치(playYear)를 "항상 정가운데"에 두는 ±HALF_WINDOW 년의 이동 창.
  // 경계에서 창을 밀지 않는다 → playYear가 늘 창 중앙이라 점선이 정가운데에 고정된다.
  // 데이터가 없는 쪽(예: 데이터 시작 이전·미래)은 그냥 비워둔다(라인은 데이터 구간에만 그려짐).
  const HALF_WINDOW = 5;
  const [viewFrom, viewTo] = useMemo(() => {
    return [playYear - HALF_WINDOW, playYear + HALF_WINDOW];
  }, [playYear]);

  const activeSlug = useMemo(() => {
    if (!flows || flows.length === 0) return null;
    let best = flows[0], bestD = Infinity;
    for (const f of flows) {
      const d = Math.abs(toFracYear(f.date) - playYear);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best.slug;
  }, [flows, playYear]);

  // 내부 링크 대상 카드 목록(편집기 링크 패널용) — 연도순 정렬.
  const linkTargets = useMemo(() => {
    if (!flows) return [];
    return flows
      .map((f) => ({ slug: f.slug, year: f.year || Number(f.date.slice(0, 4)), title: f.title }))
      .sort((a, b) => a.year - b.year);
  }, [flows]);

  // 내부 링크 클릭 → 대상 카드(slug)의 시점으로 재생 위치 이동(부드러운 슬라이드 → activeSlug 변경).
  // 특정 연도(소수)로 이동: playYear 갱신 + 세로 타임라인을 해당 연도 그룹으로 부드럽게 스크롤.
  // 슬라이더/연대칩/마커/링크점프가 모두 이걸 호출 → "슬라이더 조정 = 스크롤 이동" 일관성 확보.
  const seekToYear = useCallback((frac: number) => {
    const clamped = Math.max(fromY, Math.min(toY, frac));
    setPlayYear(clamped);
    const board = boardRef.current;
    if (!board) return;
    // 목표 연도에 가장 가까운 연도 그룹 엘리먼트를 찾아 컨테이너 상단 근처로 스크롤.
    const els = Array.from(board.querySelectorAll<HTMLElement>("[data-group-year]"));
    if (els.length === 0) return;
    let best = els[0], bestD = Infinity;
    for (const el of els) {
      const gy = Number(el.dataset.groupYear);
      const d = Math.abs(gy - clamped);
      if (d < bestD) { bestD = d; best = el; }
    }
    const boardBox = board.getBoundingClientRect();
    const elBox = best.getBoundingClientRect();
    // 그룹 상단을 컨테이너 상단에서 약간 아래(앵커 오프셋)에 맞춘다.
    const anchor = Math.min(120, board.clientHeight * 0.25);
    const target = elBox.top - boardBox.top + board.scrollTop - anchor;
    // 프로그램 스크롤 잠금 → 스크롤→playYear 역동기화 피드백 루프 차단.
    programScrollRef.current = true;
    if (programScrollTimer.current) window.clearTimeout(programScrollTimer.current);
    programScrollTimer.current = window.setTimeout(() => { programScrollRef.current = false; }, 650);
    board.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [fromY, toY]);

  // 카드 선택 — playYear(슬라이더/그래프)만 그 시점으로 갱신하고 '보드는 스크롤하지 않는다'.
  // 카드를 클릭(편집 진입 포함)할 때 이미 보고 있는 카드를 또 스크롤하면 화면이 점프하므로,
  // seekToYear 의 스크롤 부분을 빼고 시점만 맞춘다. 명시적 이동(슬라이더/연대칩/링크)만 스크롤한다.
  const selectYear = useCallback((frac: number) => {
    setPlayYear(Math.max(fromY, Math.min(toY, frac)));
  }, [fromY, toY]);

  // 내부 링크 클릭 → 대상 '카드 자체'로 스크롤(+playYear).
  // seekToYear 는 '연도 그룹'으로만 가서, 같은 연도에 이벤트가 여럿이면(예: 1985년 4건)
  // 엉뚱한 카드(그 해 첫 이벤트)로 가거나 소수연도가 인접 연도로 반올림돼 빗나갔다.
  // 그래서 대상 카드 DOM(data-testid=flow-<slug>)을 직접 찾아 그 위치로 스크롤한다. 못 찾으면 연도로 폴백.
  const jumpToSlug = useCallback((slug: string) => {
    const f = flows?.find((x) => x.slug === slug);
    if (!f) return; // 삭제되었거나 아직 없는 카드면 무시
    setPlayYear(Math.max(fromY, Math.min(toY, toFracYear(f.date)))); // 슬라이더/그래프도 그 시점으로
    const board = boardRef.current;
    const el = board?.querySelector<HTMLElement>(`[data-testid="flow-${slug}"]`);
    if (!board || !el) { seekToYear(toFracYear(f.date)); return; } // 카드 DOM 못 찾으면 연도 그룹으로 폴백
    const boardBox = board.getBoundingClientRect();
    const elBox = el.getBoundingClientRect();
    const anchor = Math.min(120, board.clientHeight * 0.25);
    const target = elBox.top - boardBox.top + board.scrollTop - anchor;
    programScrollRef.current = true;
    if (programScrollTimer.current) window.clearTimeout(programScrollTimer.current);
    programScrollTimer.current = window.setTimeout(() => { programScrollRef.current = false; }, 650);
    board.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [flows, fromY, toY, seekToYear]);

  // 링크 클릭용 래퍼 — 점프 '직전' 위치를 스택에 쌓은 뒤 이동(그래야 "돌아가기"로 원위치 복귀).
  //   pending-jump(모아보기 전환)는 raw jumpToSlug 를 그대로 써서 스택에 안 쌓인다(뷰 전환이라 무의미).
  const jumpWithHistory = useCallback((slug: string) => {
    const board = boardRef.current;
    if (board) setBackStack((s) => [...s, { top: board.scrollTop, year: playYear }]);
    jumpToSlug(slug);
  }, [jumpToSlug, playYear]);

  // "돌아가기" — 스택 최상단으로 스크롤·playYear 복원 후 pop.
  const goBack = useCallback(() => {
    const prev = backStack[backStack.length - 1];
    if (!prev) return;
    setBackStack((s) => s.slice(0, -1));
    const board = boardRef.current;
    if (board) {
      programScrollRef.current = true;
      if (programScrollTimer.current) window.clearTimeout(programScrollTimer.current);
      programScrollTimer.current = window.setTimeout(() => { programScrollRef.current = false; }, 650);
      board.scrollTo({ top: prev.top, behavior: "smooth" });
    }
    setPlayYear(prev.year);
  }, [backStack]);

  // 뷰 전환(타임라인↔모아보기) 시 스택 비우기 — 보드가 remount 돼 스크롤 위치가 무효가 되므로.
  useEffect(() => { setBackStack([]); }, [viewMode]);

  // '모아보기' 편집 클릭 → 타임라인 전환 후, 보드가 마운트·레이아웃된 다음 그 카드로 스크롤한다.
  // (전환과 같은 틱에 스크롤하면 보드 DOM이 아직 없어 무효화되고, viewMode 리셋 이펙트가 최상단으로
  //  밀어버려 항상 1968로 갔다. rAF 2회로 커밋·레이아웃 완료를 기다린 뒤 실행.)
  useEffect(() => {
    if (viewMode !== "timeline" || !pendingJump) return;
    const slug = pendingJump;
    setPendingJump(null);
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => jumpToSlug(slug));
      pendingRafRef.current = raf2;
    });
    pendingRafRef.current = raf1;
    return () => { if (pendingRafRef.current) cancelAnimationFrame(pendingRafRef.current); };
  }, [viewMode, pendingJump, jumpToSlug]);

  // active 사건이 기간 이벤트면 [시작, 종료] 소수연도 밴드를 산출(그래프 음영·중앙값용). 단일 이벤트면 null.
  const activeBand = useMemo(() => {
    if (!flows || !activeSlug) return null;
    const f = flows.find((x) => x.slug === activeSlug);
    if (!f || !f.endDate) return null;
    const start = toFracYear(f.date);
    const end = toFracYear(f.endDate);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
    return { start, end, mid: (start + end) / 2 };
  }, [flows, activeSlug]);

  // 세로 스크롤 = 시간 이동. 사용자가 마우스로 스크롤하면 뷰포트 상단 앵커에 가장 가까운
  // 연도 그룹들 사이를 보간해 playYear 를 갱신한다(스크롤→playYear 역동기화).
  // programScrollRef 가 켜진 동안(=seekToYear 가 프로그램 스크롤 중)에는 건너뛴다.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (programScrollRef.current) return;
        const els = Array.from(board.querySelectorAll<HTMLElement>("[data-group-year]"));
        if (els.length === 0) return;
        const boardBox = board.getBoundingClientRect();
        // 뷰포트 상단에서 약간 아래 지점을 "현재 보는 시점" 앵커로 삼는다.
        const anchor = Math.min(120, board.clientHeight * 0.25);
        const anchorY = boardBox.top + anchor;
        // 앵커보다 위에 있는(=이미 지난) 마지막 그룹과 그 다음 그룹 사이를 보간.
        const sorted = els
          .map((el) => ({ year: Number(el.dataset.groupYear), top: el.getBoundingClientRect().top }))
          .sort((a, b) => a.top - b.top);
        let frac: number;
        if (anchorY <= sorted[0].top) {
          frac = sorted[0].year; // 첫 그룹보다 위 → 첫 연도
        } else if (anchorY >= sorted[sorted.length - 1].top) {
          frac = sorted[sorted.length - 1].year; // 마지막 그룹보다 아래 → 마지막 연도
        } else {
          // anchorY 가 끼인 두 그룹을 찾아 선형 보간.
          let lo = sorted[0], hi = sorted[sorted.length - 1];
          for (let i = 0; i < sorted.length - 1; i++) {
            if (anchorY >= sorted[i].top && anchorY < sorted[i + 1].top) {
              lo = sorted[i]; hi = sorted[i + 1]; break;
            }
          }
          const span = hi.top - lo.top;
          const t = span > 0 ? (anchorY - lo.top) / span : 0;
          frac = lo.year + t * (hi.year - lo.year);
        }
        const clamped = Math.max(fromY, Math.min(toY, frac));
        setPlayYear((prev) => (Math.abs(prev - clamped) > 0.01 ? clamped : prev));
      });
    };
    board.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      board.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
    // isLoading 을 넣어 보드(ref) 가 렌더된 직후 effect 가 재실행되며 리스너를 등록하도록 한다.
  }, [fromY, toY, isLoading]);

  // 연도(대분류) → 사건(소분류) 그룹핑. flows 는 서버에서 날짜순 정렬되어 옴.
  const groups = useMemo(() => {
    if (!flows) return [] as { year: number; items: FlowDTO[] }[];
    const map = new Map<number, FlowDTO[]>();
    for (const f of flows) {
      const y = f.year || Number(f.date.slice(0, 4));
      (map.get(y) ?? map.set(y, []).get(y)!).push(f);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, items]) => ({ year, items }));
  }, [flows]);

  // 시대(decade) 네비 — 데이터에 존재하는 연대만 자동 생성. 각 연대의 첫 사건(slug/연도) 보관.
  // 80년대 이후 사건을 추가하면 자동으로 1980s 칩이 생긴다.
  const decades = useMemo(() => {
    if (!flows || flows.length === 0) return [] as { decade: number; label: string; firstFrac: number; firstSlug: string }[];
    const map = new Map<number, { firstFrac: number; firstSlug: string }>();
    for (const f of flows) {
      const frac = toFracYear(f.date);
      const decade = Math.floor(frac / 10) * 10;
      const cur = map.get(decade);
      if (!cur || frac < cur.firstFrac) map.set(decade, { firstFrac: frac, firstSlug: f.slug });
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([decade, v]) => ({ decade, label: `${decade}s`, firstFrac: v.firstFrac, firstSlug: v.firstSlug }));
  }, [flows]);

  // 현재 active 사건이 속한 연대(칩 하이라이트용).
  const activeDecade = useMemo(() => Math.floor(playYear / 10) * 10, [playYear]);

  // 인사이트 모드 대상 flow(별 클릭한 사건). slug 가 없거나 삭제됐으면 null → 그래프 표시.
  const activeInsightFlow = activeInsightSlug ? (flows?.find((f) => f.slug === activeInsightSlug) ?? null) : null;
  // 별을 누르면 '인사이트 모드' ON — 그래프 패널이 블러 배경이 되고, 모든 인사이트가 각 사건 카드 옆에 매칭된다(iOS식).
  const insightMode = !!activeInsightFlow;
  const hasInsight = (f: FlowDTO) => !!(f.insight && (f.insight.text.trim() || f.insight.charts.length || f.insight.tables?.length || f.insight.blocks?.length));
  const exitInsightMode = () => setActiveInsightSlug(null);

  // 인사이트 모드에서 그래프를 '제자리 블러 배경'으로. absolute 로 띄우되 원래(비인사이트) 우측
  // 컬럼 폭을 그대로 고정 → 차트가 전체 폭으로 리플로우돼 넓어지는 버그 방지. 비인사이트일 때 폭 측정.
  const asideRef = useRef<HTMLElement | null>(null);
  const [graphWidth, setGraphWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (insightMode) return; // 인사이트 모드 중엔 직전 폭 유지(측정 금지)
    const el = asideRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    if (w && w !== graphWidth) setGraphWidth(w);
  });

  const onPanels = PANELS.filter((p) => enabled[p.id]);
  // 동작 최소화 선호 시 스프링을 끄고 즉시 전환.
  const reduceMotion = useReducedMotion();
  const panelSpring = reduceMotion ? reducedTransition : spring.ios;

  // ── 통합 저장기 (Fix①②③) ─────────────────────────────────────────────
  // 최신 '캐시' 상태의 그 카드를 slug별 직렬화(②)·재시도(③)로 저장한다. invalidate/refetch 안 함(①).
  //   · 직렬화: 같은 카드 동시 저장이 서로를 덮지 않음. 실행 시점에 최신 캐시를 읽어 누적 보존.
  //   · 실패해도 편집을 '유지'하고 토스트로 알림(조용한 손실 금지). 캐시에서 사라진 카드는 서버 삭제.
  //   · withRetry(빠른 3회) 도 실패하면, 사용자가 손대지 않아도 몇 초 뒤 자동 재시도(콜드스타트·풀러
  //     히컵은 수 초면 회복). 자동 재시도도 소진되면 그제서야 토스트로 알림.
  const saveFlow = useCallback((slug: string, autoRetryLeft = 2) => {
    return enqueueSave(slug, () => withRetry(async () => {
      const latest = qc.getQueryData<FlowDTO[]>(["/api/capitalism/flows"])?.find((x) => x.slug === slug);
      if (!latest) { await apiRequest("DELETE", `/api/capitalism/flows/${encodeURIComponent(slug)}`); return; }
      const saved = await persistNodes(latest, latest.nodes); // 빈 칸 정리, 전부 비면 삭제
      // 저장 성공 → 이 클라의 캐시 버전(updatedAt)을 서버 최신값으로 올린다. 노드는 '현재 캐시'를 유지
      //   (저장 사이 추가된 편집분 보존). 이걸 안 하면 같은 클라의 연속 저장이 스테일 버전으로 나가
      //   자기 자신과 409 충돌한다(오탐).
      if (saved !== "deleted") {
        qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) =>
          prev ? prev.map((f) => (f.slug === slug ? { ...f, updatedAt: saved.updatedAt } : f)) : prev
        );
      }
    })).catch((err: unknown) => {
      // 413(요청이 너무 큼)은 재시도해도 결정적으로 실패한다 — 원인(대개 붙여넣은 이미지)이 그대로라
      // 자동 재시도로 시간 끌지 말고 즉시 '줄이라'고 정확히 안내한다(재편집 안내는 여기선 오답).
      const msg = String((err as Error)?.message ?? err);
      // 409(동시편집 충돌): 그새 다른 곳에서 이 카드가 먼저 저장됨. 조용히 덮어쓰지 않고(핵심)
      //   최신본을 강제로 다시 불러온 뒤 사용자에게 알린다. 스테일 버전으로 자동 재시도하면 또 409 라 금지.
      if (/^409\b/.test(msg)) {
        void qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] });
        toast({
          description: "이 카드가 다른 곳에서 먼저 수정됐어요. 최신본을 다시 불러왔습니다 — 방금 편집분은 저장되지 않았으니 확인 후 다시 입력해 주세요.",
          variant: "destructive",
        });
        return;
      }
      const tooLarge = /^413\b/.test(msg) || /too large|payloadtoolarge/i.test(msg);
      if (!tooLarge && autoRetryLeft > 0) {
        // 손 안 대도 4초 뒤 자동 재저장(실행 시점 최신 캐시를 다시 읽음 → 그새 편집분까지 포함).
        setTimeout(() => { void saveFlow(slug, autoRetryLeft - 1); }, 4000);
        return;
      }
      toast({
        description: tooLarge
          ? "저장 실패: 이 카드 내용(특히 붙여넣은 이미지)이 너무 커서 서버가 거부했어요. 이미지를 줄이거나 개수를 줄인 뒤 다시 저장하세요."
          : "저장 실패(자동 재시도도 안 됨). 편집 내용은 화면에만 있고 아직 DB에 저장되지 않았어요. " +
            "⚠ 새로고침하지 마세요 — 저장 안 된 내용이 사라집니다. 그 카드를 한 번 더 편집하면 재저장됩니다.",
        variant: "destructive",
      });
    });
  }, [qc, toast]);

  // 카드 안에서 칸을 추가만 할 때(빈 칸) — 캐시에만 반영, 서버 저장은 입력 완료(commit) 시.
  // 전달된 flow의 layout도 함께 동기화(stack→branch 자동 전환 시 캐시 layout 갱신).
  const onAddLocal: MutateNodes = (flow, nextNodes) => {
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) =>
      prev ? prev.map((f) => (f.slug === flow.slug ? { ...f, layout: flow.layout, nodes: nextNodes } : f)) : prev
    );
  };

  // 칸 내용 확정/삭제 — 캐시 즉시 반영 + 서버 저장(빈 칸 정리, 전부 비면 플로우 삭제).
  const onMutateNodes: MutateNodes = (flow, nextNodes) => {
    // 변경 직전 flow 스냅샷을 쌓아둔다(노드 추가/삭제·카드 삭제를 되돌릴 수 있게).
    pushUndo(makeFlowEntry("사건 수정", flow.slug, flows));
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) => {
      if (!prev) return prev;
      const clean = nextNodes.filter(nodeHasContent);
      if (clean.length === 0) return prev.filter((f) => f.slug !== flow.slug);
      return prev.map((f) => (f.slug === flow.slug ? { ...f, nodes: clean } : f));
    });
    saveFlow(flow.slug);
  };

  // 카드 메타(날짜/제목/레이아웃) 변경 — year 자동 재산출, 날짜순 재정렬, 서버 upsert 저장.
  // 날짜를 바꾸면 그룹/슬라이더 범위가 자동으로 갱신되어 다른 연도로 카드가 이동한다.
  const onMutateMeta: MutateMeta = (flow, patch) => {
    // H3 완화: 진행 중인 노드 편집과 클로버되지 않게, '스냅샷(flow)' 대신 최신 캐시의 노드를 기준으로 머지.
    // (캐시는 onMutateNodes 가 낙관적으로 갱신해 둠 → 메타 저장이 최신 노드 내용을 그대로 보존.)
    const latest = qc.getQueryData<FlowDTO[]>(["/api/capitalism/flows"])?.find((x) => x.slug === flow.slug) ?? flow;
    const nextDate = patch.date ?? latest.date;
    const nextYear = patch.date ? Number(patch.date.slice(0, 4)) : latest.year;
    // endDate: patch에 키가 있으면(설정/해제) 그 값을, 없으면 기존값 유지.
    const nextEndDate = "endDate" in patch ? (patch.endDate ?? null) : (latest.endDate ?? null);
    const merged: FlowDTO = {
      ...latest,
      date: nextDate,
      endDate: nextEndDate,
      year: nextYear,
      title: patch.title ?? latest.title,
      layout: patch.layout ?? latest.layout,
    };
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) => {
      if (!prev) return prev;
      const updated = prev.map((f) => (f.slug === flow.slug ? merged : f));
      return [...updated].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sortOrder - b.sortOrder));
    });
    saveFlow(flow.slug); // 낙관적 캐시(merged)를 직렬화·재시도 저장. invalidate 안 함(①).
  };

  // 캐시의 그 카드 버전(updatedAt)만 서버 최신값으로 갱신 — 세분화 저장 뒤 '자기저장' 409 오탐 방지.
  const bumpVersion = useCallback((slug: string, updatedAt: number) => {
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) =>
      prev ? prev.map((f) => (f.slug === slug ? { ...f, updatedAt } : f)) : prev
    );
  }, [qc]);

  // 세분화 저장(patch/insight) 실패 알림 — withRetry 소진 후에도 실패하면 조용히 잃지 않고 토스트.
  const reportSaveError = useCallback((err: unknown) => {
    const msg = String((err as Error)?.message ?? err);
    const tooLarge = /^413\b/.test(msg) || /too large|payloadtoolarge/i.test(msg);
    toast({
      description: tooLarge
        ? "저장 실패: 내용(특히 붙여넣은 이미지)이 너무 커서 서버가 거부했어요. 이미지를 줄인 뒤 다시 저장하세요."
        : "저장 실패(재시도도 안 됨). 편집 내용은 화면에만 있고 아직 저장되지 않았어요. ⚠ 새로고침하지 마세요 — 그 부분을 한 번 더 편집하면 재저장됩니다.",
      variant: "destructive",
    });
  }, [toast]);

  // 사건 인사이트 저장 — insight 만 전송(PUT). 노드·위상은 안 실어 노드 저장과 완전 분리(①).
  const onCommitInsight = (slug: string, insight: CapInsight) => {
    const hasContent = !!(insight.text.trim() || insight.charts.length || insight.tables?.length || insight.blocks?.length);
    const nextInsight = hasContent ? insight : null;
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) =>
      prev ? prev.map((f) => (f.slug === slug ? { ...f, insight: nextInsight } : f)) : prev
    );
    enqueueSave(slug, () => withRetry(() => putInsight(slug, nextInsight)))
      .then((r) => { if (r) bumpVersion(slug, r.updatedAt); })
      .catch(reportSaveError);
  };

  // ── 세분화 콘텐츠 저장(실시간 경량 + 소실 차단) ────────────────────────────
  // 기존 노드의 text/메모/표 편집은 '그 노드 1건'만 PATCH 로 저장(디바운스로 묶음). insight·전체 노드를
  // 안 실으므로 가볍고, 전체목록 덮어쓰기가 없어 스테일 스냅샷 소실이 사라진다.
  // 아직 서버에 없는 '신규 노드'의 첫 저장만 구조 저장(saveFlow)으로 보내 위상(pos·edges)을 확립한다.
  const persistedNodesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!flows) return;
    for (const f of flows) for (const n of f.nodes) persistedNodesRef.current.add(n.id);
  }, [flows]);
  const patchBufRef = useRef<Map<string, { slug: string; nodeId: string; patch: NodeContentPatch; timer: number }>>(new Map());
  const flushPatch = useCallback((key: string) => {
    const buf = patchBufRef.current.get(key);
    if (!buf) return;
    patchBufRef.current.delete(key);
    const { slug, nodeId, patch } = buf;
    enqueueSave(slug, () => withRetry(() => patchNodeContent(slug, nodeId, patch)))
      .then((r) => { if (r) { bumpVersion(slug, r.updatedAt); persistedNodesRef.current.add(nodeId); } })
      .catch(reportSaveError);
  }, [bumpVersion, reportSaveError]);
  const onEditContent = useCallback((flow: FlowDTO, nodeId: string, patch: NodeContentPatch) => {
    // 1) 캐시 즉시 반영(낙관적).
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) =>
      prev ? prev.map((f) => (f.slug !== flow.slug ? f : { ...f, nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) })) : prev
    );
    // 2) 서버에 아직 없는 신규 노드 → 위상 확립 위해 구조 저장(버전가드 A).
    if (!persistedNodesRef.current.has(nodeId)) {
      persistedNodesRef.current.add(nodeId);
      saveFlow(flow.slug);
      return;
    }
    // 3) 기존 노드 내용 → 디바운스(600ms) 후 그 노드 1건만 PATCH. 연속 편집은 병합.
    const key = `${flow.slug}::${nodeId}`;
    const cur = patchBufRef.current.get(key);
    if (cur) window.clearTimeout(cur.timer);
    const merged: NodeContentPatch = { ...(cur?.patch ?? {}), ...patch };
    const timer = window.setTimeout(() => flushPatch(key), 600);
    patchBufRef.current.set(key, { slug: flow.slug, nodeId, patch: merged, timer });
  }, [qc, saveFlow, flushPatch]);

  // 페이지 이동·새로고침·탭 숨김 시: 아직 안 나간 디바운스 저장을 즉시 발사하고, 저장 미완이면 경고.
  //   (600ms 디바운스가 blur 직후 이탈 시 만들 수 있는 유실 창을 막는다.)
  useEffect(() => {
    const flushAll = () => { for (const key of [...patchBufRef.current.keys()]) flushPatch(key); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (patchBufRef.current.size === 0) return;
      flushAll();
      e.preventDefault();
      e.returnValue = ""; // 브라우저 기본 "저장 안 됨" 경고 표시
    };
    const onHide = () => { if (document.visibilityState === "hidden") flushAll(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushPatch]);

  // 새 사건(플로우) 추가 — 팝업 없이 기본값으로 생성하고 첫 칸을 편집 모드로.
  // 낙관적으로 카드를 캐시에 추가(클라 slug = 서버 slug → temp→real 스왑/remount 없음, ④) 후
  // 직렬화·재시도 저장(saveFlow). invalidate 안 함(①). setEditingId 는 즉시.
  const addFlow = useMutation({
    mutationFn: async () => {
      const date = fracYearToDate(playYear);
      const slug = `flow-${Date.now().toString(36)}`;
      pushUndo(makeFlowEntry("사건 추가", slug, flows)); // prev=null → Undo 는 삭제
      const firstKey = newNodeKey();
      const year = Number(date.slice(0, 4));
      qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) => {
        const maxOrder = (prev ?? []).reduce((m, f) => Math.max(m, f.sortOrder), -1);
        const nf: FlowDTO = { id: -Date.now(), updatedAt: 0, slug, title: "새 사건", date, endDate: null, year, category: "경제", layout: "stack", insight: null, sortOrder: maxOrder + 1,
          nodes: [{ id: firstKey, kind: "effect", inLabel: null, text: "새 사건", ref: null, col: null, table: null }], edges: [] };
        return [...(prev ?? []), nf].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sortOrder - b.sortOrder));
      });
      setEditingId(firstKey);
      await saveFlow(slug);
      return { firstKey };
    },
  });

  // 중간 삽입: 두 연도 그룹 사이(또는 맨 앞/뒤)에 새 사건 생성. 대상 연도(targetYear)를 받아 그 년도로 생성.
  const addFlowAt = useMutation({
    mutationFn: async (targetYear: number) => {
      const date = `${targetYear}-01-01`;
      const slug = `flow-${Date.now().toString(36)}`;
      pushUndo(makeFlowEntry("사건 추가", slug, flows)); // 신규 → Undo 는 삭제
      const firstKey = newNodeKey();
      qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) => {
        const maxOrder = (prev ?? []).reduce((m, f) => Math.max(m, f.sortOrder), -1);
        const nf: FlowDTO = { id: -Date.now(), updatedAt: 0, slug, title: "새 사건", date, endDate: null, year: targetYear, category: "경제", layout: "stack", insight: null, sortOrder: maxOrder + 1,
          nodes: [{ id: firstKey, kind: "effect", inLabel: null, text: "새 사건", ref: null, col: null, table: null }], edges: [] };
        return [...(prev ?? []), nf].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sortOrder - b.sortOrder));
      });
      setEditingId(firstKey);
      await saveFlow(slug);
      window.setTimeout(() => seekToYear(targetYear), 80); // 새 그룹으로 스크롤
      return { firstKey, targetYear };
    },
  });

  // 드래그앤드롭 화살표 연결 — 낙관적 캐시 추가 후 서버 저장.
  const onLink: LinkNodes = (from, to) => {
    // 화살표 추가 직전의 전체 링크 스냅샷을 쌓아둔다.
    pushUndo(makeLinksEntry("화살표 추가", links));
    const tempId = -Date.now();
    qc.setQueryData<LinkDTO[]>(["/api/capitalism/links"], (prev) => {
      const list = prev ?? [];
      if (list.some((l) => l.fromSlug === from.slug && l.fromKey === from.key && l.toSlug === to.slug && l.toKey === to.key)) return list;
      const filtered = list.filter((l) => !(l.fromSlug === to.slug && l.fromKey === to.key && l.toSlug === from.slug && l.toKey === from.key));
      return [...filtered, { id: tempId, fromSlug: from.slug, fromKey: from.key, toSlug: to.slug, toKey: to.key }];
    });
    enqueueSave("__links__", () => withRetry(async () =>
      (await apiRequest("POST", "/api/capitalism/links", { fromSlug: from.slug, fromKey: from.key, toSlug: to.slug, toKey: to.key })).json() as Promise<LinkDTO>
    )).then((created) => {
      // temp id → 서버 실 id 화해(삭제가 실 id 로 동작). invalidate 안 함(①③).
      qc.setQueryData<LinkDTO[]>(["/api/capitalism/links"], (prev) => prev ? prev.map((l) => (l.id === tempId ? { ...l, id: created.id } : l)) : prev);
    }).catch(() => toast({ description: "화살표 저장에 실패했어요 — 잠시 후 다시 시도하세요.", variant: "destructive" }));
  };

  // 화살표 삭제(오버레이에서 클릭).
  const onDeleteLink = (id: number) => {
    // 삭제 직전 스냅샷 → Undo 는 복원.
    pushUndo(makeLinksEntry("화살표 삭제", links));
    qc.setQueryData<LinkDTO[]>(["/api/capitalism/links"], (prev) => (prev ? prev.filter((l) => l.id !== id) : prev));
    if (id < 0) return; // 낙관적 임시 id 는 서버 호출 불필요
    enqueueSave("__links__", () => withRetry(() => apiRequest("DELETE", `/api/capitalism/links/${id}`)))
      .catch(() => toast({ description: "화살표 삭제에 실패했어요 — 잠시 후 다시 시도하세요.", variant: "destructive" }));
  };

  return (
    <div ref={pageRef} className="p-4 max-w-[1900px] mx-auto h-full flex flex-col overflow-hidden">
      {/* ── 상단 탭: 타임라인 / 인사이트 모아보기 ── */}
      <div className="mb-3 inline-flex shrink-0 self-start items-center rounded-md border border-border bg-card/40 p-0.5" role="group" aria-label="보기 모드">
        {([
          { v: "timeline" as const, label: "타임라인" },
          { v: "insights" as const, label: "인사이트 모아보기" },
        ]).map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => setViewMode(t.v)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === t.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`viewmode-${t.v}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {viewMode === "insights" ? (
        <div className="flex-1 min-h-0 overflow-y-auto cap-noscrollbar">
          <InsightsCollection
            flows={flows ?? []}
            metaCards={metaCards}
            onSaveMetaCards={saveMetaCards}
            onOpenInsight={(slug) => { setActiveInsightSlug(slug); setPendingJump(slug); setViewMode("timeline"); }}
            onJump={jumpToSlug}
          />
        </div>
      ) : (
      /* ── 세로 2단 레이아웃: 좌측 타임라인 + 우측 그래프. 남은 높이를 flex-1 로 정확히 채우고
            (vh 계산 대신) 두 컬럼을 items-stretch·h-full 로 바닥 맞춤 — 1px 오버플로/여백 0. ── */
      <div className="relative flex-1 min-h-0 flex gap-5 items-stretch">
        {/* 링크 점프 후 "돌아가기" — 스택이 있을 때만 타임라인 좌하단에 떠서 원위치로 복귀 */}
        {backStack.length > 0 ? (
          <button
            onClick={goBack}
            className="absolute bottom-4 left-4 z-30 flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-2 text-[12px] font-medium shadow-md backdrop-blur transition-colors hover:bg-accent"
            title="링크로 이동하기 전 위치로 돌아갑니다"
            data-testid="cap-jump-back"
          >
            <CornerUpLeft className="h-4 w-4" /> 돌아가기{backStack.length > 1 ? ` (${backStack.length})` : ""}
          </button>
        ) : null}
        {/* ════════ 좌측: 세로 타임라인 (스크롤 = 시간 이동) ════════ */}
        {/* 인사이트 모드면 보드가 전체 폭(z-10) — 카드 옆 인사이트가 블러 그래프 위로 얹힌다. */}
        <section className={`min-w-0 ${insightMode ? "relative z-10 w-full" : "shrink-0"}`}>
          {isLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
            </div>
          ) : (
            <div
              ref={boardRef}
              className="cap-noscrollbar relative h-full overflow-y-auto overflow-x-hidden pr-1"
            >
              {/* 세로 중심 레일은 각 연도 그룹 내부에서 세그먼트로 그려 콘텐츠 전체 높이를 끊김 없이 관통한다(아래 그룹 div 참고) */}

              {/* 중간 삽입: 맨 앞(첫 그룹 위)에 + 존 */}
              {groups.length > 0 ? (
                <InsertZone
                  onInsert={() => addFlowAt.mutate(groups[0].year - 1)}
                  disabled={addFlowAt.isPending}
                  label={`${groups[0].year - 1}년에 사건 추가`}
                  testid="insert-before-first"
                />
              ) : null}

              {groups.map((g, gi) => (
                <Fragment key={g.year}>
                  {/* 연도 그룹 — data-group-year 로 스크롤 동기화 기준 제공. relative 안에서 레일 선 세그먼트를 그려 그룹끼리 이으면 선이 끊김 없이 이어진다 */}
                  <div className="relative pl-12 pr-2" data-group-year={g.year}>
                    {/* 세로 레일 선 세그먼트 — 그룹 전체 높이를 덮어 아래 그룹과 맞닿아 연속적으로 보임. 원(left-[19px])과 동일한 x기준을 공유해 선이 원 중심을 관통 */}
                    <div className="absolute left-[19px] top-0 bottom-0 w-[2px] -translate-x-1/2 bg-border" aria-hidden />

                    {/* 연도 대분류 헤더 — 연도 · 건수 · 당시 대통령/연준 의장. sticky top-0 으로 스크롤 시 상단 고정(현재 연도만 표시, 다음 연도 진입 시 교체) */}
                    <div className="sticky top-0 z-20 -ml-12 mb-2 flex items-baseline gap-2 bg-background/95 py-1.5 pl-12 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                      {/* 세로 레일 위의 연도 노드(원) — 선(left-[19px])과 동일 x기준, 선이 원 중심을 관통 */}
                      <span
                        className={`absolute left-[19px] top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 transition-all ${
                          Math.floor(playYear) === g.year
                            ? "bg-primary ring-primary/25"
                            : "bg-muted-foreground/40 ring-background"
                        }`}
                        aria-hidden
                      />
                      <span className="text-lg font-bold tabular-nums text-primary">{g.year}</span>
                      <span className="text-[11px] text-muted-foreground">· {g.items.length}건</span>
                      {(() => {
                        const L = leadersForYear(g.year);
                        if (!L) return null;
                        return (
                          <span
                            className="text-[10px] leading-tight text-muted-foreground/70 whitespace-nowrap"
                            data-testid={`text-leaders-${g.year}`}
                            title={`당시 미국 대통령 / 연준 의장`}
                          >
                            {L.president} 대통령, {L.fed} 연준의장
                          </span>
                        );
                      })()}
                    </div>

                    {/* 같은 연도 사건들 = 소분류. 세로로 쌓아(월 순) 잘림 없이 모두 노출. 단일 사건의 분기(branch) 카드는 자체 폭을 유지(해당 행만 가로 스크롤 가능) */}
                    <div className="cap-noscrollbar flex flex-col items-start gap-3 overflow-x-auto rounded-xl bg-muted/30 p-2 pb-3">
                      {g.items.map((f) => {
                        const isActive = f.slug === activeSlug;
                        const isPeriod = !!f.endDate;
                        const rangeLabel = isPeriod
                          ? `${fracYearToLabel(toFracYear(f.date)).replace(/^\d+년 /, "")} ~ ${fracYearToLabel(toFracYear(f.endDate!)).replace(/^\d+년 /, "")}`
                          : fracYearToLabel(toFracYear(f.date)).replace(/^\d+년 /, "");
                        // 인사이트 모드: 모든 카드의 인사이트를 그 카드 바로 옆에 매칭(있을 때만, 또는 막 별 누른 카드).
                        const showBesideInsight = insightMode && (hasInsight(f) || f.slug === activeInsightSlug);
                        return (
                          <div key={f.slug} className="flex flex-row items-start gap-4">
                          <div className="flex flex-col shrink-0">
                            {/* 사건 시점 라벨(월) — 클릭 시 그 시점으로 이동 */}
                            <button
                              type="button"
                              onClick={() => seekToYear(toFracYear(f.date))}
                              className={`mb-1 self-start rounded px-1 text-[10px] tabular-nums transition-colors ${
                                isActive ? "font-semibold text-primary" : "text-muted-foreground/70 hover:text-primary"
                              }`}
                              title={isPeriod ? `${f.date} ~ ${f.endDate}` : fracYearToLabel(toFracYear(f.date))}
                              data-testid={`marker-${f.slug}`}
                            >
                              {rangeLabel}
                            </button>
                            <FlowColumn
                              flow={f}
                              active={isActive}
                              onSelect={(ff) => selectYear(toFracYear(ff.date))}
                              onMutateNodes={onMutateNodes}
                              onAddLocal={onAddLocal}
                              onEditContent={onEditContent}
                              onMutateMeta={onMutateMeta}
                              onLink={onLink}
                              editingId={editingId}
                              setEditingId={setEditingId}
                              editable
                              linkTargets={linkTargets}
                              onJump={jumpWithHistory}
                              onInsightClick={(slug) => setActiveInsightSlug((prev) => (prev ? null : slug))}
                            />
                          </div>
                          {/* 카드 옆 인사이트(메모형) — 블러된 그래프 위에 얹힌다 */}
                          {showBesideInsight ? (
                            <div className="relative z-10 flex-1 min-w-[900px] max-w-[1400px] pt-6">
                              <InsightPanel flow={f} variant="inline" onCommit={onCommitInsight} onClose={exitInsightMode} />
                            </div>
                          ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 중간 삽입: 현재 그룹과 다음 그룹 사이에 + 존. 두 연도의 중간값으로 생성. */}
                  {gi < groups.length - 1 ? (() => {
                    const nextYear = groups[gi + 1].year;
                    const mid = Math.floor((g.year + nextYear) / 2);
                    const target = mid > g.year && mid < nextYear ? mid : g.year;
                    return (
                      <InsertZone
                        onInsert={() => addFlowAt.mutate(target)}
                        disabled={addFlowAt.isPending}
                        label={`${target}년에 사건 추가`}
                        testid={`insert-${g.year}-${nextYear}`}
                      />
                    );
                  })() : null}
                </Fragment>
              ))}

              {/* ── 맨 아래 “+ 사건 추가” — 클릭 시 현재 연도에 새 사건 생성 ── */}
              <div className="relative pl-12 pr-2 pb-4">
                <button
                  type="button"
                  onClick={() => addFlow.mutate()}
                  disabled={addFlow.isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/70 bg-muted/10 p-4 text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
                  data-testid="button-new-flow"
                  title="현재 연도에 새 사건 추가"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-current">
                    <Plus className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-medium">사건 추가</span>
                </button>
              </div>

              {/* 곡선 화살표 오버레이 — 노드 DOM 좌표를 측정해 그린다. 보드 전체를 덮는 절대 레이어. */}
              <CapLinkOverlay boardRef={boardRef} links={links ?? []} flows={flows ?? []} onDeleteLink={onDeleteLink} />
            </div>
          )}
        </section>

        {/* ════════ 우측: 그래프 패널 ════════ */}
        {/* 평소엔 우측 컬럼. 인사이트 모드면 전체 영역을 덮는 '블러 배경'으로 전환(z-0) → 그 위로 카드+인사이트가 얹힌다. */}
        <aside
          ref={asideRef}
          className={`transition-[filter,opacity] duration-200 ${insightMode ? "absolute right-0 top-0 bottom-0 z-0 overflow-hidden blur-[3px] opacity-50 pointer-events-none select-none" : "min-w-[480px] flex-1 relative h-full"}`}
          style={insightMode && graphWidth ? { width: graphWidth } : undefined}
        >
          <div className="flex h-full flex-col gap-3 overflow-y-auto cap-noscrollbar">
          <>
          {/* ── 연도 슬라이더 + 시대 네비 + 되돌리기 ── */}
          <section className="rounded-lg border border-border bg-card/40 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <motion.button
                type="button"
                onClick={() => void doUndo()}
                disabled={!canUndo || undoBusy}
                title="되돌리기 (Ctrl+Z)"
                aria-label="되돌리기"
                whileTap={reduceMotion ? undefined : { scale: 0.94 }}
                transition={spring.snappy}
                className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="button-undo"
              >
                <Undo2 className="h-3.5 w-3.5" />
                되돌리기
              </motion.button>
              <span className="text-sm font-medium">연도</span>
              {decades.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1" data-testid="decade-nav">
                  {decades.map((d) => {
                    const isActive = d.decade === activeDecade;
                    return (
                      <motion.button
                        key={d.decade}
                        type="button"
                        whileTap={reduceMotion ? undefined : { scale: 0.92 }}
                        transition={spring.snappy}
                        onClick={() => seekToYear(d.firstFrac)}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
                          isActive
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border/70 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        }`}
                        data-testid={`decade-${d.decade}`}
                      >
                        {d.label}
                      </motion.button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* 현재값 라벨 — 핸들(현재 지점) 바로 위에 따라감 */}
            <div className="relative h-5">
              {(() => {
                const pct = toY > fromY ? ((playYear - fromY) / (toY - fromY)) * 100 : 0;
                const clamped = Math.min(94, Math.max(6, pct));
                return (
                  <div
                    className="absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground shadow"
                    style={{ left: `${clamped}%`, bottom: 0 }}
                    data-testid="text-playyear"
                  >
                    {fracYearToLabel(playYear)}
                  </div>
                );
              })()}
            </div>
            <input
              type="range"
              min={fromY}
              max={toY}
              step={1 / 12}
              value={playYear}
              onChange={(e) => seekToYear(Number(e.target.value))}
              className="w-full accent-primary"
              data-testid="slider-year"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>{fromY}</span><span>{toY}</span>
            </div>
          </section>

          {/* ── Y축 범위 모드 토글 — 전체 범위 고정 vs 시점 따라 유동 ── */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-muted-foreground">그래프</span>
            <div
              className="inline-flex items-center rounded-md border border-border bg-card/40 p-0.5"
              role="group"
              aria-label="Y축 범위 모드"
              data-testid="ymode-toggle"
            >
              {([
                { v: "full" as const, label: "전체 범위", title: "Y축을 전체 데이터 범위로 고정(시점 이동해도 불변)" },
                { v: "window" as const, label: "시점 맞춤", title: "현재 보이는 구간에 맞춰 Y축을 유동 조절" },
              ]).map((opt) => {
                const active = yMode === opt.v;
                return (
                  <motion.button
                    key={opt.v}
                    type="button"
                    onClick={() => setYMode(opt.v)}
                    title={opt.title}
                    whileTap={reduceMotion ? undefined : { scale: 0.94 }}
                    transition={spring.snappy}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`ymode-${opt.v}`}
                  >
                    {opt.label}
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* ── 그래프 스택 — 4개 이하면 1열(넓게), 5개 이상이면 2열. 시점(playYear) 동기화 유지 ── */}
          {/* 1↔2열 전환 시 각 패널이 iOS 스프링으로 제자리를 찾아가고(layout), 추가/제거 시 fade+rise로 등장/퇴장. */}
          <LayoutGroup>
            <section className={`grid gap-3 ${onPanels.length >= 5 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>
              {onPanels.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  표시할 지표를 아래에서 선택하세요.
                </div>
              ) : (
                <AnimatePresence mode="popLayout" initial={false}>
                  {onPanels.map((p) => (
                    <motion.div
                      key={p.id}
                      layout
                      transition={panelSpring}
                      initial={reduceMotion ? false : fadeRise.initial}
                      animate={fadeRise.animate}
                      exit={reduceMotion ? undefined : fadeRise.exit}
                    >
                      <CapChartPanel
                        panel={p}
                        series={SERIES[p.series]}
                        fromYear={viewFrom}
                        toYear={viewTo}
                        playYear={playYear}
                        band={activeBand}
                        yMode={yMode}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </section>
          </LayoutGroup>

          {/* ── 체크박스 (카테고리별) ── */}
          <section className="rounded-lg border border-border bg-card/40 p-3">
            <div className="flex flex-col gap-3">
              {Object.entries(CATEGORIES).map(([catKey, cat]) => (
                <div key={catKey} className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold" style={{ color: cat.color }}>{cat.label}</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {PANELS.filter((p) => p.cat === catKey).map((p) => {
                      // 슬라이더 현재 시점에 아직 데이터가 없는 지표는 흐리게 표시(회색 + 도트 투명도 저하).
                      const noData = playYear < (PANEL_START_FRAC[p.id] ?? -Infinity);
                      const startYear = Math.floor(PANEL_START_FRAC[p.id] ?? 0);
                      return (
                        <label
                          key={p.id}
                          className={`flex items-center gap-1.5 text-[12px] cursor-pointer transition-colors ${
                            noData ? "text-muted-foreground/50" : ""
                          }`}
                          data-testid={`toggle-${p.id}`}
                          title={noData ? `${startYear}년부터 데이터 제공` : undefined}
                        >
                          <Checkbox
                            checked={enabled[p.id]}
                            onCheckedChange={(v) => setEnabled((prev) => ({ ...prev, [p.id]: !!v }))}
                          />
                          <span
                            className="h-2 w-2 rounded-sm transition-opacity"
                            style={{ background: p.color, opacity: noData ? 0.35 : 1 }}
                          />
                          {p.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          </>
          </div>
        </aside>

        {/* 인사이트 모드 종료 — 별 재클릭 외에 버튼으로도 그래프 복귀 */}
        {insightMode ? (
          <button
            type="button"
            onClick={exitInsightMode}
            className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-primary/50 hover:text-foreground"
            title="그래프로 돌아가기"
            data-testid="insight-exit"
          >
            <X className="h-3.5 w-3.5" /> 그래프
          </button>
        ) : null}
      </div>
      )}
    </div>
  );
}

// 연도 그룹 사이의 가로로 얇은 호버 존 — 호버 시 + 버튼 등장, 클릭하면 그 위치 연도에 새 사건 삽입.
// 세로 타임라인용: 그룹 사이에 가로로 눌히는 얇은 행.
function InsertZone({ onInsert, disabled, label, testid }: { onInsert: () => void; disabled?: boolean; label: string; testid: string }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="relative pl-12 pr-2 transition-all"
      style={{ height: hover ? 44 : 14 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={`insertzone-${testid}`}
    >
      {/* 호버 시 가로 구분선 + 추가 버튼 */}
      {hover ? (
        <button
          type="button"
          onClick={onInsert}
          disabled={disabled}
          title={label}
          aria-label={label}
          className="group flex h-full w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          data-testid={`button-insert-${testid}`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-current">
            <Plus className="h-4 w-4" />
          </span>
          <span className="text-[11px] font-medium">{label}</span>
        </button>
      ) : (
        <div className="mx-auto my-auto h-px w-3/5 bg-transparent transition-colors hover:bg-primary/30" />
      )}
    </div>
  );
}
