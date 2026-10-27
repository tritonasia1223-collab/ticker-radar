import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import type { BalanceMotion } from "@/lib/use-comparison-balance-motion";
import { BALANCE_LEVELS, BALANCE_OUTCOMES, balanceRelation, type InsightBalance } from "../../../shared/comparison-balance";

type Props = {
  value: InsightBalance | null | undefined;
  canEdit: boolean;
  initiallyEditing?: boolean;
  compact?: boolean;
  motionValues: BalanceMotion;
  onChange: (patch: Partial<InsightBalance> | null) => boolean;
};

export function ComparisonBalance({ value, canEdit, onChange, motionValues, initiallyEditing = false, compact = false }: Props) {
  const [editing, setEditing] = useState(initiallyEditing);
  const [resultLines, setResultLines] = useState(1);
  const [moneyLines, setMoneyLines] = useState(1), [goodsLines, setGoodsLines] = useState(1);
  const section = useRef<HTMLElement>(null);
  const closeEditor = () => {
    setEditing(false);
    requestAnimationFrame(() => section.current?.scrollIntoView({ block: "nearest" }));
  };
  if (!value) return canEdit ? <button className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => {
    if (onChange({ money: 0, goods: 0, outcome: null })) setEditing(true);
  }}><Plus size={13} />돈·물건 도표 추가</button> : null;
  const relation = value.moneyLabel || value.goodsLabel ? "본문에 따른 해석" : balanceRelation(value);
  const result = value.outcomeLabel ?? (value.outcome ? BALANCE_OUTCOMES[value.outcome].detail : "");
  const gap = value.money - value.goods;
  const comparison = gap >= 2 ? ">>" : gap > 0 ? ">" : gap <= -2 ? "<<" : gap < 0 ? "<" : "≈";
  // Reserve two label lines in the paired view so both regions share a zero line.
  const extra = (Math.max(compact ? 2 : 1, moneyLines, goodsLines) - 1) * 24;
  const topPad = extra ? 10 : 0;
  const chartHeight = 214 + extra + topPad + (resultLines - 1) * 21;
  const center = compact ? 130 : 195;
  return <section ref={section} className="relative mt-3" aria-label="돈과 물건의 변화" data-testid="insight-balance">
    {canEdit && <button aria-label="돈·물건 도표 수정" aria-expanded={editing} className="absolute right-0 top-0 z-10 rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sky-400" onClick={() => editing ? closeEditor() : setEditing(true)}>{editing ? <X size={13} /> : <Pencil size={13} />}</button>}
    <svg viewBox={`0 ${-topPad} ${compact ? 260 : 360} ${chartHeight}`} className="mx-auto block w-full max-w-[440px]" style={{ ...(compact ? { height: "auto", aspectRatio: `260 / ${chartHeight}` } : { height: chartHeight * 194 / 214 }), ...(editing && canEdit ? { touchAction: "none" } : {}) }} role={editing && canEdit ? "group" : "img"} aria-label={`돈 ${value.moneyLabel || BALANCE_LEVELS.find(l => l.value === value.money)!.label}, 물건 ${value.goodsLabel || BALANCE_LEVELS.find(l => l.value === value.goods)!.label}. ${relation}${result ? `. ${result}` : ""}`}>
      <title>본문의 증감 방향과 강도를 나타낸 도표 · 실제 통계값이 아닙니다</title>
      {editing && canEdit && BALANCE_LEVELS.map(step => <g key={step.value} aria-hidden="true">
        <line x1={compact ? 40 : 94} x2={compact ? 245 : 338} y1={82 - step.value * 24} y2={82 - step.value * 24} className="stroke-foreground/10" strokeDasharray="2 4" />
        <text x={compact ? 32 : 84} y={86 - step.value * 24} textAnchor="end" fontSize="9" className="fill-muted-foreground">{step.label}</text>
      </g>)}
      <line x1={compact ? (editing && canEdit ? 40 : 15) : (editing && canEdit ? 94 : 38)} x2={compact ? 245 : 338} y1="82" y2="82" className="stroke-foreground/35" strokeDasharray="3 4" />
      {!editing && <text x={compact ? 4 : 25} y="86" fontSize="11" className="fill-muted-foreground">0</text>}
      <BalanceBar id="money" label="돈" x={compact ? 75 : 128} labelWidth={compact ? 100 : 124} color="#eab308" edge="#ca8a04" text="fill-yellow-700 dark:fill-yellow-300" target={value.money} wording={value.moneyLabel} level={motionValues.money} labelOpacity={motionValues.labelOpacity} editing={editing && canEdit} onCommit={money => onChange({ money })} onWording={moneyLabel => onChange({ moneyLabel })} onLines={setMoneyLines} extra={extra} />
      <BalanceBar id="goods" label="물건" x={compact ? 185 : 263} labelWidth={compact ? 100 : 124} color="#8b5cf6" edge="#8b5cf6" text="fill-violet-600 dark:fill-violet-300" target={value.goods} wording={value.goodsLabel} level={motionValues.goods} labelOpacity={motionValues.labelOpacity} editing={editing && canEdit} onCommit={goods => onChange({ goods })} onWording={goodsLabel => onChange({ goodsLabel })} onLines={setGoodsLines} extra={extra} />
      <motion.text data-testid="balance-comparison-symbol" x={center} y={165 + extra} textAnchor="middle" fontSize="23" fontWeight="700" className="fill-teal-700 dark:fill-teal-300" opacity={editing ? 1 : motionValues.comparisonOpacity}>{comparison}</motion.text>
      <BalanceResult center={center} width={compact ? 240 : 280} text={result} opacity={motionValues.resultOpacity} editing={editing && canEdit} onLines={setResultLines} extra={extra} onCommit={outcomeLabel => onChange({ outcomeLabel })} />
    </svg>
    {editing && canEdit && <div className="mt-1 px-2" data-testid="balance-controls">
      <p className="text-center text-[11px] text-muted-foreground">막대는 드래그 · 문구는 클릭해서 수정</p>
      <div className="flex items-center justify-between pt-1"><button className="text-[11px] text-muted-foreground hover:text-red-500" onClick={() => { if (onChange(null)) setEditing(false); }}>도표 제거</button><button className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background" onClick={closeEditor}>완료</button></div>
    </div>}
  </section>;
}

function BalanceResult({ center, width, text, opacity, editing, onCommit, onLines, extra }: { center: number; width: number; text: string; opacity: MotionValue<number>; editing: boolean; onCommit: (text: string) => boolean; onLines: (count: number) => void; extra: number }) {
  return <motion.g opacity={editing ? 1 : opacity}>
    <InlineChartText testId="balance-result" text={text} placeholder={editing ? "결과 문구 입력" : ""} x={center} y={201 + extra} inputY={201 + extra} width={width} fontSize={15} className="fill-teal-700 dark:fill-teal-300" editable={editing} ariaLabel="도표 결과 문구" maxLength={40} onCommit={onCommit} onLines={onLines} highlight />
  </motion.g>;
}

function BalanceBar({ id, label, x, labelWidth, color, edge, text, target, wording, level: animatedLevel, labelOpacity, editing, onCommit, onWording, onLines, extra }: {
  id: string; label: string; x: number; labelWidth: number; color: string; edge: string; text: string; target: InsightBalance["money"]; wording?: string; level: MotionValue<number>;
  labelOpacity: MotionValue<number>; editing: boolean; onCommit: (value: InsightBalance["money"]) => boolean; onWording: (text: string) => boolean;
  onLines: (count: number) => void; extra: number;
}) {
  const draft = useMotionValue<number>(target);
  const [step, setStep] = useState(target);
  const drag = useRef<{ pointer: number; y: number; start: number; value: InsightBalance["money"] } | null>(null);
  const setDraft = (n: number) => {
    const snapped = Math.max(-2, Math.min(2, Math.round(n))) as InsightBalance["money"];
    draft.set(snapped); setStep(snapped);
    return snapped;
  };
  useLayoutEffect(() => {
    if (!drag.current) { draft.set(target); setStep(target); }
  }, [target, editing, draft]);
  const level = editing ? draft : animatedLevel;
  const localY = (e: PointerEvent<SVGGElement>) => {
    const matrix = e.currentTarget.ownerSVGElement?.getScreenCTM();
    return matrix ? new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()).y : null;
  };
  const cancelDrag = () => { drag.current = null; setDraft(target); };
  const commit = (n: InsightBalance["money"]) => {
    if (n === target) return;
    if (!onCommit(n)) { setDraft(target); return; }
    // Direct manipulation settles immediately; note-to-note navigation keeps its animation.
    animatedLevel.stop(); animatedLevel.set(n);
  };
  // Derive both edges from one signed value so the bar always touches zero.
  const y = useTransform(level, n => 82 - Math.max(0, n) * 24);
  const height = useTransform(level, n => Math.abs(n) * 24);
  const fillOpacity = useTransform(level, [-.15, .15], [.16, 1]);
  const strokeOpacity = useTransform(level, [-.15, .15], [1, 0]);
  const zeroOpacity = useTransform(level, n => Math.max(0, 1 - Math.abs(n) * 8));
  const labelY = useTransform(level, n => 82 - n * 24 - 8 + 23 * Math.min(1, Math.max(0, -n / .3)));
  const labelText = wording || BALANCE_LEVELS[(editing ? step : target) + 2].label;
  return <g><g data-testid={`balance-bar-${id}`} data-level={editing ? step : target}
    role={editing ? "slider" : undefined} tabIndex={editing ? 0 : undefined}
    aria-label={editing ? `${label} 변화 단계` : undefined} aria-orientation={editing ? "vertical" : undefined}
    aria-valuemin={editing ? -2 : undefined} aria-valuemax={editing ? 2 : undefined}
    aria-valuenow={editing ? step : undefined} aria-valuetext={editing ? BALANCE_LEVELS[step + 2].label : undefined}
    style={editing ? { touchAction: "none", cursor: "ns-resize", userSelect: "none" } : undefined}
    className={editing ? "outline-none [&:focus-visible_.balance-handle]:stroke-foreground [&:focus-visible_.balance-handle]:stroke-[3]" : undefined}
    onPointerDown={e => {
      if (!editing || e.button !== 0 || drag.current) return;
      const y = localY(e); if (y === null) return;
      e.preventDefault(); e.currentTarget.focus({ preventScroll: true });
      drag.current = { pointer: e.pointerId, y, start: step, value: step };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => {
      const active = drag.current;
      if (!active || active.pointer !== e.pointerId) return;
      const y = localY(e); if (y === null) return;
      active.value = setDraft(active.start + (active.y - y) / 24);
    }}
    onPointerUp={e => {
      const active = drag.current;
      if (!active || active.pointer !== e.pointerId) return;
      const y = localY(e);
      const next = y === null ? active.value : setDraft(active.start + (active.y - y) / 24);
      drag.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      commit(next);
    }}
    onPointerCancel={e => { if (drag.current?.pointer === e.pointerId) cancelDrag(); }}
    onLostPointerCapture={e => { if (drag.current?.pointer === e.pointerId) cancelDrag(); }}
    onKeyDown={e => {
      if (!editing) return;
      if (e.key === "Escape" && drag.current) { e.preventDefault(); cancelDrag(); return; }
      if (drag.current) return;
      const next = e.key === "ArrowUp" || e.key === "ArrowRight" ? step + 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? step - 1 : e.key === "Home" ? -2 : e.key === "End" ? 2 : null;
      if (next === null) return;
      e.preventDefault(); commit(setDraft(next));
    }}>
    <motion.rect x={x - 23} y={y} width="46" height={height} rx="3" fill={color} fillOpacity={fillOpacity} stroke={edge} strokeOpacity={strokeOpacity} strokeWidth="1.5" />
    <motion.line x1={x - 23} x2={x + 23} y1="82" y2="82" stroke={color} strokeWidth="3" strokeLinecap="round" opacity={zeroOpacity} />
    {editing && <>
      <rect x={x - 30} y={Math.min(82, 82 - step * 24) - 12} width="60" height={Math.abs(step) * 24 + 24} fill="transparent" />
      <rect className="balance-handle" x={x - 13} y={82 - step * 24 - 4} width="26" height="8" rx="4" fill={color} stroke={edge} strokeWidth="1.5" pointerEvents="none" />
    </>}
    <text x={x} y={163 + extra} textAnchor="middle" fontSize="13" fontWeight="600" className="fill-foreground">{label}</text>
  </g>
    <InlineChartText testId={`balance-label-${id}`} text={labelText} x={x} y={labelY} inputY={82 - step * 24 + (step < 0 ? 15 : -8)} width={labelWidth} fontSize={12} className={text} opacity={editing ? 1 : labelOpacity} editable={editing} ariaLabel={`${label} 막대 설명`} maxLength={20} onCommit={onWording} above={target >= 0} onLines={onLines} />
  </g>;
}

// Keep text editing outside the draggable slider so selecting text never moves a bar.
function InlineChartText({ text, placeholder = "", x, y, inputY, width, fontSize, className, opacity = 1, editable, ariaLabel, maxLength, onCommit, testId, above = false, onLines, highlight = false }: {
  text: string; placeholder?: string; x: number; y: number | MotionValue<number>; inputY: number; width: number; fontSize: number; className: string; opacity?: number | MotionValue<number>;
  editable: boolean; ariaLabel: string; maxLength: number; onCommit: (text: string) => boolean; testId: string; above?: boolean; onLines?: (count: number) => void; highlight?: boolean;
}) {
  const [active, setActive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const measure = useRef<SVGTextElement>(null);
  const [lines, setLines] = useState<{ text: string; width: number }[]>([]);
  const displayed = text || placeholder;
  const lineHeight = fontSize + 6;
  const weight = fontSize === 15 ? 600 : 500;
  useLayoutEffect(() => {
    const el = measure.current;
    if (!el) return;
    let live = true;
    const layout = () => {
      if (!live) return;
      const parts: { text: string; width: number }[] = [];
      const chars = Array.from(displayed);
      const widthOf = (value: string) => { el.textContent = value; return el.getComputedTextLength(); };
      let start = 0;
      while (start < chars.length) {
        let end = start + 1;
        while (end <= chars.length && widthOf(chars.slice(start, end).join("")) <= width) end++;
        end = Math.max(start + 1, end - 1);
        if ((fontSize === 15 || width < 124) && end < chars.length) {
          const space = chars.lastIndexOf(" ", end - 1);
          if (space > start) end = space + 1;
        }
        const line = chars.slice(start, end).join("");
        parts.push({ text: line, width: widthOf(line) });
        start = end;
      }
      el.textContent = displayed;
      setLines(parts); onLines?.(Math.max(1, parts.length));
    };
    layout();
    document.fonts.ready.then(layout);
    return () => { live = false; };
  }, [displayed, width, fontSize, onLines]);
  useLayoutEffect(() => { if (!editable) setActive(false); }, [editable]);
  useLayoutEffect(() => { if (active) { input.current?.focus(); input.current?.select(); } }, [active]);
  const start = () => { if (editable) { cancelled.current = false; setActive(true); } };
  return <>
    <text ref={measure} fontSize={fontSize} fontWeight={weight} visibility="hidden" aria-hidden="true" pointerEvents="none">{displayed}</text>
    {active && editable ? <foreignObject x={x - width / 2} y={inputY - fontSize - 5} width={width} height={30}>
    <input ref={input} aria-label={ariaLabel} defaultValue={text} maxLength={maxLength} placeholder={placeholder}
      className="h-[28px] w-full min-w-0 rounded border border-teal-400 bg-background px-1 text-center font-medium text-foreground outline-none ring-1 ring-teal-400/30"
      style={{ fontSize, fontWeight: weight, userSelect: "text", touchAction: "auto" }}
      onBlur={e => { if (!cancelled.current) { const next = e.target.value.trim(); if (next !== text) onCommit(next); } setActive(false); }}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { e.preventDefault(); cancelled.current = true; setActive(false); }
      }} />
  </foreignObject> : <>
    {highlight && lines.map((line, index) => <rect key={index} data-testid="balance-result-highlight" x={x - line.width / 2 - 5} y={inputY - 6 + index * lineHeight} width={line.width + 10} height="10" rx="2" className="fill-teal-400/20 dark:fill-teal-300/20" />)}
    <motion.text data-testid={testId} x={x} y={y} opacity={opacity} textAnchor="middle" fontSize={fontSize} fontWeight={weight}
    role={editable ? "button" : undefined} tabIndex={editable ? 0 : undefined} aria-label={editable ? `${ariaLabel} 수정` : undefined}
    className={`${className}${editable ? " cursor-text underline decoration-dotted underline-offset-4 outline-none focus:decoration-solid" : ""}`}
    onClick={start} onKeyDown={e => { if (editable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); start(); } }}>
    {lines.map((line, index) => <tspan key={index} x={x} dy={index === 0 ? (above ? -(lines.length - 1) * lineHeight : 0) : lineHeight}>{line.text}</tspan>)}
  </motion.text></>}
  </>;
}
