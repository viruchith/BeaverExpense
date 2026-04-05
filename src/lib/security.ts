const stripControlCharacters = (value: string): string =>
  Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')

export const sanitizeText = (value: string, maxLength = 200): string =>
  stripControlCharacters(value)
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)

export const sanitizeMultilineText = (value: string, maxLength = 800): string =>
  stripControlCharacters(value)
    .replace(/[<>]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, maxLength)

const allowedReceiptExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.csv',
  '.xls',
  '.xlsx',
  '.doc',
  '.docx',
])

const allowedReceiptContentTypes = new Set([
  'application/pdf',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export const assertSafeReceiptFile = (file: File): void => {
  const maxSize = 10 * 1024 * 1024
  const lowerName = file.name.toLowerCase()
  const dotIndex = lowerName.lastIndexOf('.')
  const extension = dotIndex >= 0 ? lowerName.slice(dotIndex) : ''
  const isAllowedByExtension = allowedReceiptExtensions.has(extension)
  const isAllowedByType = file.type.startsWith('image/') || allowedReceiptContentTypes.has(file.type)

  if (!isAllowedByExtension || (!isAllowedByType && file.type.trim().length > 0)) {
    throw new Error('Allowed receipt files: images, PDF, CSV, XLS/XLSX, DOC/DOCX.')
  }

  if (file.size > maxSize) {
    throw new Error(`File "${file.name}" is too large. Maximum allowed size is 10MB.`)
  }
}

export const assertSafeCsvFile = (file: File): void => {
  const maxSize = 2 * 1024 * 1024
  const lowerName = file.name.toLowerCase()

  if (!(lowerName.endsWith('.csv') || lowerName.endsWith('.txt'))) {
    throw new Error('Please upload a valid CSV file.')
  }

  if (file.size > maxSize) {
    throw new Error('CSV file must be 2MB or less.')
  }
}

export const secureAuthErrorMessage = (): string =>
  'Authentication failed. Verify your credentials and try again.'
