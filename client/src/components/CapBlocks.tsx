// 인사이트/메타카드 본문을 '블록 스택'으로 — 텍스트·표·이미지·그래프 블록을 순서대로 섞어
// 배치한다. 블록 사이/끝에 삽입, 각 블록 ↑↓ 재배치·삭제, 이미지 붙여넣기(Ctrl+V) 지원.
// 사건 인사이트와 메타카드가 공유(allow 로 허용 블록 타입만 노출).
import { useRef, useState } from "react";
import { ArrowUp, ArrowDown, X, Plus, Type as TypeIcon, Table as TableIcon, ImagePlus, LineChart as ChartIcon, Code2, Minus } from "lucide-react";
import { CapRichEditor, type CapRichEditorHandle } from "@/components/CapRichEditor";
import { CapRichText } from "@/components/CapRichText";
import { PanelChart } from "@/components/CapChartPanel";
import { TableCard, makeDefaultTable } from "@/components/CapTable";
import { PANELS, toFracYear } from "@/lib/capitalism-config";
import { plainText } from "@/lib/capitalism-richtext";
import type { CapBlock, CapInsight, CapInsightChart, CapMetaCard, CapTableData, CapImageData, CapHtmlData, FlowNodeDTO } from "@/lib/capitalism-types";
import { useCapSeries, type SeriesMap } from "@/lib/capitalism-series";

const panelFor = (key: string) => PANELS.find((p) => p.series === key) ?? PANELS[0];
// series 미로드 시(undefined) 안전 기본값. 로드 후엔 실제 데이터 범위.
function lastYearOf(series: SeriesMap | undefined, key: string): number {
  const arr = series?.[key];
  return arr && arr.length ? Math.ceil(toFracYear(arr[arr.length - 1][0])) : 2026;
}
function firstYearOf(series: SeriesMap | undefined, key: string): number {
  const arr = series?.[key];
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

interface AllowBlocks { text?: boolean; table?: boolean; image?: boolean; chart?: boolean; html?: boolean; divider?: boolean }

// ──────── HTML 미니앱 뷰 ──────── 임의 HTML/JS 를 sandbox iframe 으로 렌더.
//   ⚠ sandbox 에 allow-same-origin 이 필요한 이유: 이 미니앱들은 외부 데이터를 fetch 한다(예: D3 지도가
//   jsdelivr 의 TopoJSON 을 d3.json 으로 로드). opaque-origin(allow-same-origin 없음) 에서는 크로스오리진
//   fetch 가 브라우저에 막혀 데이터가 안 온다(스크립트 로드는 되지만 fetch 는 실패 → 지도 빈 화면).
//   allow-same-origin 을 주면 스크립트가 부모(앱)에도 접근 가능해지므로, '신뢰된 편집자(대시보드 소유자)'가
//   직접 넣는 미니앱에 한해 사용한다. 제3자 UGC 를 붙이는 용도가 아님.
//   src 에 <html> 이 있으면 그대로, 없으면 최소 문서 셸로 감싼다(폭 100% 반응형, 높이 픽셀 고정).
function HtmlBlockView({ html }: { html: CapHtmlData }) {
  // 배경 transparent — 카드 배경이 그대로 비쳐 자연스럽게 어우러진다(테마도 자동 추종). 테두리 없음.
  //   흰 배경/테두리가 필요한 블록은 자체 HTML 에서 지정하면 됨.
  const doc = /<html[\s>]/i.test(html.src)
    ? html.src
    : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:transparent;color:inherit}</style></head><body>${html.src}</body></html>`;
  return (
    <iframe title="mini-app" srcDoc={doc} sandbox="allow-scripts allow-same-origin" loading="lazy"
      className="block w-full rounded-md bg-transparent"
      style={{ height: html.height ?? 560 }} />
  );
}

// 읽기 전용 참고 그래프(컨트롤 없이 차트 + 라벨). mark>0 이면 사건 시점 점선 마커.
function InsightChartView({ chart, mark = 0 }: { chart: CapInsightChart; mark?: number }) {
  const { data: series } = useCapSeries();
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
      <PanelChart panel={panel} series={series?.[chart.series]} fromYear={from} toYear={to} playYear={mark} yMode="window" height={150} unit={panel.unit} />
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
  const { data: series } = useCapSeries(); // 차트 블록 편집의 연도 범위·렌더용(미로드 시 기본값)
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingPosRef = useRef<number>(0);   // 파일 선택으로 이미지 추가 시 삽입 위치
  const focusedRef = useRef<number>(-1);      // 마지막 포커스 블록(붙여넣기 위치 기준)
  const editorRefs = useRef(new Map<number, CapRichEditorHandle | null>()); // 텍스트 블록 에디터 핸들(커서 분할)
  const [activeText, setActiveText] = useState<number | null>(null);        // 포커스한 텍스트 블록(커서 삽입 툴바 노출)

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
    return { type: "chart", chart: { series: key, from: Math.max(firstYearOf(series, key), ey - 5), to: Math.min(lastYearOf(series, key), ey + 5) } };
  };
  const newHtml = (): CapBlock => ({ type: "html", html: { src: "", height: 560 } });
  const newDivider = (): CapBlock => ({ type: "divider" });

  // 파일 선택 → 축소 후 pendingPos 에 이미지 블록(여러 장) 삽입.
  const openFilePicker = (pos: number) => { pendingPosRef.current = pos; fileRef.current?.click(); };
  const onFilesChosen = async (files: FileList) => {
    const imgs: CapImageData[] = [];
    for (const f of Array.from(files)) if (f.type.startsWith("image/")) imgs.push({ src: await blobToScaledDataUrl(f) });
    if (!imgs.length) return;
    const pos = pendingPosRef.current;
    onChange([...blocks.slice(0, pos), ...imgs.map((image) => ({ type: "image", image } as CapBlock)), ...blocks.slice(pos)], true);
  };

  // 텍스트 블록 i 를 캐럿 기준 둘로 가른 뒤 그 사이에 newBlocks 삽입(빈 조각은 버림).
  //   캐럿이 없거나 분할 불가면 블록 다음에 삽입. 분할 후엔 blur 로 before 값 재렌더(포커스 가드 회피).
  const spliceAtCaret = (i: number, newBlocks: CapBlock[], split: { before: string; after: string } | null) => {
    setActiveText(null);
    if (!split) { onChange([...blocks.slice(0, i + 1), ...newBlocks, ...blocks.slice(i + 1)], true); return; }
    editorRefs.current.get(i)?.blur();
    const mk = (t: string): CapBlock => ({ type: "text", text: t });
    const out: CapBlock[] = [];
    if (plainText(split.before).length) out.push(mk(split.before));
    out.push(...newBlocks);
    if (plainText(split.after).length) out.push(mk(split.after));
    onChange([...blocks.slice(0, i), ...out, ...blocks.slice(i + 1)], true);
  };
  // 커서 위치에 표/그래프 삽입(동기).
  const splitInsert = (i: number, block: CapBlock) => {
    const split = blocks[i]?.type === "text" ? editorRefs.current.get(i)?.splitAtCaret() ?? null : null;
    spliceAtCaret(i, [block], split);
  };
  // 커서 위치에 이미지 삽입(파일 선택, 비동기) — 분할 좌표는 동기로 먼저 캡처.
  const splitInsertImage = async (i: number) => {
    const split = blocks[i]?.type === "text" ? editorRefs.current.get(i)?.splitAtCaret() ?? null : null;
    setActiveText(null);
    pendingPosRef.current = i;
    fileRef.current?.click();
    // 파일 선택은 onFilesChosen 이 처리하나, 분할 위치 반영 위해 분할을 먼저 적용해 두고 그 사이 인덱스로 삽입.
    if (split) {
      editorRefs.current.get(i)?.blur();
      const mk = (t: string): CapBlock => ({ type: "text", text: t });
      const out: CapBlock[] = [];
      let gap = i;
      if (plainText(split.before).length) { out.push(mk(split.before)); gap = i + 1; }
      if (plainText(split.after).length) out.push(mk(split.after));
      onChange([...blocks.slice(0, i), ...out, ...blocks.slice(i + 1)], true);
      pendingPosRef.current = gap;
    }
  };
  // 붙여넣기 → 포커스한 텍스트 블록의 캐럿 위치에서 분할해 그 사이에 이미지 삽입(없으면 블록 다음/끝).
  const onPaste = async (e: React.ClipboardEvent) => {
    if (!allow.image) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const blobs: Blob[] = [];
    for (const it of Array.from(items)) if (it.type.startsWith("image/")) { const b = it.getAsFile(); if (b) blobs.push(b); }
    if (!blobs.length) return;
    e.preventDefault();
    const i = focusedRef.current;
    // 캐럿/분할 좌표를 비동기(이미지 축소) 전에 동기로 캡처.
    const split = i >= 0 && blocks[i]?.type === "text" ? editorRefs.current.get(i)?.splitAtCaret() ?? null : null;
    const srcs = await Promise.all(blobs.map((b) => blobToScaledDataUrl(b)));
    const imgBlocks = srcs.map((src) => ({ type: "image", image: { src } } as CapBlock));
    if (i >= 0 && blocks[i]?.type === "text" && split) {
      spliceAtCaret(i, imgBlocks, split);
    } else {
      const pos = i >= 0 ? i + 1 : blocks.length;
      onChange([...blocks.slice(0, pos), ...imgBlocks, ...blocks.slice(pos)], true);
    }
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
        {allow.html ? <button type="button" onClick={() => insertAt(pos, newHtml())} className={btn} data-testid={`block-add-html-${pos}`}><Code2 className="h-3.5 w-3.5" /> 미니앱</button> : null}
        {allow.divider ? <button type="button" onClick={() => insertAt(pos, newDivider())} className={btn} data-testid={`block-add-divider-${pos}`}><Minus className="h-3.5 w-3.5" /> 구분선</button> : null}
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
          ref={(h) => { editorRefs.current.set(i, h); }}
          value={b.text} onChange={(t) => setTextAt(i, t)}
          onBlur={(v) => onChange(blocks.map((bb, idx) => (idx === i && bb.type === "text" ? { ...bb, text: v } : bb)), true)}
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
    if (b.type === "html") {
      if (!editing) return <HtmlBlockView html={b.html} />;
      const h = b.html;
      const patch = (p: Partial<CapHtmlData>, doCommit: boolean) =>
        onChange(blocks.map((x, j) => (j === i ? { type: "html", html: { ...h, ...p } } : x)), doCommit);
      return (
        <div className="space-y-1.5 rounded-md border border-border/60 bg-background/40 p-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Code2 className="h-3.5 w-3.5" /> HTML 미니앱 <span className="text-[10px]">(sandbox 격리·외부 CDN 허용)</span>
            <label className="ml-auto flex items-center gap-1">높이
              <input type="number" value={h.height ?? 560} min={120} max={2000}
                onChange={(e) => patch({ height: Number(e.target.value) || 560 }, false)} onBlur={() => onChange(blocks, true)}
                className="w-16 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums text-foreground" />
            </label>
          </div>
          <textarea value={h.src} onChange={(e) => patch({ src: e.target.value }, false)} onBlur={() => onChange(blocks, true)}
            rows={6} spellCheck={false} data-testid={`block-html-src-${i}`}
            placeholder="<div>…</div> + <script>…</script>  (D3 등 외부 CDN 스크립트 가능)"
            className="w-full resize-y rounded border border-border bg-background px-2 py-1 font-mono text-[11px] leading-snug text-foreground" />
          {h.src.trim() ? <HtmlBlockView html={h} /> : <div className="py-3 text-center text-[11px] text-muted-foreground">미리보기 — HTML을 입력하세요</div>}
        </div>
      );
    }
    if (b.type === "divider") {
      // 내용 구획용 가로 구분선 — 편집/읽기 동일. (편집 시 이동·삭제 컨트롤은 바깥 래퍼가 담당)
      return <hr className="my-1.5 border-0 border-t border-border/70" />;
    }
    // chart
    if (!editing) return <InsightChartView chart={b.chart} mark={eventFrac} />;
    const c = b.chart;
    const lo = firstYearOf(series, c.series);
    const hi = lastYearOf(series, c.series);
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
        <PanelChart panel={panel} series={series?.[c.series]} fromYear={Math.min(c.from, c.to)} toYear={Math.max(c.from, c.to)}
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
          <div className="group/blk relative flex flex-col gap-1 rounded-md py-0.5"
            onFocusCapture={() => { focusedRef.current = i; setActiveText(b.type === "text" ? i : null); }}>
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
            {/* 커서 위치 삽입 툴바 — 포커스한 텍스트 블록 아래. mousedown preventDefault 로 캐럿 유지.
                마지막 블록에선 바로 밑 하단 고정바와 표/이미지/그래프가 중복돼 지저분하므로 숨긴다
                (중간 블록은 안 겹치니 유지 — 글 중간 커서 삽입 기능 보존). */}
            {b.type === "text" && activeText === i && i !== last && (allow.table || allow.image || allow.chart || allow.divider) ? (
              <div className="flex flex-wrap items-center gap-1 pt-0.5" onMouseDown={(e) => e.preventDefault()}>
                <span className="text-[10px] text-muted-foreground/60">커서 위치에 삽입:</span>
                {allow.table ? <button type="button" onClick={() => splitInsert(i, newTable())}
                  className="flex items-center gap-0.5 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
                  data-testid={`block-caret-table-${i}`}><TableIcon className="h-3 w-3" /> 표</button> : null}
                {allow.image ? <button type="button" onClick={() => splitInsertImage(i)}
                  className="flex items-center gap-0.5 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
                  data-testid={`block-caret-image-${i}`}><ImagePlus className="h-3 w-3" /> 이미지</button> : null}
                {allow.chart ? <button type="button" onClick={() => splitInsert(i, newChart())}
                  className="flex items-center gap-0.5 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
                  data-testid={`block-caret-chart-${i}`}><ChartIcon className="h-3 w-3" /> 그래프</button> : null}
                {allow.divider ? <button type="button" onClick={() => splitInsert(i, newDivider())}
                  className="flex items-center gap-0.5 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
                  data-testid={`block-caret-divider-${i}`}><Minus className="h-3 w-3" /> 구분선</button> : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}
      {insertBar(blocks.length, true)}
    </div>
  );
}
