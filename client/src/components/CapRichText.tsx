// 마커가 포함된 텍스트를 색상/하이라이트/내부링크가 적용된 span으로 렌더.
import { parseRich, MARK_BY_KEY } from "@/lib/capitalism-richtext";

export function CapRichText({
  text,
  className,
  onJump,
}: {
  text: string;
  className?: string;
  // 내부 링크 클릭 시 호출(대상 카드 slug). 없으면 링크는 밑줄만 표시되고 클릭 무동작.
  onJump?: (slug: string) => void;
}) {
  const segs = parseRich(text);
  return (
    <span className={className} style={{ whiteSpace: "pre-wrap" }}>
      {segs.map((s, i) => {
        // 내부 링크 — 위키 스타일 파란 밑줄, 클릭 시 해당 시점으로 점프.
        if (s.mark === "link" && s.linkSlug) {
          const slug = s.linkSlug;
          return (
            <span
              key={i}
              role="link"
              tabIndex={0}
              title="이 시점으로 이동"
              onClick={(e) => { e.stopPropagation(); onJump?.(slug); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onJump?.(slug); } }}
              style={{
                color: "#60a5fa",
                textDecoration: "underline",
                textDecorationColor: "rgba(96,165,250,0.6)",
                textUnderlineOffset: 2,
                cursor: onJump ? "pointer" : "default",
                fontWeight: 600,
              }}
              data-link-slug={slug}
            >
              {s.text}
            </span>
          );
        }
        if (s.mark && MARK_BY_KEY[s.mark]) {
          return <span key={i} style={MARK_BY_KEY[s.mark].style}>{s.text}</span>;
        }
        return <span key={i}>{s.text}</span>;
      })}
    </span>
  );
}
