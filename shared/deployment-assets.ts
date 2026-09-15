// Vite may move the shared series loader out of the Capitalism route chunk.
// Follow only local JS dependencies, with cycle/size protection.
export async function findMacroAsset(entry: string, read: (name: string) => Promise<string>): Promise<string> {
  const queue = [entry], seen = new Set<string>();
  while (queue.length && seen.size < 80) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const text = await read(name);
    const data = text.match(/capitalism-series-[\w-]+\.json/)?.[0];
    if (data) return data;
    for (const match of text.matchAll(/["']\.\/([\w-]+\.js)["']/g)) if (!seen.has(match[1])) queue.push(match[1]);
  }
  throw new Error("Missing macro series asset in route dependencies");
}
