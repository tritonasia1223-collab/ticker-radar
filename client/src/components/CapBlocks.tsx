// 인사이트/메타카드 본문을 '블록 스택'으로 — 텍스트·표·이미지·그래프 블록을 순서대로 섞어
// 배치한다. 블록 사이/끝에 삽입, 각 블록 ↑↓ 재배치·삭제, 이미지 붙여넣기(Ctrl+V) 지원.
// 사건 인사이트와 메타카드가 공유(allow 로 허용 블록 타입만 노출).
import { useRef } from "react";
import { ArrowUp, ArrowDown, X, Plus, Type as TypeIcon, Table as TableIcon, ImagePlus, LineChart as ChartIcon } from "lucide-react";
import { CapRichEditor } from "@/components/CapRichEditor";
import { CapRichText } from "@/components/CapRichText";
import { PanelChart } from "@/components/CapChartPanel";
import { TableCard, makeDefaultTable } from "@/components/CapTable";
import { PANELS, toFracYear } from "@/lib/capitalism-config";
import type { CapBlock, CapInsight, CapInsightChart, CapMetaCard, CapTableData, CapImageData, FlowNodeDTO } from "@/lib/capitalism-types";
import seriesData from "@/data/capitalism-series.json";

const SERIES = seriesData as unknown as Record<string, [string, number][]>;
const panelFor = (key: string) => PANELS.find((p) => p.series === key) ?? PANELS[0];
function lastYearOf(key: string): number {
  const arr = SERIES[key];
  return arr && arr.length ? Math.ceil(toFracYear(arr[arr.length - 1][0])) : 2026;
}
function firstYearOf(key: string): number {
  const arr = SERIES[key];
  return arr && arr.length ? Math.floor(toFracYear(arr[0][0])) : 1940;
}
// 인사이트 표를 노드용 TableCard 로 재사용하기 위한 합성 노드(id·table 만 사용).
const synthNode = (id: string, table: CapTableData): FlowNodeDTO =>
  ({ id, kind: "effect", inLabel: null, text: "", ref: null, col: null, table });

// ──────── 이미지 축소 ──────── 붙여넣기/업로드 이미지를 가로 maxW 로 축소(비율 유지) → webp data URL.
export async function blobToScaledDataUrl(blob: Blob, maxW = 1280): Promise<string> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return canvas.toDataURL("image/webp", 0.82);
  } catch {
    return await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsDataURL(blob);
    });
  }
}

// ──────── 블록 ↔ 레거시 변환 ────────
export function blocksHaveContent(blocks: CapBlock[]): boolean {
  return blocks.some((b) => (b.type === "text" ? !!b.text.trim() : true));
}
// 레거시(text+tables+charts)에서 블록 파생 — 순서: 본문 → 표 → 그래프(기존 렌더 순).
export function insightToBlocks(insight?: CapInsight | null): CapBlock[] {
  if (!insight) return [];
  if (insight.blocks && insight.blocks.length) return insight.blocks;
  const out: CapBlock[] = [];
  if (insight.text && insight.text.trim()) out.push({ type: "text", text: insight.text });
  for (const t of insight.tables ?? []) out.push({ type: "table", table: t });
  for (const c of insight.charts ?? []) out.push({ type: "chart", chart: c });
  return out;
}
// 블록 → 인사이트(blocks 가 단일 출처, 레거시 평면 필드는 역호환용으로 함께 채움).
export function blocksToInsight(blocks: CapBlock[]): CapInsight {
  return {
    text: blocks.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n"),
    charts: blocks.filter((b): b is { type: "chart"; chart: CapInsightChart } => b.type === "chart").map((b) => b.chart),
    tables: blocks.filter((b): b is { type: "table"; table: CapTableData } => b.type === "table").map((b) => b.table),
    blocks,
  };
}
// 레거시(text+tables+images)에서 블록 파생 — 순서: 본문 → 표 → 이미지.
export function metaCardToBlocks(card: CapMetaCard): CapBlock[] {
  if (card.blocks && card.blocks.length) return card.blocks;
  const out: CapBlock[] = [];
  if (card.text && card.text.trim()) out.push({ type: "text", text: card.text });
  for (const t of card.tables ?? []) out.push({ type: "table", table: t });
  for (const im of card.images ?? []) out.push({ type: "image", image: im });
  return out;
}
// 블록 → 메타카드 본문 필드(blocks 단일 출처 + 레거시 평면 필드).
export function blocksToMetaFields(blocks: CapBlock[]): Pick<CapMetaCard, "text" | "tables" | "images" | "blocks"> {
  return {
    text: blocks.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n"),
    tables: blocks.filter((b): b is { type: "table"; table: CapTableData } => b.type === "table").map((b) => b.table),
    images: blocks.filter((b): b is { type: "image"; image: CapImageData } => b.type === "image").map((b) => b.image),
    blocks,
  };
}

interface AllowBlocks { text?: boolean; table?: boolean; image?: boolean; chart?: boolean }

// 읽기 전용 참고 그래프(컨트롤 없이 차트 + 라벨). mark>0 이면 사건 시점 점선 마커.
function InsightChartView({ chart, mark = 0 }: { chart: CapInsightChart; mark?: number }) {
  const panel = panelFor(chart.series);
  const from = Math.min(chart.from, chart.to);
  const to = Math.max(chart.from, chart.to);
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="mb-0.5 flex items-center gap-1.5 px-0.5">
        <span className="h-2 w-2 rounded-sm" style={{ background: panel.color }} />
        <span className="text-[11px] font-medium">{panel.label}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{panel.unit} · {from}~{to}</span>
      </div>
      <PanelChart panel={panel} series={SERIES[chart.series]} fromYear={from} toYear={to} playYear={mark} yMode="window" height={150} unit={panel.unit} />
    </div>
  );
}

// ──────── 메인: 블록 스택 ──────── 부모가 blocks 상태 소유. onChange(next, doCommit):
//   doCommit=false → 텍스트 입력 중(로컬만), true → 구조 변경/blur(저장).
export function BlockStack({
  blocks, editing, allow, eventFrac, onChange, onJump,
}: {
  blocks: CapBlock[];
  editing: boolean;
  allow: AllowBlocks;
  eventFrac?: number;
  onChange: (next: CapBlock[], doCommit: boolean) => void;
  onJump?: (slug: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingPosRef = useRef<number>(0);   // 파일 선택으로 이미지 추가 시 삽입 위치
  const focusedRef = useRef<number>(-1);      // 마지막 포커스 블록(붙여넣기 위치 기준)

  const insertAt = (pos: number, block: CapBlock) => onChange([...blocks.slice(0, pos), block, ...blocks.slice(pos)], true);
  const removeAt = (i: number) => onChange(blocks.filter((_, j) => j !== i), true);
  const setAt = (i: number, block: CapBlock) => onChange(blocks.map((b, j) => (j === i ? block : b)), true);
  const setTextAt = (i: number, text: string) => onChange(blocks.map((b, j) => (j === i ? { type: "text", text } : b)), false);
  const moveBy = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const nx = [...blocks];
    [nx[i], nx[j]] = [nx[j], nx[i]];
    onChange(nx, true);
  };

  const newText = (): CapBlock => ({ type: "text", text: "" });
  const newTable = (): CapBlock => ({ type: "table", table: makeDefaultTable() });
  const newChart = (): CapBlock => {
    const key = "dollar";
    const ey = Math.floor(eventFrac ?? 1980);
    return { type: "chart", chart: { series: key, from: Math.max(firstYearOf(key), ey - 5), to: Math.min(lastYearOf(key), ey + 5) } };
  };

  // 파일 선택 → 축소 후 pendingPos 에 이미지 블록(여러 장) 삽입.
  const openFilePicker = (pos: number) => { pendingPosRef.current = pos; fileRef.current?.click(); };
  const onFilesChosen = async (files: FileList) => {
    const imgs: CapImageData[] = [];
    for (const f of Array.from(files)) if (f.type.startsWith("image/")) imgs.push({ src: await blobToScaledDataUrl(f) });
    if (!imgs.length) return;
    const pos = pendingPosRef.current;
    onChange([...blocks.slice(0, pos), ...imgs.map((image) => ({ type: "image", image } as CapBlock)), ...blocks.slice(pos)], true);
  };
  // 붙여넣기 → 포커스 블록 다음(없으면 끝)에 이미지 블록 삽입.
  const onPaste = async (e: React.ClipboardEvent) => {
    if (!allow.image) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const blobs: Blob[] = [];
    for (const it of Array.from(items)) if (it.type.startsWith("image/")) { const b = it.getAsFile(); if (b) blobs.push(b); }
    if (!blobs.length) return;
    e.preventDefault();
    const srcs = await Promise.all(blobs.map((b) => blobToScaledDataUrl(b)));
    const pos = focusedRef.current >= 0 ? focusedRef.current + 1 : blocks.length;
    onChange([...blocks.slice(0, pos), ...srcs.map((src) => ({ type: "image", image: { src } } as CapBlock)), ...blocks.slice(pos)], true);
  };

  // 삽입 버튼 묶음(allow 에 따라). main=하단 상시 노출 / 사이 갭은 hover 시 팝.
  const insertBar = (pos: number, main?: boolean) => {
    const btn = "flex items-center gap-1 rounded-md border border-dashed border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary";
    const buttons = (
      <>
        {allow.text ? <button type="button" onClick={() => insertAt(pos, newText())} className={btn} data-testid={`block-add-text-${pos}`}><TypeIcon className="h-3.5 w-3.5" /> 텍스트</button> : null}
        {allow.table ? <button type="button" onClick={() => insertAt(pos, newTable())} className={btn} data-testid={`block-add-table-${pos}`}><TableIcon className="h-3.5 w-3.5" /> 표</button> : null}
        {allow.image ? <button type="button" onClick={() => openFilePicker(pos)} className={btn} data-testid={`block-add-image-${pos}`}><ImagePlus className="h-3.5 w-3.5" /> 이미지</button> : null}
        {allow.chart ? <button type="button" onClick={() => insertAt(pos, newChart())} className={btn} data-testid={`block-add-chart-${pos}`}><ChartIcon className="h-3.5 w-3.5" /> 그래프</button> : null}
      </>
    );
    if (main) return <div className="flex flex-wrap items-center justify-center gap-1 pt-0.5">{buttons}{allow.image ? <span className="ml-1 text-[10px] text-muted-foreground/60">또는 Ctrl+V 붙여넣기</span> : null}</div>;
    // 사이 갭: 얇은 줄, hover 시 버튼 팝업.
    return (
      <div className="group/ins relative flex h-2 items-center justify-center">
        <div className="h-px w-full bg-transparent transition-colors group-hover/ins:bg-border/50" />
        <div className="absolute z-20 hidden items-center gap-1 rounded-md border border-border bg-popover px-1 py-0.5 shadow-md group-hover/ins:flex">
          {buttons}
        </div>
      </div>
    );
  };

  // 블록 1개 렌더.
  const renderBlock = (b: CapBlock, i: number) => {
    if (b.type === "text") {
      return editing ? (
        <CapRichEditor
          value={b.text} onChange={(t) => setTextAt(i, t)} onBlur={() => onChange(blocks, true)}
          rows={5} align="left" placeholder="인사이트를 적어보세요. (드래그로 색·하이라이트 · '- '로 불릿 · '->'로 화살표)"
        />
      ) : b.text.trim() ? (
        <CapRichText text={b.text} className="block text-[13.5px] leading-relaxed text-foreground" onJump={onJump} />
      ) : null;
    }
    if (b.type === "table") {
      return <TableCard node={synthNode(`blk-tbl-${i}`, b.table)} editable={editing}
        onCommit={(_id, t) => { if (!editing) return; t === null ? removeAt(i) : setAt(i, { type: "table", table: t }); }} />;
    }
    if (b.type === "image") {
      return <img src={b.image.src} alt={b.image.alt ?? ""} className="block w-full h-auto rounded-md border border-border/50" />;
    }
    // chart
    if (!editing) return <InsightChartView chart={b.chart} mark={eventFrac} />;
    const c = b.chart;
    const lo = firstYearOf(c.series);
    const hi = lastYearOf(c.series);
    const panel = panelFor(c.series);
    // series 변경은 단발이라 즉시 커밋. from/to 숫자는 입력 중 로컬만(commitFalse) → blur 시 커밋(POST 폭주 방지).
    const patch = (p: Partial<CapInsightChart>, doCommit: boolean) =>
      onChange(blocks.map((x, j) => (j === i ? { type: "chart", chart: { ...c, ...p } } : x)), doCommit);
    return (
      <div className="rounded-md border border-border/60 bg-background/40 p-2">
        <div className="mb-1 flex items-center gap-1.5">
          <select value={c.series} onChange={(e) => patch({ series: e.target.value }, true)}
            className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-[11px] text-foreground" data-testid={`block-chart-series-${i}`}>
            {PANELS.map((p) => <option key={p.id} value={p.series}>{p.label}</option>)}
          </select>
          <input type="number" value={c.from} min={lo} max={hi} onChange={(e) => patch({ from: Number(e.target.value) }, false)} onBlur={() => onChange(blocks, true)}
            className="w-14 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums text-foreground" title="시작 연도" />
          <span className="text-[11px] text-muted-foreground">~</span>
          <input type="number" value={c.to} min={lo} max={hi} onChange={(e) => patch({ to: Number(e.target.value) }, false)} onBlur={() => onChange(blocks, true)}
            className="w-14 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums text-foreground" title="끝 연도" />
        </div>
        <div className="mb-0.5 flex items-center gap-1.5 px-0.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: panel.color }} />
          <span className="text-[11px] font-medium">{panel.label}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">{panel.unit}</span>
        </div>
        <PanelChart panel={panel} series={SERIES[c.series]} fromYear={Math.min(c.from, c.to)} toYear={Math.max(c.from, c.to)}
          playYear={eventFrac ?? 0} yMode="window" height={130} unit={panel.unit} />
      </div>
    );
  };

  // ── 읽기 뷰 ──
  if (!editing) {
    const visible = blocks.filter((b) => (b.type === "text" ? b.text.trim() : true));
    if (!visible.length) return null;
    return (
      <div className="flex flex-col gap-3">
        {blocks.map((b, i) => {
          const el = renderBlock(b, i);
          return el ? <div key={i}>{el}</div> : null;
        })}
      </div>
    );
  }

  // ── 편집 뷰 ── 블록 사이 삽입 갭 + 블록별 ↑↓✕.
  const last = blocks.length - 1;
  return (
    <div className="flex flex-col" onPaste={onPaste}>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { if (e.target.files) onFilesChosen(e.target.files); e.target.value = ""; }} />
      {blocks.map((b, i) => (
        <div key={i}>
          {insertBar(i)}
          <div className="group/blk relative flex flex-col gap-1 rounded-md py-0.5" onFocusCapture={() => { focusedRef.current = i; }}>
            <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/blk:opacity-100">
              <button type="button" onClick={() => moveBy(i, -1)} disabled={i === 0}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-25"
                title="위로" data-testid={`block-up-${i}`}><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => moveBy(i, 1)} disabled={i === last}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-25"
                title="아래로" data-testid={`block-down-${i}`}><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => removeAt(i)}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="블록 삭제" data-testid={`block-remove-${i}`}><X className="h-3.5 w-3.5" /></button>
            </div>
            {renderBlock(b, i)}
          </div>
        </div>
      ))}
      {insertBar(blocks.length, true)}
    </div>
  );
}
