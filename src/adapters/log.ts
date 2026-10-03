export type Level = 'debug' | 'info' | 'warn' | 'error';
type Sink = (line: string) => void;

let sink: Sink = (line) => process.stdout.write(`${line}\n`);

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, /token/i.test(k) ? '[redacted]' : redact(v)]),
    );
  }
  return value;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (process.env.DMA_QUIET_LOGS === '1' && (level === 'info' || level === 'debug')) return;
  sink(JSON.stringify({ level, msg, ...(redact(fields) as Record<string, unknown>) }));
}

export function captureLogs(): { lines: string[]; restore(): void } {
  const lines: string[] = [];
  const previous = sink;
  sink = (l) => { lines.push(l); };
  return { lines, restore: () => { sink = previous; } };
}
