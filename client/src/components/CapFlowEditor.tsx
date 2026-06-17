// 인과 플로우 에디터 (폼 기반). 블록 추가/삭제/순서변경, 분기(col) 지정, DB 저장.
// 엣지는 레이아웃 규칙으로 자동 생성:
//   - stack: 위→아래 선형 체인
//   - branch: center[0](source) → left/right 각 컬럼 체인 → center[last](merge)로 합류
import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { FlowDTO, FlowInputDTO } from "@/lib/capitalism-types";
import { KIND_STYLE } from "@/lib/capitalism-config";

interface EditNode {
  nodeKey: string;
  kind: string;
  inLabel: string;
  text: string;
  ref: string;
  col: string; // center | left | right (branch 전용)
}

const BLANK_NODE = (i: number): EditNode => ({
  nodeKey: `k${Date.now().toString(36)}${i}`,
  kind: "effect", inLabel: "", text: "", ref: "", col: "center",
});

function buildEdges(nodes: EditNode[], layout: string): { from: string; to: string }[] {
  if (layout !== "branch") {
    const e: { from: string; to: string }[] = [];
    for (let i = 1; i < nodes.length; i++) e.push({ from: nodes[i - 1].nodeKey, to: nodes[i].nodeKey });
    return e;
  }
  const center = nodes.filter((n) => (n.col || "center") === "center");
  const left = nodes.filter((n) => n.col === "left");
  const right = nodes.filter((n) => n.col === "right");
  const source = center[0];
  const merge = center.length > 1 ? center[center.length - 1] : undefined;
  const e: { from: string; to: string }[] = [];
  for (const col of [left, right]) {
    if (source && col[0]) e.push({ from: source.nodeKey, to: col[0].nodeKey });
    for (let i = 1; i < col.length; i++) e.push({ from: col[i - 1].nodeKey, to: col[i].nodeKey });
    if (merge && col.length) e.push({ from: col[col.length - 1].nodeKey, to: merge.nodeKey });
  }
  return e;
}

export function CapFlowEditor({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: FlowDTO | null; // null = 새 플로우
  onSaved: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("경제");
  const [layout, setLayout] = useState("stack");
  const [nodes, setNodes] = useState<EditNode[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setSlug(initial.slug);
      setTitle(initial.title);
      setDate(initial.date);
      setCategory(initial.category);
      setLayout(initial.layout);
      setNodes(initial.nodes.map((n) => ({
        nodeKey: n.id, kind: n.kind, inLabel: n.inLabel ?? "",
        text: n.text, ref: n.ref ?? "", col: n.col || "center",
      })));
    } else {
      setSlug(""); setTitle(""); setDate(""); setCategory("경제"); setLayout("stack");
      setNodes([BLANK_NODE(0), BLANK_NODE(1)]);
    }
    setErr(null);
  }, [open, initial]);

  function setNode(i: number, patch: Partial<EditNode>) {
    setNodes((prev) => prev.map((n, idx) => (idx === i ? { ...n, ...patch } : n)));
  }
  function move(i: number, dir: -1 | 1) {
    setNodes((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  async function remove() {
    if (!initial) return;
    if (!window.confirm(`「${initial.title}」 플로우를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setErr(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/capitalism/flows/${encodeURIComponent(initial.slug)}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : res.statusText);
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setDeleting(false);
    }
  }

  async function save() {
    setErr(null);
    if (!slug.trim() || !title.trim() || !date.trim()) {
      setErr("슬러그·제목·날짜는 필수입니다.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setErr("날짜는 YYYY-MM-DD 형식이어야 합니다.");
      return;
    }
    const cleanNodes = nodes.filter((n) => n.text.trim());
    if (cleanNodes.length === 0) {
      setErr("블록을 최소 1개 입력하세요.");
      return;
    }
    const payload: FlowInputDTO = {
      slug: slug.trim(),
      title: title.trim(),
      date: date.trim(),
      year: Number(date.slice(0, 4)),
      category,
      layout,
      nodes: cleanNodes.map((n) => ({
        nodeKey: n.nodeKey, kind: n.kind,
        inLabel: n.inLabel.trim() || null,
        text: n.text.trim(),
        ref: n.ref.trim() || null,
        col: layout === "branch" ? (n.col || "center") : null,
      })),
      edges: buildEdges(cleanNodes, layout),
    };
    setSaving(true);
    try {
      const res = await fetch("/api/capitalism/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error || res.statusText));
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "플로우 편집" : "새 플로우"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">슬러그 (고유키)</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="oilshock" disabled={!!initial} data-testid="input-slug" />
          </div>
          <div>
            <Label className="text-xs">날짜 (YYYY-MM-DD)</Label>
            <Input value={date} onChange={(e) => setDate(e.target.value)} placeholder="1973-10-17" data-testid="input-date" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">제목</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="1차 오일쇼크" data-testid="input-title" />
          </div>
          <div>
            <Label className="text-xs">카테고리</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="select-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="정치">정치</SelectItem>
                <SelectItem value="경제">경제</SelectItem>
                <SelectItem value="사회">사회</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">레이아웃</Label>
            <Select value={layout} onValueChange={setLayout}>
              <SelectTrigger data-testid="select-layout"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="stack">세로 스택 (선형)</SelectItem>
                <SelectItem value="branch">분기·합류</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {layout === "branch" ? (
          <p className="text-[11px] text-muted-foreground -mt-1">
            분기: 첫 center 블록이 출발점, 마지막 center 블록이 합류점. left/right 컬럼이 두 갈래입니다.
          </p>
        ) : null}

        <div className="space-y-2 mt-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">블록</Label>
            <Button size="sm" variant="outline" onClick={() => setNodes((p) => [...p, BLANK_NODE(p.length)])} data-testid="button-add-node">
              <Plus className="h-3.5 w-3.5 mr-1" /> 블록 추가
            </Button>
          </div>

          {nodes.map((n, i) => {
            const ks = KIND_STYLE[n.kind] ?? KIND_STYLE.effect;
            return (
              <div key={n.nodeKey} className="rounded-md border border-border p-2.5" style={{ borderLeft: `3px solid ${ks.c}` }} data-testid={`node-edit-${i}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Select value={n.kind} onValueChange={(v) => setNode(i, { kind: v })}>
                    <SelectTrigger className="h-8 w-[110px] text-xs" data-testid={`select-kind-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cause">원인</SelectItem>
                      <SelectItem value="event">사건</SelectItem>
                      <SelectItem value="effect">영향</SelectItem>
                      <SelectItem value="result">결과</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="h-8 text-xs flex-1" value={n.inLabel} onChange={(e) => setNode(i, { inLabel: e.target.value })} placeholder="라벨(선택) — 비우면 종류 표시" data-testid={`input-label-${i}`} />
                  {layout === "branch" ? (
                    <Select value={n.col} onValueChange={(v) => setNode(i, { col: v })}>
                      <SelectTrigger className="h-8 w-[90px] text-xs" data-testid={`select-col-${i}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="center">center</SelectItem>
                        <SelectItem value="left">left</SelectItem>
                        <SelectItem value="right">right</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                  <div className="flex">
                    <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => move(i, -1)} data-testid={`up-${i}`}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => move(i, 1)} data-testid={`down-${i}`}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-7 text-destructive" onClick={() => setNodes((p) => p.filter((_, idx) => idx !== i))} data-testid={`del-${i}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <Textarea value={n.text} onChange={(e) => setNode(i, { text: e.target.value })} placeholder="블록 내용" rows={2} className="text-xs mb-1.5" data-testid={`input-text-${i}`} />
                <Input className="h-8 text-xs" value={n.ref} onChange={(e) => setNode(i, { ref: e.target.value })} placeholder="참고/출처 (선택)" data-testid={`input-ref-${i}`} />
              </div>
            );
          })}
        </div>

        {err ? <p className="text-xs text-destructive">{err}</p> : null}

        <DialogFooter className="sm:justify-between">
          {initial ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={deleting || saving} data-testid="button-delete-flow">
              <Trash2 className="h-4 w-4 mr-1" /> {deleting ? "삭제 중…" : "플로우 삭제"}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button onClick={save} disabled={saving || deleting} data-testid="button-save-flow">{saving ? "저장 중…" : "저장"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
