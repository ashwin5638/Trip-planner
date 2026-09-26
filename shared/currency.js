export const DEFAULT_CURRENCY = 'INR'
export const CURRENCY_LOCALE = 'en-IN'

export function formatMoney(amount, currency = DEFAULT_CURRENCY) {
  const value = Number(amount)
  const safeValue = Number.isFinite(value) ? value : 0

  try {
    return new Intl.NumberFormat(CURRENCY_LOCALE, {
      style: 'currency',
      currency: currency || DEFAULT_CURRENCY,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(safeValue)
  } catch {
    return `${currency || DEFAULT_CURRENCY} ${Math.round(safeValue).toLocaleString(CURRENCY_LOCALE)}`
  }
}
