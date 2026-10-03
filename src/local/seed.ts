import { readFileSync } from 'node:fs';
import { monthOf } from '../adapters/budgets-repo.js';
import type { BudgetsPort, CatalogPort } from '../adapters/ports.js';
import type { CatalogItem } from '../core/types.js';

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as T;

export const seedCatalogItems = (): CatalogItem[] => readJson<CatalogItem[]>('../../seed/catalog.json');
export const seedBudgetRows = (): Array<{ requesterId: string; limitCents: number }> => readJson('../../seed/budgets.json');

export async function seedCatalog(catalog: CatalogPort): Promise<void> {
  await catalog.putAll(seedCatalogItems());
}

/** Writes a fresh budget row (spent = 0) for the current month. */
export async function seedBudget(budgets: BudgetsPort, requesterId: string, limitCents: number, nowIso = new Date().toISOString()): Promise<void> {
  await budgets.put({ requesterId, month: monthOf(nowIso), limitCents, spentCents: 0 });
}

export async function seedAll(ports: { catalog: CatalogPort; budgets: BudgetsPort }): Promise<void> {
  await seedCatalog(ports.catalog);
  for (const b of seedBudgetRows()) await seedBudget(ports.budgets, b.requesterId, b.limitCents);
}
