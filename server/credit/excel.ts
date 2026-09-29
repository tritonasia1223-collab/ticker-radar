import ExcelJS from "exceljs";
import { type Point, type Source } from "../../shared/credit/schema.js";

function scalar(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && "result" in v) return v.result;
  if (v && typeof v === "object" && "richText" in v) return v.richText.map(t => t.text).join("");
  return v;
}
// 연간·분기 합계와 월별 관측을 섞지 않고, 헤더·단위·대상을 확인한 뒤 추출한다.
export async function parseIssuanceWorkbook(bytes: Buffer, src: Source, today: string): Promise<Point[]> {
  const spec = src.workbook!; const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as any);
  const sheet = book.getWorksheet(spec.sheet), contents = book.getWorksheet(spec.updateSheet);
  if (!sheet || !contents) throw new Error("엑셀 시트 구조 변경");
  if (sheet.getCell("B1").text !== spec.security || sheet.getCell("B2").text !== "Issuance" || sheet.getCell("B3").text !== spec.units) throw new Error("엑셀 대상·단위 불일치");
  let column = 0;
  sheet.getRow(8).eachCell((cell, n) => { if (!column && cell.text === spec.column) column = n; });
  if (!column) throw new Error("엑셀 발행액 열 없음");
  const update = scalar(contents.getCell("C2").value);
  if (!(update instanceof Date) || update.toISOString().slice(0, 10) > today) throw new Error("엑셀 갱신일 오류");
  const points: Point[] = []; const dates = new Set<string>();
  sheet.eachRow(row => {
    const period = scalar(row.getCell(1).value); if (!(period instanceof Date)) return;
    const date = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (date.slice(0, 7) >= today.slice(0, 7)) return;
    const value = scalar(row.getCell(column).value);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || dates.has(date)) throw new Error("엑셀 월별 발행액 결측·중복·범위 오류");
    dates.add(date); points.push({ date, value, basis: src.basis, sourceUrl: spec.downloadUrl });
  });
  if (!points.length) throw new Error("엑셀 월별 관측 없음");
  // 전체 파일의 갱신일을 과거 개별 월의 발표일로 소급하지 않는다.
  return points.sort((a, b) => a.date.localeCompare(b.date));
}
