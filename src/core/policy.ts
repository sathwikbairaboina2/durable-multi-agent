import { formatCents } from './money.js';
import { validateProposedOrder } from './schema.js';
import type { Budget, CatalogItem, PolicyResult, PricedLine } from './types.js';

export interface PolicyInput {
  proposal: unknown;
  catalog: ReadonlyMap<string, CatalogItem>;
  budget: Budget | null;
  maxOrderCents: number;
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const parsed = validateProposedOrder(input.proposal);
  if (!parsed.ok) {
    return {
      ok: false, totalCents: 0, pricedLines: [],
      reasons: parsed.errors.map((e) => `schema: ${e}`),
      remainingBudgetCents: null,
    };
  }

  const reasons: string[] = [];
  const pricedLines: PricedLine[] = [];
  const seen = new Set<string>();

  for (const line of parsed.value.lines) {
    if (seen.has(line.sku)) {
      reasons.push(`duplicate sku ${line.sku}`);
      continue;
    }
    seen.add(line.sku);
    const item = input.catalog.get(line.sku);
    if (!item) {
      reasons.push(`unknown sku ${line.sku}`);
      continue;
    }
    if (!item.active) {
      reasons.push(`inactive sku ${line.sku}`);
      continue;
    }
    if (line.qty > item.maxQtyPerOrder) {
      reasons.push(`qty ${line.qty} exceeds max ${item.maxQtyPerOrder} for ${line.sku}`);
      continue;
    }
    pricedLines.push({
      sku: item.sku, name: item.name, qty: line.qty,
      unitPriceCents: item.unitPriceCents, lineCents: item.unitPriceCents * line.qty,
    });
  }

  const totalCents = pricedLines.reduce((sum, l) => sum + l.lineCents, 0);

  if (totalCents > input.maxOrderCents) {
    reasons.push(`order total ${formatCents(totalCents)} exceeds cap ${formatCents(input.maxOrderCents)}`);
  }
  const b = input.budget;
  if (!b) {
    reasons.push('no budget for this month');
  } else if (b.spentCents + totalCents > b.limitCents) {
    reasons.push(`order total ${formatCents(totalCents)} exceeds remaining budget ${formatCents(b.limitCents - b.spentCents)}`);
  }

  return {
    ok: reasons.length === 0,
    totalCents,
    pricedLines,
    reasons,
    remainingBudgetCents: b ? b.limitCents - b.spentCents - totalCents : null,
  };
}
