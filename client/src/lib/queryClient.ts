import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Same-origin: the client and API are served from the same host
// (Vite dev server locally, and the same vercel.app domain in production).
const API_BASE = "";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,   // 탭 재진입 시 캐시된 데이터 즉시 표시(재계산 X)
      staleTime: Infinity,     // 갱신(브라우저 새로고침/뮤테이션) 전까지 fresh 취급
      gcTime: Infinity,        // 세션 동안 캐시 유지 — 탭 오래 비워도 버리지 않음
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
