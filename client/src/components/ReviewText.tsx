import type { ReactNode } from "react";

type Amount = { text: string; value: number };
const lines = (text: string) => text.replace(/([.!?])\s+/g, "$1\n");

/** 금액은 문장에 등장하는 순서대로 전달한다. 소수점은 줄바꿈하지 않는다. */
export function ReviewText({ text, amounts = [], className = "" }: { text: string; amounts?: Amount[]; className?: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const amount of amounts) {
    const index = text.indexOf(amount.text, cursor);
    if (index < 0) continue;
    parts.push(lines(text.slice(cursor, index)));
    parts.push(<span key={`${index}-${amount.text}`} className="font-semibold" style={{ color: amount.value > 0 ? "#1F7A4D" : amount.value < 0 ? "#B3402E" : undefined }}>{amount.text}</span>);
    cursor = index + amount.text.length;
  }
  parts.push(lines(text.slice(cursor)));
  return <p className={`whitespace-pre-line ${className}`}>{parts}</p>;
}
