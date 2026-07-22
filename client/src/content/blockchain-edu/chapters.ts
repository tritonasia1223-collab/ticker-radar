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
    steps: [{ text: "블록체인에는 두 개의 층이 있습니다. L1은 현금, L2는 놀이공원 선불 팔찌예요. 이 여정에서 돈이 층을 오가며 어떻게 수수료가 쪼개지는지 따라가 봅니다.", sceneId: "intro" }] },
  ch2: { id: "ch2", num: 2, title: "입금 — 락앤민트",
    blurb: "ETH가 L1에 잠기고 L2에서 사본이 발행된다.",
    steps: [{ text: "코인이 이동하는 게 아니라, 담보로 잠기고 사본이 생깁니다.", sceneId: "lockmint" }] },
  ch3: { id: "ch3", num: 3, title: "L2의 작동원리 — 시퀀서·압축·블롭",
    blurb: "순서 결정권, 압축, 블롭 수수료 바닥의 패러독스.",
    steps: [{ text: "시퀀서는 배치를 쌓을 뿐 아니라 '순서를 정하는 권력'을 가집니다. 압축된 배치는 블롭에 담겨 L1에 실리고, 블롭 수수료는 종종 바닥에 고착됩니다.", sceneId: "sequencer" }] },
  ch4: { id: "ch4", num: 4, title: "수수료의 해부",
    blurb: "입금·스왑·송금·출금의 수수료가 누구에게 가는가. 소액↔거액 역전.",
    steps: [{ text: "같은 거래라도 소액일 땐 가스(고정비)가, 거액일 땐 슬리피지·LP(비례비)가 지배합니다. 금액 슬라이더로 그 역전을 직접 느껴보세요.", sceneId: "anatomy" }] },
  ch5: { id: "ch5", num: 5, title: "출금과 신뢰의 근거",
    blurb: "Optimistic vs ZK. 시퀀서가 멈추거나 거부하면.",
    steps: [{ text: "L2의 보안은 L1에서 상속됩니다. escape hatch는 장애 대비책일 뿐 아니라 검열 저항의 최후 보루예요.", sceneId: "withdraw" }] },
  ch6: { id: "ch6", num: 6, title: "크로스체인",
    blurb: "공식 락앤민트 경로 vs 서드파티 유동성 브릿지.",
    steps: [{ text: "롯데월드 팔찌를 에버랜드에서 못 쓰는 문제. 빠른 브릿지는 별도 신뢰를 요구합니다.", sceneId: "crosschain" }] },
  ch7: { id: "ch7", num: 7, title: "스테이블코인 — 달러의 락앤민트",
    blurb: "Ch2와 같은 그림, 담보만 다르다. 수수료는 보유 기간에 발생.",
    steps: [{ text: "담보를 ETH에서 국채·예금으로 바꾸면 스테이블코인입니다. 수수료가 거래가 아니라 '보유 기간'에 발생하죠.", sceneId: "stablecoin" }] },
  ch8: { id: "ch8", num: 8, title: "RWA — 국채가 토큰이 되기까지",
    blurb: "파이프라인, 그리고 토큰이 대표하는 '권리'의 스펙트럼.",
    steps: [{ text: "락앤민트 그림이 같아도, 토큰에 붙는 법적 권리가 자산의 실체를 결정합니다. 온체인에서 보이는 건 토큰이지 권리가 아니에요.", sceneId: "rwa" }] },
};

export const CHAPTER_LIST: ChapterMeta[] = Object.values(CHAPTERS).sort((a, b) => a.num - b.num);
