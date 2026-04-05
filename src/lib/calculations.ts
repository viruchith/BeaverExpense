import { endOfDay, isAfter, isBefore, parseISO, startOfDay, subDays } from 'date-fns'

import type { Expense } from './types'

export const toMoney = (value: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)

export const computeSubtotal = (unitAmount: number, unitPrice: number): number =>
  Number((unitAmount * unitPrice).toFixed(2))

export const computeGstAmount = (subtotal: number, gstPercent: number, applicable: boolean): number => {
  if (!applicable) {
    return 0
  }
  return Number(((subtotal * gstPercent) / 100).toFixed(2))
}

export const computeTotalCost = (
  unitAmount: number,
  unitPrice: number,
  gstPercent: number,
  gstApplicable: boolean,
): number => {
  const subtotal = computeSubtotal(unitAmount, unitPrice)
  const gstAmount = computeGstAmount(subtotal, gstPercent, gstApplicable)
  return Number((subtotal + gstAmount).toFixed(2))
}

export const sortByDateDesc = (expenses: Expense[]): Expense[] =>
  [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1))

export const totalSpend = (expenses: Expense[]): number =>
  expenses.reduce((acc, item) => acc + item.totalCost, 0)

export const splitByKind = (expenses: Expense[]): { labour: number; material: number } =>
  expenses.reduce(
    (acc, item) => {
      if (item.categoryKind === 'labour') {
        acc.labour += item.totalCost
      } else {
        acc.material += item.totalCost
      }
      return acc
    },
    { labour: 0, material: 0 },
  )

export const groupByCategory = (expenses: Expense[]): Array<{ name: string; total: number }> => {
  const map = new Map<string, number>()

  expenses.forEach((item) => {
    map.set(item.categoryName, (map.get(item.categoryName) ?? 0) + item.totalCost)
  })

  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
}

export const groupByMonth = (expenses: Expense[]): Array<{ month: string; total: number }> => {
  const map = new Map<string, number>()

  expenses.forEach((item) => {
    const month = item.date.slice(0, 7)
    map.set(month, (map.get(month) ?? 0) + item.totalCost)
  })

  return [...map.entries()]
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([month, total]) => ({ month, total: Number(total.toFixed(2)) }))
}

export interface ExpenseFilter {
  siteId?: string
  categoryId?: string
  categoryKind?: 'material' | 'labour'
  fromDate?: string
  toDate?: string
  timelinePreset?: '30d' | '90d' | '365d' | 'all'
}

export const filterExpenses = (expenses: Expense[], filter: ExpenseFilter): Expense[] => {
  const now = new Date()
  const fromPreset =
    filter.timelinePreset && filter.timelinePreset !== 'all'
      ? startOfDay(subDays(now, Number.parseInt(filter.timelinePreset, 10)))
      : null

  const fromDate = filter.fromDate ? startOfDay(parseISO(filter.fromDate)) : fromPreset
  const toDate = filter.toDate ? endOfDay(parseISO(filter.toDate)) : null

  return expenses.filter((item) => {
    if (filter.siteId && item.siteId !== filter.siteId) {
      return false
    }

    if (filter.categoryId && item.categoryId !== filter.categoryId) {
      return false
    }

    if (filter.categoryKind && item.categoryKind !== filter.categoryKind) {
      return false
    }

    const expenseDate = parseISO(item.date)

    if (fromDate && isBefore(expenseDate, fromDate)) {
      return false
    }

    if (toDate && isAfter(expenseDate, toDate)) {
      return false
    }

    return true
  })
}
