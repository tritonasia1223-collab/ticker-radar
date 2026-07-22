// 블록체인 학습 탭 — 챕터 콘텐츠(§6). 텍스트를 코드와 분리(문구 수정이 코드 변경이 되지 않게).
//   Phase 1: 8챕터 메타 + 도입 스텝 스텁. 각 챕터의 씬·인터랙션 스텝은 Phase 3~5 에서 채운다.
import type { ChapterId } from "@/lib/blockchain-edu/types";

export interface Step {
  text: string;       // 좌측 설명 패널에 표시되는 스텝 텍스트
  sceneId?: string;   // 우측 애니메이션 스테이지 씬 식별자(Phase 3~5)
}
export interface ChapterMeta {
  id: ChapterId;
  num: number;
  title: string;
  blurb: string;      // 챕터 목록·헤더용 한 줄 요약
  steps: Step[];
}

export const CHAPTERS: Record<ChapterId, ChapterMeta> = {
  ch1: { id: "ch1", num: 1, title: "두 개의 층, 그리고 L2의 스펙트럼",
    blurb: "L1/L2 정의와 놀이공원 비유. L2는 단일 종이 아니다.",
    steps: [
      { text: "블록체인에는 두 개의 층이 있습니다. L1은 현금, L2는 놀이공원 선불 팔찌예요. 아래 토글로 같은 송금이 층에 따라 비용·속도가 어떻게 달라지는지 보세요.", sceneId: "ch1-toggle" },
      { text: "그런데 L2는 단일 종이 아닙니다. 시퀀싱 정책·컴플라이언스·개방성은 각 운영사의 설계 선택지예요. 2026년의 L2 지형은 범용 체인을 넘어 기업 전용 체인의 시대입니다.", sceneId: "ch1-spectrum" },
    ] },
  ch2: { id: "ch2", num: 2, title: "입금 — 락앤민트",
    blurb: "ETH가 L1에 잠기고 L2에서 사본이 발행된다.",
    steps: [
      { text: "L2에 돈을 넣으면 무슨 일이 일어날까요? 코인이 이동하는 게 아니라, L1 브릿지 컨트랙트에 담보로 잠기고 L2에서 사본이 발행됩니다. '입금 실행'을 눌러보세요.", sceneId: "ch2-lockmint" },
    ] },
  ch3: { id: "ch3", num: 3, title: "L2의 작동원리 — 시퀀서·압축·블롭",
    blurb: "순서 결정권, 압축, 블롭 수수료 바닥의 패러독스.",
    steps: [
      { text: "시퀀서는 배치를 쌓을 뿐 아니라 '순서를 정하는 권력'을 가집니다. FCFS와 가스 경매를 토글해, MEV(프론트러닝)가 왜 생기고 어떤 설계가 막는지 체험하세요.", sceneId: "ch3-sequencer" },
      { text: "묶인 배치는 압축됩니다 — 서명을 제거하고 state diff만 남겨 바이트 수를 확 줄여요.", sceneId: "ch3-compression" },
      { text: "압축된 배치는 128KB 블롭에 담겨 L1 블록에 실립니다. 18.2일이 지나면 데이터는 사라지고 KZG 커밋먼트(지문)만 남아요.", sceneId: "ch3-blobtimeline" },
      { text: "블롭은 가스와 분리된 독립 fee 시장입니다. 수요를 타깃(14) 아래로 두면 base fee가 1 wei 바닥에 고착돼요. 이게 'L2 정산비가 거의 공짜'인 구조적 이유입니다.", sceneId: "ch3-blobfloor" },
    ] },
  ch4: { id: "ch4", num: 4, title: "수수료의 해부",
    blurb: "입금·스왑·송금·출금의 수수료가 누구에게 가는가. 소액↔거액 역전.",
    steps: [{ text: "이 탭의 클라이맥스. 4개 케이스의 수수료가 누구에게 가는지, 그리고 금액에 따라 고정비(가스)와 비례비(슬리피지·LP)가 어떻게 역전되는지. L2 정산비가 붕괴하면 운영사 마진이 어떻게 극대화되는지도 봅니다.", sceneId: "ch4-anatomy" }] },
  ch5: { id: "ch5", num: 5, title: "출금과 신뢰의 근거",
    blurb: "Optimistic vs ZK. 시퀀서가 멈추거나 거부하면.",
    steps: [{ text: "L2의 보안은 L1에서 상속됩니다. 출금 방식(Optimistic/ZK)을 고르고, 시퀀서가 멈추거나 나를 거부하는 시나리오를 눌러보세요. escape hatch가 왜 검열 저항의 최후 보루인지 드러납니다.", sceneId: "ch5-withdraw" }] },
  ch6: { id: "ch6", num: 6, title: "크로스체인",
    blurb: "공식 락앤민트 경로 vs 서드파티 유동성 브릿지.",
    steps: [{ text: "롯데월드 팔찌를 에버랜드에서 못 쓰는 문제. 두 경로를 레이스시켜 속도와 신뢰 가정의 트레이드오프를 보세요.", sceneId: "ch6-crosschain" }] },
  ch7: { id: "ch7", num: 7, title: "스테이블코인 — 달러의 락앤민트",
    blurb: "Ch2와 같은 그림, 담보만 다르다. 수수료는 보유 기간에 발생.",
    steps: [{ text: "담보를 ETH에서 국채·예금으로 바꾸면 스테이블코인입니다. USDC/USDG/OUSD를 골라 보유 이자가 누구 주머니로 가는지 보세요 — 수수료가 거래가 아니라 '보유 기간'에 발생합니다.", sceneId: "ch7-stablecoin" }] },
  ch8: { id: "ch8", num: 8, title: "RWA — 국채가 토큰이 되기까지",
    blurb: "파이프라인, 토큰이 대표하는 '권리'의 스펙트럼, 그리고 결산.",
    steps: [
      { text: "국채가 토큰이 되는 파이프라인: 국채 → 커스터디 → 토큰화 플랫폼 → 온체인 토큰. 일반 토큰과 달리 화이트리스트 전송 제한이 걸립니다.", sceneId: "ch8-pipeline" },
      { text: "같은 락앤민트 외형의 세 토큰 — 펀드 지분·주식 토큰·스테이블코인 — 은 붙는 법적 권리가 전혀 다릅니다. 발행사 파산 시나리오도 눌러보세요.", sceneId: "ch8-rights" },
      { text: "여정 결산서. 지금까지 원장에 기록한 거래의 수수료가 누구에게 얼마나 갔는지, 전부 L1이었다면 얼마였을지 비교합니다.", sceneId: "ch8-receipt" },
    ] },
};

export const CHAPTER_LIST: ChapterMeta[] = Object.values(CHAPTERS).sort((a, b) => a.num - b.num);
