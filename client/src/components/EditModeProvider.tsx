import { createContext, useContext, useEffect, useState } from "react";

// 사이트 전역 '보기 ↔ 편집' 모드. 기본은 '보기(읽기 전용)' — 편집기(contentEditable·저장 로직)를
// 안 태워 오편집·편집기 크래시를 피하고, 편집이 필요할 때만 토글로 켠다. 선택은 localStorage 로 유지.
type Mode = "view" | "edit";
const KEY = "app-edit-mode";
const EditModeCtx = createContext<{ mode: Mode; editable: boolean; toggle: () => void }>({
  mode: "view", editable: false, toggle: () => {},
});

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => {
    try { return localStorage.getItem(KEY) === "edit" ? "edit" : "view"; } catch { return "view"; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, mode); } catch { /* noop */ } }, [mode]);
  return (
    <EditModeCtx.Provider value={{ mode, editable: mode === "edit", toggle: () => setMode((m) => (m === "edit" ? "view" : "edit")) }}>
      {children}
    </EditModeCtx.Provider>
  );
}

export const useEditMode = () => useContext(EditModeCtx);
