import { createContext, useContext, useEffect } from "react";

type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme }>({ theme: "light" });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // FISCUS는 라이트 전용. 기존 차트 소비자와의 호환용 컨텍스트만 유지한다.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }, []);
  return <ThemeCtx.Provider value={{ theme: "light" }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
