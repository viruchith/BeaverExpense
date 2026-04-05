import { describe, expect, it } from 'vitest'

import { expensesToCsv, expensesToJson } from './exports'
import type { Expense } from './types'

const expense: Expense = {
  id: '1',
  date: '2026-04-01',
  siteId: 'site-a',
  categoryId: 'cat-material',
  categoryName: 'Materials',
  categoryKind: 'material',
  subcategory: 'Cement',
  description: 'Cement, OPC "53"',
  unit: 'bags',
  unitPrice: 420,
  totalCost: 49560,
  vendorOrContractorName: 'ABC Suppliers',
  gstApplicable: true,
  gstPercent: 18,
  gstAmount: 7560,
  paymentStatus: 'paid',
  paymentMethod: 'upi',
  notes: 'Delivered on time',
  createdAt: '2026-04-01T08:00:00.000Z',
}

describe('export helpers', () => {
  it('creates CSV with headers and escaped cells', () => {
    const csv = expensesToCsv([expense], { 'site-a': 'Main Site' })

    expect(csv).toContain('Date,Site,Category,Subcategory')
    expect(csv).not.toContain('Quantity')
    expect(csv).toContain('Main Site')
    expect(csv).toContain('"Cement, OPC ""53"""')
  })

  it('creates pretty JSON output', () => {
    const json = expensesToJson([expense])
    const parsed = JSON.parse(json) as Expense[]

    expect(parsed).toHaveLength(1)
    expect(parsed[0].totalCost).toBe(49560)
    expect(parsed[0]).not.toHaveProperty('quantity')
  })

  it('returns only CSV headers when there are no transactions', () => {
    const csv = expensesToCsv([], {})
    expect(csv.split('\n')).toHaveLength(1)
  })
})
