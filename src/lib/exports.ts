import type { FirebaseApp } from 'firebase/app'
import { getBytes, getStorage, ref } from 'firebase/storage'
import JSZip from 'jszip'

import type { Expense } from './types'

const headers = [
  'Date',
  'Site',
  'Category',
  'Subcategory',
  'Description',
  'Unit',
  'Unit Price INR',
  'Total Cost INR',
  'Vendor / Contractor Name',
  'GST Applicable',
  'GST Percent',
  'Payment Status',
  'Payment Method',
  'Notes',
]

const escapeCell = (value: unknown): string => {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

export const expensesToCsv = (expenses: Expense[], siteNames: Record<string, string>): string => {
  const bodyRows = expenses.map((item) => {
    const row = [
      item.date || '',
      siteNames[item.siteId] ?? item.siteId ?? '',
      item.categoryName || '',
      item.subcategory || '',
      item.description || '',
      item.unit || '',
      item.unitPrice ?? '',
      item.totalCost ?? '',
      item.vendorOrContractorName || '',
      item.gstApplicable ? 'Yes' : 'No',
      item.gstPercent ?? '',
      item.paymentStatus || '',
      item.paymentMethod || '',
      item.notes || '',
    ]

    return row.map(escapeCell).join(',')
  })

  return [headers.join(','), ...bodyRows].join('\n')
}

export const expensesToJson = (expenses: Expense[]): string =>
  JSON.stringify(
    expenses.map(({ id, date, siteId, categoryId, categoryName, categoryKind, subcategory, description, unit, unitPrice, totalCost, vendorOrContractorName, gstApplicable, gstPercent, gstAmount, paymentStatus, paymentMethod, notes, createdAt, ownerId }) => ({
      id,
      date,
      siteId,
      categoryId,
      categoryName,
      categoryKind,
      subcategory,
      description,
      unit,
      unitPrice,
      totalCost,
      vendorOrContractorName,
      gstApplicable,
      gstPercent,
      gstAmount,
      paymentStatus,
      paymentMethod,
      notes,
      createdAt,
      ownerId,
    })),
    null,
    2,
  )

export const downloadTextFile = (contents: string, filename: string, mimeType: string): void => {
  const blob = new Blob([contents], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.click()

  URL.revokeObjectURL(url)
}

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.click()

  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

const inferExtension = (fileUrl: string, contentType?: string): string => {
  if (contentType === 'image/png') {
    return 'png'
  }
  if (contentType === 'image/webp') {
    return 'webp'
  }
  if (contentType === 'image/gif') {
    return 'gif'
  }
  if (contentType === 'image/jpeg') {
    return 'jpg'
  }

  const cleanUrl = fileUrl.split('?')[0]
  const maybeExtension = cleanUrl.split('.').pop()?.toLowerCase()
  return maybeExtension && maybeExtension.length <= 5 ? maybeExtension : 'jpg'
}

export const downloadExpenseBundle = async (
  expenses: Expense[],
  siteNames: Record<string, string>,
  format: 'csv' | 'json',
  firebaseApp: FirebaseApp,
): Promise<{ receiptCount: number; skippedReceiptCount: number }> => {
  const zip = new JSZip()
  const exportFilename = format === 'csv' ? 'beaver-expenses.csv' : 'beaver-expenses.json'
  const exportContents = format === 'csv' ? expensesToCsv(expenses, siteNames) : expensesToJson(expenses)

  zip.file(exportFilename, exportContents)

  let receiptCount = 0
  let skippedReceiptCount = 0

  // Only download receipts for CSV format; JSON export is data-only to avoid CORS issues
  if (format === 'csv') {
    const storage = getStorage(firebaseApp)
    const receiptPromises: Promise<void>[] = []

    expenses.forEach((expense, index) => {
      const attachments = expense.receipts ?? []
      if (attachments.length === 0) {
        return
      }

      attachments.forEach((attachment, attachmentIndex) => {
        receiptPromises.push(
          (async () => {
            try {
              // Extract storage path from URL
              // URL format: https://firebasestorage.googleapis.com/v0/b/bucket/o/path%2Fto%2Ffile?alt=media&token=xxx
              const urlParts = attachment.url.split('/o/')
              if (urlParts.length < 2) {
                skippedReceiptCount += 1
                return
              }

              const encodedPath = urlParts[1].split('?')[0]
              const storagePath = decodeURIComponent(encodedPath)

              // Use Firebase SDK to get bytes (handles auth & CORS properly)
              const storageRef = ref(storage, storagePath)
              const bytes = await getBytes(storageRef)

                if (bytes.byteLength === 0) {
                skippedReceiptCount += 1
                return
              }

              const blob = new Blob([bytes], { type: attachment.contentType || 'application/octet-stream' })
              const extension = inferExtension(attachment.url, attachment.contentType)
              const safeDate = expense.date.replaceAll('/', '-')
              const safeCategory = expense.categoryName.replaceAll(/[^a-z0-9]+/gi, '-').replaceAll(/^-|-$/g, '') || 'receipt'
              const safeName = (attachment.name || 'receipt')
                .replaceAll(/[^a-z0-9._-]+/gi, '-')
                .replaceAll(/^-|-$/g, '')
                .slice(0, 60)
              zip.file(`receipts/${safeDate}-${safeCategory}-${index + 1}-${attachmentIndex + 1}-${safeName}.${extension}`, blob)
              receiptCount += 1
            } catch {
              skippedReceiptCount += 1
            }
          })(),
        )
      })
    })

    // Wait for all receipt downloads to complete (even if some fail)
    await Promise.allSettled(receiptPromises)
  }

  const archive = await zip.generateAsync({ type: 'blob' })
  downloadBlob(archive, `beaver-expenses-${format}.zip`)

  return { receiptCount, skippedReceiptCount }
}
