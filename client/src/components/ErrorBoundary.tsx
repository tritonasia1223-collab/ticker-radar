import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  // 라우트 등 이 값이 바뀌면 에러 상태를 리셋(다른 탭으로 이동하면 복구).
  resetKey?: unknown;
}
interface State {
  error: Error | null;
  componentStack: string;
}

// 앱 전역 에러 경계. 하위 트리에서 렌더 중 예외가 나도 전체 사이트가 흰 화면으로 죽지 않게 하고,
// 정확한 에러 메시지·스택을 화면에 표시(특정 PC에서만 나는 크래시의 근본 원인 캡처용) + 콘솔·window 로깅.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    this.setState({ componentStack: info.componentStack });
    // 콘솔(빨간 로그) + window 에 남겨, 영향받는 PC 에서 F12 없이도 화면 캡처로 원인 확보 가능.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info.componentStack);
    try {
      (window as unknown as { __lastError?: unknown }).__lastError = {
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        href: location.href,
        at: new Date().toISOString(),
      };
    } catch { /* noop */ }
  }

  componentDidUpdate(prev: Props) {
    // 다른 라우트로 이동(resetKey 변경)하면 에러 상태 해제 → 정상 화면 복귀.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, componentStack: "" });
    }
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl border border-destructive/40 bg-card p-5 shadow-sm">
          <div className="text-base font-semibold text-foreground">이 화면에서 문제가 발생했습니다</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            사이트는 정상입니다. 다른 탭으로 이동하거나 새로고침 해주세요. 아래 오류 내용을 개발자에게 전달하면 원인 파악에 도움이 됩니다.
          </p>

          <div className="mt-3 rounded-md border border-border bg-muted/40 p-2.5">
            <div className="font-mono text-[12px] font-semibold text-destructive break-words">
              {error.name}: {error.message}
            </div>
            {(error.stack || componentStack) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">스택 보기</summary>
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[10.5px] leading-snug text-muted-foreground">
{(error.stack || "") + (componentStack ? "\n\n--- component stack ---" + componentStack : "")}
                </pre>
              </details>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => location.reload()}
              className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
            >
              새로고침
            </button>
            <a
              href="#/"
              onClick={() => this.setState({ error: null, componentStack: "" })}
              className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              홈으로
            </a>
          </div>
        </div>
      </div>
    );
  }
}
