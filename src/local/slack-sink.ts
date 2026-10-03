import { createServer } from 'node:http';

export interface SinkRecord { method: 'chat.postMessage' | 'chat.update'; body: any; at: string }
export interface SlackSink {
  url: string;
  records: SinkRecord[];
  posts(): SinkRecord[];
  updates(): SinkRecord[];
  /** The approval id parsed from the approve button of the post that mentions runId, or null. */
  approvalFor(runId: string): { approvalId: string } | null;
  close(): Promise<void>;
}

/** A stand-in for slack.com/api that records what the handlers send. Binds 127.0.0.1 only. */
export function startSlackSink(opts: { port?: number } = {}): Promise<SlackSink> {
  const port = opts.port ?? 5334;
  const records: SinkRecord[] = [];
  let counter = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const method = /^\/api\/(chat\.postMessage|chat\.update)$/.exec(req.url ?? '')?.[1] as SinkRecord['method'] | undefined;
      if (req.method !== 'POST' || !method) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unknown_method' }));
        return;
      }
      let body: any = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* keep {} */ }
      records.push({ method, body, at: new Date().toISOString() });
      counter += 1;
      const ts = body.ts ?? `${Math.floor(Date.now() / 1000)}.${String(counter).padStart(6, '0')}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, channel: body.channel ?? 'C0LOCAL', ts }));
    });
  });

  const posts = () => records.filter((r) => r.method === 'chat.postMessage');
  const updates = () => records.filter((r) => r.method === 'chat.update');

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        records,
        posts,
        updates,
        approvalFor(runId) {
          for (const p of posts()) {
            const text = JSON.stringify(p.body);
            if (!text.includes(runId)) continue;
            for (const block of p.body.blocks ?? []) {
              for (const el of block.elements ?? []) {
                if (el.action_id === 'approve' && typeof el.value === 'string') {
                  try { return { approvalId: JSON.parse(el.value).a as string }; } catch { /* next */ }
                }
              }
            }
          }
          return null;
        },
        close: () => new Promise<void>((r, j) => { server.close((e) => (e ? j(e) : r())); server.closeAllConnections(); }),
      });
    });
  });
}
