import type { CapMetaCard } from "./capitalism-types";
import { plainText } from "./capitalism-richtext";

// 목록용 제목만 추출한다. 이미지/HTML을 해석하거나 원본 내용을 수정하지 않는다.
function heading(raw = ""): string {
  return plainText(raw).split(/\r?\n/).map(line => line.trim()
    .replace(/^#{1,6}\s+/, "").replace(/\*\*|__/g, ""))
    .find(line => line && !/^[─━\-_*\s]+$/.test(line)) ?? "";
}

export function metaInsightTitle(card: CapMetaCard): string {
  const explicit = heading(card.title);
  if (explicit) return explicit;
  if (card.blocks?.length) {
    for (const block of card.blocks) {
      const title = block.type === "text" ? heading(block.text)
        : block.type === "table" ? heading(block.table.title) || heading(block.table.cells.flat().find(Boolean))
        : block.type === "image" ? heading(block.image.alt) : "";
      if (title) return title;
    }
  } else {
    const title = heading(card.text);
    if (title) return title;
    for (const table of card.tables ?? []) {
      const title = heading(table.title) || heading(table.cells.flat().find(Boolean));
      if (title) return title;
    }
  }
  return "제목 없는 인사이트";
}
