import { computeSubtotal } from './calculations'
import type { BeaverRepository, BeaverSnapshot, Category, Expense, ExpenseInput, ExpenseUpdateInput, Site } from './types'
import {
  validateCategoryCreatePayload,
  validateCategoryUpdatePayload,
  validateEntityId,
  validateExpenseCreatePayload,
  validateExpenseUpdatePayload,
  validateSiteCreatePayload,
  validateSiteUpdatePayload,
} from './validators'

// Browser-only fallback store key for non-Firebase mode.
const STORE_KEY = 'beaver-expense-store-v1'

interface PersistedState {
  sites: Site[]
  categories: Category[]
  expenses: Expense[]
}

const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

// Converts files to base64 Data URL so receipts can be persisted in localStorage mode.
const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Unable to read receipt file.'))
    reader.readAsDataURL(file)
  })

const toLocalReceipt = async (file: File) => ({
  url: await readAsDataUrl(file),
  name: file.name,
  contentType: file.type || 'application/octet-stream',
  size: file.size,
  uploadedAt: new Date().toISOString(),
})

// Defensive localStorage read with defaults for first-run and schema drift tolerance.
const readStore = (fallback: PersistedState): PersistedState => {
  const saved = localStorage.getItem(STORE_KEY)
  if (!saved) {
    return fallback
  }

  try {
    const parsed = JSON.parse(saved) as PersistedState
    return {
      sites: parsed.sites ?? fallback.sites,
      categories: parsed.categories ?? fallback.categories,
      expenses: parsed.expenses ?? fallback.expenses,
    }
  } catch {
    return fallback
  }
}

const writeStore = (state: PersistedState): void => {
  localStorage.setItem(STORE_KEY, JSON.stringify(state))
}

const toUnitAmount = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const createLocalRepository = (
  defaultSites: Site[],
  defaultCategories: Category[],
): BeaverRepository => {
  // Cursor mimics paged fetch behavior used in Firebase mode.
  let expenseCursor = 0

  const initialState: PersistedState = {
    sites: defaultSites,
    categories: defaultCategories,
    expenses: [],
  }

  const loadState = (): PersistedState => readStore(initialState)
  const sortExpensesDesc = (expenses: Expense[]): Expense[] => [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1))

  const paginateExpenses = (expenses: Expense[], pageSize: number): { page: Expense[]; hasMore: boolean } => {
    // Returns deterministic pages for report table load-more behavior.
    const sorted = sortExpensesDesc(expenses)
    const page = sorted.slice(expenseCursor, expenseCursor + pageSize)
    expenseCursor += page.length
    return {
      page,
      hasMore: expenseCursor < sorted.length,
    }
  }

  return {
    async loadSnapshot(options): Promise<BeaverSnapshot> {
      const pageSize = options?.pageSize ?? 100
      expenseCursor = 0
      const state = loadState()
      const { page, hasMore } = paginateExpenses(state.expenses, pageSize)
      return {
        sites: state.sites,
        categories: state.categories,
        expenses: page,
        hasMoreExpenses: hasMore,
      }
    },

    async loadMoreExpenses(options) {
      const pageSize = options?.pageSize ?? 100
      const state = loadState()
      const { page, hasMore } = paginateExpenses(state.expenses, pageSize)
      return {
        expenses: page,
        hasMore,
      }
    },

    async createSite(payload) {
      const validatedPayload = validateSiteCreatePayload(payload)
      const state = loadState()
      const next: Site = {
        ...validatedPayload,
        id: makeId(),
        createdAt: new Date().toISOString(),
      }
      writeStore({ ...state, sites: [...state.sites, next] })
      return next
    },

    async updateSite(site) {
      const validatedSite = validateSiteUpdatePayload(site)
      const state = loadState()
      writeStore({
        ...state,
        sites: state.sites.map((item) => (item.id === validatedSite.id ? validatedSite : item)),
      })
      return validatedSite
    },

    async deleteSite(siteId) {
      const validatedSiteId = validateEntityId(siteId, 'site')
      const state = loadState()
      writeStore({
        ...state,
        sites: state.sites.filter((site) => site.id !== validatedSiteId),
        expenses: state.expenses.filter((expense) => expense.siteId !== validatedSiteId),
      })
    },

    async createCategory(payload) {
      const validatedPayload = validateCategoryCreatePayload(payload)
      const state = loadState()
      const next: Category = {
        ...validatedPayload,
        id: makeId(),
        createdAt: new Date().toISOString(),
      }
      writeStore({ ...state, categories: [...state.categories, next] })
      return next
    },

    async updateCategory(category) {
      const validatedCategory = validateCategoryUpdatePayload(category)
      const state = loadState()
      writeStore({
        ...state,
        categories: state.categories.map((item) => (item.id === validatedCategory.id ? validatedCategory : item)),
      })
      return validatedCategory
    },

    async deleteCategory(categoryId) {
      const validatedCategoryId = validateEntityId(categoryId, 'category')
      const state = loadState()
      writeStore({
        ...state,
        categories: state.categories.filter((category) => category.id !== validatedCategoryId),
        expenses: state.expenses.filter((expense) => expense.categoryId !== validatedCategoryId),
      })
    },

    async createExpense(payload: ExpenseInput, receiptFiles?: File[]) {
      const validatedPayload = validateExpenseCreatePayload(payload)
      const state = loadState()
      const category = state.categories.find((item) => item.id === validatedPayload.categoryId)
      if (!category) {
        throw new Error('Invalid category selected.')
      }

      // Keep total/gst aligned with the same derived behavior used in cloud mode.
      const subtotal = computeSubtotal(toUnitAmount(validatedPayload.unit), validatedPayload.unitPrice)
      const totalCost = Number(validatedPayload.totalCost.toFixed(2))
      const gstAmount = validatedPayload.gstApplicable ? Number(Math.max(totalCost - subtotal, 0).toFixed(2)) : 0
      const receipts = receiptFiles && receiptFiles.length > 0
        ? await Promise.all(receiptFiles.map((file) => toLocalReceipt(file)))
        : undefined

      const next: Expense = {
        ...validatedPayload,
        id: makeId(),
        categoryName: category.name,
        categoryKind: category.kind,
        gstAmount,
        totalCost,
        receipts,
        createdAt: new Date().toISOString(),
      }

      writeStore({
        ...state,
        expenses: [...state.expenses, next],
      })

      return next
    },

    async updateExpense(payload: ExpenseUpdateInput, receiptFiles?: File[], options?: { removeReceiptUrls?: string[] }) {
      const validatedPayload = validateExpenseUpdatePayload(payload)
      const state = loadState()
      const category = state.categories.find((item) => item.id === validatedPayload.categoryId)
      if (!category) {
        throw new Error('Invalid category selected.')
      }

      const existing = state.expenses.find((item) => item.id === validatedPayload.id)
      if (!existing) {
        throw new Error('Expense not found.')
      }

      const subtotal = computeSubtotal(toUnitAmount(validatedPayload.unit), validatedPayload.unitPrice)
      const totalCost = Number(validatedPayload.totalCost.toFixed(2))
      const gstAmount = validatedPayload.gstApplicable ? Number(Math.max(totalCost - subtotal, 0).toFixed(2)) : 0
      // Maintains existing receipts unless explicitly removed or new ones are added.
      const retainedReceipts = (existing.receipts ?? []).filter(
        (receipt) => !(options?.removeReceiptUrls ?? []).includes(receipt.url),
      )
      const nextReceipts = receiptFiles && receiptFiles.length > 0
        ? await Promise.all(receiptFiles.map((file) => toLocalReceipt(file)))
        : []
      const receipts = [...retainedReceipts, ...nextReceipts]

      const updated: Expense = {
        ...existing,
        ...validatedPayload,
        categoryName: category.name,
        categoryKind: category.kind,
        gstAmount,
        totalCost,
        receipts,
      }

      writeStore({
        ...state,
        expenses: state.expenses.map((item) => (item.id === validatedPayload.id ? updated : item)),
      })

      return updated
    },

    async deleteExpense(expenseId: string) {
      const validatedExpenseId = validateEntityId(expenseId, 'expense')
      const state = loadState()
      writeStore({
        ...state,
        expenses: state.expenses.filter((item) => item.id !== validatedExpenseId),
      })
    },
  }
}
