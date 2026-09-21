import { describe, expect, it } from "vitest";
import { leadersForYear } from "../client/src/lib/capitalism-leaders";
import { leadersForYear as legacyLeadersForYear } from "../client/src/lib/capitalism-config";

describe("연도별 대통령·연준 의장 라벨", () => {
  it("1968~2027년 전체가 기존 하드코딩 표와 같다 — 규칙을 어긴 1977년(포드→카터)만 교정", () => {
    for (let y = 1968; y <= 2027; y++) {
      if (y === 1977) { expect(legacyLeadersForYear(y)?.president).toBe("카터"); expect(leadersForYear(y)).toEqual({ president: "포드→카터", fed: "번스" }); continue; }
      expect(leadersForYear(y), String(y)).toEqual(legacyLeadersForYear(y));
    }
  });

  it("기존 라벨(1968~2027)과 같은 결과를 낸다", () => {
    const cases: [number, string, string][] = [
      [1968, "존슨", "마틴"], [1969, "존슨→닉슨", "마틴"], [1970, "닉슨", "마틴→번스"], [1974, "닉슨→포드", "번스"],
      [1978, "카터", "번스→밀러"], [1979, "카터", "밀러→볼커"], [1981, "카터→레이건", "볼커"], [1987, "레이건", "볼커→그린스펀"],
      [1989, "레이건→부시(아버지)", "그린스펀"], [1993, "부시(아버지)→클린턴", "그린스펀"], [2001, "클린턴→부시(아들)", "그린스펀"],
      [2006, "부시(아들)", "그린스펀→버냉키"], [2009, "부시(아들)→오바마", "버냉키"], [2014, "오바마", "버냉키→옐런"],
      [2017, "오바마→트럼프", "옐런"], [2018, "트럼프", "옐런→파월"], [2021, "트럼프→바이든", "파월"], [2025, "바이든→트럼프", "파월"],
      [2026, "트럼프", "파월→워시"], [2027, "트럼프", "워시"],
    ];
    for (const [y, p, f] of cases) expect(leadersForYear(y), String(y)).toEqual({ president: p, fed: f });
  });

  it("1968년 이전도 해마다 바뀐다(더 이상 존슨·마틴으로 고정되지 않음)", () => {
    expect(leadersForYear(1963)).toEqual({ president: "케네디→존슨", fed: "마틴" });
    expect(leadersForYear(1961)).toEqual({ president: "아이젠하워→케네디", fed: "마틴" });
    expect(leadersForYear(1953)).toEqual({ president: "트루먼→아이젠하워", fed: "마틴" });
    expect(leadersForYear(1951)).toEqual({ president: "트루먼", fed: "맥케이브→마틴" });
    expect(leadersForYear(1948)).toEqual({ president: "트루먼", fed: "에클스→맥케이브" });
    expect(leadersForYear(1945)).toEqual({ president: "루스벨트→트루먼", fed: "에클스" });
    expect(leadersForYear(1934)).toEqual({ president: "루스벨트", fed: "블랙→에클스" });
    expect(leadersForYear(1929)).toEqual({ president: "쿨리지→후버", fed: "R.영" });
    expect(leadersForYear(1923)).toEqual({ president: "하딩→쿨리지", fed: "크리싱어" }); // 연준 의장 공석 뒤 5월 취임
    expect(leadersForYear(1922)).toEqual({ president: "하딩", fed: "W.하딩" });
    expect(leadersForYear(1914)).toEqual({ president: "윌슨", fed: "해믈린" });
  });

  it("연준 창설(1914) 전은 '—', 1789년 전은 null, 한 해 세 명이면 셋 다", () => {
    expect(leadersForYear(1913)).toEqual({ president: "태프트→윌슨", fed: "—" });
    expect(leadersForYear(1881)).toEqual({ president: "헤이스→가필드→아서", fed: "—" });
    expect(leadersForYear(1841)).toEqual({ president: "밴뷰런→W.H.해리슨→타일러", fed: "—" });
    expect(leadersForYear(1865)).toEqual({ president: "링컨→앤드루 존슨", fed: "—" });
    expect(leadersForYear(1857)).toEqual({ president: "피어스→뷰캐넌", fed: "—" });
    expect(leadersForYear(1833)).toEqual({ president: "잭슨", fed: "—" });
    expect(leadersForYear(1789)).toEqual({ president: "워싱턴", fed: "—" });
    expect(leadersForYear(1788)).toBeNull();
    expect(leadersForYear(NaN)).toBeNull();
  });
});
