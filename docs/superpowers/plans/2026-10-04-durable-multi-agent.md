# Durable multi-agent workflow v0.1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax. Record progress in the ledger `.superpowers/sdd/2026-10-04-durable-multi-agent/progress.md` after every task (format below).

**Goal:** Ship v0.1 of a human-gated procurement workflow. A LangGraph agent team proposes a purchase order. A Step Functions `.waitForTaskToken` state waits for a signed Slack approval. A deterministic TypeScript core writes the ledger row exactly once and never over budget. All of it is proven by unit tests, property tests, CDK assertions, and integration tests that run the *synthesized* state machine on Step Functions Local + DynamoDB Local. A measured chaos benchmark supplies the README headline.

**Architecture:** one npm package (ESM TypeScript) plus one workspace package and one Python project:
- `src/core` holds pure logic. `src/adapters` holds the AWS SDK, Slack and agent clients. `src/handlers` holds nine Lambda handlers.
- `infra` is a CDK app with one stack.
- `packages/sfn-local-harness` is the installable piece: intrinsic resolver, stack loader and in-process Lambda Invoke API host.
- `src/local` is the local environment and driver. `cli/pa.ts` provides `pa demo` and `pa bench`.
- `agent/` is the Python LangGraph team behind the AgentCore HTTP contract.

**Spec:** `docs/superpowers/specs/2026-10-04-durable-multi-agent.md`. **Decisions:** `docs/adr/0001`-`0008`. Read the spec and ADRs 0001, 0002, 0003 and 0004 before starting.

**Status at plan time:** the repo holds docs only (`git init -b main`, spec, ADRs, this plan, the ledger). Prototypes run during planning (results in ADR 0001 and 0005) are NOT in the repo. Every task below is still to do.

## Tech stack (exact versions; all checked to exist on 2026-10-04)

- Node 24 on the host (`v24.18.0`), npm 11. TypeScript `5.9.3` (do NOT use 7.x). Vitest `4.1.11` (do NOT use 5.x). tsx `4.23.15`. esbuild `0.28.2`.
- `aws-cdk-lib@2.272.0`, `constructs@10.8.1`, `aws-cdk@2.1144.0` (CLI, devDependency only), `cdk-nag@3.0.2`.
- `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sfn`, `@aws-sdk/client-bedrock-agentcore` and `@aws-sdk/client-secrets-manager`, all `3.1146.0`.
- `ajv@8.20.0`: import it as `import { Ajv2020 } from 'ajv/dist/2020.js'`. This named import was checked to typecheck under NodeNext.
- `ulid@3.0.2` (`import { ulid } from 'ulid'`), `fast-check@4.10.2`, `aws-sdk-client-mock@4.1.0` (checked with `client-sfn` 3.1146.0), `@types/aws-lambda@8.10.164`, `@types/node@24.19.1`.
- Python 3.12 via uv `0.12.21`. Build backend `uv_build>=0.12.21,<0.13`. Packages:
  - `langgraph==1.2.12`, `langchain-core==1.6.6`, `langchain-ollama==1.1.0`, `langchain-aws==1.8.0`;
  - `bedrock-agentcore==1.24.0`, `pydantic==2.13.5`;
  - dev: `pytest==9.1.1`, `httpx==0.28.1`.
- Docker images: `amazon/dynamodb-local:3.3.1`, `amazon/aws-stepfunctions-local:2.0.0`, `python:3.12-slim`, `ghcr.io/astral-sh/uv:0.12.21`, `rhysd/actionlint:1.7.12`.

## Global constraints

- Repo root: `C:\Users\sathwik\projects\taskarinchu\durable-multi-agent`. Edit nothing outside it. Other repos under `taskarinchu\` belong to other sessions; read-only.
- **Ports:** host ports 5330-5339 only.

  | Port | Use |
  |---|---|
  | 5330 | DynamoDB Local |
  | 5331 | in-process Lambda host (fixed: the SFN Local container calls it) |
  | 5332 | Step Functions Local |
  | 5333 | agent container |
  | 5334 | in-process Slack sink |

  Never bind port 0 or other ports in tests: inject `fetch` instead of starting servers in unit tests.
- **Docker:** compose project `durable-multi-agent`. Every `container_name` and image tag starts with `durable-multi-agent-`. Stop what you start (`npm run local:down`) before finishing a task that started containers.
- **No real AWS, no LocalStack.** Never run `cdk deploy` or `cdk bootstrap`. `cdk synth` is fine. Do not set real credentials. The local env forces `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test` and `AWS_REGION=us-east-1`.
- `npm test` must pass with no Docker, no network and no credentials. Only `npm run test:integration`, `npm run bench` and `npm run demo` need Docker.
- **ESM:** root `package.json` has `"type": "module"`, and tsconfig uses `module`/`moduleResolution` `NodeNext`. **Every relative import ends in `.js`**, even in `.ts` files.
- **Money is integer cents.** Never use floats for money. Format only for display (`formatCents`).
- `src/core/**` must not import `@aws-sdk/*`, `node:http` or anything under `src/adapters`. Task 25 greps this.
- Never log or return a task token (I11). Use `src/adapters/log.ts`, which redacts `taskToken` keys.
- Numbers in README/DEVDOCS come only from committed result files (`bench/results/latest.json`, `agent/evals/results/latest.json`). Never type a number you did not measure. If something was not run, write "not run".
- No secrets: `.env` is gitignored; only `.env.example` with obviously fake values is committed.
- Do not touch `package-lock.json` or `agent/uv.lock` except through `npm install <exact pinned versions>` or `uv add`/`uv lock` in the task that adds dependencies.
- **Commits:** local commits are authorized. Make one commit per task with the subject given in the task (conventional style), a blank line, then `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push, never add remotes, never amend, never squash. If a commit is blocked by a permission check, do not work around it: note it in the ledger and continue.
- Windows host: use Git Bash or PowerShell. `package.json` scripts must be cross-platform: no inline `VAR=x cmd`. Use the vitest `env` config or node wrapper scripts.
- If a step's expected output differs, fix the code, not the test, unless the test contradicts the spec. If you deviate from this plan, add a `Ruling:` line to the ledger: `Ruling: <what> - <why> - <cost>`.

## Ledger format

Path: `.superpowers/sdd/2026-10-04-durable-multi-agent/progress.md`. Append one line per finished task:

```
Task N: complete (<test command> -> <real counts, e.g. 12 passed>; <other evidence>) | commit: "<subject>"
```

Use `Task N: BLOCKED (<exact error>)` if you cannot finish; then continue with the next task that does not depend on it.

## Review focus (inputs a happy-path test would miss; each has a test in its owning task)

1. **Hostile Slack input:** stale timestamp, tampered body, missing headers, non-`block_actions` payloads, unknown approval id and garbage action values. All of them must fail closed with no state change (T5, T9).
2. **Double delivery:** a duplicate `SendTaskSuccess`, two concurrent clicks, an SFN retry after the ledger commit, a re-invoked `request-approval` and a duplicate `StartExecution` (T9, T10, T18).
3. **Money edges:** spent + total exactly equal to the limit (allowed) and one cent over (rejected); agent-claimed prices ignored; duplicate SKUs; inactive SKUs; quantity over `maxQtyPerOrder` (T3, T6).
4. **Malformed agent output:** extra properties, quantity 0, 11 lines, a wrong `runId`, a non-JSON response from the agent container and the agent's `error` envelope (T2, T8).
5. **Timing:** approval expiry with a late click afterwards, and SFN Local's slow start (poll it, never `sleep` blindly) (T12, T16, T17).

## File structure

```
durable-multi-agent/
  package.json  package-lock.json  tsconfig.json  vitest.config.ts  vitest.integration.config.ts
  cdk.json  docker-compose.yml  .gitignore  .env.example  LICENSE  README.md
  .github/workflows/ci.yml
  scripts/bundle.mjs                       # esbuild: src/handlers/*.ts -> dist/lambda/<name>/index.mjs
  seed/catalog.json  seed/budgets.json
  src/config.ts                            # requireEnv, intEnv
  src/core/{types,errors,money,hash,ids,schema,policy,status,authorize,slack-verify,slack-message,execute}.ts
  src/adapters/{ddb,tables,ports,runs-repo,catalog-repo,budgets-repo,ledger-repo,workflow,agent-client,slack,secrets,log}.ts
  src/handlers/{start-run,get-run,slack-interactions,invoke-agent,persist-proposal,policy-check,request-approval,execute-po,finalize,registry,http}.ts
  src/local/{env,slack-sink,seed,driver,fixture-agent}.ts
  infra/bin/app.ts
  infra/lib/{stack,data,flow,api,definition,handler-function,nag}.ts
  infra/test/{data,flow,iam,nag}.test.ts  infra/test/helpers.ts
  packages/sfn-local-harness/{package.json,tsconfig.json,README.md,src/{index,resolve,load-stack,lambda-host,deploy}.ts,test/*.test.ts}
  cli/pa.ts  cli/render.ts
  bench/{chaos.ts,headline.ts,results/}
  test/unit/**  test/integration/**
  agent/{pyproject.toml,uv.lock,Dockerfile,.dockerignore,src/procurement_agent/*.py,tests/*.py,evals/{requests.jsonl,run.py,results/}}
  docs/{DEVDOCS.md,handoff.md,adr/,superpowers/}
```

## Gates (the reviewer runs these; all must pass for v0.1)

| # | Command (repo root unless stated) | Pass condition |
|---|---|---|
| G1 | `npm ci` | exit 0 |
| G2 | `npm run typecheck` | exit 0 |
| G3 | `npm test` | all pass, 0 skipped, no Docker running needed |
| G4 | `npm run synth` | exit 0, prints no `AwsSolutions-` error, `cdk.out/DurableMultiAgentStack.template.json` exists |
| G5 | `cd agent && uv sync --frozen && uv run pytest -q` | all pass |
| G6 | `npm run local:up && npm run test:integration && npm run local:down` | all pass, 0 skipped |
| G7 | `npm run local:up && npm run bench -- --runs 200 && npm run local:down` | exit 0; `bench/results/latest.json` has `ledgerStatusMismatches: 0`, `budgetDriftCents: 0`, `overspendCents: 0`, `crashesInjected > 0` |
| G8 | `npm run build -w sfn-local-harness && npm pack -w sfn-local-harness --dry-run` | lists only `dist/**`, `README.md`, `package.json`, `LICENSE` |
| G9 | `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12` | exit 0 |
| G10 | `git status --short` after the last commit | empty; `git ls-files` shows no `.env` |

---

## Task 1: Scaffold the npm project

**Files:** create `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `.gitignore`, `.env.example`, `LICENSE`, `src/config.ts`, `test/unit/config.test.ts`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "durable-multi-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*"],
  "scripts": {
    "build:harness": "node -e \"0\"",
    "pretypecheck": "npm run build:harness",
    "typecheck": "tsc -p tsconfig.json",
    "pretest": "npm run build:harness",
    "test": "vitest run",
    "pretest:integration": "npm run build:harness",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "bundle": "node scripts/bundle.mjs",
    "synth": "node scripts/bundle.mjs && cdk synth --quiet",
    "predemo": "npm run build:harness",
    "demo": "tsx cli/pa.ts demo",
    "prebench": "npm run build:harness",
    "bench": "tsx cli/pa.ts bench",
    "bench:headline": "tsx bench/headline.ts",
    "local:up": "docker compose up -d dynamodb sfn",
    "local:down": "docker compose down"
  }
}
```

Note: `build:harness` is a deliberate no-op until Task 11 creates the workspace package. Task 11 changes it to `npm run build -w sfn-local-harness`.

- [ ] **Step 2: Install pinned dependencies**

```bash
npm install --save-exact @aws-sdk/client-dynamodb@3.1146.0 @aws-sdk/lib-dynamodb@3.1146.0 @aws-sdk/client-sfn@3.1146.0 @aws-sdk/client-bedrock-agentcore@3.1146.0 @aws-sdk/client-secrets-manager@3.1146.0 ajv@8.20.0 ulid@3.0.2 aws-cdk-lib@2.272.0 constructs@10.8.1 cdk-nag@3.0.2
npm install --save-exact --save-dev typescript@5.9.3 vitest@4.1.11 tsx@4.23.15 esbuild@0.28.2 aws-cdk@2.1144.0 fast-check@4.10.2 aws-sdk-client-mock@4.1.0 @types/aws-lambda@8.10.164 @types/node@24.19.1
```

Expected: exit 0. `node -e "console.log(require('./package.json').dependencies['aws-cdk-lib'])"` prints `2.272.0`.

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "infra", "cli", "bench", "test", "vitest.config.ts", "vitest.integration.config.ts"]
}
```

- [ ] **Step 4: Vitest configs**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'infra/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```
`vitest.integration.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    fileParallelism: false,          // all files share port 5331 (SFN Local's LAMBDA_ENDPOINT)
    testTimeout: 180_000,
    hookTimeout: 120_000,
    env: { DMA_INTEGRATION: '1' },
  },
});
```

- [ ] **Step 5: `.gitignore`, `.env.example`, `LICENSE`**

`.gitignore`:
```
node_modules/
dist/
cdk.out/
coverage/
*.tsbuildinfo
.env
.env.*
!.env.example
agent/.venv/
__pycache__/
.pytest_cache/
```
`.env.example` (fake values only):
```
# Local development only. Never put real secrets in this repo.
# Model for the agent container: scripted (default) | ollama | bedrock
AGENT_MODEL=scripted
OLLAMA_MODEL=qwen3.8:27b
```
`LICENSE`: the standard MIT text, `Copyright (c) 2026 The durable-multi-agent authors`.

- [ ] **Step 6: Write the failing test** `test/unit/config.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { intEnv, requireEnv } from '../../src/config.js';

describe('config', () => {
  it('returns a present variable', () => {
    expect(requireEnv({ A: 'x' }, 'A')).toBe('x');
  });
  it('throws naming the missing variable', () => {
    expect(() => requireEnv({}, 'RUNS_TABLE')).toThrow('Missing environment variable RUNS_TABLE');
  });
  it('treats empty strings as missing', () => {
    expect(() => requireEnv({ A: '' }, 'A')).toThrow('Missing environment variable A');
  });
  it('parses integers with a default', () => {
    expect(intEnv({ N: '42' }, 'N', 7)).toBe(42);
    expect(intEnv({}, 'N', 7)).toBe(7);
    expect(() => intEnv({ N: '4.2' }, 'N', 7)).toThrow('N must be an integer');
  });
});
```

Run `npm test`. Expected: FAIL (cannot find `src/config.js`).

- [ ] **Step 7: Implement `src/config.ts`**

```ts
export type Env = Record<string, string | undefined>;

export function requireEnv(env: Env, name: string): string {
  const v = env[name];
  if (v === undefined || v === '') throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function intEnv(env: Env, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  if (!/^-?\d+$/.test(v)) throw new Error(`${name} must be an integer`);
  return Number(v);
}
```

- [ ] **Step 8: Verify and commit**

`npm test` → `4 passed`. `npm run typecheck` → exit 0.
Commit: `chore: scaffold TypeScript project with pinned dependencies`

---

## Task 2: Core types, errors, hashing, ids and the ProposedOrder schema (I9)

**Files:** create `src/core/types.ts`, `src/core/errors.ts`, `src/core/money.ts`, `src/core/hash.ts`, `src/core/ids.ts`, `src/core/schema.ts`. Tests: `test/unit/core/hash.test.ts`, `test/unit/core/schema.test.ts`, `test/unit/core/money.test.ts`, `test/unit/fixtures.ts`.

- [ ] **Step 1: `src/core/types.ts`** (types only)

```ts
export type RunStatus =
  | 'PLANNING' | 'POLICY' | 'AWAITING_APPROVAL' | 'EXECUTING' | 'DONE'
  | 'REJECTED_BY_POLICY' | 'REJECTED_BY_HUMAN' | 'EXPIRED' | 'FAILED';
export type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type Decision = 'approve' | 'reject';

export interface CatalogItem {
  sku: string; name: string; vendor: string;
  unitPriceCents: number; maxQtyPerOrder: number; active: boolean;
}
export interface ProposalLine { sku: string; qty: number; claimedUnitPriceCents?: number }
export interface ProposedOrder { runId: string; currency: 'USD'; lines: ProposalLine[]; justification: string }
export interface PricedLine { sku: string; name: string; qty: number; unitPriceCents: number; lineCents: number }
export interface Budget { requesterId: string; month: string; limitCents: number; spentCents: number }
export interface PolicyResult {
  ok: boolean; totalCents: number; pricedLines: PricedLine[];
  reasons: string[]; remainingBudgetCents: number | null;
}
export interface ApprovalRecord {
  runId: string; approvalId: string; proposalHash: string; totalCents: number;
  pricedLines: PricedLine[]; state: ApprovalState; decidedBy?: string; decidedAt?: string;
}
export interface LedgerEntry {
  runId: string; requesterId: string; lines: PricedLine[]; totalCents: number;
  approvedBy: string; proposalHash: string; createdAt: string;
}
export interface ModelUsage { inputTokens: number; outputTokens: number; modelSteps: number }
```

- [ ] **Step 2: `src/core/errors.ts`.** Each class sets `name`, because Step Functions catches on the Lambda `errorType`, which is `err.name`.

```ts
function named(name: string) {
  return class extends Error {
    constructor(message = name) { super(message); this.name = name; }
  };
}
export class InvalidProposal extends named('InvalidProposal') {}
export class NotApproved extends named('NotApproved') {}
export class HashMismatch extends named('HashMismatch') {}
export class BudgetExhausted extends named('BudgetExhausted') {}
export class AgentFailed extends named('AgentFailed') {}
export class IllegalTransition extends named('IllegalTransition') {}
export class NotFound extends named('NotFound') {}
```

- [ ] **Step 3: Write failing tests**

`test/unit/fixtures.ts` exports:
- `RUN_ID = '01J9ZX5K3M8Q4R6T7V9W1Y2Z3A'` (a valid 26-char Crockford ULID);
- `validOrder(): ProposedOrder`, returning `{ runId: RUN_ID, currency: 'USD', lines: [{ sku: 'GPU-DEVBOX-4090', qty: 3, claimedUnitPriceCents: 250000 }], justification: 'ML team needs 3 more dev boxes.' }`;
- `catalogMap(): Map<string, CatalogItem>`, built from these items:

| sku | name | vendor | unitPriceCents | maxQtyPerOrder | active |
|---|---|---|---|---|---|
| `GPU-DEVBOX-4090` | GPU dev box (RTX 4090) | Northwind Systems | 289900 | 5 | true |
| `LAPTOP-14-PRO` | 14-inch pro laptop | Contoso | 179900 | 10 | true |
| `MONITOR-27-4K` | 27-inch 4K monitor | Fabrikam | 44900 | 20 | true |
| `LAPTOP-13-OLD` | 13-inch laptop (discontinued) | Contoso | 99900 | 10 | false |

`test/unit/core/hash.test.ts`:
- `canonicalJson({b:1,a:{d:2,c:[3,{f:1,e:2}]}})` equals `'{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}'`.
- Property (fast-check `fc.jsonValue()` → build an object with shuffled keys via `fc.shuffledSubarray` over `Object.entries`): `proposalHash(x) === proposalHash(shuffled)`.
- Array order matters: hashes of `[1,2]` and `[2,1]` differ.
- `canonicalJson` throws `TypeError` on `undefined`, functions, `NaN`, `Infinity` and `BigInt`. Object properties whose value is `undefined` are dropped, as `JSON.stringify` does.
- `proposalHash` returns 64 lowercase hex chars.

`test/unit/core/schema.test.ts` (I9). `validateProposedOrder(validOrder())` → `{ ok: true }`. Each of these returns `ok: false` with at least one error string:
- an extra top-level property;
- an extra line property;
- `qty: 0`;
- `qty: 51`;
- `qty: 2.5`;
- 11 lines;
- 0 lines;
- missing `justification`;
- a 2001-character justification;
- `currency: 'EUR'`;
- `runId: 'not-a-ulid'`;
- `null`;
- an array.

`test/unit/core/money.test.ts`: `formatCents(869700) === '$8,697.00'`, `formatCents(5) === '$0.05'`, `formatCents(-100) === '-$1.00'`.

Run `npm test` → FAIL (modules missing).

- [ ] **Step 4: Implement**

`src/core/money.ts`: `formatCents(c: number): string`, using integer math: `Math.trunc(abs/100)` with `toLocaleString('en-US')`, then `String(abs % 100).padStart(2,'0')`, with a `-` sign before `$`.

`src/core/hash.ts`:
```ts
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'string': return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v) => { if (v === undefined) throw new TypeError('canonicalJson: undefined in array'); return canonicalJson(v); }).join(',')}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const proposalHash = (proposal: unknown): string => sha256Hex(canonicalJson(proposal));
```
(`node:crypto` is allowed in core; it is not AWS.)

`src/core/ids.ts`: `newRunId = () => ulid()`, `newApprovalId = () => ulid()`, `ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/`, `isUlid(s)`.

`src/core/schema.ts`: export `PROPOSED_ORDER_SCHEMA` (the JSON Schema from the spec, draft 2020-12, `$schema: 'https://json-schema.org/draft/2020-12/schema'`). Create `new Ajv2020({ allErrors: true, strict: true })` once, compile, and export:

```ts
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };
export function validateProposedOrder(input: unknown): Validation<ProposedOrder>
```
Each error string is `${e.instancePath || '/'} ${e.message}` (for example `/lines/0/qty must be >= 1`).

- [ ] **Step 5: Verify and commit.** `npm test` → all pass (config 4 + hash ≥5 + schema 14 + money 3). `npm run typecheck` → exit 0.
Commit: `feat(core): add canonical proposal hash and ProposedOrder schema validation`

---

## Task 3: Policy pricing from the catalog only (I2)

**Files:** create `src/core/policy.ts`. Tests: `test/unit/core/policy.test.ts`, `test/unit/core/policy.property.test.ts`.

- [ ] **Step 1: Write failing example tests** (`policy.test.ts`), using `validOrder()` and `catalogMap()`, with `budget = { requesterId: 'U0REQ1', month: '2026-10', limitCents: 1_500_000, spentCents: 0 }` and `maxOrderCents = 1_000_000`:
  1. Valid order → `ok: true`. `totalCents === 869700` (3 × 289900, NOT 3 × the claimed 250000). `pricedLines[0]` equals `{ sku:'GPU-DEVBOX-4090', name:'GPU dev box (RTX 4090)', qty:3, unitPriceCents:289900, lineCents:869700 }`. `remainingBudgetCents === 630300`.
  2. Unknown SKU → `ok:false`, reasons contain `unknown sku NOPE-1`.
  3. Inactive SKU `LAPTOP-13-OLD` → reason `inactive sku LAPTOP-13-OLD`.
  4. qty 6 of the GPU box (max 5) → reason `qty 6 exceeds max 5 for GPU-DEVBOX-4090`.
  5. Two lines with the same SKU → reason `duplicate sku GPU-DEVBOX-4090`.
  6. Total over the cap (4 GPU boxes = 1,159,600) → reason `order total $11,596.00 exceeds cap $10,000.00`.
  7. `budget: null` → reason `no budget for this month`.
  8. `spentCents: 630300` → spent + total == limit → `ok: true`, `remainingBudgetCents: 0`. `spentCents: 630301` → reason `order total $8,697.00 exceeds remaining budget $8,696.99`.
  9. Schema-invalid input (`qty: 0`) → `ok:false`, `totalCents: 0`, `pricedLines: []`, reasons start with `schema:`.

- [ ] **Step 2: Write failing property tests** (`policy.property.test.ts`, fast-check, 300 runs each). Use an arbitrary catalog of 1-8 active items with distinct SKUs, prices 1..500_000 and max qty 50. Use an arbitrary order with 1-10 lines of distinct SKUs drawn from that catalog, qty 1..50 and `claimedUnitPriceCents` from `fc.option(fc.integer({min:0,max:10_000_000}))`.
  - I2: `result.totalCents === Σ catalog.get(sku).unitPriceCents * qty`.
  - Replacing every `claimedUnitPriceCents` with a different random value gives the same `totalCents` and the same `ok`.
  - `ok ⇒ totalCents <= maxOrderCents && budget.spentCents + totalCents <= budget.limitCents`.

Run → FAIL.

- [ ] **Step 3: Implement** `export function evaluatePolicy(input: { proposal: unknown; catalog: ReadonlyMap<string, CatalogItem>; budget: Budget | null; maxOrderCents: number }): PolicyResult`, in this order:
  1. Run schema validation. If it fails, return `ok:false`, total 0, no lines, and reasons `schema: <error>`.
  2. Check each line in order: duplicate → unknown → inactive → qty over max. Only known, active lines are priced.
  3. `totalCents` = Σ `lineCents`.
  4. Check the cap, then the budget. `remainingBudgetCents` = `budget ? budget.limitCents - budget.spentCents - totalCents : null`.
  5. `ok = reasons.length === 0`.

Use `formatCents` in the reason strings exactly as in Step 1.

- [ ] **Step 4: Verify and commit.** `npm test` → all pass. Commit: `feat(core): price proposals from the catalog and enforce caps and budget`

---

## Task 4: Status machine and approver authorization (I5)

**Files:** create `src/core/status.ts`, `src/core/authorize.ts`. Tests: `test/unit/core/status.test.ts`, `test/unit/core/authorize.test.ts`.

- [ ] **Step 1: Failing tests**

`status.test.ts`:
- These transitions are legal:
  - `PLANNING→POLICY`, `POLICY→AWAITING_APPROVAL`, `POLICY→REJECTED_BY_POLICY`;
  - `AWAITING_APPROVAL→EXECUTING`, `AWAITING_APPROVAL→REJECTED_BY_HUMAN`, `AWAITING_APPROVAL→EXPIRED`;
  - `EXECUTING→DONE`;
  - `X→FAILED` for every non-terminal X.
- These are illegal: `PLANNING→DONE`, `POLICY→EXECUTING`, `AWAITING_APPROVAL→DONE`, `DONE→FAILED`, `EXPIRED→EXECUTING` and `X→X`.
- `isTerminal` is true exactly for `DONE`, `REJECTED_BY_POLICY`, `REJECTED_BY_HUMAN`, `EXPIRED` and `FAILED`.
- Property (fast-check, 500 runs): start at `PLANNING` and apply a random sequence of up to 20 target statuses, applying each only when `canTransition` allows it. Then:
  - (a) every applied step was in the table;
  - (b) once a terminal status is reached, no further step applies (absorbing);
  - (c) `DONE` is reachable only through `EXECUTING`.
- `assertTransition('DONE','FAILED')` throws `IllegalTransition` with message `DONE -> FAILED`.

`authorize.test.ts` (I5, table-driven):

| approverId | requesterId | approverIds | expected |
|---|---|---|---|
| `U0APPROVER1` | `U0REQ1` | `['U0APPROVER1']` | `{ ok: true }` |
| `U0REQ1` | `U0REQ1` | `['U0REQ1']` | `{ ok: false, reason: 'SELF_APPROVAL' }` (the self check runs first) |
| `U0OTHER` | `U0REQ1` | `['U0APPROVER1']` | `{ ok: false, reason: 'NOT_AN_APPROVER' }` |
| `U0APPROVER1` | `U0REQ1` | `[]` | `{ ok: false, reason: 'NOT_AN_APPROVER' }` |

`parseApproverIds(' U0A1, ,U0A2 ')` → `['U0A1','U0A2']`.

- [ ] **Step 2: Implement.** `status.ts` exports `RUN_STATUSES`, `TERMINAL`, `TRANSITIONS: Record<RunStatus, readonly RunStatus[]>`, `canTransition`, `isTerminal` and `assertTransition`. `authorize.ts` exports `authorizeApprover({ approverId, requesterId, approverIds })` and `parseApproverIds(csv?: string)`.

- [ ] **Step 3: Verify and commit.** `npm test` → all pass. Commit: `feat(core): add run status machine and approver authorization`

---

## Task 5: Slack signature verification (I6) and the approval message

**Files:** create `src/core/slack-verify.ts`, `src/core/slack-message.ts`. Tests: `test/unit/core/slack-verify.test.ts`, `test/unit/core/slack-message.test.ts`.

- [ ] **Step 1: Failing tests**

`slack-verify.test.ts` uses Slack's documented example (verified during planning to produce the expected signature):
```ts
const SECRET = '8f742231b10e8888abcd99yyyzzz85a5';
const TS = '1531420618';
const BODY = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
const SIG = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';
```
- `signSlackRequest(SECRET, TS, BODY) === SIG`.
- `accepts valid signature`: `verifySlackRequest({ signingSecret: SECRET, timestamp: TS, signature: SIG, rawBody: BODY, nowSeconds: 1531420618 + 10 })` → `{ ok: true }`.
- `rejects stale timestamp`: `nowSeconds = TS + 301` → `{ ok:false, reason:'STALE' }`. `TS - 301` (future) → `STALE`.
- `rejects tampered body`: change one char → `BAD_SIGNATURE`.
- Signature of the wrong length (`'v0=abc'`) → `BAD_SIGNATURE` (no throw).
- Missing timestamp or signature → `MISSING_HEADERS`.
- A non-numeric timestamp → `STALE`.

`slack-message.test.ts`:
- `buildApprovalMessage({ runId, approvalId, requesterId:'U0REQ1', pricedLines, totalCents: 869700, remainingBudgetCents: 630300, justification })` returns `{ text, blocks }`:
  - `text` contains `$8,697.00` and `<@U0REQ1>`;
  - there is exactly one `actions` block with two buttons, `action_id` `approve` (style `primary`) and `reject` (style `danger`);
  - the button values are `JSON.stringify({ a: approvalId, d: 'approve' })` and the same with `'reject'`.
- A justification of 5000 chars is truncated to ≤ 2900 chars, ending in `…`.
- `parseActionValue('{"a":"<valid ulid>","d":"approve"}')` → `{ approvalId, decision:'approve' }`. These return `null`:
  - `'{"a":"x","d":"approve"}'` (bad id);
  - `'{"a":"<ulid>","d":"maybe"}'`;
  - `'not json'`;
  - `'{"a":"<ulid>","d":"approve","x":1}'` (extra key).
- `buildOutcomeMessage({ runId, status:'DONE', decidedBy:'U0APPROVER1', totalCents: 869700 })` has no `actions` block and its text contains `Ordered`. Each status has its own text:

  | status | text contains |
  |---|---|
  | `REJECTED_BY_HUMAN` | `Rejected` |
  | `EXPIRED` | `Expired` |
  | `FAILED` with `reason 'BUDGET_EXHAUSTED'` | `budget` |

- [ ] **Step 2: Implement.**

`slack-verify.ts`:
- Base string: `v0:${timestamp}:${rawBody}`. Signature: HMAC-SHA256 hex, prefixed `v0=`.
- Compare with `crypto.timingSafeEqual` on equal-length Buffers; a length mismatch returns `BAD_SIGNATURE`.
- Tolerance is 300 s in both directions.

`slack-message.ts`:
- Block Kit JSON: a `header` block; a `section` with fields for requester and run id; one `section` per priced line (`*3 × GPU dev box (RTX 4090)* — $8,697.00`); a total + remaining budget `context` block; the justification `section`; the `actions` block.
- Export `ApprovalMessageInput` and `SlackMessage = { text: string; blocks: unknown[] }`.

- [ ] **Step 3: Verify and commit.** `npm test` → all pass. Commit: `feat(core): verify Slack signatures and build approval messages`

---

## Task 6: Execution planning (I1 preconditions, budget arithmetic)

**Files:** create `src/core/execute.ts`. Test: `test/unit/core/execute.test.ts`.

- [ ] **Step 1: Failing tests.** Base input: the stored proposal is `validOrder()`. The approval is `{ state:'APPROVED', proposalHash: proposalHash(validOrder()), decidedBy:'U0APPROVER1', totalCents: 869700, pricedLines }`. The budget is `{ limitCents: 1_500_000, spentCents: 0 }`. `nowIso = '2026-10-04T10:00:00.000Z'`.
  - OK → `{ ok:true, totalCents: 869700, maxSpentBeforeCents: 630300, limitCents: 1_500_000 }`. The `ledgerEntry` carries `approvedBy 'U0APPROVER1'`, `createdAt nowIso` and `proposalHash`.
  - `rejects when approval hash differs from proposal hash`: mutate the stored proposal (`qty: 4`) → `{ ok:false, error:'HashMismatch' }`.
  - Approval `null` → `NotApproved`. Each of `PENDING`, `REJECTED` and `EXPIRED` → `NotApproved`.
  - Budget `null` → `BudgetExhausted`. `spentCents: 630300` → ok (boundary). `630301` → `BudgetExhausted`. `limitCents < totalCents` → `BudgetExhausted`.
  - Property (fast-check): for any limit, spent and total in 0..10_000_000, `ok ⇒ spent + total <= limit`, and `!ok ⇒ spent + total > limit`. Hash and approval stay valid throughout.

- [ ] **Step 2: Implement**

```ts
export interface ExecutionInput {
  runId: string; requesterId: string; storedProposal: unknown;
  approval: Pick<ApprovalRecord, 'state' | 'proposalHash' | 'decidedBy' | 'totalCents' | 'pricedLines'> | null;
  budget: Pick<Budget, 'limitCents' | 'spentCents'> | null; nowIso: string;
}
export type ExecutionPlan =
  | { ok: true; proposalHash: string; totalCents: number; limitCents: number; maxSpentBeforeCents: number; ledgerEntry: LedgerEntry }
  | { ok: false; error: 'NotApproved' | 'HashMismatch' | 'BudgetExhausted'; message: string };
export function planExecution(input: ExecutionInput): ExecutionPlan
```
Checks run in this order: approval present and `APPROVED` → hash equal → budget present → `maxSpentBeforeCents = limit - total` must be ≥ 0 and ≥ spent.

- [ ] **Step 3: Verify and commit.** `npm test` → all pass. Commit: `feat(core): plan purchase order execution bound to the approved proposal hash`

---

## Task 7: DynamoDB repositories

**Files:** create `src/adapters/ddb.ts`, `src/adapters/tables.ts`, `src/adapters/ports.ts`, `src/adapters/runs-repo.ts`, `src/adapters/catalog-repo.ts`, `src/adapters/budgets-repo.ts`, `src/adapters/ledger-repo.ts`, `src/adapters/log.ts`. Tests: `test/unit/adapters/runs-repo.test.ts`, `test/unit/adapters/ledger-repo.test.ts`, `test/unit/adapters/catalog-repo.test.ts`, `test/unit/adapters/log.test.ts`.

Interfaces go in `ports.ts`, so handlers depend on interfaces and tests use in-memory fakes. Classes implement them with `DynamoDBDocumentClient`. Real semantics (conditions, transactions) are proven against DynamoDB Local in Task 18. Unit tests here assert the exact command inputs and the error mapping with `aws-sdk-client-mock`.

- [ ] **Step 1: Contracts** (`ports.ts`)

```ts
export interface RunMeta { runId: string; requesterId: string; request: string; status: RunStatus; createdAt: string; updatedAt: string; executionArn?: string; failureReason?: string; slackTs?: string; slackChannel?: string }
export interface StoredProposal { proposal: ProposedOrder; proposalHash: string; usage: ModelUsage }
export interface StoredApproval extends ApprovalRecord { taskToken: string; ttl: number }
export interface RunsPort {
  createRun(i: { runId: string; requesterId: string; request: string; nowIso: string }): Promise<void>;   // cond attribute_not_exists(pk)
  getMeta(runId: string): Promise<RunMeta | null>;
  update(runId: string, fields: Partial<Pick<RunMeta, 'executionArn' | 'slackTs' | 'slackChannel'>>): Promise<void>;
  transition(runId: string, from: RunStatus, to: RunStatus, nowIso: string, extra?: { failureReason?: string }): Promise<boolean>; // assertTransition first; false on ConditionalCheckFailed
  putProposal(runId: string, p: StoredProposal): Promise<void>;          // cond attribute_not_exists(pk) OR proposalHash = :h ; else throws InvalidProposal('proposal already stored with a different hash')
  getProposal(runId: string): Promise<StoredProposal | null>;
  createApproval(a: StoredApproval, nowIso: string): Promise<void>;      // one TransactWrite: APPROVAL put (cond attribute_not_exists(pk) OR #state = PENDING), LOOKUP put, META POLICY|AWAITING_APPROVAL -> AWAITING_APPROVAL
  findRunIdByApprovalId(approvalId: string): Promise<string | null>;
  getApproval(runId: string): Promise<StoredApproval | null>;
  decideApproval(runId: string, approvalId: string, state: 'APPROVED' | 'REJECTED', decidedBy: string, nowIso: string): Promise<boolean>; // cond #state = PENDING AND approvalId = :id
  expireApproval(runId: string, nowIso: string): Promise<boolean>;      // cond #state = PENDING
  listItems(runId: string): Promise<Record<string, unknown>[]>;         // Query pk, paginated
}
export interface CatalogPort { getMany(skus: string[]): Promise<Map<string, CatalogItem>>; listActive(): Promise<CatalogItem[]>; putAll(items: CatalogItem[]): Promise<void> }
export interface BudgetsPort { get(requesterId: string, month: string): Promise<Budget | null>; put(b: Budget): Promise<void> }
export type ExecuteOutcome = { kind: 'written' } | { kind: 'ledger-exists' };
export interface LedgerPort {
  execute(plan: Extract<ExecutionPlan, { ok: true }>, i: { runId: string; requesterId: string; month: string; nowIso: string }): Promise<ExecuteOutcome>;
  get(runId: string): Promise<LedgerEntry | null>;
  scanAll(): Promise<LedgerEntry[]>;
}
```

Key layout is exactly as in the spec's data model (`pk`/`sk`; `RUN#`, `META`, `PROPOSAL#v1`, `APPROVAL`, `APPROVAL#<id>`/`LOOKUP`, `SKU#`/`ITEM`, `REQ#`/`MONTH#`, `PO#`/`PO`). `monthOf(iso) = iso.slice(0, 7)` goes in `budgets-repo.ts`.

- [ ] **Step 2: `LedgerRepo.execute` transaction.** Its four items must be in this order, because the index maps the cancellation reason:
  0. `ConditionCheck` Runs `{pk: RUN#id, sk: APPROVAL}`: `#state = :approved AND proposalHash = :h`.
  1. `Put` Ledger `{pk: PO#id, sk: PO, ...ledgerEntry}`: `attribute_not_exists(pk)`.
  2. `Update` Budgets `{pk: REQ#requester, sk: MONTH#month}`: `SET spentCents = spentCents + :t`, condition `limitCents = :lim AND spentCents <= :maxBefore`.
  3. `Update` Runs META: `SET #status = :done, updatedAt = :now`, condition `#status = :executing`.

  Map a `TransactionCanceledException` by checking `CancellationReasons` in this order:
  - reason[1] is `ConditionalCheckFailed` → return `{ kind: 'ledger-exists' }`;
  - reason[0] → throw `NotApproved`;
  - reason[2] → throw `BudgetExhausted`;
  - reason[3] → throw `IllegalTransition`;
  - otherwise rethrow (for example `TransactionConflict`, which the SDK does not retry inside a transaction, so SFN retries the task).

- [ ] **Step 3: `log.ts`.** `log(level, msg, fields)` writes one JSON line to stdout. A recursive `redact` replaces the value of any key matching `/token/i` with `'[redacted]'`. Export `captureLogs()` for tests. It returns `{ lines: string[]; restore() }` and swaps the sink.

- [ ] **Step 4: Failing tests, then implement.** Use `mockClient(DynamoDBDocumentClient)`:
  - `createRun` sends a `PutCommand` with `ConditionExpression: 'attribute_not_exists(pk)'`.
  - `transition('r','PLANNING','POLICY')` sends an `UpdateCommand` with condition `#status = :from`. It returns `false` when the mock rejects with `ConditionalCheckFailedException`. It throws `IllegalTransition` for `PLANNING→DONE` without sending anything.
  - `createApproval` sends one `TransactWriteCommand` with 3 items.
  - `LedgerRepo.execute` sends a 4-item transaction in the order above. Reject with a `TransactionCanceledException` carrying these `CancellationReasons` codes, and check the result:

    | Codes | Result |
    |---|---|
    | `None, ConditionalCheckFailed, None, ConditionalCheckFailed` | `ledger-exists` |
    | `ConditionalCheckFailed, None, None, None` | throws `NotApproved` |
    | `None, None, ConditionalCheckFailed, None` | throws `BudgetExhausted` |

    Construct the error with `new TransactionCanceledException({ message: 'x', $metadata: {}, CancellationReasons: [...] })` from `@aws-sdk/client-dynamodb`.
  - `CatalogRepo.getMany` uses `BatchGetCommand` in chunks of 100. `putAll` uses `BatchWriteCommand` in chunks of 25.
  - `log.test.ts`: `log('info','x',{ taskToken:'SECRET', nested:{ TaskToken:'S2' } })` → the captured line contains neither `SECRET` nor `S2`.

- [ ] **Step 5: Verify and commit.** `npm test` → all pass; `npm run typecheck` → exit 0. Commit: `feat(adapters): add DynamoDB repositories with transactional ledger execution`

---

## Task 8: Agent clients and the first four handlers

**Files:** create `src/adapters/workflow.ts`, `src/adapters/agent-client.ts`, `src/handlers/http.ts`, `src/handlers/start-run.ts`, `src/handlers/invoke-agent.ts`, `src/handlers/persist-proposal.ts`, `src/handlers/policy-check.ts`, and `test/unit/fakes.ts` (in-memory `RunsPort`, `CatalogPort`, `BudgetsPort`, `LedgerPort` and `WorkflowPort` fakes that mimic the conditions). Tests: `test/unit/adapters/agent-client.test.ts`, `test/unit/handlers/{start-run,invoke-agent,persist-proposal,policy-check}.test.ts`.

**Handler module pattern** (all nine handlers use it):
```ts
export interface XDeps { /* ports + clock */ now: () => string }
export function makeXHandler(deps: XDeps) { return async (event: XEvent): Promise<XResult> => { ... }; }
export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> { /* build real adapters from env */ }
let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
```

- [ ] **Step 1: `workflow.ts`.** `WorkflowPort { start(runId, input): Promise<string /*executionArn*/>; succeed(taskToken, output: object): Promise<void>; fail(taskToken, error: string, cause: string): Promise<void> }`. `StepFunctionsWorkflow(client: SFNClient, stateMachineArn)` implements it with `StartExecutionCommand({ name: runId, input })`, `SendTaskSuccessCommand` and `SendTaskFailureCommand`. On `ExecutionAlreadyExists`, `start` returns the existing ARN, built as `stateMachineArn.replace(':stateMachine:', ':execution:') + ':' + runId`. `succeed`/`fail` wrap the call in up to 3 attempts with 100/200 ms backoff, but rethrow `TaskTimedOut` and `TaskDoesNotExist` immediately.

- [ ] **Step 2: `agent-client.ts`**

```ts
export interface AgentInvocation { runId: string; request: string; catalog: Array<Pick<CatalogItem, 'sku' | 'name' | 'unitPriceCents' | 'maxQtyPerOrder'>> }
export interface AgentResult { proposal: unknown; usage: ModelUsage; model: string }
export interface AgentClient { invoke(i: AgentInvocation): Promise<AgentResult> }
```
- `HttpAgentClient(baseUrl, fetchImpl = fetch, timeoutMs = 300_000)` → `POST ${baseUrl}/invocations` with a JSON body.
  - A non-2xx response throws `AgentFailed('agent HTTP <status>')`.
  - A non-JSON body throws `AgentFailed('agent returned non-JSON')`.
  - A body `{ error: { type, message } }` throws `AgentFailed('<type>: <message>')`.
  - Otherwise the body must contain `proposal`, `usage` and `model`.
- `AgentCoreAgentClient(client: BedrockAgentCoreClient, agentRuntimeArn)` sends `InvokeAgentRuntimeCommand({ agentRuntimeArn, runtimeSessionId: 'procurement-run-' + runId, contentType: 'application/json', accept: 'application/json', payload: new TextEncoder().encode(JSON.stringify(i)) })`. It reads `await res.response!.transformToString()`, then parses as above. `runtimeSessionId` must be ≥ 33 chars; assert it in the test.
- Tests: inject a fake `fetchImpl` (no servers). For AgentCore, use `mockClient(BedrockAgentCoreClient)` resolving `{ response: { transformToString: async () => JSON.stringify(ok) } as any, contentType: 'application/json' }`.

- [ ] **Step 3: `http.ts`** (API Gateway v2 helpers): `json(statusCode, body)` → `{ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }`; `rawBody(event)` handles `isBase64Encoded`; `header(event, name)` does a case-insensitive lookup.

- [ ] **Step 4: Handlers** (write each test first, then the code)
  - `start-run` (`APIGatewayProxyEventV2` → result):
    - The body is `{ request: string (1-2000 chars), requesterId: /^[UW][A-Z0-9]{2,20}$/ }`. A bad body → 400 `{ error }`.
    - Otherwise: `runId = newRunId()`, `runs.createRun`, `workflow.start(runId, { runId, requesterId, request })`, `runs.update(runId, { executionArn })` → 202 `{ runId }`.
    - Tests: 202 path; 400 on empty request, bad requester and non-JSON; `workflow.start` is called with name = runId.
  - `invoke-agent` (`{ runId, request }` → `AgentResult`):
    - Load `catalog.listActive()` and call `agent.invoke({ runId, request, catalog })`. Return `{ proposal, usage, model }`.
    - Tests: the catalog is passed to the agent; `AgentFailed` propagates.
  - `persist-proposal` (`{ runId, agent: AgentResult }` → `{ proposalHash }`):
    - `validateProposedOrder` failure → throw `InvalidProposal(errors.join('; '))`.
    - `proposal.runId !== runId` → throw `InvalidProposal('runId mismatch')`.
    - `putProposal` → `transition(PLANNING→POLICY)`. If that returns false, read the meta: `POLICY` is OK (idempotent retry); anything else throws `IllegalTransition`.
    - Tests (I9): malformed fixtures (extra field, qty 0, 11 lines) throw `InvalidProposal`, and the fake records **no** `putProposal` call. A retry with the same proposal succeeds.
  - `policy-check` (`{ runId, requesterId }` → `PolicyResult`):
    - Load the stored proposal (missing → `NotFound`), `catalog.getMany(skus)` and `budgets.get(requesterId, monthOf(now()))`, then `evaluatePolicy({ ..., maxOrderCents })`.
    - `maxOrderCents` comes from env `MAX_ORDER_CENTS` (default 1_000_000).
    - Tests: a passing order returns `ok:true` and the total; an over-budget order returns `ok:false` with the reason.

  `fromEnv` reads:

  | Handler | Env vars |
  |---|---|
  | `start-run` | `RUNS_TABLE`, `STATE_MACHINE_ARN` |
  | `invoke-agent` | `CATALOG_TABLE`, plus `AGENT_URL` (→ `HttpAgentClient`) or `AGENT_RUNTIME_ARN` (→ `AgentCoreAgentClient`); neither → throw |
  | `persist-proposal` | `RUNS_TABLE` |
  | `policy-check` | `RUNS_TABLE`, `CATALOG_TABLE`, `BUDGETS_TABLE`, `MAX_ORDER_CENTS` |

- [ ] **Step 5: Verify and commit.** `npm test` → all pass. Commit: `feat(handlers): start runs, invoke the agent team, persist and price proposals`

---

## Task 9: Approval handlers: request-approval (I11), slack-interactions (I5, I6, I7), get-run

**Files:** create `src/adapters/slack.ts`, `src/adapters/secrets.ts`, `src/handlers/request-approval.ts`, `src/handlers/slack-interactions.ts`, `src/handlers/get-run.ts`. Tests: `test/unit/adapters/slack.test.ts`, `test/unit/handlers/{request-approval,slack-interactions,get-run}.test.ts`.

- [ ] **Step 1: `slack.ts`.**
  - `SlackPort { postMessage(m: { channel: string } & SlackMessage): Promise<{ ts: string; channel: string }>; updateMessage(m: { channel: string; ts: string } & SlackMessage): Promise<void> }`.
  - `SlackWebClient(apiBase, botToken, fetchImpl = fetch)` POSTs to `${apiBase}/chat.postMessage` and `${apiBase}/chat.update` with `authorization: Bearer <token>` and `content-type: application/json; charset=utf-8`. If the response JSON has `ok !== true`, it throws `Error('slack <method>: <error>')`.
  - `apiBase` defaults to `https://slack.com/api`.
- [ ] **Step 2: `secrets.ts`.** `loadSlackSecrets(env)`:
  - If both `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` are set, return them.
  - Otherwise send `GetSecretValueCommand({ SecretId: SLACK_SECRET_ARN })` and parse `{ signingSecret, botToken }`. Cache per process.
  - Test both paths (mock `SecretsManagerClient`).
- [ ] **Step 3: `request-approval`** (event `{ taskToken, runId, requesterId, proposalHash, policy: PolicyResult }`):
  - `approvalId = newApprovalId()`.
  - `runs.createApproval({ runId, approvalId, taskToken, proposalHash, totalCents: policy.totalCents, pricedLines: policy.pricedLines, state:'PENDING', ttl: epochSeconds(now) + APPROVAL_TTL_SECONDS (default 259200) })`.
  - Load the proposal for its justification, then `slack.postMessage({ channel: SLACK_CHANNEL_ID, ...buildApprovalMessage(...) })`.
  - `runs.update(runId, { slackTs, slackChannel })`, catching and logging errors. Return `{ approvalId }`.
  - **I11 test:** use the token `'TOKEN-abc123-must-not-leak'`. Capture logs (`captureLogs`) and the fake Slack's received bodies. `JSON.stringify(bodies)` and every log line must not contain `TOKEN-abc123`; the stored approval does contain it.
  - Also test: a Slack failure after `createApproval` rethrows. The workflow task fails, and SFN `Catch` → `MarkFailed`.
- [ ] **Step 4: `slack-interactions`** (`APIGatewayProxyEventV2` → 200/401 JSON). Steps, in order:
  1. `verifySlackRequest` on `rawBody(event)` with headers `x-slack-request-timestamp` and `x-slack-signature`. On failure → `401 { error: 'invalid signature' }`. **No port call may happen before this.**
  2. Parse the form body: `new URLSearchParams(raw).get('payload')` → JSON. Require `type === 'block_actions'`, take `actions[0].value` → `parseActionValue`, and `user.id`. Anything malformed → `200 { response_type:'ephemeral', text:'Unsupported interaction.' }`.
  3. `findRunIdByApprovalId` → null → `200 ephemeral 'Unknown approval.'`.
  4. `getApproval` + `getMeta`. If the state is not `PENDING`, reply `'This request expired.'` for `EXPIRED`, else `'Already decided by <@X>.'`.
  5. `authorizeApprover` with `APPROVER_IDS`. On failure, reply `'You cannot approve your own request.'` or `'You are not an approver for this request.'`.
  6. `decideApproval` (CAS). If it returns false, re-read and reply as in step 4.
  7. Approve → `workflow.succeed(token, { decision:'approve', approver, proposalHash })`. Reject → `workflow.fail(token, 'HumanRejected', 'rejected by <user>')`. If either throws `TaskTimedOut` or `TaskDoesNotExist`, reply `'This request expired.'`.
  8. `200 ephemeral 'Approved. Placing the order.'` or `'Rejected.'`.

  Tests:
  - I6 `rejects stale timestamp` and `rejects tampered body` → 401, and the fake ports record zero calls.
  - I5: self-approval → reply text, no CAS, no workflow call.
  - I7 mapping: the fake CAS returns false → `'Already decided'`, no workflow call.
  - The approve path calls `succeed` with an output containing `proposalHash`. The reject path calls `fail` with `HumanRejected`.
  - `TaskTimedOut` → expired reply.
  - Base64 body works.
- [ ] **Step 5: `get-run`** (`GET /runs/{runId}`):
  - Returns `200 { runId, status, failureReason?, proposal?, proposalHash?, approval?: { approvalId, state, decidedBy?, totalCents }, ledger?: LedgerEntry }`, or 404.
  - Test: the response JSON never contains `taskToken` or the token value.
- [ ] **Step 6: Verify and commit.** `npm test` → all pass. Commit: `feat(handlers): request Slack approval and resume the workflow on verified clicks`

---

## Task 10: execute-po (idempotent, I1/I3/I4 preconditions) and finalize

**Files:** create `src/handlers/execute-po.ts`, `src/handlers/finalize.ts`, `src/handlers/registry.ts`. Tests: `test/unit/handlers/{execute-po,finalize}.test.ts`, `test/unit/handlers/registry.test.ts`.

- [ ] **Step 1: `execute-po`** (event `{ runId, requesterId }` → `{ ledgerWritten: true, totalCents } | { alreadyExecuted: true, totalCents }`):
  1. `meta = getMeta` (missing → `NotFound`). If `DONE` → go to the read-back path (step 4).
  2. If `AWAITING_APPROVAL` → `transition(→EXECUTING)`. If that returns false, re-read the meta: `EXECUTING` continues, `DONE` goes to read-back, anything else throws `NotApproved`.
  3. If the status is not `EXECUTING` → throw `NotApproved`. Then load the approval, proposal and budget (`monthOf(now())`) and call `planExecution`. Pass the stored `proposal` **object** as `storedProposal`, so its hash is recomputed. Never trust the stored `proposalHash` field; that is what makes I1 hold when someone edits the stored proposal. If it is not ok, throw `new {NotApproved|HashMismatch|BudgetExhausted}(message)`. Otherwise call `ledger.execute(plan, …)`:
     - `written` → return `{ ledgerWritten: true }`;
     - `ledger-exists` → read-back.
  4. Read-back: `ledger.get(runId)`. If its `proposalHash` equals the approval's, return `{ alreadyExecuted: true, totalCents }`. Otherwise throw `HashMismatch`.

  Tests:
  - The happy path writes once.
  - **Retry after commit:** the second call returns `alreadyExecuted`, and the fake ledger still has 1 row with budget charged once.
  - A hash mismatch throws an error whose `.name === 'HashMismatch'`.
  - Budget too small → `.name === 'BudgetExhausted'`.
  - An approval in `REJECTED` → `NotApproved`.
- [ ] **Step 2: `finalize`** (event `{ runId, outcome: 'DONE'|'REJECTED_BY_POLICY'|'REJECTED_BY_HUMAN'|'EXPIRED'|'FAILED', error?: { Error?: string; Cause?: string } }` → `{ status }`):
  - `EXPIRED` → `runs.expireApproval` first (ignore false).
  - Read the meta. If the status already equals the target, there is nothing to change. If the current status is terminal and differs, leave it and return the current status. Otherwise `transition(current → target)`. For `FAILED`, set `failureReason = error?.Error === 'BudgetExhausted' ? 'BUDGET_EXHAUSTED' : (error?.Error ?? 'UNKNOWN')`.
  - If the meta has `slackTs`, call `slack.updateMessage(buildOutcomeMessage(...))`. Catch and log errors (best effort).
  - Tests: idempotent on a second call; `DONE` stays `DONE` when finalize is called with `FAILED`; `EXPIRED` calls `expireApproval`; a Slack failure does not throw.
- [ ] **Step 3: `registry.ts`.** `export const HANDLER_NAMES = ['start-run','get-run','slack-interactions','invoke-agent','persist-proposal','policy-check','request-approval','execute-po','finalize'] as const; export type HandlerName = typeof HANDLER_NAMES[number]; export const REGISTRY: Record<HandlerName, { fromEnv(env: Env): Promise<(e: any) => Promise<any>> }>` (imports each module's `fromEnv`). Test: there are 9 keys, each with a `fromEnv` function.
- [ ] **Step 4: Verify and commit.** `npm test` → all pass. Commit: `feat(handlers): execute purchase orders idempotently and finalize run outcomes`

---

## Task 11: sfn-local-harness: intrinsic resolver and stack loader

**Files:** create `packages/sfn-local-harness/package.json`, `tsconfig.json`, `src/index.ts`, `src/resolve.ts`, `src/load-stack.ts`. Tests: `packages/sfn-local-harness/test/resolve.test.ts`, `test/load-stack.test.ts`, `test/fixtures/template.json` (a small hand-written template: 1 table, 2 functions, 1 state machine with a `Fn::Join` definition using `Fn::GetAtt` and `Ref AWS::Partition`, plus a `Fn::Sub` env var).

- [ ] **Step 1: Package files**

`package.json`:
```json
{
  "name": "sfn-local-harness",
  "version": "0.1.0",
  "description": "Run the Step Functions state machine your CDK app synthesizes on AWS Step Functions Local, with your Lambda handlers in-process.",
  "type": "module",
  "license": "MIT",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=22" },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "peerDependencies": { "@aws-sdk/client-dynamodb": "^3.1146.0", "@aws-sdk/client-sfn": "^3.1146.0" }
}
```
`tsconfig.json`: same compiler options as the root, but `"noEmit": false, "declaration": true, "outDir": "dist", "rootDir": "src"`, include `["src"]`. Copy the root `LICENSE` into the package. Add `"sfn-local-harness": "0.1.0"` to the root `dependencies`, then run `npm install`. Change the root `build:harness` script to `npm run build -w sfn-local-harness`.

- [ ] **Step 2: Failing tests** (`resolve.test.ts`). The context is `{ region:'us-east-1', accountId:'123456789012', partition:'aws', urlSuffix:'amazonaws.com', ref:(id)=>..., getAtt:(id,attr)=>... }`.
  - `{"Fn::Join":["",["arn:",{"Ref":"AWS::Partition"},":states:::lambda:invoke"]]}` → `'arn:aws:states:::lambda:invoke'`.
  - `Fn::GetAtt` in both array form and the `"Fn1.Arn"` string form.
  - `Fn::Sub` string form with `${AWS::Region}`, `${MyTable}` (a Ref) and `${Fn1.Arn}` (a GetAtt).
  - It recurses through nested objects and arrays and leaves plain values unchanged.
  - `{"Fn::ImportValue":"x"}` throws `Unsupported intrinsic Fn::ImportValue`.
  - `Fn::Sub` in array form throws `Unsupported intrinsic Fn::Sub (array form)`.

  `load-stack.test.ts` (fixture template, `prefix: 't1'`):
  - The functions list has a logical id, `arn:aws:lambda:us-east-1:123456789012:function:t1<LogicalId>`, a `name` of `t1<LogicalId>` and resolved `environment` (a table `Ref` → `t1<TableLogicalId>`).
  - The table `createTableInput.TableName === 't1<TableLogicalId>'`, `BillingMode: 'PAY_PER_REQUEST'`, and `KeySchema`/`AttributeDefinitions` are copied. The TTL spec is returned separately as `ttlAttribute`. `SSESpecification` and `PointInTimeRecoverySpecification` are dropped.
  - The state machine `definition` is a JSON string that parses. Its Lambda ARNs match the function ARNs. `name === 't1<SmLogicalId>'`, and `arn === 'arn:aws:states:us-east-1:123456789012:stateMachine:t1<SmLogicalId>'`.
  - A `Ref` to the state machine (as used in env vars) resolves to that ARN.
  - `Ref`/`GetAtt` to an unknown logical id throws `Unknown resource <id>`.

- [ ] **Step 3: Implement** `resolveIntrinsics(value, ctx)` and `loadStack(template, { prefix, region = 'us-east-1', accountId = '123456789012' })`:
  - `Ref` by resource type: `AWS::DynamoDB::Table` → table name; `AWS::Lambda::Function` → function name; `AWS::StepFunctions::StateMachine` → ARN; any other type → `<prefix><logicalId>`.
  - `GetAtt <id>.Arn`, by type:

    | Type | ARN |
    |---|---|
    | Table | `arn:aws:dynamodb:<r>:<a>:table/<name>` |
    | Function | `arn:aws:lambda:<r>:<a>:function:<name>` |
    | StateMachine | `arn:aws:states:<r>:<a>:stateMachine:<name>` |
    | anything else | `arn:aws:local:<r>:<a>:<logicalId>` |

  - Other attributes → `<prefix><logicalId>.<attr>`.
  - Export everything from `src/index.ts`.
- [ ] **Step 4: Verify and commit.** `npm run build -w sfn-local-harness` → exit 0; `npm test` → all pass. Commit: `feat(harness): resolve CloudFormation intrinsics and load stacks for Step Functions Local`

---

## Task 12: sfn-local-harness: Lambda host and deployers

**Files:** create `packages/sfn-local-harness/src/lambda-host.ts`, `src/deploy.ts`, `README.md`. Tests: `test/lambda-host.test.ts`.

- [ ] **Step 1: Failing tests** (`lambda-host.test.ts`; uses port **5339**, the only unit test allowed to bind a port, inside 5330-5339):
  - `startLambdaHost({ port: 5339, resolve: (name) => name === 'Echo' ? async (e) => ({ got: e }) : undefined })`.
  - `POST /2015-03-31/functions/Echo/invocations` with `{"a":1}` → 200 `{"got":{"a":1}}`.
  - The function name may be URL-encoded or a full ARN: `arn%3Aaws%3Alambda%3Aus-east-1%3A123456789012%3Afunction%3AEcho` resolves to `Echo`.
  - A handler throwing `class BudgetExhausted extends Error { name = 'BudgetExhausted' }` → 200, header `x-amz-function-error: Unhandled`, body `{"errorType":"BudgetExhausted","errorMessage":"..."}`.
  - An unknown function → 404 with `{"Type":"User","message":"Function not found: X"}` and header `x-amzn-errortype: ResourceNotFoundException`.
  - `host.invocations` counts per function name.
  - `close()` resolves and frees the port: a second `startLambdaHost` on 5339 succeeds.
- [ ] **Step 2: Implement.**
  - `startLambdaHost({ port, host = '0.0.0.0', resolve })` → `{ url, invocations: Map<string, number>, close(): Promise<void> }`, using `node:http`.
  - The function name is `decodeURIComponent(segment)`. If it starts with `arn:`, take the 7th `:`-separated field.
  - The empty body becomes `{}`.
  - Bind `0.0.0.0`, so the SFN Local container can reach the host through `host.docker.internal`.
- [ ] **Step 3: `deploy.ts`**
  - `waitForStepFunctionsLocal(sfn, timeoutMs = 60_000)` polls `ListStateMachinesCommand` every 500 ms until it succeeds, catching "socket hang up" and `ECONNREFUSED`. On timeout it throws `Step Functions Local not reachable at <endpoint> after <ms> ms. Start it with: npm run local:up`.
  - `waitForDynamoDbLocal(ddb, timeoutMs)` does the same with `ListTablesCommand`.
  - `deployTables(ddb, tables)` calls `CreateTableCommand`, ignoring `ResourceInUseException`. If `ttlAttribute` is set, it then calls `UpdateTimeToLiveCommand`.
  - `deployStateMachine(sfn, { name, definition, roleArn = 'arn:aws:iam::123456789012:role/sfn-local' })` returns the ARN.
  - `deleteStateMachine` is optional.
  - These are exercised against real containers in Task 16; no unit test needed beyond typecheck.
- [ ] **Step 4: `README.md`** for the package: what it does (one paragraph), install line, a 25-line usage example (`loadStack` → `deployTables` → `deployStateMachine` → `startLambdaHost`), the supported intrinsics and the known SFN Local limits (link to ADR 0001 in the repo).
- [ ] **Step 5: Verify and commit.** `npm test` → all pass. `npm run build -w sfn-local-harness && npm pack -w sfn-local-harness --dry-run` lists only `dist/**`, `README.md`, `LICENSE` and `package.json`. Commit: `feat(harness): host Lambda handlers in-process for Step Functions Local`

---

## Task 13: CDK stack skeleton and the Data construct

**Files:** create `cdk.json`, `infra/lib/stack.ts`, `infra/lib/data.ts`, `infra/lib/handler-function.ts`, `infra/test/helpers.ts`, `infra/test/data.test.ts`.

- [ ] **Step 1: `cdk.json`**: `{ "app": "npx tsx infra/bin/app.ts", "context": { "@aws-cdk/core:newStyleStackSynthesis": true } }`.
- [ ] **Step 2: Stack props** (`infra/lib/stack.ts`)

```ts
export interface DurableMultiAgentStackProps extends StackProps {
  readonly stage: 'aws' | 'local';
  readonly approvalTimeoutSeconds?: number;   // default 172800
  readonly agentUrl?: string;                 // local stage; default 'http://127.0.0.1:5333'
  readonly slackChannelId?: string;           // default 'C0APPROVALS'
  readonly approverIds?: string;              // CSV; default ''
  readonly maxOrderCents?: number;            // default 1_000_000
  readonly codeFor?: (name: HandlerName) => lambda.Code; // default: aws -> Code.fromAsset('dist/lambda/<name>'), local -> Code.fromInline('// runs in-process locally')
}
export class DurableMultiAgentStack extends Stack { readonly data: Data; readonly flow: Flow; readonly api: Api; }
```
In the `aws` stage, add `new CfnParameter(this, 'AgentRuntimeArn', { type: 'String', allowedPattern: '^arn:aws[a-z-]*:bedrock-agentcore:[a-z0-9-]+:[0-9]{12}:runtime/.+$', description: 'ARN of the AgentCore runtime that hosts the procurement agent' })`. The `local` stage has no parameters. In this task, only `Data` is created (`Flow` and `Api` come in Tasks 14-15; keep the fields optional until then, or add them in those tasks).

- [ ] **Step 3: `Data` construct**:
  - a `kms.Key` `RunsKey` (`enableKeyRotation: true`);
  - tables `RunsTable` (encryption `CUSTOMER_MANAGED` with `RunsKey`, `timeToLiveAttribute: 'ttl'`), `CatalogTable`, `BudgetsTable` and `LedgerTable` (`AWS_MANAGED`).

  Every table has `pk`/`sk` (`STRING`), `PAY_PER_REQUEST` billing and `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }`. Removal policy is `RETAIN` for `aws` and `DESTROY` for `local`. Expose `tables` and `key`.
- [ ] **Step 4: `handlerFunction(scope, id, { name, environment, codeFor, timeout?, memorySize? })`**:
  - `lambda.Function` with runtime `NODEJS_24_X`, architecture `ARM_64`, handler `index.handler`, `tracing: ACTIVE` and memory 256 (default);
  - timeout 30 s (default);
  - its own `logs.LogGroup` (retention `ONE_MONTH`);
  - environment `{ DMA_HANDLER: name, NODE_OPTIONS: '--enable-source-maps', ...environment }`.
- [ ] **Step 5: Tests** (`infra/test/data.test.ts`). The helper `synth(props?)` in `infra/test/helpers.ts` builds an `App` and a stack with `stage: 'aws'` and `codeFor: () => lambda.Code.fromInline('x')`, and returns `Template.fromStack(stack)`. Then:
  - `resourceCountIs('AWS::DynamoDB::Table', 4)`;
  - every table has `PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled: true` and `BillingMode: PAY_PER_REQUEST`;
  - the runs table has `SSESpecification.SSEEnabled: true` with a `KMSMasterKeyId`, and `TimeToLiveSpecification { AttributeName: 'ttl', Enabled: true }`;
  - the KMS key has `EnableKeyRotation: true`;
  - `stage: 'local'` → tables have `DeletionPolicy: 'Delete'`, and the template has no `Parameters.AgentRuntimeArn`.
- [ ] **Step 6: Verify and commit.** `npm test` → all pass. Commit: `feat(infra): add CDK stack with encrypted, point-in-time-recoverable tables`

---

## Task 14: Flow construct and the state machine definition (I8)

**Files:** create `infra/lib/definition.ts`, `infra/lib/flow.ts`; modify `infra/lib/stack.ts`. Test: `infra/test/flow.test.ts`.

- [ ] **Step 1: Functions** in `Flow` (construct ids): `InvokeAgentFn` (timeout 5 min, memory 512), `PersistProposalFn`, `PolicyCheckFn`, `RequestApprovalFn`, `ExecutePoFn` and `FinalizeFn`. A Secrets Manager secret `SlackSecret` lives in the stack (created in `Flow` or `stack.ts`): `generateSecretString: { secretStringTemplate: JSON.stringify({ botToken: 'set-me' }), generateStringKey: 'signingSecret' }`. Environment:

| Function | Environment | Grants |
|---|---|---|
| InvokeAgentFn | `CATALOG_TABLE`; `AGENT_URL` (local) or `AGENT_RUNTIME_ARN` = parameter value (aws) | catalog read; aws only: `bedrock-agentcore:InvokeAgentRuntime` on `[arn, arn + '/*']` |
| PersistProposalFn | `RUNS_TABLE` | runs read/write |
| PolicyCheckFn | `RUNS_TABLE`, `CATALOG_TABLE`, `BUDGETS_TABLE`, `MAX_ORDER_CENTS` | runs, catalog, budgets read |
| RequestApprovalFn | `RUNS_TABLE`, `SLACK_SECRET_ARN`, `SLACK_CHANNEL_ID`, `APPROVAL_TTL_SECONDS` (= timeout + 86400) | runs read/write; secret read |
| ExecutePoFn | `RUNS_TABLE`, `BUDGETS_TABLE`, `LEDGER_TABLE` | runs read/write, budgets read/write, ledger read/write |
| FinalizeFn | `RUNS_TABLE`, `SLACK_SECRET_ARN` | runs read/write; secret read |

- [ ] **Step 2: `buildDefinition(scope, fns, { approvalTimeoutSeconds })`** exactly as in the spec's state table. All tasks use `tasks.LambdaInvoke` with `payloadResponseOnly: true`.
  - `InvokeAgentTeam` payload `{ runId.$, request.$ }` → `resultPath '$.agent'`.
  - `PersistProposal` payload `{ runId.$, agent.$: '$.agent' }` → `'$.persist'`.
  - `PolicyCheck` payload `{ runId.$, requesterId.$ }` → `'$.policy'`.
  - `PolicyPassed?` is a `Choice` on `Condition.booleanEquals('$.policy.ok', true)`.
  - `RequestApproval` uses `integrationPattern: WAIT_FOR_TASK_TOKEN`, payload `{ taskToken: JsonPath.taskToken, runId.$, requesterId.$, proposalHash.$: '$.persist.proposalHash', policy.$: '$.policy' }`, `taskTimeout: sfn.Timeout.duration(Duration.seconds(approvalTimeoutSeconds))` and `resultPath '$.approval'`.
  - `ExecutePO` payload `{ runId.$, requesterId.$ }` → `'$.execution'`. It has **two** `addRetry` calls in this order:
    1. `{ errors: ['BudgetExhausted','HashMismatch','NotApproved'], maxAttempts: 0 }`;
    2. `{ errors: ['States.ALL'], maxAttempts: 3, interval: Duration.seconds(1), backoffRate: 2 }`.
  - Catches (all with `resultPath: '$.error'`):

    | State | Error → next state |
    |---|---|
    | `InvokeAgentTeam`, `PersistProposal`, `PolicyCheck`, `ExecutePO` | `States.ALL` → `MarkFailed` |
    | `RequestApproval` | `States.Timeout` → `MarkExpired`; `HumanRejected` → `MarkRejectedByHuman`; `States.ALL` → `MarkFailed` |

  - Finalize tasks call `FinalizeFn` with payload `{ runId.$, outcome: '<OUTCOME>' }`. `MarkFailed`, `MarkExpired` and `MarkRejectedByHuman` also pass `error.$: '$.error'`; never reference `$.error` from states reached without an error. `MarkDone` follows `ExecutePO`. `MarkRejectedByPolicy` follows the Choice's otherwise branch. `MarkFailed` → `sfn.Fail('Failed', { error: 'RunFailed' })`. The others → `sfn.Succeed('Finished')`.
  - State machine `ProcurementFlow`: `DefinitionBody.fromChainable`, `stateMachineType: STANDARD`, `timeout: Duration.seconds(approvalTimeoutSeconds + 3600)`, `tracingEnabled: true`, and `logs: { destination: new logs.LogGroup(...), level: sfn.LogLevel.ALL, includeExecutionData: false }`. `includeExecutionData: false` keeps task tokens and payloads out of logs (I11).
  - Expose `stateMachine` and `functions`.
- [ ] **Step 3: Tests** (`infra/test/flow.test.ts`). Resolve the `DefinitionString` with `resolveIntrinsics` from `sfn-local-harness`, using a `ref`/`getAtt` that returns the logical id, then `JSON.parse` it:
  - `States.RequestApproval.TimeoutSeconds === 172800` (I8). With `approvalTimeoutSeconds: 5` → `5`.
  - `States.RequestApproval.Resource` ends with `:states:::lambda:invoke.waitForTaskToken`, and its `Parameters.Payload['taskToken.$'] === '$$.Task.Token'`.
  - The `RequestApproval` catches route `States.Timeout`→`MarkExpired`, `HumanRejected`→`MarkRejectedByHuman`, `States.ALL`→`MarkFailed`, in that order.
  - In `ExecutePO.Retry`, the first entry whose `ErrorEquals` contains `BudgetExhausted` comes before the `States.ALL` entry, and its `MaxAttempts === 0`.
  - Every finalize payload that contains `error.$` belongs to a state that is only reachable through a `Catch` (check `MarkDone` and `MarkRejectedByPolicy` do not).
  - Every `AWS::Lambda::Function` has `Environment.Variables.DMA_HANDLER`, and the set of values equals the 6 flow handler names.
  - The state machine has `TracingConfiguration.Enabled: true` and `LoggingConfiguration.Level: 'ALL'`, with `IncludeExecutionData: false`.
- [ ] **Step 4: Verify and commit.** `npm test` → all pass. Commit: `feat(infra): define the procurement state machine with task-token approval and bounded wait`

---

## Task 15: Api construct, IAM invariants (I12), cdk-nag, app entry, bundling, synth gate

**Files:** create `infra/lib/api.ts`, `infra/lib/nag.ts`, `infra/bin/app.ts`, `scripts/bundle.mjs`; modify `infra/lib/stack.ts`. Tests: `infra/test/iam.test.ts`, `infra/test/nag.test.ts`.

- [ ] **Step 1: `Api`**:
  - functions `StartRunFn` (`RUNS_TABLE`, `STATE_MACHINE_ARN`; runs read/write; `stateMachine.grantStartExecution`), `GetRunFn` (`RUNS_TABLE`, `LEDGER_TABLE`; runs read, ledger read), `SlackInteractionsFn` (`RUNS_TABLE`, `SLACK_SECRET_ARN`, `APPROVER_IDS`; runs read/write; `stateMachine.grantTaskResponse`; secret read).
  - An `apigwv2.HttpApi` `ProcurementApi` with routes:

    | Route | Function | Authorizer |
    |---|---|---|
    | `POST /runs` | start-run | `HttpIamAuthorizer` |
    | `GET /runs/{runId}` | get-run | `HttpIamAuthorizer` |
    | `POST /slack/interactions` | slack-interactions | none (Slack HMAC is the auth) |

  - Default-stage access logs and throttling via the `CfnStage` escape hatch: `accessLogSettings` to a new LogGroup in JSON format, and `defaultRouteSettings { throttlingBurstLimit: 20, throttlingRateLimit: 10 }`.
  - Output `ApiUrl`.
- [ ] **Step 2: `iam.test.ts` (I12)**. Collect all `AWS::IAM::Policy` resources:
  - Every statement whose `Action` includes `bedrock-agentcore:InvokeAgentRuntime` belongs to a policy attached only to the `InvokeAgentFn` role. Exactly one such statement exists in the `aws` stage.
  - Every statement that grants any of `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:DeleteItem` or `dynamodb:BatchWriteItem` on a `Resource` referencing the ledger table's `Arn` belongs only to the `ExecutePoFn` role. Match roles by the `Ref` to the role whose logical id starts with `FlowExecutePoFn`.
  - Only the `SlackInteractionsFn` role has `states:SendTaskSuccess`.
  - No statement has `Action: '*'` or `Action` of the form `<service>:*`.
- [ ] **Step 3: `nag.ts`**. `applyNagSuppressions(stack)` uses `NagSuppressions.addResourceSuppressions` / `addStackSuppressions`. Every suppression has a one-sentence `reason` and, for `IAM5`, an explicit `appliesTo` list (for example `Action::kms:GenerateDataKey*`, `Resource::<LedgerTable.Arn>/index/*`, X-Ray `Resource::*`). Expected suppressions:
  - `AwsSolutions-IAM4` (AWSLambdaBasicExecutionRole);
  - `AwsSolutions-IAM5` (CDK grant wildcards, listed);
  - `AwsSolutions-APIG4` (the Slack route is authenticated by HMAC in code);
  - `AwsSolutions-SMG4` (Slack credentials are rotated in Slack, not by Lambda).

  Fix every other finding instead of suppressing it. If `AwsSolutions-L1` fires because a newer Node runtime exists, switch `handlerFunction` to the runtime it names and add a `Ruling:` line.
- [ ] **Step 4: `nag.test.ts`**. Use `App` + the `aws` stage with inline code, `Aspects.of(stack).add(new AwsSolutionsChecks())` and `applyNagSuppressions(stack)`. Then `Annotations.fromStack(stack).findError('*', Match.stringLikeRegexp('AwsSolutions-.*'))` has length 0.
- [ ] **Step 5: `infra/bin/app.ts`**. `new DurableMultiAgentStack(app, 'DurableMultiAgentStack', { stage: 'aws', approverIds: app.node.tryGetContext('approverIds') ?? '', slackChannelId: app.node.tryGetContext('slackChannelId') })`, then `Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))` and `applyNagSuppressions`.
- [ ] **Step 6: `scripts/bundle.mjs`**. Use esbuild for every `src/handlers/*.ts` except `registry.ts` and `http.ts`:
  - `bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: true`;
  - `outfile: dist/lambda/<name>/index.mjs`;
  - `banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" }`.

  It prints `bundled <n> handlers` and exits 1 on any error.
- [ ] **Step 7: Verify and commit**
  - `npm test` → all pass.
  - `npm run synth` → exit 0, prints `bundled 9 handlers`, no `[Error at` lines, and `cdk.out/DurableMultiAgentStack.template.json` exists.
  - Record the template's resource count in the ledger: `node -e "console.log(Object.keys(require('./cdk.out/DurableMultiAgentStack.template.json').Resources).length)"`.

  Commit: `feat(infra): expose the HTTP API and enforce least-privilege IAM with cdk-nag`

---

## Task 16: Docker compose, local environment, Slack sink and driver

**Files:** create `docker-compose.yml`, `seed/catalog.json`, `seed/budgets.json`, `src/local/env.ts`, `src/local/slack-sink.ts`, `src/local/seed.ts`, `src/local/driver.ts`, `src/local/fixture-agent.ts`. Tests: `test/integration/env.test.ts`, `test/unit/local/slack-sink.test.ts` (uses port **5338**).

- [ ] **Step 1: `docker-compose.yml`**

```yaml
name: durable-multi-agent
services:
  dynamodb:
    image: amazon/dynamodb-local:3.3.1
    container_name: durable-multi-agent-dynamodb
    command: ["-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb"]
    ports: ["127.0.0.1:5330:8000"]
  sfn:
    image: amazon/aws-stepfunctions-local:2.0.0
    container_name: durable-multi-agent-sfn
    ports: ["127.0.0.1:5332:8083"]
    environment:
      AWS_DEFAULT_REGION: us-east-1
      AWS_ACCOUNT_ID: "123456789012"
      LAMBDA_ENDPOINT: http://host.docker.internal:5331
    extra_hosts: ["host.docker.internal:host-gateway"]
  agent:
    build: ./agent
    image: durable-multi-agent-agent:local
    container_name: durable-multi-agent-agent
    ports: ["127.0.0.1:5333:8080"]
    environment:
      AGENT_MODEL: ${AGENT_MODEL:-scripted}
      OLLAMA_BASE_URL: http://host.docker.internal:11434
      OLLAMA_MODEL: ${OLLAMA_MODEL:-qwen3.8:27b}
    extra_hosts: ["host.docker.internal:host-gateway"]
```
(The `agent` service is built in Task 20; `local:up` starts only `dynamodb` and `sfn`.)

- [ ] **Step 2: Seeds.** `seed/catalog.json` holds the 4 items from `test/unit/fixtures.ts`, plus:

| sku | name | vendor | unitPriceCents | maxQtyPerOrder | active |
|---|---|---|---|---|---|
| `DOCK-USB4` | USB4 docking station | Fabrikam | 27900 | 20 | true |
| `KEYBOARD-ERGO` | Ergonomic keyboard | Contoso | 12900 | 30 | true |
| `HEADSET-ANC` | Noise-cancelling headset | Northwind Systems | 19900 | 30 | true |
| `CHAIR-ERGO` | Ergonomic chair | Fabrikam | 64900 | 10 | true |

`seed/budgets.json` is `[{ "requesterId": "U0REQUESTER", "limitCents": 1500000 }]`. The month is filled in at seed time.

- [ ] **Step 3: `slack-sink.ts`**. `startSlackSink({ port = 5334 })` binds `127.0.0.1`. It handles `POST /api/chat.postMessage` and `/api/chat.update`, records `{ method, body, at }`, and replies `{ ok: true, channel, ts: '<epoch>.<6-digit counter>' }`. Helpers:
  - `posts()`, `updates()`;
  - `approvalFor(runId)`: finds the post whose JSON contains `runId` and returns `{ approvalId }` parsed from its approve button value, or null;
  - `close()`.

  Unit test on port 5338: a post through `SlackWebClient` is recorded and `approvalFor` finds it.
- [ ] **Step 4: `env.ts` (`startLocalEnv(opts)`)**. Options:
  - `prefix` (default `'dma' + Date.now().toString(36)`);
  - `approvalTimeoutSeconds` (default 172800);
  - `agentClient?: AgentClient`;
  - `wrapHandler?: (name, h) => h`;
  - `approverIds` (default `'U0APPROVER1,U0APPROVER2'`);
  - `slackPort` (default 5334), `lambdaPort` (default 5331);
  - `maxOrderCents`.

  Steps:
  1. **Force** the local AWS env in `process.env`: `AWS_REGION=us-east-1`, `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`, `AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:5330`, `AWS_ENDPOINT_URL_SFN=http://127.0.0.1:5332`. Never read real credentials.
  2. Synthesize `DurableMultiAgentStack` with `stage: 'local'` in-process. Use `app.synth().getStackByName('DurableMultiAgentStack').template`, without cdk-nag.
  3. `loadStack(template, { prefix })`.
  4. `waitForDynamoDbLocal` and `waitForStepFunctionsLocal`, then `deployTables` and `deployStateMachine`.
  5. For each loaded function, read `DMA_HANDLER`. Its env is the function env plus `SLACK_SIGNING_SECRET=LOCAL_SIGNING_SECRET ('local-signing-secret')`, `SLACK_BOT_TOKEN='xoxb-local-fake'` and `SLACK_API_BASE='http://127.0.0.1:<slackPort>/api'`.
     - If `opts.agentClient` is set, build `invoke-agent` with `makeInvokeAgentHandler({ agent: opts.agentClient, catalog })`.
     - Otherwise use `REGISTRY[name].fromEnv(env)`.
     - Apply `wrapHandler`.
  6. Start the Slack sink and `startLambdaHost({ port: lambdaPort, resolve: (fnName) => byFunctionName.get(fnName) })`.
  7. Return `LocalEnv { prefix, stateMachineArn, tables, handlers: Record<HandlerName, Handler>, slack, lambdaHost, doc, sfn, runs, catalog, budgets, ledger, close() }`. Table names come from the `ExecutePoFn` and `PolicyCheckFn` env vars.
- [ ] **Step 5: `driver.ts` (`LocalDriver`)**:
  - `apiEvent(...)` builds a minimal `APIGatewayProxyEventV2`.
  - `startRun(requesterId, request) → runId`, through `handlers['start-run']`.
  - `waitForStatus(runId, statuses, timeoutMs = 60_000)` polls `runs.getMeta` every 100 ms. It throws `Timed out waiting for <runId> to reach <statuses>; last status <s>`.
  - `waitForApproval(runId) → approvalId`: waits for `AWAITING_APPROVAL` and `slack.approvalFor`.
  - `click(runId, userId, decision, { approvalId?, nowSeconds? }) → { statusCode, text }`. It builds the `block_actions` form body (`payload=<urlencoded JSON with type, user.id, actions[0].action_id and value>`), signs it with `signSlackRequest(LOCAL_SIGNING_SECRET, ts, body)`, and calls `handlers['slack-interactions']`.
  - `getRun(runId)` and `history(runId)` (paginated `GetExecutionHistoryCommand`; the execution ARN comes from `getMeta().executionArn`).
- [ ] **Step 6: `fixture-agent.ts`**. `fixedOrderAgent(lines: ProposalLine[], justification = 'Fixture order.')` returns an `AgentClient`. It answers `{ proposal: { runId: i.runId, currency:'USD', lines, justification }, usage: { inputTokens: 0, outputTokens: 0, modelSteps: 0 }, model: 'fixture' }`. `functionAgent(fn)` is the general form.
- [ ] **Step 7: `test/integration/env.test.ts`** (`describe.skipIf(process.env.DMA_INTEGRATION !== '1')`; every integration file uses this guard):
  - `startLocalEnv()` → `ListTables` includes the 4 prefixed names.
  - `DescribeStateMachine(stateMachineArn)` succeeds.
  - There are 9 handlers.
  - `close()` resolves.
- [ ] **Step 8: Verify and commit**
  - `npm test` → all pass. Integration files are not in the unit config.
  - `npm run local:up`, then `npm run test:integration` → `env.test.ts` passes. `docker ps --filter name=durable-multi-agent` shows the 2 containers.
  - `npm run local:down`.

  Commit: `feat(local): run the synthesized stack on DynamoDB Local and Step Functions Local`

---

## Task 17: Integration: end-to-end flows on the synthesized state machine (I8, I9)

**Files:** create `test/integration/flow.test.ts`.

Each `describe` starts its own env in `beforeAll` and closes it in `afterAll`. Seed the catalog from `seed/catalog.json`, and give `U0REQUESTER` a budget of 1,500,000. The agent is `fixedOrderAgent` unless stated.

- [ ] **Step 1: Write the tests**
  1. **Approve.** The agent returns 3 × `GPU-DEVBOX-4090`.
     - Before approval: `startRun` → `waitForApproval`. The sink has 1 post containing `$8,697.00`.
     - After `click(U0APPROVER1, 'approve')` → text `Approved. Placing the order.` → `waitForStatus DONE`.
     - Ledger: row `totalCents 869700`, `approvedBy U0APPROVER1`.
     - Budget: `spentCents 869700`.
     - Sink: 1 update containing `Ordered`.
     - `getRun`: JSON has no `taskToken`.
  2. **Reject.** `click(U0APPROVER1,'reject')` → `REJECTED_BY_HUMAN`; no ledger row; `spentCents` unchanged.
  3. **Policy rejection.** The agent returns 4 GPU boxes (over the 1,000,000 cap) → `REJECTED_BY_POLICY`; the sink has **no** post for this run.
  4. **Invalid agent output (I9 end-to-end).** The agent returns `qty: 0` → `FAILED` with `failureReason 'InvalidProposal'`; no Slack post; no ledger row.
  5. **Self-approval.** `click(U0REQUESTER,'approve')` → text `You cannot approve your own request.`; the status stays `AWAITING_APPROVAL`. Then approve with `U0APPROVER2` → `DONE`.
  6. **Expiry (I8).** Use a separate env with `approvalTimeoutSeconds: 3`. Start a run, then `waitForStatus EXPIRED` within 20 s. The approval `state === 'EXPIRED'`, there is no ledger row, and a later `click(U0APPROVER1,'approve')` → `This request expired.` with the status still `EXPIRED`.
- [ ] **Step 2: Run.** `npm run local:up && npm run test:integration` → all pass. `npm run local:down`. If a test fails because of an SFN Local limitation (not our bug), stop and record it: `Task 17: BLOCKED (<history events>)`.
- [ ] **Step 3: Commit:** `test(integration): cover approve, reject, policy, invalid output, self-approval and expiry flows`

---

## Task 18: Integration: invariant tests (I1, I3, I4, I7)

**Files:** create `test/integration/approval-binding.test.ts`, `test/integration/double-click.test.ts`, `test/integration/duplicate-resume.test.ts`, `test/integration/budget-race.test.ts`.

- [ ] **Step 1: Write the tests**
  - `approval-binding.test.ts` (I1): start a run (3 GPU boxes) → `waitForApproval`. **Mutate the stored proposal** with `doc.send(UpdateCommand)`, setting `proposal.lines[0].qty = 1` on `PROPOSAL#v1`. Then approve → `FAILED` with `failureReason 'HashMismatch'`. The ledger table is empty and the budget `spentCents` is unchanged.
  - `double-click.test.ts` (I7): for 10 runs, send `Promise.all([click(U0APPROVER1,'approve'), click(U0APPROVER2,'reject')])`.
    - Each pair: exactly one reply is `Approved. Placing the order.` or `Rejected.`, and the other starts with `Already decided`.
    - Each run's final status matches the winner (`DONE` or `REJECTED_BY_HUMAN`).
    - The ledger row count equals the number of approve winners.
  - `duplicate-resume.test.ts` (I4):
    - (a) After a run is `DONE`, read its token from the `APPROVAL` item and send `SendTaskSuccessCommand` again. It rejects with `name` in `['TaskTimedOut','TaskDoesNotExist']`. The ledger still has 1 row.
    - (b) Use a new env with `wrapHandler` that, for `execute-po`, throws `Object.assign(new Error('chaos'), { name: 'ChaosError' })` **after** the real handler returns, the first time per run. The run reaches `DONE`, and the execution history has ≥ 1 failed Lambda event for `ExecutePO`: count events whose `type` is `LambdaFunctionFailed` or `TaskFailed`, and record which one appears in the ledger. There is exactly 1 ledger row, and `spentCents === totalCents` (charged once).
    - (c) `new StepFunctionsWorkflow(env.sfn, env.stateMachineArn).start(runId, input)` called twice with the same `runId` returns the same execution ARN.
  - `budget-race.test.ts` (I3): requester `U0RACE` has a budget of 314,300 (= 7 × 44,900). Twenty runs each order 1 × `MONITOR-27-4K`. Start all 20 and `waitForApproval` on all, then approve all 20 concurrently (`Promise.all`). Wait for all to be terminal. Then:
    - exactly 7 are `DONE` and 13 are `FAILED` with `failureReason 'BUDGET_EXHAUSTED'`;
    - there are 7 ledger rows;
    - `spentCents === 314300`, which equals Σ ledger `totalCents`.
- [ ] **Step 2: Run.** `npm run local:up && npm run test:integration` → all files pass; record the counts in the ledger. Then `npm run local:down`.
- [ ] **Step 3: Commit:** `test(integration): prove approval binding, single decision, exactly-once execution and budget race`

---

## Task 19: Agent: Python project, schemas and model factory

**Files:** create `agent/pyproject.toml`, `agent/.python-version` (`3.12`), `agent/src/procurement_agent/{__init__.py,schemas.py,models.py}`, `agent/tests/{conftest.py,test_schemas.py,test_models.py}`. Generate `agent/uv.lock` with `uv lock`.

- [ ] **Step 1: `pyproject.toml`**

```toml
[project]
name = "procurement-agent"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "langgraph==1.2.12",
  "langchain-core==1.6.6",
  "langchain-ollama==1.1.0",
  "langchain-aws==1.8.0",
  "bedrock-agentcore==1.24.0",
  "pydantic==2.13.5",
]

[dependency-groups]
dev = ["pytest==9.1.1", "httpx==0.28.1"]

[build-system]
requires = ["uv_build>=0.12.21,<0.13"]
build-backend = "uv_build"

[tool.pytest.ini_options]
testpaths = ["tests"]
```
Run `cd agent && uv lock && uv sync`. Expected: exit 0.

- [ ] **Step 2: `schemas.py`** (pydantic v2, all `model_config = ConfigDict(extra='forbid')`):
  - `CatalogEntry(sku, name, unitPriceCents: int, maxQtyPerOrder: int)`;
  - `Invocation(runId: str, request: str (1-2000), catalog: list[CatalogEntry] (min 1))`;
  - `Requirement(description: str, qty: int = Field(ge=1, le=50))`;
  - `Requirements(items: list[Requirement] (1-10))`;
  - `SourcedLine(sku: str, qty: int (1-50), claimedUnitPriceCents: int | None = None)`;
  - `Sourcing(lines: list[SourcedLine] (0-10))`;
  - `Justification(justification: str (1-2000))`;
  - `ProposedOrder(runId: str (pattern ULID), currency: Literal['USD'], lines: list[SourcedLine] (1-10), justification: str (≤2000))`.
- [ ] **Step 3: `models.py`**
  - `make_model(name: str | None = None) -> BaseChatModel`. `name` defaults to `os.environ.get('AGENT_MODEL', 'scripted')`.
    - `'scripted'` → `ScriptedChatModel()`.
    - `'ollama'` → `ChatOllama(model=os.environ.get('OLLAMA_MODEL','qwen3.8:27b'), base_url=os.environ.get('OLLAMA_BASE_URL','http://127.0.0.1:11434'), format='json', temperature=0, reasoning=False)`.
    - `'bedrock'` → `ChatBedrockConverse(model=os.environ['BEDROCK_MODEL_ID'])`; raise `ValueError('BEDROCK_MODEL_ID is required for AGENT_MODEL=bedrock')` if it is unset.
    - Anything else → `ValueError('unknown AGENT_MODEL <x>')`.
  - `class ScriptedChatModel(BaseChatModel)`: `_llm_type = 'scripted'`. `_generate(messages, ...)`:
    1. Read the node from the system message prefix `[node:<name>]`. Parse the last human message as JSON.
    2. Build the answer:

       | Node | Answer |
       |---|---|
       | `intake` | `{"items":[{"description": <request>, "qty": <first integer in request, default 1, clamp 1..50>}]}` |
       | `sourcing` | For each item, pick the catalog entry with the most shared lowercase alphanumeric tokens between the description and `name + ' ' + sku.replace('-',' ')`. Ties go to the cheaper entry. `{"lines":[{"sku":..., "qty":..., "claimedUnitPriceCents": <catalog price>}]}` |
       | `justification` | `{"justification": "Requested: <request>. Order: <qty> x <name> ...; total by catalog price $X."}` (≤ 2000 chars) |

    3. Return `ChatResult(generations=[ChatGeneration(message=AIMessage(content=json_text, usage_metadata={'input_tokens': in_n, 'output_tokens': out_n, 'total_tokens': in_n + out_n}))])`, with `n = ceil(len(text) / 4)`.
- [ ] **Step 4: Tests** (failing first)
  - `test_schemas.py`: `ProposedOrder` rejects extra keys, `qty` 0 and 51, and 11 lines.
  - `test_models.py`:
    - The scripted model on the intake payload for `"We need 3 more GPU dev boxes for the ML team, under $9k"` → qty 3.
    - Sourcing with the 8-item seed catalog (load `../seed/catalog.json` relative to the test file; only active items) picks `GPU-DEVBOX-4090`.
    - The justification is ≤ 2000 chars.
    - `make_model('bedrock')` without the env var raises; `make_model('nope')` raises.
  - `conftest.py`: `class FakeChat(BaseChatModel)` with `responses: list[AIMessage]`. Each call returns the next response; past the end it repeats the last. It records `calls`. Use it in Task 20.
- [ ] **Step 5: Verify and commit.** `cd agent && uv run pytest -q` → all pass. Commit: `feat(agent): add schemas and scripted, Ollama and Bedrock model factory`

---

## Task 20: Agent: LangGraph team, budgets (I10), AgentCore app and container

**Files:** create `agent/src/procurement_agent/{nodes.py,graph.py,app.py}`, `agent/Dockerfile`, `agent/.dockerignore`, `agent/tests/{test_graph.py,test_budget.py,test_app.py}`.

- [ ] **Step 1: `nodes.py`**
  - `call_json(model, node, instructions, payload: dict, schema_cls, extra_check=None, max_repairs=1) -> tuple[obj, usage]`.
  - Messages: `[SystemMessage(f'[node:{node}] {instructions}\nReply with JSON only, matching this JSON Schema: {schema_cls.model_json_schema()}'), HumanMessage(json.dumps(payload))]`.
  - Parse the content: strip markdown fences, then take the substring from the first `{` to the last `}`, then `schema_cls.model_validate_json`, then `extra_check(obj)` (which raises `ValueError` on semantic errors such as an unknown SKU).
  - On `ValidationError`/`ValueError`, append the AI message and `HumanMessage(f'Your JSON was invalid: {err}. Reply with corrected JSON only.')` and retry, up to `max_repairs`. Then raise `AgentOutputInvalid(f'{node}: {err}')`.
  - `usage` is the summed `usage_metadata` (`input_tokens`, `output_tokens`) plus a `model_steps` count.
  - Exceptions: `class AgentOutputInvalid(Exception)` and `class AgentBudgetExceeded(Exception)` (message `steps` or `tokens`).
- [ ] **Step 2: `graph.py`**
  - `State(TypedDict, total=False)`: `run_id, request, catalog, requirements, lines, justification, usage`.
  - Nodes `intake`, `sourcing` and `justification`. Each calls `call_json`, adds the usage, and raises `AgentBudgetExceeded('tokens')` if `usage.output_tokens > max_output_tokens`.
  - `sourcing`'s `extra_check` rejects SKUs not in the catalog.
  - `route(state)`: no `requirements` → `'intake'`; empty `lines` → `'sourcing'`; no `justification` → `'justification'`; else `END`.
  - `build_graph(model, max_output_tokens=40_000)`: `START` → conditional `route`, and each node → conditional `route`.
  - `run_team(invocation: Invocation, model, recursion_limit=12, max_output_tokens=40_000) -> dict`:
    - invoke with `config={'recursion_limit': recursion_limit}`;
    - map `GraphRecursionError` → `AgentBudgetExceeded('steps')`;
    - return `{ 'proposal': ProposedOrder(...).model_dump(exclude_none=True), 'usage': {'inputTokens','outputTokens','modelSteps'}, 'model': getattr(model, '_llm_type', type(model).__name__) }`.
- [ ] **Step 3: `app.py`**
  - `app = BedrockAgentCoreApp()`.
  - `@app.entrypoint def invoke(payload)`: validate `Invocation`, then `run_team(..., make_model())`. `AgentOutputInvalid`, `AgentBudgetExceeded` and `ValidationError` → return `{'error': {'type': type(e).__name__, 'message': str(e)}}`.
  - `def main(): app.run(port=int(os.environ.get('PORT', '8080')), host=os.environ.get('HOST', '0.0.0.0'))` and `if __name__ == '__main__': main()`.
  - `app.run` binds `127.0.0.1` unless `host` is given; checked during planning.
- [ ] **Step 4: Tests** (failing first)
  - `test_graph.py`, with `FakeChat` scripted JSON:
    - Happy path: valid intake → sourcing → justification; the proposal validates as `ProposedOrder`; `FakeChat.calls == 3`.
    - Repair: sourcing first returns `not json`, then valid → success; calls == 4.
    - An unknown SKU twice → `AgentOutputInvalid`.
    - `route` unit cases.
  - `test_budget.py` (I10):
    - `test_step_limit`: sourcing always returns `{"lines": []}` → `run_team` raises `AgentBudgetExceeded('steps')`.
    - `test_token_limit`: every response carries `usage_metadata.output_tokens = 25_000` → `AgentBudgetExceeded('tokens')`, with at most 2 model calls.
  - `test_app.py`: `from starlette.testclient import TestClient`; `TestClient(app)`.
    - `GET /ping` → 200 with `status == 'Healthy'`.
    - `POST /invocations` with a valid invocation and `AGENT_MODEL=scripted` (`monkeypatch.setenv`) → 200; `proposal.runId` echoes the input.
    - A payload missing `catalog` → 200 with `error.type == 'ValidationError'`.
- [ ] **Step 5: Container.** `Dockerfile`:

```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
CMD ["uv", "run", "--no-sync", "python", "-m", "procurement_agent.app"]
```
`.dockerignore`: `.venv`, `__pycache__`, `tests`, `evals`, `.pytest_cache`.

- [ ] **Step 6: Verify and commit**
  - `cd agent && uv run pytest -q` → all pass.
  - `docker compose build agent && docker compose up -d agent`, then `curl -s http://127.0.0.1:5333/ping` → contains `Healthy`.
  - `curl -s -X POST http://127.0.0.1:5333/invocations -H 'content-type: application/json' -d '{"runId":"01J9ZX5K3M8Q4R6T7V9W1Y2Z3A","request":"3 GPU dev boxes","catalog":[{"sku":"GPU-DEVBOX-4090","name":"GPU dev box (RTX 4090)","unitPriceCents":289900,"maxQtyPerOrder":5}]}'` → JSON with `proposal.lines[0].sku == "GPU-DEVBOX-4090"`.
  - `docker compose stop agent`.

  Commit: `feat(agent): add LangGraph procurement team behind the AgentCore HTTP contract`

---

## Task 21: CLI `pa demo` (the 30-second wow)

**Files:** create `cli/pa.ts`, `cli/render.ts`. Test: `test/unit/cli/render.test.ts`.

- [ ] **Step 1: `render.ts`**. `renderCard(message: SlackMessage): string` draws a box (`┌─`…`┘`, width 64). It shows the header, the requester, each line (`3 × GPU dev box (RTX 4090)    $8,697.00`), the total, the remaining budget, a justification wrapped at 60 chars, and the footer `[ Approve ]  [ Reject ]`. Test: rendering `buildApprovalMessage(...)` from the Task 5 fixture contains those strings, and no rendered line is wider than 66 chars.
- [ ] **Step 2: `pa.ts`** (`node:util` `parseArgs`). Commands are `demo` and `bench` (bench is wired in Task 22). `pa demo [--request <text>] [--decision approve|reject] [--approver U0APPROVER1]`:
  1. `GET http://127.0.0.1:5333/ping`. On failure, print `Agent container not reachable at http://127.0.0.1:5333. Start it: docker compose up -d --build agent` and exit 2.
  2. `startLocalEnv()`. Seed the catalog, and give `U0REQUESTER` a budget of 1,500,000 for this month.
  3. Print `▶ request from <@U0REQUESTER>: "<text>"`. The default text is `We need 3 more GPU dev boxes for the ML team, under $9k`.
  4. Poll the status every 200 ms and print each new status with elapsed ms (`  +412ms  POLICY`).
  5. At `AWAITING_APPROVAL`, print `renderCard` of the sink's post.
  6. `click(<approver>, decision)` and print `✔ <@U0APPROVER1> clicked Approve → "<reply>"`.
  7. Wait until the run is terminal. Print the outcome: the ledger row (`PO#<runId> $8,697.00 approved by U0APPROVER1`), the remaining budget, the agent model name and token usage from the stored proposal, and the total elapsed time.
  8. `env.close()`. Exit 0 if the final status matches the decision (`DONE` / `REJECTED_BY_HUMAN`), else 1.
- [ ] **Step 3: Run it for real and capture the transcript**
  - `npm run local:up && docker compose up -d --build agent && npm run demo | tee docs/demo/demo-scripted.txt` → exit 0, transcript ends with the ledger line.
  - Optional, if `curl -s http://127.0.0.1:11434/api/tags` lists `qwen3.8:27b`: `AGENT_MODEL=ollama docker compose up -d --force-recreate agent && npm run demo | tee docs/demo/demo-ollama.txt`. Record the elapsed time from the transcript. If Ollama is not reachable, write `Ruling: ollama demo not run - <reason> - README shows the scripted transcript only`.
  - `docker compose stop agent && npm run local:down`.
- [ ] **Step 4: Commit:** `feat(cli): add pa demo that runs one approval end to end and prints the Slack card`

---

## Task 22: Chaos benchmark (`pa bench`) and the headline

**Files:** create `bench/chaos.ts`, `bench/headline.ts`, `bench/stats.ts`; modify `cli/pa.ts`. Tests: `test/unit/bench/stats.test.ts`, `test/unit/bench/headline.test.ts`, `test/integration/bench.test.ts`.

- [ ] **Step 1: `stats.ts`** (test first):
  - `mulberry32(seed)` → `() => number` in [0,1). The same seed gives the same first 5 values.
  - `percentile(sorted, p)` uses nearest-rank: `percentile([1..100], 50) === 50`, `p95 === 95`, an empty array → `null`.
  - `median`.
- [ ] **Step 2: `chaos.ts`**. `runChaosBench({ runs = 200, crashRate = 0.3, conflictRate = 0.1, budgetFits = 0.7, concurrency = 20, seed = 42, write = true })`, following ADR 0008:
  1. Set up the PRNG. Requesters are `U0BENCH1`..`U0BENCH5`, assigned round-robin.
  2. Run *i*'s order is 1-2 distinct lines from `[MONITOR-27-4K, DOCK-USB4, KEYBOARD-ERGO, HEADSET-ANC]`, qty 1-3, all chosen by the PRNG.
  3. Each requester's budget = `Math.floor(budgetFits × Σ that requester's order totals)`.
  4. `startLocalEnv({ agentClient: functionAgent(i => orderFor(i.request, i.runId)), wrapHandler })`. Run *i*'s request text is `bench run #<i>: <items>`. The agent parses `<i>` from the request text to find the precomputed order. The run id is not known before `start-run` returns, and the state machine may call the agent first, so do NOT key the order on the run id. The wrapper wraps `execute-po`: after the real handler resolves, if `rand() < crashRate` it increments `crashesInjected` and throws `ChaosError`. Use a second PRNG stream (`mulberry32(seed + 1)`) for crash decisions, so a crash decision does not shift the order generation.
  5. Phase 1: start all runs with a simple promise pool of size `concurrency`, then `waitForStatus` on `AWAITING_APPROVAL` or a terminal status.
  6. Phase 2: for each waiting run, set `t0 = Date.now()`. If `rand() < conflictRate`, run approve(`U0APPROVER1`) and reject(`U0APPROVER2`) concurrently (`conflictingClicks++`). Otherwise run approve(`U0APPROVER1`) and approve(`U0APPROVER2`) concurrently (`doubleClicks++`).
  7. Phase 3: wait until all runs are terminal (overall timeout 15 min).
  8. Measure the fields in ADR 0008:
     - `ledgerStatusMismatches` = (`DONE` runs without a ledger row) + (ledger rows whose run is not `DONE`);
     - `budgetDriftCents` = Σ `spentCents` over the bench requesters − Σ ledger `totalCents`;
     - `overspendCents` = Σ max(0, spent − limit);
     - `approvalToLedgerMs` = `Date.parse(ledger.createdAt) - t0` over `DONE` runs, as p50/p95;
     - `stateTransitionsPerRun` = median, min and max of the count of history events whose `type` ends with `StateEntered`;
     - `estimatedSfnCostPerRunUsd = median × 0.000025`;
     - `wallClockSeconds`;
     - `environment { stepFunctionsLocal: '2.0.0', dynamodbLocal: '3.3.1', node: process.version, platform: process.platform }`;
     - `measuredAt`.
  9. If `write`, write `bench/results/latest.json` and `bench/results/<YYYY-MM-DD>-<runs>.json` (2-space JSON). Return the result.
  10. `env.close()` in a `finally` block.
- [ ] **Step 3: `pa bench`** parses `--runs --crash-rate --conflict-rate --budget-fits --concurrency --seed --no-write`, prints a markdown table of the results, and exits 1 if `ledgerStatusMismatches`, `budgetDriftCents` or `overspendCents` is non-zero.
- [ ] **Step 4: `headline.ts`**. `formatHeadline(result)` (unit-tested with a literal object) returns:
  `"<runs> approval runs with <crashesInjected> crashes injected after commit, <doubleClicks + conflictingClicks> double clicks and a budget race: <ledgerStatusMismatches> duplicate or missing purchase orders, $<budgetDriftCents/100 to 2dp> budget drift, $<overspendCents/100> overspend (Step Functions Local + DynamoDB Local, <measuredAt date>)."`

  `bench:headline` prints it for `bench/results/latest.json`.
- [ ] **Step 5: `test/integration/bench.test.ts`**. `runChaosBench({ runs: 20, write: false, concurrency: 10, crashRate: 0.5 })` → `ledgerStatusMismatches === 0`, `budgetDriftCents === 0`, `overspendCents === 0`, `crashesInjected > 0`, and `counts.DONE > 0`. The seed is fixed, so this is deterministic. If `crashesInjected` is 0 with seed 42, change the test's seed and record a `Ruling:`.
- [ ] **Step 6: Run the real benchmark.** `npm run local:up && npm run bench -- --runs 200` → exit 0. Then `npm run local:down`. Paste the printed table and `npm run bench:headline` output into the ledger line. Commit the results files.
- [ ] **Step 7: Commit:** `feat(bench): measure exactly-once execution under injected crashes, double clicks and a budget race`

---

## Task 23: Agent eval set and runner

**Files:** create `agent/evals/requests.jsonl` (30 lines), `agent/evals/run.py`, `agent/tests/test_eval_runner.py`; results go to `agent/evals/results/latest.json`.

- [ ] **Step 1: `requests.jsonl`**. Write 30 objects `{ "id": "r01", "request": "...", "expected": [{"sku": "...", "qty": n}] }` over the 8 active seed SKUs. Phrase them the way real people write; include:
  - 10 single-item requests with explicit numbers in digits;
  - 5 with numbers in words ("two", "a dozen");
  - 8 multi-item requests ("2 laptops and 2 monitors for the new designers");
  - 4 with synonyms ("noise cancelling headphones", "docking station", "ergonomic chair");
  - 3 with distractor numbers ("under $3k", "by the 15th").

  Every expected SKU must exist and be active in `seed/catalog.json`. A pytest checks this.
- [ ] **Step 2: `run.py`** (`uv run python evals/run.py --model ollama --limit 30 --out evals/results/latest.json`):
  - For each request: `run_team(Invocation(runId=<fixed ULID>, request, catalog=active seed items), make_model(model))`. Time it, and compare the set of `(sku, qty)` with `expected` (exact match).
  - Count `claimedPriceMismatches` (`claimedUnitPriceCents` present and ≠ catalog price).
  - Write `{ measuredAt, model, ollamaModel, n, exactMatch, exactMatchRate, meanSecondsPerRequest, errors, claimedPriceMismatches, perRequest: [...] }`.
- [ ] **Step 3: `test_eval_runner.py`**. Run the runner's `evaluate(requests[:3], 'scripted')` function and assert the shape of the result (keys, `n == 3`). It does not assert the score; scripted scores are not model quality and must not be reported as such.
- [ ] **Step 4: Run against Ollama** if `curl -s http://127.0.0.1:11434/api/tags` lists `qwen3.8:27b`. Expect ~5-30 min; run it in the background and wait for it. Commit `agent/evals/results/latest.json`. If Ollama is unreachable or it does not finish within 45 min, record `Task 23: complete (eval NOT run: <reason>)` and commit no results file.
- [ ] **Step 5: Verify and commit.** `cd agent && uv run pytest -q` → all pass. Commit: `feat(agent): add 30-request procurement eval and runner`

---

## Task 24: CI workflow

**Files:** create `.github/workflows/ci.yml`.

- [ ] **Step 1: Write the workflow.** Use `on: push` (branch `main`) and `pull_request`, with `permissions: contents: read`. Jobs run on `ubuntu-24.04`:
  - `node`: `actions/checkout@v4`, `actions/setup-node@v4` (`node-version: 24`, `cache: npm`). Then `npm ci`, `npm run typecheck`, `npm test`, `npm run synth`, `npm run build -w sfn-local-harness`, `npm pack -w sfn-local-harness --dry-run`.
  - `agent`: `actions/checkout@v4`, `astral-sh/setup-uv@v6` (`version: "0.12.21"`). With `working-directory: agent`: `uv sync --frozen`, then `uv run pytest -q`.
  - `integration` (`needs: node`): checkout, setup-node and `npm ci`. Then:
    1. `docker compose up -d dynamodb sfn`;
    2. `npm run test:integration`;
    3. `npm run bench -- --runs 50 --no-write`;
    4. a final step with `if: always()` that runs `docker compose logs --no-color sfn | tail -n 100` and `docker compose down`.
- [ ] **Step 2: Lint.** `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12` → exit 0, no output. (In Git Bash on Windows, use `-v "$(pwd -W):/repo"` if the mount fails; record which form worked.)
- [ ] **Step 3: Commit:** `ci: run unit, CDK, agent and emulator integration tests on every push`

---

## Task 25: README, DEVDOCS, handoff and the final gate run

**Files:** create `README.md`, `docs/DEVDOCS.md`; modify `docs/handoff.md`.

- [ ] **Step 1: README.md** (plain short sentences). Write the sections in this order:
  1. `# Durable multi-agent workflow`. The next line is the exact output of `npm run bench:headline`. Do not edit any number.
  2. **30-second demo**: the fenced transcript from `docs/demo/demo-scripted.txt`, labelled "scripted model". Add the Ollama transcript only if it exists, with its measured elapsed time.
  3. **What it proves**: the "model proposes, deterministic core disposes" thesis in 3 bullets.
  4. The architecture mermaid diagram (from the spec).
  5. The invariant table I1-I12, each linking to its test file.
  6. **Results**: a bench table generated from `latest.json` (runs, crashes, mismatches, drift, overspend, p50/p95 approval→ledger labelled *local*, transitions per run, cost per run labelled *estimate*), and the eval result from `agent/evals/results/latest.json` or "not run".
  7. **Quickstart** (exact commands: `npm ci`, `npm run local:up`, `docker compose up -d --build agent`, `npm run demo`, `npm run bench`, `npm run local:down`).
  8. **Install the harness**: `sfn-local-harness`, with a link to its README.
  9. **What is not proven**: nothing has been deployed to AWS; AgentCore, Bedrock, KMS and the HTTP API are synth-and-unit-tested only; local latencies are not AWS latencies.
  10. **Roadmap v0.2** (ADR 0007), and links to the ADRs.
- [ ] **Step 2: `docs/DEVDOCS.md`**, a first version in this order:
  1. what it is plus the headline;
  2. a 5-minute quickstart;
  3. architecture (one mermaid diagram);
  4. a project layout table;
  5. run/test/bench commands;
  6. key decisions with what they gave up (ADR links);
  7. known limits and what's left.

  The Opus lead rewrites it later; keep it accurate, not long.
- [ ] **Step 3: Append to `docs/handoff.md`** (it already exists; never rewrite earlier entries): `## 2026-10-04, Claude (Sonnet builder), branch main`, then what changed, what's left, and how to verify (the gate commands).
- [ ] **Step 4: Run every gate G1-G10** from the Gates table, in order, and paste real outputs (counts, exit codes) into the ledger as `Task 25: complete (G1 ok; G2 ok; G3 N passed; ...)`. Also run `grep -rn "@aws-sdk\|node:http\|adapters/" src/core` → no output.
- [ ] **Step 5: Commit:** `docs: add README with measured headline, developer docs and handoff`
