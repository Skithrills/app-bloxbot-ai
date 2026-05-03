import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught error:", error);
    console.error("Component stack:", info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-red-500">
            <span>Something went wrong</span>
            <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
              {this.state.error?.message}
            </pre>
            <button
              className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Retry
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
