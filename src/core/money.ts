export function formatCents(c: number): string {
  const abs = Math.abs(c);
  const dollars = Math.trunc(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${c < 0 ? '-' : ''}$${dollars}.${cents}`;
}
