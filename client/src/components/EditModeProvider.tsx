import { createContext, useContext, useEffect, useState } from "react";

// 사이트 전역 '편집 ↔ 발표' 모드.
//  - edit(기본): 평소 작업 모드. 네비·편집 UI 정상.
//  - present(발표): 읽기 전용 + 네비 숨김 + 본문 확대 — 남에게 보여주기/발표용. 선택은 localStorage 로 유지.
type Mode = "edit" | "present";
const KEY = "app-mode";
const EditModeCtx = createContext<{ mode: Mode; editable: boolean; present: boolean; toggle: () => void }>({
  mode: "edit", editable: true, present: false, toggle: () => {},
});

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => {
    try { return localStorage.getItem(KEY) === "present" ? "present" : "edit"; } catch { return "edit"; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, mode); } catch { /* noop */ } }, [mode]);
  return (
    <EditModeCtx.Provider value={{ mode, editable: mode === "edit", present: mode === "present", toggle: () => setMode((m) => (m === "present" ? "edit" : "present")) }}>
      {children}
    </EditModeCtx.Provider>
  );
}

export const useEditMode = () => useContext(EditModeCtx);
