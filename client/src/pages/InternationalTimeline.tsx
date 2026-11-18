import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Plus, Download, FileText, ArrowUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CapRichEditor } from "@/components/CapRichEditor";
import { CapRichText } from "@/components/CapRichText";
import { useEditMode } from "@/components/EditModeProvider";
import { REGIONS, type Region, type TimelineEvent } from "@/data/international-timeline";
import { countryTags, eventMonth, validEnd, rangeLabel, mergeTimelineRevision, documentTimeline, descriptionView, europeanLabels } from "@/lib/international-timeline";
import { plainText } from "@/lib/capitalism-richtext";
import usSourceText from "@/data/international-timeline-us-source.txt?raw";
import sourceText from "@/data/international-timeline-mark-revision.txt?raw";
import "./InternationalTimeline.css";

const STORAGE = "fiscus-international-timeline-v1";
const BACKUP = "fiscus-international-timeline-before-us-20261118";
function countryColor(country: string, region: Region = "europe") {
  if (/서독|독일/.test(country)) return "de";
  if (country === "영국") return "uk";
  if (country === "프랑스") return "fr";
  return ({ us: "us", europe: "eu", japan: "jp", emerging: "emerging", oil: "oil" })[region];
}
const ink = (color: string) => ({ "--it-event": `var(--it-${color})` }) as CSSProperties;
function readDraft(): { events: TimelineEvent[]; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return { events: mergeTimelineRevision(), error: "" };
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every(e => e && typeof e.id === "string" && Number.isInteger(e.year) && e.year >= 1800 && e.year <= 2100 && (e.month == null || (Number.isInteger(e.month) && e.month >= 1 && e.month <= 12)) && (e.scope == null || e.scope === "regional" || e.scope === "global") && (e.groupId == null || typeof e.groupId === "string") && (e.endYear == null || validEnd(e)) && REGIONS.some(r => r.id === e.region) && [e.date, e.country, e.title, e.body].every(v => typeof v === "string")) || new Set(value.map(e => e.id)).size !== value.length) throw new Error();
    return { events: mergeTimelineRevision(value), error: "" };
  } catch {
    return { events: mergeTimelineRevision(), error: "기존 로컬 초안을 읽지 못했습니다. 원본을 보존하기 위해 저장을 잠갔습니다." };
  }
}


function TimelineEntry({ event, editable, patch, global = false }: {
  event: TimelineEvent; editable: boolean; global?: boolean; patch: (body: string) => void;
}) {
  const view = descriptionView(event);
  const tags = event.region === "europe" ? europeanLabels(event.country) : countryTags(event.country);
  const labelRef = useRef<HTMLDivElement>(null);
  const [labelWidth, setLabelWidth] = useState(0);
  useEffect(() => {
    if (!labelRef.current) return;
    const observer = new ResizeObserver(([entry]) => setLabelWidth(entry.contentRect.width));
    observer.observe(labelRef.current);
    return () => observer.disconnect();
  }, []);
  return <article data-event-id={event.id} className={`it-event ${global ? "it-global-event" : ""}`} style={{ ...ink(countryColor(event.country, event.region)), "--it-label-width": `${labelWidth ? labelWidth + 8 : 0}px` } as CSSProperties}>
    <div ref={labelRef} className="it-event-meta">
      {!global && <span className="it-mobile-region">{REGIONS.find(r => r.id === event.region)?.name}</span>}
      {!global && tags.map(tag => <span key={tag} data-country-label className="it-tag" style={ink(countryColor(tag, event.region))}>{tag}</span>)}
    </div>
    <div className="it-description">
      {editable ? <CapRichEditor inline spellCheck={false} align="left" rows={1} ariaLabel={`${event.id} 설명`} value={view.text} onChange={body => patch(view.prefix + body)} onBlur={body => patch(view.prefix + body)} placeholder="설명 입력 · 글을 선택해 색과 하이라이트 적용" />
        : <CapRichText text={view.text} className="it-read-description" />}
    </div>
  </article>;
}

export default function InternationalTimeline() {
  const [initial] = useState(readDraft);
  const [events, setEvents] = useState(initial.events);
  const latestEvents = useRef(events);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(64);
  const [saveError, setSaveError] = useState("");
  const [regions, setRegions] = useState<Region[]>(["us", "europe", "japan"]);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [openBands, setOpenBands] = useState<Set<string>>(() => new Set());
  const [country, setCountry] = useState<string | null>(null);
  const { editable } = useEditMode();
  const canEdit = editable && !initial.error;
  useEffect(() => { const old = document.title; document.title = "국제 연표 — 피스쿠스"; return () => { document.title = old; }; }, []);
  useEffect(() => {
    if (!headRef.current) return;
    const observer = new ResizeObserver(([entry]) => setHeaderHeight((entry.target as HTMLElement).offsetHeight));
    observer.observe(headRef.current);
    return () => observer.disconnect();
  }, []);
  const visibleRegions = REGIONS.filter(r => regions.includes(r.id));
  const countries = ["독일", "영국", "프랑스"];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const match = (event: TimelineEvent) => event.id === editingId || `${event.year} ${event.date} ${event.country} ${plainText(event.body)}`.toLowerCase().includes(query);
    const groups = new Set(events.filter(e => e.scope === "global" && match(e)).map(e => e.groupId || e.id));
    return events.filter(e => e.scope === "global" ? groups.has(e.groupId || e.id) : regions.includes(e.region) && match(e) && (e.region !== "europe" || (!country || europeanLabels(e.country).includes(country))));
  }, [events, regions, search, country, editingId]);
  const years = useMemo(() => documentTimeline(filtered), [filtered]);
  function persist(next: TimelineEvent[]) {
    try {
      const old = localStorage.getItem(STORAGE);
      if (old && !localStorage.getItem(BACKUP)) localStorage.setItem(BACKUP, old);
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setSaveError("");
    } catch { setSaveError("로컬 저장에 실패했습니다. 입력 내용은 현재 화면에 남아 있습니다. 다시 저장하거나 내보내 주세요."); }
  }
  function update(next: TimelineEvent[]) {
    latestEvents.current = next;
    setEvents(next);
    persist(next);
  }

  function patch(id: string, body: string) {
    if (!canEdit || latestEvents.current.find(e => e.id === id)?.body === body) return;
    update(latestEvents.current.map(e => e.id === id ? { ...e, body } : e));
  }
  function add(year = years[0]?.year ?? 1970, month: number | null = null, region: Region = visibleRegions[0].id, scope: "regional" | "global" = "regional") {
    if (!canEdit) return;
    const id = crypto.randomUUID();
    update([...latestEvents.current, { id, year, month, date: "", region, scope, country: region === "europe" ? country ?? "" : REGIONS.find(r => r.id === region)!.name, title: "", body: "", descriptionOnly: true }]);
    setSearch("");
    if (scope === "global") setOpenBands(current => new Set(current).add(id));
    requestAnimationFrame(() => {
      const entry = document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`);
      entry?.scrollIntoView({ behavior: "smooth", block: "center" });
      entry?.querySelector<HTMLElement>("[contenteditable]")?.focus({ preventScroll: true });
    });
  }
  function exportDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(latestEvents.current, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "국제연표-로컬초안.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  useEffect(() => { if (!initial.error) persist(initial.events); }, [initial]);
  function jumpToYear(year: number) {
    scrollRef.current?.querySelector(`[data-year-section="${year}"]`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  function filters() {
    return <div className="it-country-filters" aria-label="유럽 국가 필터">
      <button aria-pressed={country === null} onClick={() => setCountry(null)}>전체</button>
      {countries.map(tag => <button key={tag} style={ink(countryColor(tag))} aria-label={`${tag}만 보기`} aria-pressed={country === tag} onClick={() => setCountry(country === tag ? null : tag)}>{tag}</button>)}
    </div>;
  }
  return <div ref={scrollRef} onFocusCapture={e => { const id = (e.target as HTMLElement).closest<HTMLElement>("[data-event-id]")?.dataset.eventId; if (id) setEditingId(id); }} className="international-document" data-testid="international-timeline" style={{ "--it-columns": `repeat(${visibleRegions.length}, minmax(0, 1fr))`, "--it-head-height": `${headerHeight}px` } as CSSProperties}>
    <div className="it-wrap">
      <header className="it-page-header">
        <div className="it-toolbar">
          <h1>국제 연표 — {visibleRegions.map(r => r.name).join(" · ")} {years.length ? `${years[0].year}–${years.at(-1)!.year}` : ""}</h1>
          <div className="it-controls">
            <input className="it-search" type="search" aria-label="연표 검색" placeholder="사건 검색…" value={search} onChange={e => { setEditingId(null); setSearch(e.target.value); }} />
            <div className="it-lane-toggles" aria-label="비교 지역 선택">{REGIONS.slice(0, 3).map(r => <button aria-pressed={regions.includes(r.id)} disabled={regions.length === 1 && regions.includes(r.id)} key={r.id} onClick={() => setRegions(regions.includes(r.id) ? regions.filter(id => id !== r.id) : [...regions, r.id])}>{r.name}</button>)}</div>
            <button className="it-btn" onClick={() => setOpenBands(openBands.size ? new Set() : new Set(events.filter(e => e.scope === "global").map(e => e.id)))}>{openBands.size ? "대사건 접기" : "대사건 펼치기"}</button>
            <span className="it-count">{filtered.length}개 사건</span>
          </div>
        </div>
        {regions.includes("europe") && <div className="it-mobile-filters">{filters()}</div>}
        {(initial.error || saveError) && <p role="alert" className="text-xs text-destructive">{initial.error || saveError} {saveError && <button onClick={() => persist(latestEvents.current)}>다시 저장</button>}</p>}
      </header>
      <div className="it-board" data-testid="timeline-board">
        <div ref={headRef} className="it-lane-head"><div aria-hidden="true" />{visibleRegions.map(r => <div key={r.id} data-region-heading={r.id}><h2>{r.name}</h2>{r.id === "europe" && filters()}</div>)}</div>
        {years.map(year => <section key={year.year} data-year-section={year.year} className="it-year-section">
          <h3 data-year-heading={year.year} className="it-year-heading"><span>{year.year}</span><small>{year.count}건</small><button className="it-year-top" aria-label="연표 맨 위로" onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}><ArrowUp size={12} /></button></h3>
          {year.items.map(item => item.kind === "band" ? <div key={item.key} className="it-band" data-global-marker={item.events[0].id}>
            <div className="it-gutter it-band-gutter" title={item.events[0].date || rangeLabel(item.events[0]) || String(year.year)}>{item.month ? `${String(item.month).padStart(2, "0")}월` : item.events[0].date || rangeLabel(item.events[0]) || "연간"}{/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(item.events[0].date) && <small className="it-band-day">{Number(item.events[0].date.split(".")[2])}일</small>}</div>
            <div className="it-band-content">{item.events.map(event => <div key={event.id}>
              <button className="it-band-toggle" aria-expanded={openBands.has(event.id)} aria-controls={`band-${event.id}`} onClick={() => setOpenBands(current => { const next = new Set(current); next.has(event.id) ? next.delete(event.id) : next.add(event.id); return next; })}>
                <span className="it-band-title">{openBands.has(event.id) ? "설명 접기" : plainText(descriptionView(event).text).split("\n")[0] || "새 대사건"}</span>
              </button>
              {openBands.has(event.id) && <div id={`band-${event.id}`} className="it-band-detail"><TimelineEntry event={event} global editable={canEdit} patch={body => patch(event.id, body)} /></div>}
            </div>)}</div>
          </div> : <div key={item.key} className="it-slice" data-date-key={item.key}>
            <div className="it-gutter" title={item.month ? `${year.year}.${item.month}` : "월이 특정되지 않은 자료"}>{item.month ? `${String(item.month).padStart(2, "0")}월` : "연간"}</div>
            {visibleRegions.map(region => <div key={region.id} data-region={region.id} className="it-cell">
              {item.events.filter(e => e.region === region.id).map(event => <TimelineEntry key={event.id} event={event} editable={canEdit} patch={body => patch(event.id, body)} />)}
              {canEdit && <button className="it-cell-add" aria-label={`${year.year}.${item.month ?? "연간"} ${region.name} 사건 추가`} onClick={() => add(year.year, item.month, region.id)}><Plus size={12} /></button>}
            </div>)}
          </div>)}
        </section>)}
        {!years.length && <p className="it-empty">조건에 맞는 사건이 없습니다. 검색어나 국가 필터를 바꿔 주세요.</p>}
      </div>
      <footer className="it-note">
        <span>설명을 클릭해 바로 편집 · 글을 선택해 색과 하이라이트 적용 · 브라우저에 자동 저장</span>
        <div className="it-actions">
          <input className="it-year-jump" type="number" aria-label="연도로 이동" placeholder="연도 이동" min={1800} max={2100} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} onBlur={e => jumpToYear(Number(e.target.value))} />
          {REGIONS.slice(3).map(r => <button className="it-btn" key={r.id} aria-pressed={regions.includes(r.id)} onClick={() => setRegions(regions.includes(r.id) ? regions.filter(id => id !== r.id) : [...regions, r.id])}>{r.name}</button>)}
          <button className="it-icon" onClick={() => setShowSource(true)} aria-label="참고 원문"><FileText size={15} /></button>
          <button className="it-icon" onClick={exportDraft} aria-label="연표 내보내기"><Download size={15} /></button>
          {canEdit && <><button className="it-btn" onClick={() => add(undefined, null, "us", "global")}><Plus size={12} />국제 사건</button><button className="it-btn" onClick={() => add()}><Plus size={12} />사건 추가</button></>}
        </div>
      </footer>
    </div>
    <Dialog open={showSource} onOpenChange={setShowSource}><DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl"><DialogHeader><DialogTitle>참고 원문 · 1970–1990</DialogTitle><DialogDescription>제공하신 유럽·일본 수정본과 미국 추가 자료입니다.</DialogDescription></DialogHeader><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{sourceText + "\n\n" + usSourceText}</pre></DialogContent></Dialog>
  </div>;
}
