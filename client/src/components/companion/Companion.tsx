import { useEffect, useRef, useState, type PointerEvent } from "react";
import { MessageCircle, Minus, Plus, Send, Square } from "lucide-react";
import FiscusModel, { type FiscusMood } from "./FiscusModel";
import "./companion.css";

type Message = { id: number; role: "user" | "assistant"; content: string; preview?: boolean };
type Position = { x: number; y: number };
const prompts = ["안녕, 너를 소개해 줘", "어떤 대화를 할 수 있어?", "복잡한 생각을 정리하고 싶어"];

function previewReply(input: string) {
  if (/안녕|소개/.test(input)) return "안녕하세요. 저는 피스, FISCUS 옆에서 함께할 작은 대화 친구예요.\n\n지금은 모습을 살펴보는 미리보기라 준비된 예시 답변을 보여드리고 있어요. 오른쪽 아래의 저를 끌어서 편한 곳에 놓아보세요.";
  if (/수정|삭제|저장|찾아|자료/.test(input)) return "이번 버전에는 자료를 찾거나 수정하는 기능이 연결되어 있지 않아요. 실제 데이터에는 아무 변화도 생기지 않습니다.\n\n지금은 대화창의 크기와 위치, 메시지를 주고받는 느낌을 살펴볼 수 있어요.";
  if (/정리|생각/.test(input)) return "생각을 정리할 땐 세 가지로 나누어 적어보세요.\n\n1. 지금 알고 있는 것\n2. 아직 확실하지 않은 것\n3. 다음에 확인할 것\n\n이 답변은 대화창을 체험하기 위한 예시예요. GPT 연결 후에는 적어주신 내용에 맞춰 함께 정리할 수 있어요.";
  return "지금은 대화창을 체험하는 미리보기예요. 자유로운 질문에 대한 GPT 답변은 아직 연결되지 않았어요.\n\n연결 후에는 이 자리에서 질문하고, 문장을 다듬고, 생각을 정리할 수 있어요. 웹앱 자료에 접근하는 권한은 없는 상태입니다.";
}

export default function Companion() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const demoTimer = useRef<ReturnType<typeof setTimeout>>();
  const celebrationTimer = useRef<ReturnType<typeof setTimeout>>();
  const sequence = useRef(0);
  const clamp = (p: Position): Position => ({ x: Math.max(12, Math.min(p.x, window.innerWidth - 156)), y: Math.max(12, Math.min(p.y, window.innerHeight - 172)) });

  useEffect(() => {
    const resize = () => { setViewport({ width: window.innerWidth, height: window.innerHeight }); setPosition(p => p ? clamp(p) : p); };
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); clearTimeout(demoTimer.current); clearTimeout(celebrationTimer.current); };
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (open && (messages.length > 0 || busy || error)) bottom.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy, open, error]);

  function close() { setOpen(false); launcher.current?.focus(); }
  function cancel() {
    sequence.current++;
    clearTimeout(demoTimer.current); setBusy(false);
    clearTimeout(celebrationTimer.current); setCelebrating(false);
  }
  function fresh() { cancel(); setMessages([]); setDraft(""); setError(""); input.current?.focus(); }
  async function send(text = draft) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Message[] = [...messages, { id: Date.now(), role: "user", content }];
    setMessages(next); setDraft(""); setError(""); setBusy(true);
    clearTimeout(celebrationTimer.current); setCelebrating(false);
    const ticket = ++sequence.current;
    demoTimer.current = setTimeout(() => {
      if (sequence.current !== ticket) return;
      setMessages([...next, { id: Date.now(), role: "assistant", content: previewReply(content), preview: true }]); setBusy(false);
      setCelebrating(true); celebrationTimer.current = setTimeout(() => setCelebrating(false), 3000);
    }, 1400);
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) current.moved = true;
    if (current.moved) { setDragging(true); setPosition(clamp({ x: current.left + dx, y: current.top + dy })); }
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    suppressClick.current = Boolean(drag.current?.moved);
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const panelWidth = Math.min(390, viewport.width - 24);
  const panelHeight = Math.min(620, viewport.height - 184);
  const anchor = position ?? { x: viewport.width - 168, y: viewport.height - 180 };
  const panelLeft = Math.max(12, Math.min(anchor.x + 144 - panelWidth, viewport.width - panelWidth - 12));
  const panelTop = Math.max(12, Math.min(anchor.y - panelHeight - 8, viewport.height - panelHeight - 180));
  const modeLabel = "미리보기";
  const mood: FiscusMood = dragging ? "walk" : busy ? "think" : celebrating ? "success" : "idle";

  return <div className="fiscus-companion">
    {open && <section className="fiscus-chat" role="dialog" aria-modal="false" aria-label="피스와 대화" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} style={{ left: panelLeft, top: panelTop, width: panelWidth, height: panelHeight }}>
      <header className="fiscus-chat-header">
        <FiscusModel variant="mini" mood={mood} />
        <div className="fiscus-chat-identity"><strong>피스 <span>FISCUS</span></strong><small>{modeLabel}</small></div>
        <button type="button" className="fiscus-icon-button" title="새 대화" aria-label="새 대화" onClick={fresh}><Plus size={19} /></button>
        <button type="button" className="fiscus-icon-button" title="대화창 최소화" aria-label="대화창 최소화" onClick={close}><Minus size={19} /></button>
      </header>
      <div className="fiscus-chat-body" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? <div className="fiscus-welcome">
          <div className="fiscus-welcome-orbit"><FiscusModel variant="hero" /></div>
          <p className="fiscus-eyebrow">YOUR LITTLE THINKING PARTNER</p>
          <h2>생각을 나눌<br />작은 공간이 생겼어요.</h2>
          <p className="fiscus-welcome-copy">궁금한 것부터 떠오른 생각까지.<br />편하게 말을 걸어주세요.</p>
          <div className="fiscus-prompts">{prompts.map(prompt => <button type="button" key={prompt} onClick={() => void send(prompt)}><MessageCircle size={15} />{prompt}</button>)}</div>
        </div> : <div className="fiscus-messages">{messages.map(message => <div key={message.id} className={`fiscus-message fiscus-message-${message.role}`}>
          {message.role === "assistant" && <span className="fiscus-message-name">피스{message.preview && <small>예시 답변</small>}</span>}
          <div className="fiscus-message-bubble">{message.content}</div>
        </div>)}</div>}
        {busy && <div className="fiscus-thinking" role="status"><span /><span /><span /><small>예시 답변을 준비하고 있어요</small></div>}
        {error && <div className="fiscus-chat-error" role="alert">{error}</div>}
        <div ref={bottom} />
      </div>
      <footer className="fiscus-chat-footer">
        <p className="fiscus-mode-note">지금은 예시 대화예요. GPT 연결 전입니다.</p>
        <form className="fiscus-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
          <textarea ref={input} aria-label="피스에게 메시지" placeholder="피스에게 말 걸기…" rows={2} maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
            event.stopPropagation();
            if (event.key === "Escape") { close(); return; }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
          }} />
          {busy ? <button type="button" className="fiscus-send" aria-label="답변 중지" onClick={cancel}><Square size={15} fill="currentColor" /></button> : <button type="submit" className="fiscus-send" aria-label="메시지 보내기" disabled={!draft.trim()}><Send size={17} /></button>}
        </form>
        <div className="fiscus-footer-caption"><span>대화 전용 · 자료 접근 권한 없음</span><span>Shift + Enter 줄바꿈</span></div>
      </footer>
    </section>}
    <div className="fiscus-launcher-wrap" style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}>
      {!open && messages.length === 0 && <span className="fiscus-launcher-hint">생각을 나눠볼까요?</span>}
      <button type="button" ref={launcher} className={`fiscus-launcher ${open ? "fiscus-launcher-open" : ""}`} aria-label={open ? "피스 대화창 닫기" : "피스와 대화하기"} aria-expanded={open} title="클릭해서 대화 · 끌어서 이동" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; } setOpen(value => !value);
      }}>
        <FiscusModel mood={mood} />
      </button>
      <span className="fiscus-launcher-label">{busy ? "생각 중…" : celebrating ? "딩동!" : "피스"}</span>
    </div>
  </div>;
}
