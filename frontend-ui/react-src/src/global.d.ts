// Global crash handler set by App.tsx, called from main.tsx on rust-panic
interface Window {
  __loomCrashHandler?: () => void;
}
