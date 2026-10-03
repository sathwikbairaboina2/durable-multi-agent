import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type LambdaFn = (event: any) => Promise<unknown>;

export interface LambdaHostOptions {
  port: number;
  host?: string;
  /** Returns the in-process handler for a function name, or undefined for an unknown function. */
  resolve(functionName: string): LambdaFn | undefined;
}
export interface LambdaHost {
  url: string;
  invocations: Map<string, number>;
  close(): Promise<void>;
}

/** Accepts a plain name, a URL-encoded name or a full function ARN, and returns the plain name. */
export function functionNameOf(segment: string): string {
  const decoded = decodeURIComponent(segment);
  return decoded.startsWith('arn:') ? (decoded.split(':')[6] ?? decoded) : decoded;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body === undefined ? null : body));
}

/** A minimal Lambda Invoke API: POST /2015-03-31/functions/{name}/invocations. */
export function startLambdaHost(opts: LambdaHostOptions): Promise<LambdaHost> {
  const invocations = new Map<string, number>();
  const server = createServer((req, res) => {
    void (async () => {
      const match = /^\/2015-03-31\/functions\/([^/]+)\/invocations/.exec(req.url ?? '');
      if (req.method !== 'POST' || !match) return send(res, 404, { message: 'not found' });
      const name = functionNameOf(match[1]!);
      const fn = opts.resolve(name);
      if (!fn) {
        return send(res, 404, { Type: 'User', message: `Function not found: ${name}` }, { 'x-amzn-errortype': 'ResourceNotFoundException' });
      }
      invocations.set(name, (invocations.get(name) ?? 0) + 1);
      const raw = await readBody(req);
      try {
        const result = await fn(raw.trim() === '' ? {} : JSON.parse(raw));
        return send(res, 200, result);
      } catch (e) {
        const err = e as Error;
        return send(
          res, 200,
          { errorType: err.name || 'Error', errorMessage: err.message },
          { 'x-amz-function-error': 'Unhandled' },
        );
      }
    })().catch((e) => {
      if (!res.headersSent) send(res, 500, { message: String(e) });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '0.0.0.0', () => {
      resolve({
        url: `http://127.0.0.1:${opts.port}`,
        invocations,
        close: () => new Promise<void>((r, j) => { server.close((err) => (err ? j(err) : r())); server.closeAllConnections(); }),
      });
    });
  });
}
