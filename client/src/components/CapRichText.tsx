// 마커가 포함된 텍스트를 색상/하이라이트가 적용된 span으로 렌더.
import { parseRich, MARK_BY_KEY } from "@/lib/capitalism-richtext";

export function CapRichText({ text, className }: { text: string; className?: string }) {
  const segs = parseRich(text);
  return (
    <span className={className}>
      {segs.map((s, i) =>
        s.mark && MARK_BY_KEY[s.mark] ? (
          <span key={i} style={MARK_BY_KEY[s.mark].style}>{s.text}</span>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </span>
  );
}
