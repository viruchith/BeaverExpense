import { describe, expect, it, vi } from 'vitest'

import {
  computeGstAmount,
  computeSubtotal,
  computeTotalCost,
  filterExpenses,
  groupByCategory,
  groupByMonth,
  splitByKind,
  totalSpend,
} from './calculations'
import type { Expense } from './types'

const sampleExpenses: Expense[] = [
  {
    id: '1',
    date: '2026-04-01',
    siteId: 'site-a',
    categoryId: 'cat-material',
    categoryName: 'Materials',
    categoryKind: 'material',
    subcategory: 'Cement',
    description: 'Cement bags',
    unit: 'bags',
    unitPrice: 420,
    totalCost: 49560,
    vendorOrContractorName: 'ABC Suppliers',
    gstApplicable: true,
    gstPercent: 18,
    gstAmount: 7560,
    paymentStatus: 'paid',
    paymentMethod: 'upi',
    notes: '',
    createdAt: '2026-04-01T08:00:00.000Z',
  },
  {
    id: '2',
    date: '2026-03-15',
    siteId: 'site-b',
    categoryId: 'cat-labour',
    categoryName: 'Labour',
    categoryKind: 'labour',
    subcategory: 'Masonry',
    description: 'Weekly labour payout',
    unit: 'week',
    unitPrice: 25000,
    totalCost: 25000,
    vendorOrContractorName: 'Labour Crew A',
    gstApplicable: false,
    gstPercent: 0,
    gstAmount: 0,
    paymentStatus: 'partial',
    paymentMethod: 'bank_transfer',
    notes: '',
    createdAt: '2026-03-15T08:00:00.000Z',
  },
]

describe('calculation helpers', () => {
  it('computes subtotal, gst and total correctly', () => {
    expect(computeSubtotal(10, 99.95)).toBe(999.5)
    expect(computeGstAmount(1000, 18, true)).toBe(180)
    expect(computeGstAmount(1000, 18, false)).toBe(0)
    expect(computeTotalCost(2, 1000, 18, true)).toBe(2360)
  })

  it('aggregates totals correctly', () => {
    expect(totalSpend(sampleExpenses)).toBe(74560)
    expect(splitByKind(sampleExpenses)).toEqual({ labour: 25000, material: 49560 })
  })

  it('groups values category-wise and month-wise', () => {
    expect(groupByCategory(sampleExpenses)).toEqual([
      { name: 'Materials', total: 49560 },
      { name: 'Labour', total: 25000 },
    ])

    expect(groupByMonth(sampleExpenses)).toEqual([
      { month: '2026-03', total: 25000 },
      { month: '2026-04', total: 49560 },
    ])
  })

  it('filters by site, category and category kind', () => {
    expect(filterExpenses(sampleExpenses, { siteId: 'site-a' })).toHaveLength(1)
    expect(filterExpenses(sampleExpenses, { categoryId: 'cat-labour' })).toHaveLength(1)
    expect(filterExpenses(sampleExpenses, { categoryKind: 'material' })).toHaveLength(1)
  })

  it('filters by date range boundaries', () => {
    expect(
      filterExpenses(sampleExpenses, {
        fromDate: '2026-03-01',
        toDate: '2026-03-31',
      }),
    ).toEqual([sampleExpenses[1]])
  })

  it('filters by timeline preset', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T00:00:00.000Z'))

    const result = filterExpenses(sampleExpenses, { timelinePreset: '30d' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')

    vi.useRealTimers()
  })
})
