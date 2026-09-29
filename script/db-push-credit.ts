import "dotenv/config";
import { initializeCreditStorage } from "../server/credit/storage.js";

initializeCreditStorage().then(() => console.log("신용 모니터 전용 테이블 초기화 완료 — 기존 테이블 변경 없음")).catch(() => { console.error("신용 테이블 초기화 실패. DATABASE_URL 연결·권한을 확인하세요."); process.exitCode = 1; });
