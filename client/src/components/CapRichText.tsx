// 마커가 포함된 텍스트를 색상/하이라이트/내부링크가 적용된 span으로 렌더.
// 줄 단위로 말머리(불릿)를 인식해, 불릿 줄은 왼쪽 정렬 + 레벨별 기호로 표시하고
// 일반 줄은 기존처럼 가운데 정렬한다.
import { parseRich, MARK_BY_KEY, parseBulletLine, BULLET_GLYPH, MAX_BULLET_LEVEL, type RichSeg } from "@/lib/capitalism-richtext";

// 한 줄 분량의 (마크 유지) 세그먼트 조각.
interface LineSeg { text: string; mark?: string; linkSlug?: string; }

// 세그먼트 배열을 \n 기준으로 줄별 조각으로 분할(각 조각의 마크 유지).
function splitSegsToLines(segs: RichSeg[]): LineSeg[][] {
  const lines: LineSeg[][] = [[]];
  for (const s of segs) {
    const parts = s.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, mark: s.mark, linkSlug: s.linkSlug });
    });
  }
  return lines;
}

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
  const lines = splitSegsToLines(segs);

  // 줄 조각 → 인라인 span 렌더(마크/링크 적용).
  const renderInline = (parts: LineSeg[], keyBase: string) =>
    parts.map((s, i) => {
      if (s.mark === "link" && s.linkSlug) {
        const slug = s.linkSlug;
        return (
          <span
            key={`${keyBase}-${i}`}
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
        return <span key={`${keyBase}-${i}`} style={MARK_BY_KEY[s.mark].style}>{s.text}</span>;
      }
      return <span key={`${keyBase}-${i}`}>{s.text}</span>;
    });

  return (
    <span className={className} style={{ whiteSpace: "pre-wrap" }}>
      {lines.map((parts, li) => {
        // 줄 본문 평문(불릿 프리픽스 검사용) — 첫 조각이 마크 없는 일반 텍스트에 프리픽스가 담긴다.
        const lineText = parts.map((p) => p.text).join("");
        const meta = parseBulletLine(lineText);

        if (meta.bullet) {
          // 불릿 줄: 프리픽스(\t×레벨 + "• ")를 본문에서 제거한 조각으로 재구성.
          // 프리픽스는 항상 첫 조각(마크 없는 텍스트)에 들어 있으므로 그만큼 잘라낸다.
          const prefixLen = lineText.length - meta.body.length;
          const trimmed: LineSeg[] = [];
          let remain = prefixLen;
          for (const p of parts) {
            if (remain <= 0) { trimmed.push(p); continue; }
            if (p.text.length <= remain) { remain -= p.text.length; continue; }
            trimmed.push({ ...p, text: p.text.slice(remain) });
            remain = 0;
          }
          const lvl = Math.min(meta.level, MAX_BULLET_LEVEL);
          const glyph = BULLET_GLYPH[lvl];
          return (
            <span
              key={`l-${li}`}
              style={{
                display: "flex",
                textAlign: "left",
                paddingLeft: `${lvl * 0.85}em`,
                gap: "0.3em",
                alignItems: "baseline",
              }}
              data-bullet-level={lvl}
            >
              <span style={{ flex: "none", opacity: 0.8, userSelect: "none" }} aria-hidden>{glyph}</span>
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>{renderInline(trimmed, `l-${li}`)}</span>
            </span>
          );
        }

        // 일반 줄: 기존처럼(가운데 정렬은 부모 className=text-center 가 담당). 빈 줄도 높이 유지.
        return (
          <span key={`l-${li}`} style={{ display: "block" }}>
            {parts.length ? renderInline(parts, `l-${li}`) : "\u200b"}
          </span>
        );
      })}
    </span>
  );
}
