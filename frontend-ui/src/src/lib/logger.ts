import { sendLog } from '../api';
import type { LogEntry } from '../types';

const QUEUE_LIMIT = 200;
const FLUSH_INTERVAL_MS = 10_000;

type Level = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private queue: LogEntry[] = [];
  private flushCallback: (() => void) | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.intervalId = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private entry(level: Level, message: string, context?: Record<string, unknown>): LogEntry {
    return { level, message, timestamp: new Date().toISOString(), context };
  }

  private enqueue(entry: LogEntry) {
    this.queue.push(entry);
    if (this.queue.length > QUEUE_LIMIT) this.queue.shift();
  }

  debug(msg: string, ctx?: Record<string, unknown>) { this.enqueue(this.entry('debug', msg, ctx)); }
  info(msg: string,  ctx?: Record<string, unknown>) { this.enqueue(this.entry('info',  msg, ctx)); }
  warn(msg: string,  ctx?: Record<string, unknown>) { this.enqueue(this.entry('warn',  msg, ctx)); }
  error(msg: string, ctx?: Record<string, unknown>) {
    const e = this.entry('error', msg, ctx);
    this.enqueue(e);
    this.flush(true); // immediate flush on error
  }

  setFlushCallback(fn: () => void) { this.flushCallback = fn; }

  async flush(_immediate = false) {
    const batch = [...this.queue];
    if (batch.length === 0) return;
    this.queue = [];
    try {
      for (const entry of batch) {
        await sendLog(entry);
      }
      this.flushCallback?.();
    } catch {
      // If flush fails, put entries back (best-effort)
      this.queue = [...batch, ...this.queue].slice(-QUEUE_LIMIT);
    }
  }

  destroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}

export const logger = new Logger();
