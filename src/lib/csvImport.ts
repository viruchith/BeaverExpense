import type { CategoryKind, ExpenseInput, PaymentMethod, PaymentStatus } from './types'

import { computeTotalCost } from './calculations'

const requiredColumns = [
  'Date',
  'Category',
  'Subcategory',
  'Description',
  'Unit',
  'Unit Price (₹)',
  'Vendor / Contractor Name',
  'GST Applicable?',
  'GST %',
  'Payment Status',
  'Payment Method',
  'Notes',
]

const normalize = (value: string): string => value.trim().toLowerCase()

const toNumber = (raw: string, fallback = 0): number => {
  const cleaned = raw.replaceAll(',', '').replace(/[^0-9.-]/g, '')
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : fallback
}

const toBool = (raw: string): boolean => {
  const value = normalize(raw)
  return value === 'yes' || value === 'true' || value === '1' || value === 'y'
}

const toPaymentStatus = (raw: string): PaymentStatus => {
  const value = normalize(raw)
  if (value === 'paid') {
    return 'paid'
  }
  if (value === 'partial' || value === 'partially paid') {
    return 'partial'
  }
  return 'pending'
}

const toPaymentMethod = (raw: string): PaymentMethod => {
  const value = normalize(raw)
  if (value === 'upi') {
    return 'upi'
  }
  if (value === 'cash') {
    return 'cash'
  }
  if (value === 'bank transfer' || value === 'bank_transfer' || value === 'neft' || value === 'rtgs') {
    return 'bank_transfer'
  }
  if (value === 'cheque' || value === 'check') {
    return 'cheque'
  }
  if (value === 'card') {
    return 'card'
  }
  return 'other'
}

const guessCategoryKind = (name: string): CategoryKind => {
  const value = normalize(name)
  if (value.includes('labour') || value.includes('labor') || value.includes('work')) {
    return 'labour'
  }
  return 'material'
}

const parseFlexibleDate = (raw: string): string => {
  const value = raw.trim()
  if (!value) {
    return new Date().toISOString().slice(0, 10)
  }

  const slashParts = value.split('/')
  if (slashParts.length === 3) {
    const [dayRaw, monthRaw, yearRaw] = slashParts
    const day = Number.parseInt(dayRaw, 10)
    const month = Number.parseInt(monthRaw, 10)
    let year = Number.parseInt(yearRaw, 10)

    if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
      if (yearRaw.length === 2) {
        year += year >= 70 ? 1900 : 2000
      }

      const parsed = new Date(Date.UTC(year, month - 1, day))
      if (!Number.isNaN(parsed.getTime()) && parsed.getUTCDate() === day && parsed.getUTCMonth() === month - 1) {
        return parsed.toISOString().slice(0, 10)
      }
    }
  }

  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsedDate.toISOString().slice(0, 10)
}

const splitCsvLine = (line: string, delimiter: string): string[] => {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (char === '"') {
      const isEscapedQuote = inQuotes && line[i + 1] === '"'
      if (isEscapedQuote) {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === delimiter && !inQuotes) {
      result.push(current)
      current = ''
      continue
    }

    current += char
  }

  result.push(current)
  return result
}

export interface ParsedCsvRow {
  rawCategoryName: string
  rawSubcategory: string
  kindHint: CategoryKind
  expense: ExpenseInput
}

export interface ParsedCsvPayload {
  rows: ParsedCsvRow[]
  warnings: string[]
}

export const parseExpenseCsv = (csvText: string, defaultSiteId: string): ParsedCsvPayload => {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)

  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one data row.')
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const headerCells = splitCsvLine(lines[0], delimiter).map((header) => header.trim())
  const headerMap = new Map<string, number>()

  headerCells.forEach((header, index) => {
    headerMap.set(normalize(header), index)
  })

  const missing = requiredColumns.filter((column) => !headerMap.has(normalize(column)))
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}`)
  }

  const warnings: string[] = []
  const rows: ParsedCsvRow[] = []

  lines.slice(1).forEach((line, lineIndex) => {
    const cells = splitCsvLine(line, delimiter)
    const hasAnyValue = cells.some((cell) => cell.trim().length > 0)

    // Ignore trailing spreadsheet rows that only contain delimiters and no values.
    if (!hasAnyValue) {
      return
    }

    const at = (name: string): string => {
      const index = headerMap.get(normalize(name))
      if (typeof index !== 'number') {
        return ''
      }
      return (cells[index] ?? '').trim()
    }

    const rawCategoryName = at('Category')
    const rawSubcategory = at('Subcategory')

    if (!rawCategoryName || !rawSubcategory) {
      warnings.push(`Skipped row ${lineIndex + 2}: missing Category/Subcategory.`)
      return
    }

    const date = parseFlexibleDate(at('Date'))
    const unit = at('Unit') || ''
    const unitPrice = toNumber(at('Unit Price (₹)'), 0)
    const gstApplicable = toBool(at('GST Applicable?'))
    const gstPercent = toNumber(at('GST %'), 0)
    const totalCost = toNumber(
      at('Total Cost (₹)'),
      computeTotalCost(Number.parseFloat(unit || '0') || 0, unitPrice, gstPercent, gstApplicable),
    )

    rows.push({
      rawCategoryName,
      rawSubcategory,
      kindHint: guessCategoryKind(rawCategoryName),
      expense: {
        date,
        siteId: defaultSiteId,
        categoryId: '',
        subcategory: rawSubcategory,
        description: at('Description') || `${rawCategoryName} - ${rawSubcategory}`,
        unit,
        unitPrice,
        totalCost,
        vendorOrContractorName: at('Vendor / Contractor Name') || 'Unknown Vendor',
        gstApplicable,
        gstPercent,
        paymentStatus: toPaymentStatus(at('Payment Status')),
        paymentMethod: toPaymentMethod(at('Payment Method')),
        notes: at('Notes') || '',
      },
    })
  })

  return { rows, warnings }
}

export const categoryKey = (name: string): string => normalize(name)
