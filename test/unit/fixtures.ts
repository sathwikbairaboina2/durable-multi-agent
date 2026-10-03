import type { CatalogItem, ProposedOrder } from '../../src/core/types.js';

export const RUN_ID = '01J9ZX5K3M8Q4R6T7V9W1Y2Z3A';

export function validOrder(): ProposedOrder {
  return {
    runId: RUN_ID,
    currency: 'USD',
    lines: [{ sku: 'GPU-DEVBOX-4090', qty: 3, claimedUnitPriceCents: 250000 }],
    justification: 'ML team needs 3 more dev boxes.',
  };
}

export const CATALOG_ITEMS: CatalogItem[] = [
  { sku: 'GPU-DEVBOX-4090', name: 'GPU dev box (RTX 4090)', vendor: 'Northwind Systems', unitPriceCents: 289900, maxQtyPerOrder: 5, active: true },
  { sku: 'LAPTOP-14-PRO', name: '14-inch pro laptop', vendor: 'Contoso', unitPriceCents: 179900, maxQtyPerOrder: 10, active: true },
  { sku: 'MONITOR-27-4K', name: '27-inch 4K monitor', vendor: 'Fabrikam', unitPriceCents: 44900, maxQtyPerOrder: 20, active: true },
  { sku: 'LAPTOP-13-OLD', name: '13-inch laptop (discontinued)', vendor: 'Contoso', unitPriceCents: 99900, maxQtyPerOrder: 10, active: false },
];

export function catalogMap(): Map<string, CatalogItem> {
  return new Map(CATALOG_ITEMS.map((i) => [i.sku, { ...i }]));
}
