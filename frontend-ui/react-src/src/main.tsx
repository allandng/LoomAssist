import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.tsx';

// Wire global error capture — routed into the logger in Phase 6
window.onerror = (msg, src, line, col, err) => {
  console.error('[loom:uncaught]', msg, src, line, col, err);
};
window.onunhandledrejection = (e) => {
  console.error('[loom:unhandled-rejection]', e.reason);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
