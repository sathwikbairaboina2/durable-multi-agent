import { afterEach, describe, expect, it } from 'vitest';
import { startLambdaHost, type LambdaHost } from '../src/lambda-host.js';

class BudgetExhausted extends Error { override name = 'BudgetExhausted'; }

let host: LambdaHost | undefined;
afterEach(async () => { await host?.close(); host = undefined; });

const start = () => startLambdaHost({
  port: 5339,
  resolve: (name) => {
    if (name === 'Echo') return async (e) => ({ got: e });
    if (name === 'Boom') return async () => { throw new BudgetExhausted('no money'); };
    return undefined;
  },
});
const post = (path: string, body?: string) =>
  fetch(`http://127.0.0.1:5339${path}`, { method: 'POST', body });

describe('lambda host', () => {
  it('invokes a handler with the JSON body', async () => {
    host = await start();
    const r = await post('/2015-03-31/functions/Echo/invocations', '{"a":1}');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ got: { a: 1 } });
  });
  it('treats an empty body as {}', async () => {
    host = await start();
    expect(await (await post('/2015-03-31/functions/Echo/invocations')).json()).toEqual({ got: {} });
  });
  it('accepts URL-encoded function ARNs', async () => {
    host = await start();
    const arn = encodeURIComponent('arn:aws:lambda:us-east-1:123456789012:function:Echo');
    const r = await post(`/2015-03-31/functions/${arn}/invocations`, '{"b":2}');
    expect(await r.json()).toEqual({ got: { b: 2 } });
  });
  it('reports handler errors the way Lambda does', async () => {
    host = await start();
    const r = await post('/2015-03-31/functions/Boom/invocations', '{}');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-amz-function-error')).toBe('Unhandled');
    expect(await r.json()).toEqual({ errorType: 'BudgetExhausted', errorMessage: 'no money' });
  });
  it('returns 404 for an unknown function', async () => {
    host = await start();
    const r = await post('/2015-03-31/functions/Nope/invocations', '{}');
    expect(r.status).toBe(404);
    expect(r.headers.get('x-amzn-errortype')).toBe('ResourceNotFoundException');
    expect(await r.json()).toEqual({ Type: 'User', message: 'Function not found: Nope' });
  });
  it('counts invocations per function and frees the port on close', async () => {
    host = await start();
    await post('/2015-03-31/functions/Echo/invocations', '{}');
    await post('/2015-03-31/functions/Echo/invocations', '{}');
    expect(host.invocations.get('Echo')).toBe(2);
    await host.close();
    host = await start();
    expect(host.invocations.size).toBe(0);
  });
});
