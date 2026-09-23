// 인사이트·메타 카드 편집의 저장 정책(순수 부분). 컴포넌트는 이 전이 규칙만 따르고 실제 저장 호출은 밖에서 한다.
//   · 타이핑·블록 구조 변경은 로컬 초안만 바꾼다(dirty). 키 입력마다 부모 저장기를 부르지 않는다 — 그게 버벅임의 원인이었다.
//   · '저장'(버튼·Ctrl+S)과 '이탈'(패널 닫기·다른 카드로 전환·언마운트·페이지 숨김)에서만, 그것도 dirty 일 때만 한 번 저장한다.
//   · dirty 인 동안은 바깥(협업 폴링)에서 온 새 값으로 초안을 재시드하지 않는다. 저장 뒤에는 서버본을 따른다.
export interface DraftState<T> {
  value: T;          // 편집기가 보여 주는 값(초안)
  dirty: boolean;    // 마지막 저장 이후 바뀐 게 있는가
  saved: T;          // 마지막으로 저장(또는 시드)한 값
}

export const seedDraft = <T>(value: T): DraftState<T> => ({ value, dirty: false, saved: value });

// 값 비교(블록·제목은 순수 데이터라 직렬화 비교로 충분).
const sameValue = <T>(a: T, b: T): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

// 편집 중 변경. 저장하지 않는다. 마지막 저장값과 같은 값이면(리치텍스트가 변경 없는 blur 에도 콜백을 부른다) dirty 로 두지 않는다.
export const changeDraft = <T>(state: DraftState<T>, value: T): DraftState<T> => ({ ...state, value, dirty: !sameValue(value, state.saved) });

// 값은 그대로인데 저장할 게 생겼음(예: 표 셀처럼 blur 때만 값이 올라오는 자식 편집기의 입력). 이미 dirty 면 같은 객체.
export const markDraftDirty = <T>(state: DraftState<T>): DraftState<T> => (state.dirty ? state : { ...state, dirty: true });

// 저장하지 않고 버림(명시적 삭제 등) — 이탈 저장이 일어나지 않게 clean 으로.
export const discardDraft = <T>(state: DraftState<T>): DraftState<T> => (state.dirty ? { ...state, dirty: false, saved: state.value } : state);

// 저장 결정: dirty 이고 값이 실제로 달라졌을 때만 값을 내주고 상태를 clean 으로. 아니면 null(저장 호출 없음).
export function takeDraftForSave<T>(state: DraftState<T>): { next: DraftState<T>; toSave: T | null } {
  if (!state.dirty) return { next: state, toSave: null };
  if (sameValue(state.value, state.saved)) return { next: { ...state, dirty: false }, toSave: null }; // 표시만 켜졌고 결국 같은 값
  return { next: { value: state.value, dirty: false, saved: state.value }, toSave: state.value };
}

// 바깥에서 새 값이 왔을 때: dirty 면 무시(타이핑 보호), 아니면 재시드.
export function acceptRemote<T>(state: DraftState<T>, incoming: T): DraftState<T> {
  return state.dirty ? state : seedDraft(incoming);
}

// 이탈(닫기·전환·언마운트·페이지 숨김) 시 저장해야 하는가 — dirty 와 같다. 이름을 붙여 의도를 드러낸다.
export const shouldSaveOnLeave = <T>(state: DraftState<T>): boolean => state.dirty;

// 저장 단축키: Ctrl+S / Cmd+S (편집기 안에서). 브라우저의 '페이지 저장' 대화상자를 막는 판단은 호출부가 한다.
export const isSaveShortcut = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean =>
  (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "s" || e.key === "S");

// 메타 카드 목록 갱신(id 기준). 같은 틱에 여러 카드가 저장돼도 호출부가 '마지막으로 보낸 목록'을 넘기면 누적된다.
export function upsertCardById<C extends { id: string }>(cards: C[], next: C): C[] {
  return cards.some((c) => c.id === next.id) ? cards.map((c) => (c.id === next.id ? next : c)) : [...cards, next];
}
export const removeCardById = <C extends { id: string }>(cards: C[], id: string): C[] => cards.filter((c) => c.id !== id);
