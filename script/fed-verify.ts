// Fed 대차대조표 검증 하네스 (읽기전용). 계획서 §6 F1~F5.
//   실행:  npm run fed:verify        (cron 수집 직후 자동 실행 예정 — orphan 헬스체크와 동일 사상)
// 일회성 test 러너가 아니라 '영구 하네스': 단위·항등식·네거티브컨트롤을 상시 재검증한다(CLAUDE.md #3).
// 전부 통과해야 exit 0. 하나라도 실패하면 exit 1 (cron/배포 게이트).
import "dotenv/config";
import { loadAll, weeklyDates, seriesSorted, deriveAssets, deriveLiabilities, waterfall } from "../server/fed.js";

const M = 1_000_000; // musd 단위: 1e6 musd = $1T
const B = 1_000;     // 1e3 musd = $1B
type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];
const add = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0=일 … 6=토

async function main() {
  const all = await loadAll();
  const wdates = weeklyDates(all);
  if (wdates.length === 0) { console.error("데이터 없음 — 백필 먼저(npm run fed:backfill)"); process.exit(1); }

  // ── F1. 단위 정합성(전 시리즈 앵커) ── 고정 과거일의 공식 H.4.1 값과 저장값 일치.
  //   WALCL 뿐 아니라 자산(TREAST·MBS)·부채(준비금·역레포·TGA·현금)·RRP정규화까지 전부 앵커링해
  //   시리즈별 단위·정규화를 정밀 검증한다(±1 musd: RRP 는 billions×1000 부동소수 허용).
  const anchors: { id: string; date: string; exp: number }[] = [
    { id: "WALCL", date: "2022-04-13", exp: 8_965_487 },
    { id: "WALCL", date: "2024-06-26", exp: 7_231_163 },
    { id: "TREAST", date: "2024-06-26", exp: 4_453_571 },
    { id: "WSHOMCB", date: "2024-06-26", exp: 2_335_997 },
    { id: "WRESBAL", date: "2024-06-26", exp: 3_302_647 },  // 주간평균(참고)
    { id: "WLODLL", date: "2024-06-26", exp: 3_268_896 },   // 수요일 준비금(파생계산에 실제 사용)
    { id: "WLFN", date: "2024-06-26", exp: 2_301_532 },     // FR notes net 수요일(=화폐발행)
    { id: "WDFOL", date: "2024-06-26", exp: 9_682 },        // 해외공식예금(잔차 성분)
    { id: "WLRRAL", date: "2024-06-26", exp: 879_766 },
    { id: "WDTGAL", date: "2024-06-26", exp: 744_206 },
    { id: "WCURCIR", date: "2024-06-26", exp: 2_351_673 },  // 통화발행(참고)
    { id: "RRPONTSYD", date: "2024-06-26", exp: 490_156 }, // 490.156B × 1000
  ];
  const f1bad = anchors.filter((a) => { const v = all.get(a.id)?.get(a.date); return v == null || Math.abs(v - a.exp) > 1; });
  add("F1 단위앵커(12종)", f1bad.length === 0,
    f1bad.length === 0 ? `${anchors.length}개 시리즈·날짜 전부 일치`
      : `불일치: ${f1bad.map((a) => `${a.id}@${a.date} 기대 ${a.exp}/실제 ${all.get(a.id)?.get(a.date) ?? "없음"}`).join("; ")}`);

  // ── F2. 구조 정합(불가능 잔차 차단) ── 우리가 수집한 성분이 총자산을 '초과'하면(잔차 크게 음수)
  //   단위오류·중복계상이다. 단, 큰 양수 잔차는 정상(2008 CPFF/TALF 등 미수집 긴급대출이 기타자산으로
  //   잡힘 — 최대 2008-12 $1,018B). 부채잔차 하한은 분기말 역레포 스파이크(2015-09 −$255B) 허용.
  //   → 자산잔차 ≥ −$50B, 부채잔차 ≥ −$300B. 단위오류는 잔차를 조 단위로 날려 반드시 걸린다.
  let f2complete = 0, f2bad = 0; const f2ex: string[] = [];
  for (const d of wdates) {
    const a = deriveAssets(all, d), l = deriveLiabilities(all, d);
    if (!Number.isFinite(a.residual) || !Number.isFinite(l.residual)) continue; // 시리즈 시작 전 = 스킵
    f2complete++;
    const ok = a.residual >= -50 * B && l.residual >= -300 * B;
    if (!ok) { f2bad++; if (f2ex.length < 3) f2ex.push(`${d}: 자산잔차 ${Math.round(a.residual / B)}B, 부채잔차 ${Math.round(l.residual / B)}B`); }
  }
  add("F2 구조 정합(불가능잔차)", f2bad === 0, `완전주 ${f2complete} 중 위반 ${f2bad}${f2ex.length ? " — " + f2ex.join(" / ") : ""}`);

  // ── F3. 준비금 이중검증(워터폴 재구성) ── 연속 완전주 쌍에서 분해합이 실측 ΔWRESBAL 과 $5B 이내.
  //   대부분 대수적으로 정확 → 실패는 '날짜 정렬 어긋남/결측'을 잡는다(독립 크로스체크).
  let f3pairs = 0, f3ok = 0; const f3ex: string[] = [];
  for (let i = 1; i < wdates.length; i++) {
    const prev = wdates[i - 1], now = wdates[i];
    const lp = deriveLiabilities(all, prev), ln = deriveLiabilities(all, now);
    if (!Number.isFinite(lp.residual) || !Number.isFinite(ln.residual)) continue;
    f3pairs++;
    const wf = waterfall(all, prev, now);
    if (wf.reconError <= 5 * B) f3ok++;
    else if (f3ex.length < 3) f3ex.push(`${prev}→${now}: 오차 ${Math.round(wf.reconError / B)}B`);
  }
  const f3rate = f3pairs ? f3ok / f3pairs : 0;
  add("F3 준비금 워터폴 재구성", f3rate >= 0.95, `${f3ok}/${f3pairs} (${(f3rate * 100).toFixed(1)}%) $5B 이내${f3ex.length ? " — " + f3ex.join(" / ") : ""}`);

  // ── F4. 네거티브 컨트롤 ──
  //  (a) 일간 RRPONTSYD 에 주말 관측이 없어야(forward-fill 이 가짜 관측 생성 안 함).
  const rrpWeekend = seriesSorted(all, "RRPONTSYD").filter(([d]) => dow(d) === 0 || dow(d) === 6);
  //  (b) BTFP(2023-03 발족)는 발족 전 '비영값'이 없어야(시리즈 자체는 0으로 존재 — 발족 전 값 조작 없음).
  const btfpPre = seriesSorted(all, "H41RESPPALDKNWW").filter(([d, v]) => d < "2023-03-01" && v !== 0);
  const f4pass = rrpWeekend.length === 0 && btfpPre.length === 0;
  add("F4 네거티브 컨트롤", f4pass, `RRP 주말행 ${rrpWeekend.length} · BTFP 발족전(2023-03) 비영값 ${btfpPre.length} (둘 다 0이어야)`);

  // ── F5. 순유동성 크로스체크 ── 2022-12-28 시장통용 순유동성(WALCL − TGA − ONRRP) ≈ $5.85T ±3%.
  //   시장 통용 정의는 '오버나이트 역레포(RRPONTSYD)' 기준(§4 주간식의 WLRRAL 은 해외 RRP 풀 포함해 더 큼).
  //   계획서의 $6.1T 는 근사치였고 실측·시장통용값은 $5.85T. RRPONTSYD 정규화(billions×1000)도 함께 검증.
  const target = "2022-12-28";
  const near = (ds: string[]) => ds.reduce((b, d) => Math.abs(+new Date(d) - +new Date(target)) < Math.abs(+new Date(b) - +new Date(target)) ? d : b, ds[0]);
  const wDate = near(wdates);
  const rrpDates = seriesSorted(all, "RRPONTSYD").map(([d]) => d);
  const onrrp = all.get("RRPONTSYD")?.get(near(rrpDates));
  const walcl = all.get("WALCL")?.get(wDate), tga = all.get("WDTGAL")?.get(wDate);
  const nl = walcl != null && tga != null && onrrp != null ? walcl - tga - onrrp : NaN;
  const f5rel = Math.abs(nl - 5.85 * M) / (5.85 * M);
  add("F5 순유동성(2022-12)", Number.isFinite(nl) && f5rel <= 0.03, `${wDate} ONRRP기반 순유동성 $${(nl / M).toFixed(2)}T (기준 $5.85T, 편차 ${(f5rel * 100).toFixed(1)}%)`);

  // ── F6. 잔차 지배 검사(최근 체제) ── 부채 분해의 설명력 보증. 잔차(기타·자본)의 주간 변화가
  //   명시요인(TGA·역레포·현금)을 '지배'하면 분해가 무의미하다. WRESBAL(주간평균)을 수요일 스냅샷에
  //   섞던 버그가 원인이었고(§3), WLODLL/WLFN(수요일레벨)로 통일해 해소 — 최근160주 지배율 32%→2%.
  //   ⚠ 전-역사 대상이 아니라 '최근 ~3년(160주)'만 본다: 2008 GFC(재무부 SFP ~$500B)·2020 코비드
  //   긴급대출처럼 위기기엔 4요인이 담지 않는 대형 부채프로그램이 잔차로 잡히는 게 정상(설계상 미itemize).
  //   카드가 보여주는 건 현행 체제뿐이고, 회귀(주간평균 재혼입)는 최근창에서도 즉시 32%로 터져 게이트가 잡는다.
  //   기준: |Δ잔차| > max(|ΔTGA|,|Δ역레포|,|Δ현금|) 이면서 |Δ잔차| > $10B 인 최근주 비율 ≤ 5%.
  const F6WIN = 160, F6FLOOR = 10 * B;
  const f6win = wdates.slice(-(F6WIN + 1));
  let f6pairs = 0, f6dom = 0; const f6ex: string[] = [];
  for (let i = 1; i < f6win.length; i++) {
    const a = deriveLiabilities(all, f6win[i - 1]), b = deriveLiabilities(all, f6win[i]);
    if (![a.residual, b.residual, a.tga, b.tga, a.rrp, a.currency].every(Number.isFinite)) continue;
    f6pairs++;
    const dOther = Math.abs(b.residual - a.residual);
    const dNamed = Math.max(Math.abs(b.tga - a.tga), Math.abs(b.rrp - a.rrp), Math.abs(b.currency - a.currency));
    if (dOther > dNamed && dOther > F6FLOOR) { f6dom++; if (f6ex.length < 3) f6ex.push(`${f6win[i]}: Δ잔차 ${Math.round((b.residual - a.residual) / B)}B > 명시 ${Math.round(dNamed / B)}B`); }
  }
  const f6rate = f6pairs ? f6dom / f6pairs : 1;
  add("F6 잔차 지배(최근≤5%)", f6rate <= 0.05, `최근 ${f6pairs}주 중 지배 ${f6dom} (${(f6rate * 100).toFixed(1)}%, floor $10B)${f6ex.length ? " — " + f6ex.join(" / ") : ""}`);

  // ── 리포트 ──
  console.log("\n══ Fed 대차대조표 검증 (F1~F6) ══");
  for (const r of results) console.log(`  ${r.pass ? "✅" : "❌"} ${r.name.padEnd(22)} ${r.detail}`);
  const failed = results.filter((r) => !r.pass);
  console.log(failed.length === 0 ? "\n✅ 전부 통과 — 배포/증분 게이트 통과" : `\n❌ ${failed.length}개 실패 — ${failed.map((r) => r.name).join(", ")}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error("[fed:verify] 실패:", e); process.exit(1); });
