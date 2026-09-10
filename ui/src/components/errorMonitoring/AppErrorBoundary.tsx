import React, { ErrorInfo, ReactNode } from "react";
import { captureReactError } from "../../utils/errorMonitoring";

export type AppErrorBoundaryFallbackDetails = {
  error: Error;
  eventId: string | null;
  reset: () => void;
  reload: () => void;
};

type AppErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode | ((details: AppErrorBoundaryFallbackDetails) => ReactNode);
  onReset?: () => void;
  resetKeys?: unknown[];
};

type AppErrorBoundaryState = {
  error: Error | null;
  eventId: string | null;
};

const resetKeysChanged = (previous: unknown[] = [], next: unknown[] = []): boolean =>
  previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null, eventId: null };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    let eventId: string | null = null;
    try {
      eventId = captureReactError(error, info.componentStack, {
        boundary: this.constructor.name || "AppErrorBoundary",
      });
    } catch {
      // Monitoring must never turn a recoverable rendering error into another crash.
    }
    this.setState({ eventId });
  }

  componentDidUpdate(previousProps: AppErrorBoundaryProps): void {
    if (
      this.state.error &&
      resetKeysChanged(previousProps.resetKeys, this.props.resetKeys)
    ) {
      this.reset();
    }
  }

  private reset = (): void => {
    this.setState({ error: null, eventId: null });
    this.props.onReset?.();
  };

  private reload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render(): ReactNode {
    const { error, eventId } = this.state;
    if (!error) {
      return this.props.children;
    }

    const details: AppErrorBoundaryFallbackDetails = {
      error,
      eventId,
      reset: this.reset,
      reload: this.reload,
    };
    if (typeof this.props.fallback === "function") {
      return this.props.fallback(details);
    }
    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    return (
      <main
        role="alert"
        aria-live="assertive"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#f5f7fa",
          color: "#172033",
          fontFamily: "Open Sans, system-ui, sans-serif",
        }}
      >
        <section
          style={{
            width: "min(100%, 560px)",
            padding: "clamp(24px, 6vw, 48px)",
            border: "1px solid #dce3ec",
            borderRadius: "20px",
            background: "#ffffff",
            boxShadow: "0 18px 50px rgba(23, 32, 51, 0.12)",
            textAlign: "center",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              display: "grid",
              placeItems: "center",
              width: "56px",
              height: "56px",
              margin: "0 auto 18px",
              borderRadius: "16px",
              background: "#fff0f0",
              color: "#d92d20",
              fontSize: "30px",
              fontWeight: 800,
            }}
          >
            !
          </div>
          <h1 style={{ margin: "0 0 10px", fontSize: "clamp(24px, 5vw, 32px)" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 auto 24px", maxWidth: "440px", color: "#667085" }}>
            The problem was reported automatically. Try this screen again, or reload the app
            if it continues.
          </p>
          <div
            style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px" }}
          >
            <button
              type="button"
              onClick={this.reset}
              style={{
                minHeight: "44px",
                padding: "10px 18px",
                border: "1px solid #b9c4d2",
                borderRadius: "10px",
                background: "#ffffff",
                color: "#172033",
                font: "inherit",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.reload}
              style={{
                minHeight: "44px",
                padding: "10px 18px",
                border: 0,
                borderRadius: "10px",
                background: "#1677e8",
                color: "#ffffff",
                font: "inherit",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Reload app
            </button>
          </div>
          {eventId ? (
            <p style={{ margin: "22px 0 0", color: "#98a2b3", fontSize: "12px" }}>
              Error reference: {eventId}
            </p>
          ) : null}
        </section>
      </main>
    );
  }
}

export default AppErrorBoundary;
