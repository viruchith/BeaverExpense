import { describe, expect, it } from 'vitest'

import { parseExpenseCsv } from './csvImport'

describe('csv import parser', () => {
  it('parses valid csv rows from excel-like export', () => {
    const csv = [
      'Date,Category,Subcategory,Description,Unit,Unit Price (₹),Total Cost (₹),Vendor / Contractor Name,GST Applicable?,GST %,Payment Status,Payment Method,Notes',
      '2026-03-01,Materials,Cement,OPC 53,120,430,60984,ABC Supplier,Yes,18,Paid,UPI,Delivered',
    ].join('\n')

    const parsed = parseExpenseCsv(csv, 'site-1')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].expense.siteId).toBe('site-1')
    expect(parsed.rows[0].expense.unit).toBe('120')
    expect(parsed.rows[0].expense.paymentMethod).toBe('upi')
    expect(parsed.rows[0].expense.gstApplicable).toBe(true)
  })

  it('handles quoted comma cells and skips invalid rows', () => {
    const csv = [
      'Date,Category,Subcategory,Description,Unit,Unit Price (₹),Total Cost (₹),Vendor / Contractor Name,GST Applicable?,GST %,Payment Status,Payment Method,Notes',
      '2026-03-01,Materials,Cement,"OPC 53, bulk",120,430,60984,ABC Supplier,Yes,18,Paid,UPI,Delivered',
      '2026-03-02,Materials,,Missing subcategory,1,1,1,Vendor,No,0,Pending,Cash,',
    ].join('\n')

    const parsed = parseExpenseCsv(csv, 'site-1')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].expense.description).toBe('OPC 53, bulk')
    expect(parsed.warnings).toHaveLength(1)
  })

  it('throws on missing required columns', () => {
    const csv = ['Date,Category,Description', '2026-03-01,Materials,foo'].join('\n')
    expect(() => parseExpenseCsv(csv, 'site-1')).toThrow(/Missing required columns/i)
  })

  it('supports sample schema date format DD/MM/YY', () => {
    const csv = [
      'Date,Category,Subcategory,Description,Unit,Unit Price (₹),Total Cost (₹),Vendor / Contractor Name,GST Applicable?,GST %,Payment Status,Payment Method,Notes',
      '24/11/25,Miscellaneous,Pooja,Pooja materials,1,"₹1,000.00","₹1,000.00",,,,,,',
    ].join('\n')

    const parsed = parseExpenseCsv(csv, 'site-1')
    expect(parsed.rows[0].expense.date).toBe('2025-11-24')
  })

  it('ignores empty delimiter-only rows without warnings', () => {
    const csv = [
      'Date,Category,Subcategory,Description,Unit,Unit Price (₹),Total Cost (₹),Vendor / Contractor Name,GST Applicable?,GST %,Payment Status,Payment Method,Notes',
      '2026-03-01,Materials,Cement,OPC 53,120,430,60984,ABC Supplier,Yes,18,Paid,UPI,Delivered',
      ',,,,,,,,,,,,',
      ',,,,,,,,,,,,',
    ].join('\n')

    const parsed = parseExpenseCsv(csv, 'site-1')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.warnings).toHaveLength(0)
  })
})
