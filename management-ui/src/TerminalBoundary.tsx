import { Component, type ReactNode } from "react";

export class TerminalBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="card" role="alert">
        <h3>Terminal view could not start</h3>
        <p>
          The remote session may still be running. Retry this view, or use
          Overview to inspect or end the session.
        </p>
        <button onClick={() => this.setState({ failed: false })}>
          Retry view
        </button>
      </section>
    );
  }
}
