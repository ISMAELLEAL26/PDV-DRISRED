import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Error desconocido' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application error', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-xl font-bold text-slate-800">No se pudo cargar la pantalla</h1>
          <p className="mb-4 text-sm leading-6 text-slate-600">
            Actualiza la página. Si el problema continúa, cierra sesión y vuelve a entrar.
          </p>
          <p className="mb-6 break-words rounded-lg bg-red-50 px-3 py-2 text-left text-xs text-red-700">
            {this.state.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Actualizar página
          </button>
        </div>
      </div>
    );
  }
}
