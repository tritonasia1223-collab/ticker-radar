import { describe, expect, it } from "vitest";
import { extractLinks, newLinks, validateRto } from "../shared/world-refresh";
const source = { id: "test", name: "Publisher", url: "https://example.com/news/", include: "/news/.+", topic: "fab|data.center" };
describe("World source monitor", () => {
  it("normalizes official links, ignores tracking duplicates, navigation and scripts", () => {
    const links = extractLinks('<script><a href="/news/fake">New fab fake</a></script><a href="/news/fab?utm_source=x#top">New <b>fab</b> &amp; data center</a><a href="https://example.com/news/fab">Read more</a><a href="https://evil.test/news/fab">New fab overseas</a><a href="javascript:alert(1)">New fab announcement</a>', source);
    expect(links).toEqual([{ title: "New fab & data center", url: "https://example.com/news/fab" }]);
  });
  it("reports unseen links without relabeling title changes as new facts", () => {
    const a = { title: "Old title", url: "https://example.com/a" }, b = { title: "New article", url: "https://example.com/b" };
    expect(newLinks([a], [{ ...a, title: "Changed heading" }, b])).toEqual([b]);
    expect(newLinks([a, b], [a, b])).toEqual([]);
  });
  it("reads NRC titles from the adjacent table cell", () => {
    const html = '<tr><td><a href="/2026/26-001.pdf">26-001</a></td><td class="views-field views-field-body">Crane reactor license</td></tr>';
    expect(extractLinks(html, { ...source, id: "nrc", include: "\\.pdf$", topic: "Crane" })[0].title).toBe("Crane reactor license");
  });
});
describe("RTO publication guard", () => {
  const geometry = { type: "Polygon", coordinates: [[[-100, 30], [-100, 32], [-98, 32], [-98, 30], [-100, 30]]] };
  const fixture = () => ({ regions: ["CAISO", "ERCOT", "ISONE", "MISO", "NYISO", "PJM", "SPP"].map(code => ({ code, geometry: structuredClone(geometry) })) });
  it("accepts unchanged complete data", () => expect(() => validateRto(fixture(), fixture())).not.toThrow());
  it("rejects missing and duplicated regions", () => {
    const data = fixture(); data.regions[0].code = "ERCOT";
    expect(() => validateRto(fixture(), data)).toThrow(/seven/);
  });
  it("rejects a broken ring", () => {
    const data = fixture(); data.regions[0].geometry.coordinates[0].pop();
    expect(() => validateRto(fixture(), data)).toThrow(/ring/);
  });
  it("rejects implausible area changes", () => {
    const data = fixture(); data.regions[0].geometry.coordinates[0][1][1] = 60;
    expect(() => validateRto(fixture(), data)).toThrow(/area/);
  });
});
