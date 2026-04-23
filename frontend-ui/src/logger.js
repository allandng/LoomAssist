const _API = "http://127.0.0.1:8000";

class Logger {
  constructor() {
    this._queue = [];
    this._flushCallback = null;
    this._timer = setInterval(() => this._flush(), 10_000);

    window.onerror = (msg, src, line, col, err) => {
      this.error("Uncaught error", { message: String(msg), source: src, line, col, stack: err?.stack });
      window.__loomCrashHandler?.({ message: String(msg), stack: err?.stack });
    };

    window.onunhandledrejection = (ev) => {
      const msg = ev.reason?.message ?? String(ev.reason);
      this.error("Unhandled rejection", { message: msg, stack: ev.reason?.stack });
      window.__loomCrashHandler?.({ message: msg, stack: ev.reason?.stack });
    };
  }

  debug(msg, ctx) { this._log("DEBUG",   msg, ctx); }
  info (msg, ctx) { this._log("INFO",    msg, ctx); }
  warn (msg, ctx) { this._log("WARNING", msg, ctx); }
  error(msg, ctx) { this._log("ERROR",   msg, ctx); this._flush(); }

  setFlushCallback(fn) { this._flushCallback = fn; }

  _log(level, message, context) {
    this._queue.push({ level, message, context });
    if (this._queue.length > 200) this._queue.shift();
  }

  async _flush() {
    if (!this._queue.length) return;
    const batch = this._queue.splice(0);
    let allSent = true;
    for (const entry of batch) {
      try {
        await fetch(`${_API}/api/logs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        });
      } catch {
        allSent = false;
      }
    }
    if (allSent && this._flushCallback) this._flushCallback(batch);
  }
}

export const logger = new Logger();
