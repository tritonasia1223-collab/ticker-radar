import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Plus, Download, FileText, ArrowUp, MoreHorizontal, Trash2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseTimelineDate, withTimelineDate } from "@/lib/international-timeline-date";
import { readTimelineDraft, deleteTimelineEvent, restoreTimelineEvent, type TimelineDraft } from "@/lib/international-timeline-draft";
import { CapRichEditor } from "@/components/CapRichEditor";
import { CapRichText } from "@/components/CapRichText";
import { useEditMode } from "@/components/EditModeProvider";
import { REGIONS, type Region, type TimelineEvent } from "@/data/international-timeline";
import { rangeLabel, documentTimeline, descriptionView, eventLabels } from "@/lib/international-timeline";
import { plainText } from "@/lib/capitalism-richtext";
import usSourceText from "@/data/international-timeline-us-source.txt?raw";
import sourceText from "@/data/international-timeline-mark-revision.txt?raw";
import "./InternationalTimeline.css";

const STORAGE = "fiscus-international-timeline-v1";
const BACKUP = "fiscus-international-timeline-before-edit-actions-20261118";
function countryColor(country: string, region: Region = "europe") {
  if (/서독|독일/.test(country)) return "de";
  if (country === "영국") return "uk";
  if (country === "프랑스") return "fr";
  return ({ us: "us", europe: "eu", japan: "jp", emerging: "emerging", oil: "oil" })[region];
}
const ink = (color: string) => ({ "--it-event": `var(--it-${color})` }) as CSSProperties;
function readDraft(): { draft: TimelineDraft; error: string } {
  try { return { draft: readTimelineDraft(localStorage.getItem(STORAGE)), error: "" }; }
  catch { return { draft: readTimelineDraft(null), error: "기존 로컬 초안을 읽지 못했습니다. 원본을 보존하기 위해 저장을 잠갔습니다." }; }
}

function EventMenu({ event, labels, remove, changeDate }: { event: TimelineEvent; labels: (next: string[]) => void; remove: () => void; changeDate: (date: NonNullable<ReturnType<typeof parseTimelineDate>>) => void }) {
  const [open, setOpen] = useState(false);
  const [dateText, setDateText] = useState("");
  const [dateError, setDateError] = useState("");
  const selected = eventLabels(event);
  const choices = event.region === "europe" ? ["독일", "영국", "프랑스"] : [REGIONS.find(r => r.id === event.region)!.name];
  return <Popover open={open} onOpenChange={next => { if (next) { setDateText(event.date || `${event.year}${event.month ? `.${event.month}` : ""}`); setDateError(""); } setOpen(next); }}>
    <PopoverTrigger asChild><button className="it-event-menu" aria-label={`${event.id} 사건 메뉴`} title="날짜 · 라벨 · 삭제"><MoreHorizontal size={16} /></button></PopoverTrigger>
    <PopoverContent align="end" className="w-64 p-3">
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
  const tags = eventLabels(event);
  const labelRef = useRef<HTMLDivElement>(null);
  const [labelWidth, setLabelWidth] = useState(0);
  useEffect(() => {
    if (!labelRef.current) return;
    const observer = new ResizeObserver(([entry]) => setLabelWidth(entry.contentRect.width));
    observer.observe(labelRef.current);
    return () => observer.disconnect();
  }, []);
  return <article data-event-id={event.id} className={`it-event ${global ? "it-global-event" : ""} ${editable && !global ? "it-event-editable" : ""}`} style={{ ...ink(countryColor(event.country, event.region)), "--it-label-width": `${labelWidth ? labelWidth + 8 : 0}px` } as CSSProperties}>
    {editable && !global && <EventMenu event={event} labels={labels} remove={remove} changeDate={changeDate} />}
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
  const [draft, setDraft] = useState(initial.draft);
  const events = draft.events;
  const latestDraft = useRef(draft);
  const [showDeleted, setShowDeleted] = useState(false);
  const [lastDeletedId, setLastDeletedId] = useState<string | null>(null);
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
    const match = (event: TimelineEvent) => event.id === editingId || `${event.year} ${event.date} ${eventLabels(event).join(" ")} ${plainText(event.body)}`.toLowerCase().includes(query);
    const groups = new Set(events.filter(e => e.scope === "global" && match(e)).map(e => e.groupId || e.id));
    return events.filter(e => e.scope === "global" ? groups.has(e.groupId || e.id) : regions.includes(e.region) && match(e) && (e.region !== "europe" || (!country || eventLabels(e).includes(country))));
  }, [events, regions, search, country, editingId]);
  const years = useMemo(() => documentTimeline(filtered), [filtered]);
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
  function add(year = years[0]?.year ?? 1970, month: number | null = null, region: Region = visibleRegions[0].id, scope: "regional" | "global" = "regional") {
    if (!canEdit) return;
    const id = crypto.randomUUID();
    update([...latestDraft.current.events, { id, year, month, date: "", region, scope, country: region === "europe" ? country ?? "" : REGIONS.find(r => r.id === region)!.name, title: "", body: "", descriptionOnly: true }]);
    setSearch("");
    if (scope === "global") setOpenBands(current => new Set(current).add(id));
    requestAnimationFrame(() => {
      const entry = document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`);
      entry?.scrollIntoView({ behavior: "smooth", block: "center" });
      entry?.querySelector<HTMLElement>("[contenteditable]")?.focus({ preventScroll: true });
    });
  }
  function exportDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(latestDraft.current, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "국제연표-로컬초안.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  useEffect(() => { if (!initial.error) persist(latestDraft.current); }, [initial]);
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
        {(initial.error || saveError) && <p role="alert" className="text-xs text-destructive">{initial.error || saveError} {saveError && <button onClick={() => persist(latestDraft.current)}>다시 저장</button>}</p>}
      </header>
      <div className="it-board" data-testid="timeline-board">
        <div ref={headRef} className="it-lane-head"><div aria-hidden="true" />{visibleRegions.map(r => <div key={r.id} data-region-heading={r.id}><h2>{r.name}</h2>{r.id === "europe" && filters()}</div>)}</div>
        {years.map(year => <section key={year.year} data-year-section={year.year} className="it-year-section">
          <h3 data-year-heading={year.year} className="it-year-heading"><span>{year.year}</span><small>{year.count}건</small><button className="it-year-top" aria-label="연표 맨 위로" onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}><ArrowUp size={12} /></button></h3>
          {year.items.map(item => item.kind === "band" ? <div key={item.key} className="it-band" data-global-marker={item.events[0].id}>
            <div className="it-gutter it-band-gutter" title={item.events[0].date || rangeLabel(item.events[0]) || String(year.year)}>{item.month ? `${String(item.month).padStart(2, "0")}월` : item.events[0].date || rangeLabel(item.events[0]) || "연간"}{/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(item.events[0].date) && <small className="it-band-day">{Number(item.events[0].date.split(".")[2])}일</small>}</div>
            <div className="it-band-content">{item.events.map(event => <div key={event.id}>
              <div className="it-band-heading"><button className="it-band-toggle" aria-expanded={openBands.has(event.id)} aria-controls={`band-${event.id}`} onClick={() => setOpenBands(current => { const next = new Set(current); next.has(event.id) ? next.delete(event.id) : next.add(event.id); return next; })}>
                <span className="it-band-title">{openBands.has(event.id) ? "설명 접기" : plainText(descriptionView(event).text).split("\n")[0] || "새 대사건"}</span>
              </button>{canEdit && <EventMenu event={event} labels={next => setLabels(event.id, next)} remove={() => remove(event.id)} changeDate={date => changeDate(event.id, date)} />}</div>
              {openBands.has(event.id) && <div id={`band-${event.id}`} className="it-band-detail"><TimelineEntry event={event} global editable={canEdit} patch={body => patch(event.id, body)} labels={next => setLabels(event.id, next)} remove={() => remove(event.id)} changeDate={date => changeDate(event.id, date)} /></div>}
            </div>)}</div>
          </div> : <div key={item.key} className="it-slice" data-date-key={item.key}>
            <div className="it-gutter" title={item.month ? `${year.year}.${item.month}` : "월이 특정되지 않은 자료"}>{item.month ? `${String(item.month).padStart(2, "0")}월` : "연간"}</div>
            {visibleRegions.map(region => <div key={region.id} data-region={region.id} className="it-cell">
              {item.events.filter(e => e.region === region.id).map(event => <TimelineEntry key={event.id} event={event} editable={canEdit} patch={body => patch(event.id, body)} labels={next => setLabels(event.id, next)} remove={() => remove(event.id)} changeDate={date => changeDate(event.id, date)} />)}
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
          {canEdit && <button className="it-btn" onClick={() => setShowDeleted(true)}><Trash2 size={12} />삭제한 사건 {draft.deleted.length || ""}</button>}
          <button className="it-icon" onClick={exportDraft} aria-label="연표 내보내기"><Download size={15} /></button>
          {canEdit && <><button className="it-btn" onClick={() => add(undefined, null, "us", "global")}><Plus size={12} />국제 사건</button><button className="it-btn" onClick={() => add()}><Plus size={12} />사건 추가</button></>}
        </div>
      </footer>
    </div>
    {canEdit && lastDeletedId && draft.deleted.some(d => d.event.id === lastDeletedId) && <div className="it-undo" role="status"><span>사건을 삭제했습니다.</span><button onClick={() => restore(lastDeletedId)}>되돌리기</button><button aria-label="삭제 알림 닫기" onClick={() => setLastDeletedId(null)}>×</button></div>}
    <Dialog open={showDeleted} onOpenChange={setShowDeleted}><DialogContent className="max-h-[80vh] overflow-auto sm:max-w-xl"><DialogHeader><DialogTitle>삭제한 사건</DialogTitle><DialogDescription>삭제한 본문과 라벨을 복원할 수 있습니다. 이 브라우저에 보관됩니다.</DialogDescription></DialogHeader>
      {!draft.deleted.length && <p className="text-sm text-muted-foreground">삭제한 사건이 없습니다.</p>}
      {draft.deleted.map(({ event }) => <div key={event.id} className="flex items-start gap-3 border-b py-3"><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{event.date || event.year} · {event.scope === "global" ? "대사건" : REGIONS.find(r => r.id === event.region)?.name}</p><p className="break-words text-sm">{plainText(descriptionView(event).text).split("\n")[0] || "제목 없는 사건"}</p></div><button disabled={!canEdit} onClick={() => restore(event.id)} className="rounded border px-3 py-1 text-xs">복원</button></div>)}
    </DialogContent></Dialog>
    <Dialog open={showSource} onOpenChange={setShowSource}><DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl"><DialogHeader><DialogTitle>참고 원문 · 1970–1990</DialogTitle><DialogDescription>제공하신 유럽·일본 수정본과 미국 추가 자료입니다.</DialogDescription></DialogHeader><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{sourceText + "\n\n" + usSourceText}</pre></DialogContent></Dialog>
  </div>;
}
