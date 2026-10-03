import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ProposedOrder } from './types.js';

export const PROPOSED_ORDER_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://durable-multi-agent.local/schemas/proposed-order.json',
  type: 'object',
  additionalProperties: false,
  required: ['runId', 'currency', 'lines', 'justification'],
  properties: {
    runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
    currency: { const: 'USD' },
    lines: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sku', 'qty'],
        properties: {
          sku: { type: 'string', minLength: 1, maxLength: 64 },
          qty: { type: 'integer', minimum: 1, maximum: 50 },
          claimedUnitPriceCents: { type: 'integer', minimum: 0 },
        },
      },
    },
    justification: { type: 'string', maxLength: 2000 },
  },
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(PROPOSED_ORDER_SCHEMA);

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function validateProposedOrder(input: unknown): Validation<ProposedOrder> {
  if (validate(input)) return { ok: true, value: input as unknown as ProposedOrder };
  const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
  return { ok: false, errors: errors.length ? errors : ['/ invalid'] };
}
