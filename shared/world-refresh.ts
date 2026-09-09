import { geoArea } from "d3-geo";

export type Link = { title: string; url: string };
export type Source = { id: string; name: string; url: string; include: string; topic?: string; manual?: string };
const plain = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, n: string) => { const code = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n); return code <= 0x10ffff ? String.fromCodePoint(code) : entity; }).replace(/\s+/g, " ").trim();

// Only collect same-publisher HTTP links. These are review candidates, never executable input or verified facts.
export function extractLinks(html: string, source: Source): Link[] {
  const found = new Map<string, Link>();
  let clean = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  // NRC puts the descriptive title in a sibling table cell, not inside the PDF anchor.
  if (source.id === "nrc") clean = clean.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (row, cells: string) => {
    const title = cells.match(/<td\b[^>]*class="[^"]*views-field-body[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1];
    return title ? row.replace(/(<a\b[^>]*href="[^"]+\.pdf"[^>]*>)[\s\S]*?(<\/a>)/i, (_: string, a: string, end: string) => a + plain(title) + end) : row;
  });
  const include = new RegExp(source.include, "i"), topic = source.topic ? new RegExp(source.topic, "i") : null;
  for (const match of clean.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(plain(match[1]), source.url);
      const label = plain(match[2]).slice(0, 300);
      const title = label.length >= 8 && !/^(read more|learn more|view more)$/i.test(label) ? label : decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "").replace(/-/g, " ");
      if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, "") !== new URL(source.url).hostname.replace(/^www\./, "")) continue;
      url.hash = "";
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
      if (title.length < 8 || !include.test(url.pathname) || (topic && !topic.test(title + " " + url.pathname))) continue;
      const href = url.href;
      if (!found.has(href) || title.length > found.get(href)!.title.length) found.set(href, { title, url: href });
    } catch { /* Invalid anchors are not candidates. */ }
  }
  return [...found.values()].sort((a, b) => a.url.localeCompare(b.url));
}

export function newLinks(previous: Link[], current: Link[]): Link[] {
  const seen = new Set(previous.map(x => x.url));
  return current.filter(x => !seen.has(x.url));
}

// Guard unattended map writes against empty/partial responses, unmapped regions and gross geometry changes.
export function validateRto(before: any, after: any): void {
  const expected = ["CAISO", "ERCOT", "ISONE", "MISO", "NYISO", "PJM", "SPP"].sort();
  if (JSON.stringify(after.regions?.map((x: any) => x.code).sort()) !== JSON.stringify(expected)) throw new Error("RTO: expected exactly seven unique regions");
  for (const region of after.regions) {
    const old = before.regions.find((x: any) => x.code === region.code);
    const geometry = region.geometry;
    if (!["Polygon", "MultiPolygon"].includes(geometry?.type)) throw new Error(`RTO: invalid geometry ${region.code}`);
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    if (!polygons.length) throw new Error(`RTO: empty geometry ${region.code}`);
    for (const polygon of polygons) for (const ring of polygon) {
      if (ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) throw new Error(`RTO: open/short ring ${region.code}`);
      for (const point of ring) if (point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error(`RTO: invalid coordinate ${region.code}`);
    }
    const area = geoArea(geometry), oldArea = old ? geoArea(old.geometry) : 0;
    if (!(area > 0 && area < 2 * Math.PI && oldArea > 0 && area / oldArea > 0.75 && area / oldArea < 1.25)) throw new Error(`RTO: area changed >25%; human review required: ${region.code}`);
  }
}
