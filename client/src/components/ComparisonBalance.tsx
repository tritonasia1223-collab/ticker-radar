import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import type { BalanceMotion } from "@/lib/use-comparison-balance-motion";
import { BALANCE_LEVELS, BALANCE_OUTCOMES, balanceRelation, type InsightBalance } from "../../../shared/comparison-balance";

type Props = {
  value: InsightBalance | null | undefined;
  canEdit: boolean;
  initiallyEditing?: boolean;
  motionValues: BalanceMotion;
  onChange: (patch: Partial<InsightBalance> | null) => boolean;
};

export function ComparisonBalance({ value, canEdit, onChange, motionValues, initiallyEditing = false }: Props) {
  const [editing, setEditing] = useState(initiallyEditing);
  const section = useRef<HTMLElement>(null);
  const closeEditor = () => {
    setEditing(false);
    requestAnimationFrame(() => section.current?.scrollIntoView({ block: "nearest" }));
  };
  if (!value) return canEdit ? <button className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => {
    if (onChange({ money: 0, goods: 0, outcome: null })) setEditing(true);
  }}><Plus size={13} />돈·물건 도표 추가</button> : null;
  const relation = balanceRelation(value);
  const result = value.outcomeLabel ?? (value.outcome ? BALANCE_OUTCOMES[value.outcome].detail : "");
  const gap = value.money - value.goods;
  const comparison = gap >= 2 ? ">>" : gap > 0 ? ">" : gap <= -2 ? "<<" : gap < 0 ? "<" : "≈";
  return <section ref={section} className="relative mt-3" aria-label="돈과 물건의 변화" data-testid="insight-balance">
    {canEdit && <button aria-label="돈·물건 도표 수정" aria-expanded={editing} className="absolute right-0 top-0 z-10 rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sky-400" onClick={() => editing ? closeEditor() : setEditing(true)}>{editing ? <X size={13} /> : <Pencil size={13} />}</button>}
    <svg viewBox="0 0 360 214" className="mx-auto block h-[194px] w-full max-w-[440px]" style={editing && canEdit ? { touchAction: "none" } : undefined} role={editing && canEdit ? "group" : "img"} aria-label={`돈 ${BALANCE_LEVELS.find(l => l.value === value.money)!.label}, 물건 ${BALANCE_LEVELS.find(l => l.value === value.goods)!.label}. ${relation}${result ? `. ${result}` : ""}`}>
      <title>본문의 증감 방향과 강도를 나타낸 도표 · 실제 통계값이 아닙니다</title>
      {editing && canEdit && BALANCE_LEVELS.map(step => <g key={step.value} aria-hidden="true">
        <line x1="94" x2="338" y1={82 - step.value * 24} y2={82 - step.value * 24} className="stroke-foreground/10" strokeDasharray="2 4" />
        <text x="84" y={86 - step.value * 24} textAnchor="end" fontSize="9" className="fill-muted-foreground">{step.label}</text>
      </g>)}
      <line x1={editing && canEdit ? 94 : 38} x2="338" y1="82" y2="82" className="stroke-foreground/35" strokeDasharray="3 4" />
      {!editing && <text x="25" y="86" fontSize="11" className="fill-muted-foreground">0</text>}
      <BalanceBar id="money" label="돈" x={128} color="#eab308" edge="#ca8a04" text="fill-yellow-700 dark:fill-yellow-300" target={value.money} level={motionValues.money} labelOpacity={motionValues.labelOpacity} editing={editing && canEdit} onCommit={money => onChange({ money })} />
      <BalanceBar id="goods" label="물건" x={263} color="#8b5cf6" edge="#8b5cf6" text="fill-violet-600 dark:fill-violet-300" target={value.goods} level={motionValues.goods} labelOpacity={motionValues.labelOpacity} editing={editing && canEdit} onCommit={goods => onChange({ goods })} />
      {!editing && <>
        <motion.text data-testid="balance-comparison-symbol" x="195" y="165" textAnchor="middle" fontSize="23" fontWeight="700" className="fill-teal-700 dark:fill-teal-300" opacity={motionValues.comparisonOpacity}>{comparison}</motion.text>
        {result && <BalanceResult text={result} opacity={motionValues.resultOpacity} />}
      </>}
    </svg>
    {editing && canEdit && <div className="mt-1 px-2" data-testid="balance-controls">
      <p className="text-center text-[11px] text-muted-foreground">막대를 위아래로 드래그 · 방향키로 한 칸씩 조정</p>
      <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">결과
        <input key={result} defaultValue={result} maxLength={40} placeholder="예: 호황형 골디락스" aria-label="도표 결과 문구" className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-foreground" onBlur={e => { const next = e.target.value.trim(); if (next !== result && !onChange({ outcomeLabel: next })) e.target.value = result; }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      </label>
      <div className="flex items-center justify-between pt-1"><button className="text-[11px] text-muted-foreground hover:text-red-500" onClick={() => { if (onChange(null)) setEditing(false); }}>도표 제거</button><button className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background" onClick={closeEditor}>완료</button></div>
    </div>}
  </section>;
}

function BalanceResult({ text, opacity }: { text: string; opacity: MotionValue<number> }) {
  const label = useRef<SVGTextElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => { setWidth(label.current?.getComputedTextLength() ?? 0); }, [text]);
  return <motion.g opacity={opacity}>
    <rect data-testid="balance-result-highlight" x={195 - width / 2 - 5} y="195" width={width + 10} height="10" rx="2" className="fill-teal-400/20 dark:fill-teal-300/20" />
    <text ref={label} data-testid="balance-result" data-placement="bottom" x="195" y="201" textAnchor="middle" fontSize="15" fontWeight="600" className="fill-teal-700 dark:fill-teal-300">{text}</text>
  </motion.g>;
}

function BalanceBar({ id, label, x, color, edge, text, target, level: animatedLevel, labelOpacity, editing, onCommit }: {
  id: string; label: string; x: number; color: string; edge: string; text: string; target: InsightBalance["money"]; level: MotionValue<number>;
  labelOpacity: MotionValue<number>; editing: boolean; onCommit: (value: InsightBalance["money"]) => boolean;
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
  const labelText = BALANCE_LEVELS[(editing ? step : target) + 2].label;
  return <g data-testid={`balance-bar-${id}`} data-level={editing ? step : target}
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
    <motion.text data-testid={`balance-label-${id}`} x={x} y={labelY} opacity={editing ? 1 : labelOpacity} textAnchor="middle" fontSize="12" fontWeight="500" className={text}>{labelText}</motion.text>
    {editing && <>
      <rect x={x - 30} y={Math.min(82, 82 - step * 24) - 12} width="60" height={Math.abs(step) * 24 + 24} fill="transparent" />
      <rect className="balance-handle" x={x - 13} y={82 - step * 24 - 4} width="26" height="8" rx="4" fill={color} stroke={edge} strokeWidth="1.5" pointerEvents="none" />
    </>}
    <text x={x} y="163" textAnchor="middle" fontSize="13" fontWeight="600" className="fill-foreground">{label}</text>
  </g>;
}
