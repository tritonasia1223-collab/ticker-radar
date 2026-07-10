import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// 기본 진입 탭 = 자본주의 경제사. (해시 없이 들어오면 여기로.)
if (!window.location.hash) {
  window.location.hash = "#/capitalism";
}

createRoot(document.getElementById("root")!).render(<App />);
