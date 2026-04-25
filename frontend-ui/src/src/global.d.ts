// Global crash handler set by App.tsx, called from main.tsx on rust-panic
interface Window {
  __loomCrashHandler?: () => void;
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    emit?: (event: string, payload?: unknown) => Promise<void>;
  };
}
