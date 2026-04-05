import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseExpenseCsv } from './csvImport'

describe('csv import real sample compatibility', () => {
  it('parses the provided construction tracker CSV file', () => {
    const samplePath = resolve(process.cwd(), '../House_Construction_Expense_Tracker_INR.csv')
    const csv = readFileSync(samplePath, 'utf8')

    const parsed = parseExpenseCsv(csv, 'sample-site')

    expect(parsed.rows.length).toBeGreaterThan(50)
    expect(parsed.rows[0].expense.date).toBe('2025-11-24')
    expect(parsed.rows[0].expense.categoryId).toBe('')
    expect(parsed.rows.some((row) => row.expense.paymentMethod === 'bank_transfer')).toBe(true)
  })
})
