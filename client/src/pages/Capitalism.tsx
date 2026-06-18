// 자본주의 경제사 타임라인 — 상단 인과 플로우(연도 그룹) + 하단 FRED 그래프 스택.
// 연도가 대분류, 그 안의 사건들이 소분류로 묶인다. 슬라이더로 연도 스크럽.
// 편집은 전부 인라인(팝업 없음): 카드 클릭→텍스트 편집, 호버 +버튼→칸 추가, X→칸 삭제.
import { useMemo, useState, useRef, useEffect, useCallback, Fragment } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Undo2 } from "lucide-react";
import { FlowColumn, type MutateNodes, type MutateMeta, type LinkNodes } from "@/components/CapFlow";
import { CapLinkOverlay } from "@/components/CapLinkOverlay";
import { CapChartPanel } from "@/components/CapChartPanel";
import { PANELS, CATEGORIES, toFracYear, fracYearToLabel, leadersForYear } from "@/lib/capitalism-config";
import { persistNodes, toInput, newNodeKey } from "@/lib/capitalism-flowops";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { applyUndo, makeFlowEntry, makeLinksEntry, type UndoEntry } from "@/lib/capitalism-undo";
import type { FlowDTO, FlowNodeDTO, FlowInputDTO, LinkDTO } from "@/lib/capitalism-types";
import seriesData from "@/data/capitalism-series.json";

type SeriesMap = Record<string, [string, number][]>;
const SERIES = seriesData as unknown as SeriesMap;

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

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PANELS.map((p) => [p.id, p.on]))
  );
  const [playYear, setPlayYear] = useState(1973.8);
  // 어느 노드가 인라인 편집 중인지 — 전역으로 1개만.
  const [editingId, setEditingId] = useState<string | null>(null);
  // 세로 타임라인 스크롤 컨테이너 ref — 스크롤 위치 ↔ playYear 동기화 + 화살표 오버레이 기준.
  const boardRef = useRef<HTMLDivElement | null>(null);
  // 프로그램이 스크롤을 움직이는 동안엔 스크롤→playYear 역동기화를 잠가 피드백 루프를 막는다.
  const programScrollRef = useRef(false);
  const programScrollTimer = useRef<number | null>(null);
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

  const [fromY, toY] = useMemo(() => {
    if (!flows || flows.length === 0) return [YEAR_MIN, YEAR_MAX];
    const years = flows.map((f) => toFracYear(f.date));
    return [Math.floor(Math.min(...years, YEAR_MIN)), Math.ceil(Math.max(...years, YEAR_MAX))];
  }, [flows]);

  // 그래프 X축은 현재 위치(playYear) 기준 ±HALF_WINDOW 년의 이동 창.
  // playYear가 연속값이라 창도 연속으로 미끄러져 부드럽게 스크롤된다.
  // 데이터 전체 경계(fromY~toY) 안에서 창 폭(10년)을 유지하도록 양끝에서 밀어준다.
  const HALF_WINDOW = 5;
  const [viewFrom, viewTo] = useMemo(() => {
    const span = HALF_WINDOW * 2;
    // 전체 데이터가 창보다 좁으면 그냥 전체를 보여준다.
    if (toY - fromY <= span) return [fromY, toY];
    let lo = playYear - HALF_WINDOW;
    let hi = playYear + HALF_WINDOW;
    if (lo < fromY) { lo = fromY; hi = fromY + span; }
    if (hi > toY) { hi = toY; lo = toY - span; }
    return [lo, hi];
  }, [playYear, fromY, toY]);

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

  // 내부 링크 클릭 → 대상 카드 시점으로 이동(스크롤 + playYear).
  const jumpToSlug = useCallback((slug: string) => {
    const f = flows?.find((x) => x.slug === slug);
    if (!f) return; // 삭제되었거나 아직 없는 카드면 무시
    seekToYear(toFracYear(f.date));
  }, [flows, seekToYear]);

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

  const onPanels = PANELS.filter((p) => enabled[p.id]);

  // 노드 배열 통째 저장(빈 칸 정리, 전부 비면 플로우 삭제). 낙관적 캐시 갱신.
  const mutate = useMutation({
    mutationFn: ({ flow, nodes }: { flow: FlowDTO; nodes: FlowNodeDTO[] }) =>
      persistNodes(flow, nodes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] }),
  });

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
      const clean = nextNodes.filter((n) => n.text.trim());
      if (clean.length === 0) return prev.filter((f) => f.slug !== flow.slug);
      return prev.map((f) => (f.slug === flow.slug ? { ...f, nodes: clean } : f));
    });
    mutate.mutate({ flow, nodes: nextNodes });
  };

  // 카드 메타(날짜/제목/레이아웃) 변경 — year 자동 재산출, 날짜순 재정렬, 서버 upsert 저장.
  // 날짜를 바꾸면 그룹/슬라이더 범위가 자동으로 갱신되어 다른 연도로 카드가 이동한다.
  const onMutateMeta: MutateMeta = (flow, patch) => {
    const nextDate = patch.date ?? flow.date;
    const nextYear = patch.date ? Number(patch.date.slice(0, 4)) : flow.year;
    // endDate: patch에 키가 있으면(설정/해제) 그 값을, 없으면 기존값 유지.
    const nextEndDate = "endDate" in patch ? (patch.endDate ?? null) : (flow.endDate ?? null);
    const merged: FlowDTO = {
      ...flow,
      date: nextDate,
      endDate: nextEndDate,
      year: nextYear,
      title: patch.title ?? flow.title,
      layout: patch.layout ?? flow.layout,
    };
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) => {
      if (!prev) return prev;
      const updated = prev.map((f) => (f.slug === flow.slug ? merged : f));
      return [...updated].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sortOrder - b.sortOrder));
    });
    const cleanNodes = merged.nodes.filter((n) => n.text.trim());
    apiRequest("POST", "/api/capitalism/flows", toInput(merged, cleanNodes.length ? cleanNodes : merged.nodes))
      .then(() => qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] }))
      .catch(() => qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] }));
  };

  // 새 사건(플로우) 추가 — 팝업 없이 기본값으로 생성하고 첫 칸을 편집 모드로.
  const addFlow = useMutation({
    mutationFn: async () => {
      const date = fracYearToDate(playYear);
      const slug = `flow-${Date.now().toString(36)}`;
      // 신규 생성이므로 prev=null → Undo 는 이 카드 삭제가 된다.
      pushUndo(makeFlowEntry("사건 추가", slug, flows));
      const firstKey = newNodeKey();
      const payload: FlowInputDTO = {
        slug,
        title: "새 사건",
        date,
        year: Number(date.slice(0, 4)),
        category: "경제",
        layout: "stack",
        nodes: [{ nodeKey: firstKey, kind: "effect", inLabel: null, text: "새 사건", ref: null, col: null }],
        edges: [],
      };
      await apiRequest("POST", "/api/capitalism/flows", payload);
      return { slug, firstKey };
    },
    onSuccess: async ({ firstKey }) => {
      await qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] });
      setEditingId(firstKey);
    },
  });

  // 중간 삽입: 두 연도 그룹 사이(또는 맨 앞/뒤)에 새 사건 생성. 대상 연도(targetYear)를 받아 그 년도로 생성.
  const addFlowAt = useMutation({
    mutationFn: async (targetYear: number) => {
      const date = `${targetYear}-01-01`;
      const slug = `flow-${Date.now().toString(36)}`;
      // 신규 생성 → Undo 는 삭제.
      pushUndo(makeFlowEntry("사건 추가", slug, flows));
      const firstKey = newNodeKey();
      const payload: FlowInputDTO = {
        slug, title: "새 사건", date, year: targetYear,
        category: "경제", layout: "stack",
        nodes: [{ nodeKey: firstKey, kind: "effect", inLabel: null, text: "새 사건", ref: null, col: null }],
        edges: [],
      };
      await apiRequest("POST", "/api/capitalism/flows", payload);
      return { firstKey, targetYear };
    },
    onSuccess: async ({ firstKey, targetYear }) => {
      await qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] });
      setEditingId(firstKey);
      // 새 그룹 DOM 이 렌더된 뒤 해당 연도로 스크롤.
      window.setTimeout(() => seekToYear(targetYear), 80);
    },
  });

  // 드래그앤드롭 화살표 연결 — 낙관적 캐시 추가 후 서버 저장.
  const onLink: LinkNodes = (from, to) => {
    // 화살표 추가 직전의 전체 링크 스냅샷을 쌓아둔다.
    pushUndo(makeLinksEntry("화살표 추가", links));
    qc.setQueryData<LinkDTO[]>(["/api/capitalism/links"], (prev) => {
      const list = prev ?? [];
      // 이미 있으면 그대로.
      if (list.some((l) => l.fromSlug === from.slug && l.fromKey === from.key && l.toSlug === to.slug && l.toKey === to.key)) return list;
      // 역방향은 제거(방향 전환).
      const filtered = list.filter((l) => !(l.fromSlug === to.slug && l.fromKey === to.key && l.toSlug === from.slug && l.toKey === from.key));
      return [...filtered, { id: -Date.now(), fromSlug: from.slug, fromKey: from.key, toSlug: to.slug, toKey: to.key }];
    });
    apiRequest("POST", "/api/capitalism/links", {
      fromSlug: from.slug, fromKey: from.key, toSlug: to.slug, toKey: to.key,
    })
      .then(() => qc.invalidateQueries({ queryKey: ["/api/capitalism/links"] }))
      .catch(() => qc.invalidateQueries({ queryKey: ["/api/capitalism/links"] }));
  };

  // 화살표 삭제(오버레이에서 클릭).
  const onDeleteLink = (id: number) => {
    // 삭제 직전 스냅샷 → Undo 는 복원.
    pushUndo(makeLinksEntry("화살표 삭제", links));
    qc.setQueryData<LinkDTO[]>(["/api/capitalism/links"], (prev) => (prev ? prev.filter((l) => l.id !== id) : prev));
    if (id < 0) return; // 낙관적 임시 id 는 서버 호출 불필요
    apiRequest("DELETE", `/api/capitalism/links/${id}`)
      .then(() => qc.invalidateQueries({ queryKey: ["/api/capitalism/links"] }))
      .catch(() => qc.invalidateQueries({ queryKey: ["/api/capitalism/links"] }));
  };

  return (
    <div className="p-4 max-w-[1600px] mx-auto">
      {/* ── 세로 2단 레이아웃: 좌측 세로 타임라인(위=과거→아래=미래) + 우측 sticky 그래프 패널 ── */}
      <div className="flex gap-5 items-start">
        {/* ════════ 좌측: 세로 타임라인 (스크롤 = 시간 이동) ════════ */}
        <section className="min-w-0 flex-1">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
            </div>
          ) : (
            <div
              ref={boardRef}
              className="cap-noscrollbar relative overflow-y-auto overflow-x-hidden pr-1"
              style={{ height: "calc(100vh - 110px)" }}
            >
              {/* 세로 중심 레일 — 위에서 아래로 시간 흐름 */}
              <div className="absolute left-[18px] top-2 bottom-2 w-[2px] bg-border" aria-hidden />

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
                  {/* 연도 그룹 — data-group-year 로 스크롤 동기화 기준 제공 */}
                  <div className="relative pl-12 pr-2" data-group-year={g.year}>
                    {/* 세로 레일 위의 연도 노드(원) */}
                    <span
                      className={`absolute left-[12px] top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full ring-4 transition-all ${
                        Math.floor(playYear) === g.year
                          ? "bg-primary ring-primary/25"
                          : "bg-muted-foreground/40 ring-background"
                      }`}
                      aria-hidden
                    />

                    {/* 연도 대분류 헤더 — 연도 · 건수 · 당시 대통령/연준 의장 */}
                    <div className="flex items-baseline gap-2 mb-2">
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
                        return (
                          <div key={f.slug} className="flex flex-col">
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
                              onSelect={(ff) => seekToYear(toFracYear(ff.date))}
                              onMutateNodes={onMutateNodes}
                              onAddLocal={onAddLocal}
                              onMutateMeta={onMutateMeta}
                              onLink={onLink}
                              editingId={editingId}
                              setEditingId={setEditingId}
                              editable
                              linkTargets={linkTargets}
                              onJump={jumpToSlug}
                            />
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

        {/* ════════ 우측: sticky 패널 (슬라이더 + 연대 네비 + 그래프 스택 + 체크박스) ════════ */}
        <aside
          className="w-[480px] shrink-0 sticky top-4 flex flex-col gap-3 overflow-y-auto cap-noscrollbar"
          style={{ maxHeight: "calc(100vh - 32px)" }}
        >
          {/* ── 연도 슬라이더 + 시대 네비 + 되돌리기 ── */}
          <section className="rounded-lg border border-border bg-card/40 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void doUndo()}
                disabled={!canUndo || undoBusy}
                title="되돌리기 (Ctrl+Z)"
                aria-label="되돌리기"
                className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="button-undo"
              >
                <Undo2 className="h-3.5 w-3.5" />
                되돌리기
              </button>
              <span className="text-sm font-medium">연도</span>
              {decades.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1" data-testid="decade-nav">
                  {decades.map((d) => {
                    const isActive = d.decade === activeDecade;
                    return (
                      <button
                        key={d.decade}
                        type="button"
                        onClick={() => seekToYear(d.firstFrac)}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
                          isActive
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border/70 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        }`}
                        data-testid={`decade-${d.decade}`}
                      >
                        {d.label}
                      </button>
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

          {/* ── 그래프 스택 — 세로로 적층, 시점(playYear) 동기화 유지 ── */}
          <section className="grid grid-cols-1 gap-3">
            {onPanels.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                표시할 지표를 아래에서 선택하세요.
              </div>
            ) : (
              onPanels.map((p) => (
                <CapChartPanel
                  key={p.id}
                  panel={p}
                  series={SERIES[p.series]}
                  fromYear={viewFrom}
                  toYear={viewTo}
                  playYear={playYear}
                  band={activeBand}
                />
              ))
            )}
          </section>

          {/* ── 체크박스 (카테고리별) ── */}
          <section className="rounded-lg border border-border bg-card/40 p-3">
            <div className="flex flex-col gap-3">
              {Object.entries(CATEGORIES).map(([catKey, cat]) => (
                <div key={catKey} className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold" style={{ color: cat.color }}>{cat.label}</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {PANELS.filter((p) => p.cat === catKey).map((p) => (
                      <label key={p.id} className="flex items-center gap-1.5 text-[12px] cursor-pointer" data-testid={`toggle-${p.id}`}>
                        <Checkbox
                          checked={enabled[p.id]}
                          onCheckedChange={(v) => setEnabled((prev) => ({ ...prev, [p.id]: !!v }))}
                        />
                        <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
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
