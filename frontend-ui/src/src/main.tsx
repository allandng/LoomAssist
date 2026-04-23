import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.tsx';
import { logger } from './lib/logger';

// Route all uncaught errors through the logger (immediate flush on error)
window.onerror = (msg, src, line, col, err) => {
  logger.error(String(msg), { src, line, col, stack: err?.stack });
  return false;
};
window.onunhandledrejection = (e) => {
  logger.error('Unhandled rejection', { reason: String(e.reason) });
};

// Tauri rust-panic event → crash handler
// Uses dynamic import so the app still boots in non-Tauri environments (e.g. browser dev)
(async () => {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen('rust-panic', (event) => {
      logger.error('Rust panic', { payload: event.payload });
      window.__loomCrashHandler?.();
    });
  } catch {
    // Not running inside Tauri — ignore
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
