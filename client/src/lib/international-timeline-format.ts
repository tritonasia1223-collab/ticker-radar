/** One-time source import. Never run this on the user's later rich-text edits. */
export function formatTimelineSource(source: string): string {
  // Markdown emphasis in the attachment is structural, not literal asterisks.
  const text = source.replace(/\*\(([^\n]*?)\)\*/g, "($1)").trim();
  const sections: string[] = [];
  let start = 0, depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (text[i] === "—" || text[i] === "ㅡ")) {
      sections.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  sections.push(text.slice(start).trim());
  const heading = sections.shift() ?? "";
  const notes: string[] = [];
  let title = "", cursor = 0;
  for (let i = 0; i < heading.length; i++) {
    if (heading[i] !== "(") continue;
    if (heading.slice(Math.max(0, i - 3), i + 3) === "401(k)") continue;
    let end = i + 1, nesting = 1;
    for (; end < heading.length && nesting; end++) {
      if (heading[end] === "(") nesting++;
      if (heading[end] === ")") nesting--;
    }
    if (nesting) break; // Preserve incomplete parentheses verbatim.
    title += heading.slice(cursor, i) + " ";
    notes.push(heading.slice(i, end));
    cursor = end;
    i = end - 1;
  }
  title = (title + heading.slice(cursor)).replace(/\s+/g, " ").trim();
  if (!title) return [heading, ...sections].filter(Boolean).join("\n");
  // Parentheses already in the explanatory section stay in context, in small type.
  return [title, ...notes, ...sections].filter(Boolean).join("\n");
}
