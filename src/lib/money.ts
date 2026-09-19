export function formatMoney(amount: number, currency = 'CDF'): string {
  return new Intl.NumberFormat('fr-CD', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'CDF' ? 0 : 2
  }).format(amount);
}
