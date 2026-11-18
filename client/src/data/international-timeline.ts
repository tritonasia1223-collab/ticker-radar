export const REGIONS = [
  { id: "us", name: "미국", subtitle: "달러 · 통화정책", color: "#4f76c7" },
  { id: "europe", name: "유럽", subtitle: "마르크 · 유럽 통합", color: "#268a79" },
  { id: "japan", name: "일본", subtitle: "엔 · 산업과 자본", color: "#b97b52" },
  { id: "emerging", name: "신흥국", subtitle: "차입 · 산업화", color: "#9170bf" },
  { id: "oil", name: "산유국", subtitle: "원유 · 달러 순환", color: "#b49539" },
] as const;
export type Region = typeof REGIONS[number]["id"];
export type TimelineLane = "us" | "de" | "fr" | "uk" | "jp" | "eu" | "emerging" | "oil";
export type TimelineEvent = { id: string; year: number; month?: number | null; date: string; region: Region; country: string; lane?: TimelineLane; labels?: string[]; title: string; body: string; scope?: "regional" | "global"; groupId?: string; endYear?: number | null; endMonth?: number | null; descriptionOnly?: boolean; revision?: string; pointRevision?: string; usRevision?: string; sourceIndex?: number };
// 사용자 제공 자료를 지역별로 나눈 편집 초안. 사실 검증·경제사 원본 동기화와는 별개.
// 날짜·인과관계 등은 원문 보존 파일과 대조해 후속 편집한다.
const entries: Omit<TimelineEvent, "id">[] = [
  { year: 1970, date: "6월", region: "us", country: "미국", title: "CD 규제 완화와 유로달러 차입 상환", body: "CD 규제 철폐를 계기로 미국 은행들이 유로달러 시장에서 차입을 상환하기 시작했다는 흐름." },
  { year: 1970, date: "7월~", region: "europe", country: "서독", title: "외국인 마르크 예금에 지준 부담", body: "외국인 예금의 지급준비율을 높여 유입을 억제. 그러나 독일 기업의 유로달러 차입 경로는 열려 있어 자금 유입 압력이 지속됨." },
  { year: 1971, date: "5월", region: "europe", country: "서독", title: "마르크 변동환율과 자본 유입 규제", body: "외국인 예금에 대한 이자 지급 금지, 외국인 대상 단기금융상품 판매 제한을 함께 시행. 환율 변동 허용 이후에도 이어질 투기성 유입에 대비." },
  { year: 1971, date: "10월", region: "europe", country: "영국", title: "이민법 제정", body: "사용자 자료의 노동 이동 전환점. 서독·프랑스의 외국인 노동력 유치와 대비해 읽기. 법 제정과 시행 시점, 제한 대상은 추가 확인 필요." },
  { year: 1972, date: "3월", region: "europe", country: "서독", title: "바르데포트: 기업의 해외 차입 억제", body: "해외 차입에 40% 무이자 현금 예치 의무를 부과했다는 자료. 은행 예금 규제를 우회하던 기업 차입 경로까지 조달 비용을 높임." },
  { year: 1972, date: "4월", region: "europe", country: "유럽 공동체", title: "스네이크 출범", body: "서독·프랑스·이탈리아·베네룩스 등이 공동으로 환율을 관리. 유럽 통화 간 개입을 제도화하며 1979년 EMS로 이어지는 기반이 됨." },
  { year: 1973, date: "3월", region: "us", country: "국제 통화체제", title: "브레턴우즈 고정환율체제의 종결", body: "주요 통화의 변동환율 전환. 유럽에서는 마르크 절상 압력과 해외 자금 유입 규제의 전환점을 함께 살펴볼 시기." },
  { year: 1973, date: "10월", region: "us", country: "미국", title: "1차 오일쇼크와 산업생산 위축", body: "제공 자료의 1973~1975년 산업생산 낙폭: 미국 약 13%. 국가별 비교의 기준·기간·출처는 추가 확인 예정." },
  { year: 1973, date: "10월", region: "europe", country: "유럽", title: "1차 오일쇼크", body: "제공 자료의 산업생산 낙폭(1973~1975): 이탈리아 15%, 프랑스 12%, 독일 10%, 영국 8~9%. 에너지 충격과 경기 위축이 겹침. 수치 출처 확인 필요." },
  { year: 1973, date: "10월", region: "japan", country: "일본", title: "오일쇼크 이후 산업생산 급감", body: "제공 자료의 1973~1975년 산업생산 낙폭은 약 17%. 같은 시기 미국·유럽의 산업 위축과 나란히 비교. 수치 출처 확인 필요." },
  { year: 1973, date: "11월 / 시점 확인", region: "europe", country: "서독 · 프랑스", title: "노동자 모집 중단에서 가족 정착으로", body: "제공 자료는 신규 노동자 모집 중단 이후 귀국보다 정착·가족 재결합이 확대된 흐름을 강조. 서독과 프랑스의 시행 시점은 구분 확인 필요. 주택·교육·복지 문제로 연결." },
  { year: 1973, date: "이후", region: "oil", country: "중동 산유국", title: "노동 이동과 송금의 새 경로", body: "유럽의 노동자 유입 제한과 산유국의 노동 수요 확대를 연결한 자료. 이주 노동자의 본국 송금을 페트로달러 순환의 또 다른 경로로 관찰." },
  { year: 1974, date: "1월", region: "us", country: "미국", title: "대외 자본이동 규제 해제", body: "이자평형세·대외대출 규제·해외투자 제한의 해제. 미국에서 해외로 자금이 나가는 경로가 다시 넓어짐." },
  { year: 1974, date: "연중", region: "europe", country: "서독", title: "자본 유입 억제에서 점진적 규제 해제로", body: "브레턴우즈 종료와 오일쇼크 이후 마르크 절상 압력이 풀리며, 1970~1973년의 규제 강화에서 해제 방향으로 전환했다는 자료." },
  { year: 1974, date: "4월 · 7월", region: "europe", country: "포르투갈 · 그리스", title: "남유럽 민주화의 시작", body: "포르투갈(4월), 그리스(7월)의 정치체제 전환. 오일쇼크와 함께 1970년대 유럽의 정치·경제 변화를 읽는 배경." },
  { year: 1974, date: "6월 이후", region: "europe", country: "서독 · 국제은행", title: "헤르슈타트 파산과 은행감독 공조", body: "헤르슈타트 은행 파산을 계기로 국제 은행감독 협력이 강화되고 바젤은행감독위원회 설립으로 이어짐. 파산 시점과 위원회 설립 시점은 구분." },
  { year: 1975, date: "연중", region: "europe", country: "영국", title: "북해유전과 무역수지", body: "제공 자료는 1975년 북해 원유 생산을 전환점으로 제시. 초기에는 국내 소비 대체, 이후 순수출로 이어지는 흐름. 생산 개시의 범위와 수치는 추가 확인." },
  { year: 1975, date: "9월 → 1977년", region: "europe", country: "서독", title: "독일의 금융완화", body: "자료상 재할인율은 6%에서 1975년 9월 3.5%, 1977년 12월 3%로 하락. 환율 방어 부담 완화와 무역흑자가 배경으로 제시됨." },
  { year: 1975, date: "11월", region: "europe", country: "스페인", title: "민주화 이행의 전환점", body: "포르투갈·그리스에 이어 스페인의 정치체제 전환을 남유럽 민주화의 흐름으로 연결." },
  { year: 1976, date: "3월 → 6월 → 12월", region: "europe", country: "영국", title: "파운드 위기와 IMF 구제금융", body: "파운드 투매 재발 → G10·BIS 지원 → 12월 IMF 구제금융. 유럽 내부의 경제 격차와 마르크의 위상 변화를 함께 살펴보기." },
  { year: 1976, date: "연중", region: "europe", country: "프랑스", title: "스네이크 이탈", body: "1973년 이탈리아 이탈에 이어 프랑스도 이탈. 유럽 공동 환율관리의 어려움이 드러남." },
  { year: 1977, date: "12월", region: "europe", country: "서독", title: "재할인율 3%", body: "1975년부터 이어진 금융완화의 연장. 다른 유럽 국가들의 통화 불안과 대비되는 독일의 정책 여건." },
  { year: 1978, date: "연중", region: "us", country: "미국", title: "카터 시기 달러 위기", body: "달러의 마르크 대비 큰 폭 하락. 준비자산 수요가 마르크로 이동하고 유럽 내부 환율 불안으로 연결됐다는 자료." },
  { year: 1978, date: "연중", region: "europe", country: "서독 · 유럽", title: "달러 불안이 유럽 통화협력을 자극", body: "마르크로 도피 자금이 쏠리면서 유럽 내 환율 격차가 확대. 역내 환율을 공동 관리할 EMS의 필요성이 커짐." },
  { year: 1979, date: "3월", region: "europe", country: "유럽", title: "EMS 출범: 환율 밴드와 ECU", body: "유럽 공동 환율관리체계 출범. ERM의 환율 밴드와 통화 바스켓인 ECU를 중심으로 구성. 독일 통화정책의 영향과 위기 대응의 한계를 함께 살펴보기. 국가별 밴드 예외·영국 참여 범위는 추가 확인." },
  { year: 1979, date: "10월", region: "europe", country: "영국", title: "외환통제 철폐", body: "영국의 대외 자본이동 규제가 해제되는 전환점. 런던 금융시장과 유로달러의 이후 흐름에 연결할 항목." },
];
export const INITIAL_EVENTS: TimelineEvent[] = entries.map((event, i) => ({ ...event, id: `source-20261117-${i}` }));
