import { describe, expect, it } from "vitest";
import { readHiddenCategories, visibleIndicatorIds } from "../client/src/lib/comparison-visibility";

describe("category visibility without selection loss", () => {
  const selected = ["dxy", "fx_jpy", "real_tb3ms", "gold", "cpi_level", "net_exports_gdp"];

  it("hides each category independently and restores only the selected subset in its original order", () => {
    expect(visibleIndicatorIds(selected, ["dollar"])).toEqual(["real_tb3ms", "gold", "cpi_level", "net_exports_gdp"]);
    expect(visibleIndicatorIds(selected, ["economy"])).toEqual(["dxy", "fx_jpy", "real_tb3ms", "gold"]);
    expect(visibleIndicatorIds(selected, ["dollar", "economy"])).toEqual(["real_tb3ms", "gold"]);
    expect(visibleIndicatorIds(selected, [])).toEqual(selected);
    expect(selected).toHaveLength(6);
  });

  it("never selects additional indicators, including when everything is hidden or selection changes while hidden", () => {
    expect(visibleIndicatorIds(["dxy", "cpi_level"], ["dollar", "economy"])).toEqual([]);
    expect(visibleIndicatorIds([], [])).toEqual([]);
    const edited = selected.filter(id => id !== "dxy").concat("fx_eur");
    expect(visibleIndicatorIds(edited, ["dollar"])).not.toContain("fx_eur");
    expect(visibleIndicatorIds(edited, [])).toEqual(edited);
    expect(visibleIndicatorIds(edited, [])).not.toContain("dxy");
  });

  it("accepts old preferences and filters malformed or unsupported saved categories", () => {
    for (const value of [undefined, null, "dollar", {}, 3]) expect(readHiddenCategories(value)).toEqual([]);
    expect(readHiddenCategories(["assets", "dollar", "dollar", "economy", null])).toEqual(["dollar", "economy"]);
  });
});
