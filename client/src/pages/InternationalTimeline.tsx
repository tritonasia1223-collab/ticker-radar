import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { TimelineHoverGuide } from "@/components/TimelineHoverGuide";
import { TimelineDisclosure } from "@/components/TimelineDisclosure";
import { CapitalismTabs } from "@/components/CapitalismTabs";
import { captureGrid, springGrid, springScroll } from "@/lib/glass-spring/spring.js";
import { Plus, Download, FileText, ArrowUp, MoreHorizontal, Trash2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseTimelineDate, withTimelineDate } from "@/lib/international-timeline-date";
import { readTimelineDraft, deleteTimelineEvent, restoreTimelineEvent, type TimelineDraft } from "@/lib/international-timeline-draft";
import { CapRichEditor } from "@/components/CapRichEditor";
import { CapRichText } from "@/components/CapRichText";
import { TimelinePeriodContext, usePeriodInteraction, useTimelinePeriod } from "@/components/TimelinePeriodIndicator";
import { periodEnd, periodDateLabel } from "@/lib/international-timeline-period";
import { useEditMode } from "@/components/EditModeProvider";
import { useTheme } from "@/components/ThemeProvider";
import { REGIONS, type Region, type TimelineEvent, type TimelineLane } from "@/data/international-timeline";
import { COUNTRY_LANES, eventLanes, eventLaneSpan } from "@/lib/international-timeline-lanes";
import { mergeInsightTimeline } from "@/lib/international-timeline-insights";
import { mergeClassifiedTimeline, CLASSIFIED_BACKUP, CLASSIFIED_REVISION } from "@/lib/international-timeline-classified";
import { mergeSupplementTimeline, SUPPLEMENT_BACKUP, SUPPLEMENT_REVISION } from "@/lib/international-timeline-supplement";
import classifiedSourceText from "@/data/international-timeline-classified-source.txt?raw";
import { searchTimeline } from "@/lib/international-timeline-search";
import insightSourceText from "@/data/international-timeline-insights.txt?raw";
import { rangeLabel, documentTimeline, descriptionView, bandText } from "@/lib/international-timeline";
import { plainText } from "@/lib/capitalism-richtext";
import usSourceText from "@/data/international-timeline-us-source.txt?raw";
import sourceText from "@/data/international-timeline-mark-revision.txt?raw";
import "./InternationalTimeline.css";

const STORAGE = "fiscus-international-timeline-v1";
const BACKUP = "fiscus-international-timeline-before-five-countries-20261118";
function countryColor(country: string, region: Region = "europe") {
  if (/서독|독일/.test(country)) return "de";
  if (country === "영국") return "uk";
  if (country === "프랑스") return "fr";
  return ({ us: "us", europe: "eu", japan: "jp", emerging: "emerging", oil: "oil" })[region];
}
const ink = (color: string) => ({ "--it-event": `var(--it-${color})` }) as CSSProperties;
function readDraft(): { draft: TimelineDraft; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE);
    const draft = readTimelineDraft(raw);
    // Back up the exact saved text before applying the user's priority import.
    // If the backup cannot be written, the catch locks saving and keeps the original intact.
    if (raw && !draft.imports?.includes(CLASSIFIED_REVISION) && !localStorage.getItem(CLASSIFIED_BACKUP)) localStorage.setItem(CLASSIFIED_BACKUP, raw);
    if (raw && !draft.imports?.includes(SUPPLEMENT_REVISION) && !localStorage.getItem(SUPPLEMENT_BACKUP)) localStorage.setItem(SUPPLEMENT_BACKUP, raw);
    return { draft: mergeSupplementTimeline(mergeClassifiedTimeline(mergeInsightTimeline(draft))), error: "" };
  }
  catch { return { draft: readTimelineDraft(null), error: "기존 로컬 초안을 읽지 못했습니다. 원본을 보존하기 위해 저장을 잠갔습니다." }; }
}

function EventMenu({ event, labels, remove, changeDate, patch }: { event: TimelineEvent; labels: (next: string[]) => void; remove: () => void; changeDate: (date: NonNullable<ReturnType<typeof parseTimelineDate>>) => void; patch: (body: string) => void }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [dateText, setDateText] = useState("");
  const [dateError, setDateError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = event.labels ?? [];
  const band = bandText(event);
  const choices = event.region === "europe" ? ["독일", "영국", "프랑스"] : [REGIONS.find(r => r.id === event.region)!.name];
  return <Popover open={open} onOpenChange={next => { if (next) { setDateText(event.date || `${event.year}${event.month ? `.${event.month}` : ""}`); setDateError(""); } setOpen(next); }}>
    <PopoverTrigger asChild><button className="it-event-menu" aria-label={`${event.id} 사건 메뉴`} title="날짜 · 라벨 · 삭제"><MoreHorizontal size={16} /></button></PopoverTrigger>
    <PopoverContent ref={menuRef} data-theme={theme} align="end" className="it-editor-portal w-64 p-3" onOpenAutoFocus={e => { if (event.scope === "global") { e.preventDefault(); requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>("[data-richeditor]")?.focus()); } }}>
      {event.scope === "global" && <div className="it-band-title-edit mb-3"><p className="mb-1 text-xs text-muted-foreground">제목</p><CapRichEditor spellCheck={false} align="left" rows={1} ariaLabel="대사건 제목" value={band.title} placeholder="제목 입력" onChange={title => patch(band.prefix + title + (band.details ? `\n${band.details}` : ""))} /></div>}
      <form className="mb-3 border-b pb-3" onSubmit={e => { e.preventDefault(); const parsed = parseTimelineDate(dateText); if (!parsed) { setDateError("유효한 날짜나 기간을 입력해 주세요."); return; } changeDate(parsed); setOpen(false); }}>
        <label htmlFor={`date-${event.id}`} className="mb-1 block text-xs text-muted-foreground">날짜</label>
        <div className="flex gap-1.5"><input id={`date-${event.id}`} type="text" spellCheck={false} className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs" value={dateText} onChange={e => { setDateText(e.target.value); setDateError(""); }} aria-invalid={!!dateError} aria-describedby={`date-hint-${event.id}`} /><button type="submit" className="rounded border px-2 text-xs">적용</button></div>
        <p id={`date-hint-${event.id}`} className="mt-1 text-[10px] leading-relaxed text-muted-foreground">1971 · 1971.8 · 1971.8.15<br />기간: 1981.7~82.11</p>
        {dateError && <p role="alert" className="mt-1 text-xs text-destructive">{dateError}</p>}
      </form>
      {event.scope !== "global" && <div className="mb-3">
        <p className="mb-2 text-xs text-muted-foreground">국가 라벨 · 눌러서 켜기/끄기</p>
        <div className="flex flex-wrap gap-1.5">{[...new Set([...choices, ...selected])].map(tag => <button key={tag} type="button" aria-pressed={selected.includes(tag)} onClick={() => labels(selected.includes(tag) ? selected.filter(t => t !== tag) : [...selected, tag])} className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${selected.includes(tag) ? "bg-accent font-semibold" : "text-muted-foreground"}`}>
          {selected.includes(tag) && <Check size={12} />}{tag}
        </button>)}</div>
      </div>}
      <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10" onClick={() => { setOpen(false); remove(); }}><Trash2 size={13} />사건 삭제</button>
    </PopoverContent>
  </Popover>;
}


function TimelineEntry({ event, editable, patch, labels, remove, changeDate, global = false }: {
  event: TimelineEvent; editable: boolean; global?: boolean; patch: (body: string) => void; labels: (next: string[]) => void; remove: () => void; changeDate: (date: NonNullable<ReturnType<typeof parseTimelineDate>>) => void;
}) {
  const view = descriptionView(event);
  const tags = event.labels ?? [];
  const band = bandText(event);
  const editorText = global ? band.details : view.text;
  const { mobile, tapped, setTapped } = usePeriodInteraction();
  const period = !global && periodEnd(event);
  const expanded = tapped === event.id;
  const mobileCollapsed = !!period && mobile && !expanded;
  const togglePeriod = () => setTapped(current => current === event.id ? null : event.id);
  const descriptionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = descriptionRef.current?.querySelector<HTMLElement>("[data-richeditor]");
    if (!editor) return;
    const sync = () => { editor.dataset.titleRoot = String(!!editor.firstChild && !(editor.firstChild instanceof HTMLElement && ["DIV", "P"].includes(editor.firstChild.tagName))); };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(editor, { childList: true });
    return () => observer.disconnect();
  }, [editable, mobileCollapsed]);
  const labelRef = useRef<HTMLDivElement>(null);
  const [labelWidth, setLabelWidth] = useState(0);
  useEffect(() => {
    if (!labelRef.current) return;
    const observer = new ResizeObserver(([entry]) => setLabelWidth(entry.contentRect.width));
    observer.observe(labelRef.current);
    return () => observer.disconnect();
  }, []);
  return <article data-event-id={event.id} data-period-event={period ? event.id : undefined} className={`it-event ${global ? "it-global-event" : ""} ${editable && !global ? "it-event-editable" : ""}`} style={{ ...ink(countryColor(event.country, event.region)), "--it-label-width": `${labelWidth ? labelWidth + 8 : 0}px` } as CSSProperties}
    onClick={e => { if (period && mobile && !(e.target as HTMLElement).closest("button, input, [contenteditable]")) togglePeriod(); }}>
    {editable && !global && <EventMenu event={event} labels={labels} remove={remove} changeDate={changeDate} patch={patch} />}
    {period && <button type="button" className="it-period-date" aria-label={`${periodDateLabel(event)} 기간 범위${mobile ? expanded ? " 접기" : " 펼치기" : ""}`} aria-expanded={mobile ? expanded : undefined} aria-controls={mobile ? `period-body-${event.id}` : undefined}
      onClick={e => { e.stopPropagation(); if (mobile) togglePeriod(); }}>{periodDateLabel(event)}</button>}
    <div ref={labelRef} className="it-event-meta">
      {!global && <span className="it-mobile-region">{REGIONS.find(r => r.id === event.region)?.name}</span>}
      {!global && tags.map(tag => <span key={tag} data-country-label className="it-tag" style={ink(countryColor(tag, event.region))}>{tag}</span>)}
    </div>
    <div ref={descriptionRef} id={period ? `period-body-${event.id}` : undefined} className="it-description">
      {mobileCollapsed ? <CapRichText text={band.title} className="it-read-description" /> : editable ? <CapRichEditor inline spellCheck={false} align="left" rows={1} ariaLabel={`${event.id} 설명`} value={editorText} onChange={body => patch(global ? band.prefix + band.title + (body ? `\n${body}` : "") : view.prefix + body)} onBlur={body => patch(global ? band.prefix + band.title + (body ? `\n${body}` : "") : view.prefix + body)} placeholder={global ? "설명 입력" : "제목 입력"} />
        : <CapRichText text={editorText} className="it-read-description" />}
    </div>
  </article>;
}

export default function InternationalTimeline() {
  const [initial] = useState(readDraft);
  const [draft, setDraft] = useState(initial.draft);
  const events = draft.events;
  const latestDraft = useRef(draft);
  const [showDeleted, setShowDeleted] = useState(false);
  const [lastDeletedId, setLastDeletedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(84);
  const [currentYear, setCurrentYear] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState(64);
  const [saveError, setSaveError] = useState("");
  const [regions, setRegions] = useState<TimelineLane[]>(["us", "de", "fr", "uk", "jp"]);
  const gridBefore = useRef<ReturnType<typeof captureGrid> | null>(null);
  const gridMotion = useRef<ReturnType<typeof springGrid> | null>(null);
  const scrollMotion = useRef<ReturnType<typeof springScroll> | null>(null);
  function toggleRegion(lane: TimelineLane) {
    if (headRef.current) gridBefore.current = captureGrid(headRef.current, "[data-region-heading]");
    setRegions(current => current.includes(lane) ? current.filter(id => id !== lane) : [...current, lane]);
  }
  useLayoutEffect(() => {
    if (headRef.current && gridBefore.current) {
      gridMotion.current = springGrid(headRef.current, gridBefore.current, { selector: "[data-region-heading]" });
      gridBefore.current = null;
    }
  }, [regions]);
  useEffect(() => () => { gridMotion.current?.cancel(); scrollMotion.current?.cancel(); }, []);
  function scrollToPosition(top: number) {
    if (scrollRef.current) scrollMotion.current = springScroll(scrollRef.current, top);
  }
  function scrollToEntry(entry: HTMLElement, center = false) {
    const root = scrollRef.current;
    if (!root) return;
    const offset = center ? Math.max(headerHeight, (root.clientHeight - entry.offsetHeight) / 2) : headerHeight;
    scrollToPosition(entry.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - offset);
  }
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [openBands, setOpenBands] = useState<Set<string>>(() => new Set());
  const { editable } = useEditMode();
  const { theme } = useTheme();
  const canEdit = editable && !initial.error;
  useEffect(() => { const old = document.title; document.title = "국제 연표 — 피스쿠스"; return () => { document.title = old; }; }, []);
  useEffect(() => {
    if (!headRef.current || !toolbarRef.current) return;
    const measure = () => {
      const toolbar = toolbarRef.current?.offsetHeight ?? 0;
      setToolbarHeight(toolbar);
      setHeaderHeight(toolbar + (headRef.current?.offsetHeight ?? 0));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(headRef.current);
    observer.observe(toolbarRef.current);
    measure();
    return () => observer.disconnect();
  }, []);
  const visibleRegions = COUNTRY_LANES.filter(r => regions.includes(r.id));
  const visibleLaneIds = visibleRegions.map(r => r.id);
  const filtered = useMemo(() => searchTimeline(events, search, regions, editingId), [events, regions, search, editingId]);
  const years = useMemo(() => documentTimeline(filtered), [filtered]);
  const firstYear = years[0]?.year ?? 1969;
  const lastYear = years.at(-1)?.year ?? firstYear;
  const sliderYear = Math.max(firstYear, Math.min(lastYear, currentYear ?? firstYear));
  const sliderPercent = lastYear > firstYear ? (sliderYear - firstYear) / (lastYear - firstYear) * 100 : 0;
  // Dates have equal slider spacing; document positions follow actual section heights.
  // Measure sections again after edits, disclosures, font loading or resizing.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-year-section]"));
    let anchors: { year: number; top: number }[] = [];
    let frame = 0;
    const sync = () => {
      frame = 0;
      if (!anchors.length) return;
      const edge = root.scrollTop + headerHeight + 2;
      const active = anchors.findLast(anchor => anchor.top <= edge) ?? anchors[0];
      setCurrentYear(active.year);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const measure = () => {
      const origin = root.getBoundingClientRect().top - root.scrollTop;
      anchors = sections.map(section => ({ year: Number(section.dataset.yearSection), top: section.getBoundingClientRect().top - origin }));
      schedule();
    };
    const resize = new ResizeObserver(measure);
    sections.forEach(section => resize.observe(section));
    resize.observe(root);
    root.addEventListener("scroll", schedule, { passive: true });
    measure();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); root.removeEventListener("scroll", schedule); };
  }, [years, headerHeight]);
  function seekYear(value: number) {
    const root = scrollRef.current;
    if (!root || !years.length) return;
    const nearest = years.reduce((best, candidate) => Math.abs(candidate.year - value) < Math.abs(best.year - value) ? candidate : best);
    const entry = root.querySelector<HTMLElement>(`[data-year-section="${nearest.year}"]`);
    if (!entry) return;
    scrollMotion.current?.cancel();
    // Direct scrubbing avoids accumulated animations while dragging rapidly.
    root.scrollTo({ top: entry.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - headerHeight, behavior: "instant" });
    setCurrentYear(nearest.year);
  }
  const periodSlices = useMemo(() => years.flatMap(year => year.items), [years]);
  const periodUI = useTimelinePeriod(filtered, periodSlices, visibleLaneIds);
  function persist(next: TimelineDraft) {
    try {
      const old = localStorage.getItem(STORAGE);
      if (old && !localStorage.getItem(BACKUP)) localStorage.setItem(BACKUP, old);
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setSaveError("");
    } catch { setSaveError("로컬 저장에 실패했습니다. 입력 내용은 현재 화면에 남아 있습니다. 다시 저장하거나 내보내 주세요."); }
  }
  function updateDraft(next: TimelineDraft) {
    latestDraft.current = next;
    setDraft(next);
    persist(next);
  }
  function update(next: TimelineEvent[]) { updateDraft({ ...latestDraft.current, events: next }); }
  function setLabels(id: string, labels: string[]) {
    if (!canEdit) return;
    update(latestDraft.current.events.map(e => e.id === id ? { ...e, labels } : e));
  }
  function changeDate(id: string, date: NonNullable<ReturnType<typeof parseTimelineDate>>) {
    if (!canEdit) return;
    update(latestDraft.current.events.map(e => e.id === id ? withTimelineDate(e, date) : e));
    setSearch("");
    setEditingId(null);
    requestAnimationFrame(() => jumpToYear(date.year));
  }
  function remove(id: string) {
    if (!canEdit) return;
    updateDraft(deleteTimelineEvent(latestDraft.current, id));
    setEditingId(null);
    setLastDeletedId(id);
  }
  function restore(id: string) {
    if (!canEdit) return;
    updateDraft(restoreTimelineEvent(latestDraft.current, id));
    setLastDeletedId(null);
  }

  function patch(id: string, body: string) {
    if (!canEdit || latestDraft.current.events.find(e => e.id === id)?.body === body) return;
    update(latestDraft.current.events.map(e => e.id === id ? { ...e, body } : e));
  }
  function add(year = years[0]?.year ?? 1969, month: number | null = null, lane: TimelineLane = visibleRegions[0].id, scope: "regional" | "global" = "regional") {
    if (!canEdit) return;
    const id = crypto.randomUUID();
    const target = lane === "eu" ? { region: "europe" as const, name: "유럽 공동" } : COUNTRY_LANES.find(r => r.id === lane)!;
    if (lane === "eu" && !regions.some(id => ["de", "fr", "uk"].includes(id))) setRegions(current => [...current, "de", "fr", "uk"]);
    update([...latestDraft.current.events, { id, type: "event", year, month, date: `${year}${month ? `.${month}` : ""}`, region: target.region, lane, scope, country: target.name, title: "", body: "", descriptionOnly: true }]);
    setSearch("");
    if (scope === "global") setOpenBands(current => new Set(current).add(id));
    requestAnimationFrame(() => {
      const entry = document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`);
      if (entry) scrollToEntry(entry, true);
      if (scope === "global") scrollRef.current?.querySelector<HTMLElement>(`[data-global-marker="${CSS.escape(id)}"] .it-event-menu`)?.click();
      else entry?.querySelector<HTMLElement>("[contenteditable]")?.focus({ preventScroll: true });
    });
  }
  function exportDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(latestDraft.current, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "국제연표-로컬초안.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  useEffect(() => { if (!initial.error) persist(latestDraft.current); }, [initial]);
  function jumpToYear(year: number) {
    const entry = scrollRef.current?.querySelector<HTMLElement>(`[data-year-section="${year}"]`);
    if (entry) scrollToEntry(entry);
  }
  return <div ref={scrollRef} data-theme={theme} onFocusCapture={e => { const id = (e.target as HTMLElement).closest<HTMLElement>("[data-event-id]")?.dataset.eventId; if (id) setEditingId(id); }} className="international-document it-five-countries" data-testid="international-timeline" style={{ "--it-columns": `repeat(${visibleRegions.length}, minmax(0, 1fr))`, "--it-board-width": `${68 + visibleRegions.length * 180}px`, "--it-head-height": `${headerHeight}px`, "--it-toolbar-height": `${toolbarHeight}px` } as CSSProperties}>
    <div className="it-wrap">
      <CapitalismTabs active="international" />
      <header ref={toolbarRef} className="it-page-header">
        <div className="it-toolbar">
          <h1>국제 연표</h1>
          <div className="it-time-slider" style={{ "--it-slider-progress": `${sliderPercent}%` } as CSSProperties}>
            <div className="it-slider-caption"><output htmlFor="international-year-slider">{sliderYear}</output></div>
            <input id="international-year-slider" type="range" min={firstYear} max={lastYear} step={1} value={sliderYear}
              disabled={years.length < 2} aria-label="국제 연표 연도 이동" aria-valuetext={`${sliderYear}년`} data-testid="international-year-slider"
              onChange={e => seekYear(Number(e.target.value))}
              onKeyDown={e => {
                const direction = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
                if (!direction) return;
                e.preventDefault();
                const index = years.findIndex(year => year.year === sliderYear);
                seekYear(years[Math.max(0, Math.min(years.length - 1, index + direction))]?.year ?? sliderYear);
              }} />
            <div className="it-slider-ticks" aria-hidden="true"><span>{firstYear}</span>
              {Array.from({ length: Math.max(0, Math.floor(lastYear / 5) - Math.ceil(firstYear / 5) + 1) }, (_, i) => (Math.ceil(firstYear / 5) + i) * 5)
                .filter(year => year > firstYear + 1 && year < lastYear - 1)
                .map(year => <span key={year} style={{ left: `${(year - firstYear) / (lastYear - firstYear) * 100}%` }}>{year}</span>)}
              {lastYear !== firstYear && <span>{lastYear}</span>}</div>
          </div>
        </div>
        {(initial.error || saveError) && <p role="alert" className="text-xs text-destructive">{initial.error || saveError} {saveError && <button onClick={() => persist(latestDraft.current)}>다시 저장</button>}</p>}
      </header>
      <TimelinePeriodContext.Provider value={periodUI.interaction}>
      <div ref={periodUI.boardRef} {...periodUI.handlers} className="it-board" data-testid="timeline-board">
        <div ref={headRef} className="it-lane-head"><div className="it-gutter">연월</div>{visibleRegions.map(r => <div key={r.id} style={ink(r.color)} data-region-heading={r.id}><h2>{r.name}</h2></div>)}</div>
        {years.map(year => <section key={year.year} data-year-section={year.year} className="it-year-section">
          <div className="it-column-rules" aria-hidden="true">{visibleRegions.slice(1).map((region, index) => <span key={region.id} style={{ gridColumn: index + 3 }} />)}</div>
          <h3 data-year-heading={year.year} className="it-year-heading"><span>{year.year}</span><small>{year.count}건</small><button className="it-year-top" aria-label="연표 맨 위로" onClick={() => scrollToPosition(0)}><ArrowUp size={12} /></button></h3>
          {year.items.map(item => item.kind === "band" ? <div key={item.key} className="it-band" data-global-marker={item.events[0].id} data-period-row={item.key} data-period-event={periodEnd(item.events[0]) ? item.events[0].id : undefined}>
            <div className={`it-gutter it-band-gutter ${periodEnd(item.events[0]) ? "it-period-band-date" : ""}`} style={periodUI.gutterStyle(item.key)} title={item.events[0].date || rangeLabel(item.events[0]) || String(year.year)}><span data-month-label={item.month ? "" : undefined}>{periodEnd(item.events[0]) ? periodDateLabel(item.events[0]) : item.month ? `${String(item.month).padStart(2, "0")}월` : item.events[0].date || rangeLabel(item.events[0]) || "연간"}{!periodEnd(item.events[0]) && /^\d{4}\.\d{1,2}\.\d{1,2}$/.test(item.events[0].date) && <small className="it-band-day">{Number(item.events[0].date.split(".")[2])}일</small>}</span></div>
            <div className="it-band-content">{item.events.map(event => <div key={event.id}>
              <div className="it-band-heading"><button className="it-band-toggle" aria-expanded={openBands.has(event.id)} aria-controls={`band-${event.id}`} onClick={() => { if (periodUI.interaction.mobile && periodEnd(event)) periodUI.interaction.setTapped(openBands.has(event.id) ? null : event.id); setOpenBands(current => { const next = new Set(current); next.has(event.id) ? next.delete(event.id) : next.add(event.id); return next; }); }}>
                <span className="it-band-title">{plainText(bandText(event).title) || "새 대사건"}</span>
              </button>{canEdit && <EventMenu event={event} labels={next => setLabels(event.id, next)} remove={() => remove(event.id)} changeDate={date => changeDate(event.id, date)} patch={body => patch(event.id, body)} />}</div>
              <TimelineDisclosure open={openBands.has(event.id)} id={`band-${event.id}`}><TimelineEntry event={event} global editable={canEdit} patch={body => patch(event.id, body)} labels={next => setLabels(event.id, next)} remove={() => remove(event.id)} changeDate={date => changeDate(event.id, date)} /></TimelineDisclosure>
            </div>)}</div>
          </div> : <div key={item.key} className={`it-slice ${item.month === null && !item.period ? "it-annual-slice" : ""}`} data-date-key={item.key} data-period-row={item.key} style={{ "--it-annual-detail-row": item.events.filter(e => eventLanes(e).length > 1 && eventLaneSpan(e, visibleLaneIds)).length + 1 } as CSSProperties}>
            <div className="it-gutter" style={periodUI.gutterStyle(item.key)} title={item.month ? `${year.year}.${item.month}` : item.period ?? "월이 특정되지 않은 자료"}><span data-month-label={item.month ? "" : undefined}>{item.month ? `${String(item.month).padStart(2, "0")}월` : item.period ?? ""}</span>{canEdit && <button className="it-shared-add" aria-label={`${year.year}.${item.month ?? "연간"} 유럽 공동 사건 추가`} title="이 시점에 유럽 공동 사건 추가" onClick={() => add(year.year, item.month, "eu")}><Plus size={11} />공동</button>}</div>
            {visibleRegions.map((region, regionIndex) => <div key={region.id} data-region={region.id}
              className={`it-cell ${item.month === null && !item.period && item.events.some(e => eventLanes(e).length === 1 && eventLanes(e).includes(region.id)) ? "it-annual-card" : ""}`}
              style={item.month === null && !item.period ? { gridColumn: regionIndex + 2, gridRow: region.region === "europe" ? "var(--it-annual-detail-row)" : 1 } : undefined}>
              {item.month === null && !item.period && item.events.some(e => eventLanes(e).length === 1 && eventLanes(e).includes(region.id)) && <span className="it-shared-label it-annual-label">연간</span>}
              {item.events.filter(e => eventLanes(e).length === 1 && eventLanes(e).includes(region.id)).map(event => <TimelineEntry key={event.id} event={event} editable={canEdit} patch={body => patch(event.id, body)} labels={next => setLabels(event.id, next)} remove={() => remove(event.id)} changeDate={date => changeDate(event.id, date)} />)}
              {canEdit && <button className="it-cell-add" aria-label={`${year.year}.${item.month ?? "연간"} ${region.name} 사건 추가`} onClick={() => add(year.year, item.month, region.id)}><Plus size={12} /></button>}
            </div>)}
            {item.events.filter(e => eventLanes(e).length > 1 && eventLaneSpan(e, visibleLaneIds)).map((event, sharedIndex) => {
              const span = eventLaneSpan(event, visibleLaneIds);
              return span && <div key={event.id} className={`it-europe-shared ${item.month === null && !item.period ? "it-annual-shared" : ""}`} data-shared-event={event.id} style={{ gridColumn: `${span.start} / span ${span.span}`, gridRow: item.month === null && !item.period ? sharedIndex + 1 : undefined }}><span className="it-shared-label">{item.month === null && !item.period ? "연간 · 유럽 공동" : "유럽 공동"}</span><TimelineEntry event={event} editable={canEdit} patch={body => patch(event.id, body)} labels={next => setLabels(event.id, next)} remove={() => remove(event.id)} changeDate={date => changeDate(event.id, date)} /></div>;
            })}
          </div>)}
        </section>)}
        {!years.length && <p className="it-empty">아직 등록된 사건이 없습니다.</p>}
        {periodUI.overlay}
        <TimelineHoverGuide boardRef={periodUI.boardRef} />
      </div>
      </TimelinePeriodContext.Provider>
      <footer className="it-note">
        <span>설명을 클릭해 바로 편집 · 글을 선택해 색과 하이라이트 적용 · 브라우저에 자동 저장</span>
        <div className="it-actions">
          <input className="it-year-jump" type="number" aria-label="연도로 이동" placeholder="연도 이동" min={1800} max={2100} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} onBlur={e => jumpToYear(Number(e.target.value))} />
          {COUNTRY_LANES.slice(5).map(r => <button className="it-btn" key={r.id} aria-pressed={regions.includes(r.id)} disabled={regions.length === 1 && regions.includes(r.id)} onClick={() => toggleRegion(r.id)}>{r.name}</button>)}
          <button className="it-icon" onClick={() => setShowSource(true)} aria-label="참고 원문"><FileText size={15} /></button>
          {canEdit && <button className="it-btn" onClick={() => setShowDeleted(true)}><Trash2 size={12} />삭제한 사건 {draft.deleted.length || ""}</button>}
          <button className="it-icon" onClick={exportDraft} aria-label="연표 내보내기"><Download size={15} /></button>
          {canEdit && <><button className="it-btn" onClick={() => add(undefined, null, "us", "global")}><Plus size={12} />국제 사건</button><button className="it-btn" onClick={() => add(undefined, null, "eu")}><Plus size={12} />유럽 공동</button><button className="it-btn" onClick={() => add()}><Plus size={12} />사건 추가</button></>}
        </div>
      </footer>
    </div>
    {canEdit && lastDeletedId && draft.deleted.some(d => d.event.id === lastDeletedId) && <div className="it-undo" role="status"><span>사건을 삭제했습니다.</span><button onClick={() => restore(lastDeletedId)}>되돌리기</button><button aria-label="삭제 알림 닫기" onClick={() => setLastDeletedId(null)}>×</button></div>}
    <Dialog open={showDeleted} onOpenChange={setShowDeleted}><DialogContent data-theme={theme} className="it-editor-portal max-h-[80vh] overflow-auto sm:max-w-xl"><DialogHeader><DialogTitle>삭제한 사건</DialogTitle><DialogDescription>삭제한 본문과 라벨을 복원할 수 있습니다. 이 브라우저에 보관됩니다.</DialogDescription></DialogHeader>
      {!draft.deleted.length && <p className="text-sm text-muted-foreground">삭제한 사건이 없습니다.</p>}
      {draft.deleted.map(({ event }) => <div key={event.id} className="flex items-start gap-3 border-b py-3"><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{event.date || event.year} · {event.scope === "global" ? "대사건" : REGIONS.find(r => r.id === event.region)?.name}</p><p className="break-words text-sm">{plainText(descriptionView(event).text).split("\n")[0] || "제목 없는 사건"}</p></div><button disabled={!canEdit} onClick={() => restore(event.id)} className="rounded border px-3 py-1 text-xs">복원</button></div>)}
    </DialogContent></Dialog>
    <Dialog open={showSource} onOpenChange={setShowSource}><DialogContent data-theme={theme} className="it-editor-portal max-h-[85vh] overflow-auto sm:max-w-3xl"><DialogHeader><DialogTitle>참고 자료 · 1969–1992</DialogTitle><DialogDescription>유형을 분류한 최신 제공본을 우선 반영했습니다. 이후 화면에서 수정한 내용은 로컬에 저장됩니다.</DialogDescription></DialogHeader><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{classifiedSourceText + "\n\n" + insightSourceText + "\n\n" + sourceText + "\n\n" + usSourceText}</pre></DialogContent></Dialog>
  </div>;
}
