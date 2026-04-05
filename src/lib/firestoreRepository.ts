import type { FirebaseApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  where,
} from 'firebase/firestore/lite'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'

import { computeSubtotal } from './calculations'
import type { BeaverRepository, BeaverSnapshot, Category, Expense, ExpenseInput, ExpenseReceipt, ExpenseUpdateInput, Site } from './types'
import {
  validateCategoryCreatePayload,
  validateCategoryUpdatePayload,
  validateExpenseCreatePayload,
  validateExpenseUpdatePayload,
  validateSiteCreatePayload,
  validateSiteUpdatePayload,
} from './validators'

// Shared helper to keep lists deterministic across Firestore/local repositories.
const sortByCreatedAt = <T extends { createdAt: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1))

// Firestore writes reject undefined fields; sanitize objects before persisting.
const stripUndefined = <T extends Record<string, unknown>>(input: T): T =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

// Supports both new receipt-array schema and old single imageUrl schema.
const toReceiptArray = (raw: unknown, fallbackImageUrl?: string): ExpenseReceipt[] => {
  const receipts = Array.isArray(raw)
    ? raw
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null
          }
          const candidate = item as Record<string, unknown>
          if (typeof candidate.url !== 'string' || candidate.url.trim().length === 0) {
            return null
          }
          return {
            url: candidate.url,
            name: typeof candidate.name === 'string' ? candidate.name : 'receipt',
            contentType: typeof candidate.contentType === 'string' ? candidate.contentType : 'application/octet-stream',
            size: typeof candidate.size === 'number' ? candidate.size : 0,
            uploadedAt: typeof candidate.uploadedAt === 'string' ? candidate.uploadedAt : new Date().toISOString(),
          }
        })
        .filter((item): item is ExpenseReceipt => item !== null)
    : []

  if (receipts.length > 0) {
    return receipts
  }

  if (typeof fallbackImageUrl === 'string' && fallbackImageUrl.trim().length > 0) {
    return [
      {
        url: fallbackImageUrl,
        name: 'legacy-receipt',
        contentType: 'application/octet-stream',
        size: 0,
        uploadedAt: new Date().toISOString(),
      },
    ]
  }

  return []
}

// Reconstruct totals defensively for legacy rows that may miss derived fields.
const resolveExpenseTotals = (data: Record<string, unknown>): { gstAmount: number; totalCost: number } => {
  const unitAmount = toUnitAmount(asString(data.unit, '0'))
  const unitPrice = Number(data.unitPrice ?? 0)
  const gstApplicable = Boolean(data.gstApplicable)
  const gstPercent = Number(data.gstPercent ?? 0)
  const subtotal = computeSubtotal(unitAmount, Number.isFinite(unitPrice) ? unitPrice : 0)
  const derivedGstAmount = gstApplicable ? Number(((subtotal * gstPercent) / 100).toFixed(2)) : 0
  const derivedTotalCost = Number((subtotal + derivedGstAmount).toFixed(2))

  const storedGstAmount = Number(data.gstAmount ?? 0)
  const storedTotalCost = Number(data.totalCost ?? 0)

  return {
    gstAmount: Number.isFinite(storedGstAmount) && (storedGstAmount > 0 || derivedGstAmount === 0) ? storedGstAmount : derivedGstAmount,
    totalCost: Number.isFinite(storedTotalCost) && (storedTotalCost > 0 || derivedTotalCost === 0) ? storedTotalCost : derivedTotalCost,
  }
}

// Normalizes Firestore raw document into strongly-typed Expense shape.
const toExpenseWithDocId = (docId: string, data: Record<string, unknown>): Expense => {
  const totals = resolveExpenseTotals(data)

  return {
    id: docId,
    date: asString(data.date),
    siteId: asString(data.siteId),
    categoryId: asString(data.categoryId),
    categoryName: asString(data.categoryName),
    categoryKind: data.categoryKind === 'labour' ? 'labour' : 'material',
    subcategory: asString(data.subcategory),
    description: asString(data.description),
    unit: asString(data.unit),
    unitPrice: Number(data.unitPrice ?? 0),
    totalCost: totals.totalCost,
    vendorOrContractorName: asString(data.vendorOrContractorName),
    gstApplicable: Boolean(data.gstApplicable),
    gstPercent: Number(data.gstPercent ?? 0),
    gstAmount: totals.gstAmount,
    paymentStatus: data.paymentStatus === 'paid' || data.paymentStatus === 'partial' ? data.paymentStatus : 'pending',
    paymentMethod:
      data.paymentMethod === 'upi'
      || data.paymentMethod === 'cash'
      || data.paymentMethod === 'bank_transfer'
      || data.paymentMethod === 'cheque'
      || data.paymentMethod === 'card'
        ? data.paymentMethod
        : 'other',
    notes: asString(data.notes),
    receipts: toReceiptArray(data.receipts, typeof data.imageUrl === 'string' ? data.imageUrl : undefined),
    createdAt: asString(data.createdAt),
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : undefined,
  }
}

// Keeps write payload explicit and stable when upgrading schema fields.
const toExpenseDocument = (expense: Omit<Expense, 'id'>): Omit<Expense, 'id'> =>
  stripUndefined({
    date: expense.date,
    siteId: expense.siteId,
    categoryId: expense.categoryId,
    categoryName: expense.categoryName,
    categoryKind: expense.categoryKind,
    subcategory: expense.subcategory,
    description: expense.description,
    unit: expense.unit,
    unitPrice: expense.unitPrice,
    totalCost: expense.totalCost,
    vendorOrContractorName: expense.vendorOrContractorName,
    gstApplicable: expense.gstApplicable,
    gstPercent: expense.gstPercent,
    gstAmount: expense.gstAmount,
    paymentStatus: expense.paymentStatus,
    paymentMethod: expense.paymentMethod,
    notes: expense.notes,
    receipts: expense.receipts ?? [],
    createdAt: expense.createdAt,
    ownerId: expense.ownerId,
  })

const hasLegacyExpenseFields = (data: Record<string, unknown>): boolean =>
  Object.keys(data).some((key) => key === 'quantity' || key === 'id' || key === 'imageUrl')

// Uploads receipt files and returns metadata persisted with the expense row.
const uploadReceipts = async (storageRoot: ReturnType<typeof getStorage>, userId: string, files: File[]): Promise<ExpenseReceipt[]> => {
  if (files.length === 0) {
    return []
  }

  const uploadedAt = new Date().toISOString()
  return Promise.all(
    files.map(async (file) => {
      const fileRef = ref(
        storageRoot,
        `expense-receipts/${userId}/${new Date().toISOString().replaceAll(':', '-')}-${file.name}`,
      )
      await uploadBytes(fileRef, file)
      const url = await getDownloadURL(fileRef)
      return {
        url,
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        uploadedAt,
      }
    }),
  )
}

const assertNonEmptyId = (id: string, entityName: string): void => {
  if (!id || id.trim().length === 0) {
    throw new Error(`Invalid ${entityName} id.`)
  }
}

const toUnitAmount = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Ensures all reads/writes are user-scoped in multi-tenant collections.
const requireUserId = (app: FirebaseApp): string => {
  const auth = getAuth(app)
  const userId = auth.currentUser?.uid
  if (!userId) {
    throw new Error('Authentication required to access Firebase data.')
  }
  return userId
}

const toSiteWithDocId = (docId: string, data: Record<string, unknown>): Site => ({
  id: docId,
  name: asString(data.name),
  location: asString(data.location),
  budget: Number(data.budget ?? 0),
  createdAt: asString(data.createdAt),
  ownerId: typeof data.ownerId === 'string' ? data.ownerId : undefined,
})

// Seeds default sites/categories for first-time users in Firebase mode.
const ensureDefaults = async (
  app: FirebaseApp,
  defaultSites: Site[],
  defaultCategories: Category[],
): Promise<void> => {
  const db = getFirestore(app)
  const userId = requireUserId(app)
  const sitesRef = collection(db, 'sites')
  const categoriesRef = collection(db, 'categories')

  const [sitesSnap, categoriesSnap] = await Promise.all([
    getDocs(query(sitesRef, where('ownerId', '==', userId))),
    getDocs(query(categoriesRef, where('ownerId', '==', userId))),
  ])

  if (sitesSnap.empty) {
    await Promise.all(
      defaultSites.map(async (site) => {
        await setDoc(doc(sitesRef, `${userId}-${site.id}`), {
          ...site,
          id: `${userId}-${site.id}`,
          ownerId: userId,
        })
      }),
    )
  }

  if (categoriesSnap.empty) {
    await Promise.all(
      defaultCategories.map(async (category) => {
        await setDoc(doc(categoriesRef, `${userId}-${category.id}`), {
          ...category,
          id: `${userId}-${category.id}`,
          ownerId: userId,
        })
      }),
    )
  }
}

export const createFirestoreRepository = (
  app: FirebaseApp,
  defaultSites: Site[],
  defaultCategories: Category[],
): BeaverRepository => {
  // Cursor-based paging state used by report table infinite loading.
  let lastExpenseCursor: string | null = null
  let expensesExhausted = false
  // Fallback mode for temporary Firestore index-build windows.
  let useClientExpensePagination = false
  let clientExpenseCache: Expense[] = []
  let clientExpenseOffset = 0

  const db = getFirestore(app)
  const storage = getStorage(app)

  const sitesRef = collection(db, 'sites')
  const categoriesRef = collection(db, 'categories')
  const expensesRef = collection(db, 'expenses')

  const isIndexBuildingError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return false
    }
    const message = error.message.toLowerCase()
    return message.includes('requires an index') || message.includes('index is currently building')
  }

  const normalizeCategoryName = (value: string): string => value.trim().toLowerCase()

  const syncCategoriesFromExpenses = async (userId: string, existingCategories: Category[]): Promise<Category[]> => {
    // Backfills missing categories/subcategories discovered in legacy expense rows.
    const categoriesByName = new Map(existingCategories.map((item) => [normalizeCategoryName(item.name), item]))
    const nextCategories = [...existingCategories]

    const expensesSnap = await getDocs(query(expensesRef, where('ownerId', '==', userId)))
    const expenses = expensesSnap.docs.map((item) => toExpenseWithDocId(item.id, item.data() as Record<string, unknown>))

    await Promise.allSettled(
      expensesSnap.docs
        .filter((item) => hasLegacyExpenseFields(item.data() as Record<string, unknown>))
        .map(async (item) => {
          await setDoc(item.ref, toExpenseDocument(toExpenseWithDocId(item.id, item.data() as Record<string, unknown>)))
        }),
    )

    for (const expense of expenses) {
      const categoryName = expense.categoryName?.trim() ?? ''
      const subcategory = expense.subcategory?.trim() ?? ''
      if (!categoryName) {
        continue
      }

      const key = normalizeCategoryName(categoryName)
      const existing = categoriesByName.get(key)

      if (!existing) {
        const created: Category = {
          id: doc(categoriesRef).id,
          name: categoryName,
          kind: expense.categoryKind === 'labour' ? 'labour' : 'material',
          subcategories: subcategory ? [subcategory] : [],
          createdAt: new Date().toISOString(),
          ownerId: userId,
        }
        try {
          await setDoc(doc(categoriesRef, created.id), created)
        } catch {
          continue
        }
        categoriesByName.set(key, created)
        nextCategories.push(created)
        continue
      }

      if (!subcategory || existing.subcategories.includes(subcategory)) {
        continue
      }

      const updated: Category = {
        ...existing,
        subcategories: [...existing.subcategories, subcategory],
      }
      try {
        await setDoc(doc(categoriesRef, existing.id), updated)
      } catch {
        continue
      }
      categoriesByName.set(key, updated)

      const index = nextCategories.findIndex((item) => item.id === existing.id)
      if (index >= 0) {
        nextCategories[index] = updated
      }
    }

    return sortByCreatedAt(nextCategories)
  }

  const loadExpensePageClientFallback = async (
    userId: string,
    pageSize: number,
    reset: boolean,
  ): Promise<{ expenses: Expense[]; hasMore: boolean }> => {
    // Client fallback loads all user expenses once, then slices pages in memory.
    if (reset || clientExpenseCache.length === 0) {
      const fullSnap = await getDocs(query(expensesRef, where('ownerId', '==', userId)))
      clientExpenseCache = fullSnap.docs
        .map((item) => toExpenseWithDocId(item.id, item.data() as Record<string, unknown>))
        .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
      clientExpenseOffset = 0
    }

    const start = clientExpenseOffset
    const end = start + pageSize
    const expenses = clientExpenseCache.slice(start, end)
    clientExpenseOffset = end

    return {
      expenses,
      hasMore: end < clientExpenseCache.length,
    }
  }

  const loadExpensePage = async (
    userId: string,
    options?: { pageSize?: number; reset?: boolean },
  ): Promise<{ expenses: Expense[]; hasMore: boolean }> => {
    const pageSize = options?.pageSize ?? 100

    if (options?.reset) {
      lastExpenseCursor = null
      expensesExhausted = false
      useClientExpensePagination = false
      clientExpenseCache = []
      clientExpenseOffset = 0
    }

    if (!useClientExpensePagination && expensesExhausted) {
      return { expenses: [], hasMore: false }
    }

    if (useClientExpensePagination) {
      return loadExpensePageClientFallback(userId, pageSize, Boolean(options?.reset))
    }

    // Prefer indexed cursor paging; gracefully downgrade while indexes are building.
    const expenseQuery = lastExpenseCursor
      ? query(
          expensesRef,
          where('ownerId', '==', userId),
          orderBy('createdAt', 'desc'),
          startAfter(lastExpenseCursor),
          limit(pageSize),
        )
      : query(expensesRef, where('ownerId', '==', userId), orderBy('createdAt', 'desc'), limit(pageSize))

    try {
      const expensesSnap = await getDocs(expenseQuery)
      const expenses = expensesSnap.docs.map((item) => toExpenseWithDocId(item.id, item.data() as Record<string, unknown>))

      if (expenses.length > 0) {
        lastExpenseCursor = expenses[expenses.length - 1].createdAt
      }

      const hasMore = expenses.length === pageSize
      expensesExhausted = !hasMore

      return {
        expenses,
        hasMore,
      }
    } catch (error) {
      if (!isIndexBuildingError(error)) {
        throw error
      }
      useClientExpensePagination = true
      expensesExhausted = false
      return loadExpensePageClientFallback(userId, pageSize, Boolean(options?.reset))
    }
  }

  return {
    async loadSnapshot(options): Promise<BeaverSnapshot> {
      // Initial read: sites, categories, and first page of expenses in parallel.
      await ensureDefaults(app, defaultSites, defaultCategories)
      const userId = requireUserId(app)
      const [ownedSitesSnap, categoriesSnap, expensesPage] = await Promise.all([
        getDocs(query(sitesRef, where('ownerId', '==', userId))),
        getDocs(query(categoriesRef, where('ownerId', '==', userId))),
        loadExpensePage(userId, { pageSize: options?.pageSize, reset: true }),
      ])
      const sites = ownedSitesSnap.docs.map((item) => toSiteWithDocId(item.id, item.data() as Record<string, unknown>))
      const categories = categoriesSnap.docs.map((item) => item.data() as Category)
      const expenses = expensesPage.expenses

      const syncedCategories = await syncCategoriesFromExpenses(userId, categories).catch(() => sortByCreatedAt(categories))

      return {
        sites: sortByCreatedAt(sites),
        categories: syncedCategories,
        expenses,
        hasMoreExpenses: expensesPage.hasMore,
      }
    },

    async loadMoreExpenses(options) {
      const userId = requireUserId(app)
      const page = await loadExpensePage(userId, { pageSize: options?.pageSize })
      return {
        expenses: page.expenses,
        hasMore: page.hasMore,
      }
    },

    async createSite(payload) {
      const validatedPayload = validateSiteCreatePayload(payload)
      const userId = requireUserId(app)
      const next: Site = {
        ...validatedPayload,
        id: doc(sitesRef).id,
        createdAt: new Date().toISOString(),
        ownerId: userId,
      }
      await setDoc(doc(sitesRef, next.id), next)
      return next
    },

    async updateSite(site) {
      const validatedSite = validateSiteUpdatePayload(site)
      await setDoc(doc(sitesRef, validatedSite.id), validatedSite)
      return validatedSite
    },

    async deleteSite(siteId) {
      // Site delete cascades to linked expenses owned by the current user.
      const userId = requireUserId(app)
      const linkedExpensesSnap = await getDocs(
        query(expensesRef, where('ownerId', '==', userId), where('siteId', '==', siteId)),
      )
      await Promise.allSettled(linkedExpensesSnap.docs.map(async (item) => deleteDoc(item.ref)))

      await deleteDoc(doc(sitesRef, siteId))
    },

    async createCategory(payload) {
      const validatedPayload = validateCategoryCreatePayload(payload)
      const userId = requireUserId(app)
      const next: Category = {
        ...validatedPayload,
        id: doc(categoriesRef).id,
        createdAt: new Date().toISOString(),
        ownerId: userId,
      }
      await setDoc(doc(categoriesRef, next.id), next)
      return next
    },

    async updateCategory(category) {
      const validatedCategory = validateCategoryUpdatePayload(category)
      const userId = requireUserId(app)
      const next: Category = {
        ...validatedCategory,
        ownerId: userId,
      }
      await setDoc(doc(categoriesRef, validatedCategory.id), next)
      return next
    },

    async deleteCategory(categoryId) {
      // Category delete requires removing linked expenses first.
      const userId = requireUserId(app)
      const expensesSnap = await getDocs(query(expensesRef, where('ownerId', '==', userId)))
      const affected = expensesSnap.docs.filter((item) => (item.data() as Expense).categoryId === categoryId)

      const deleteResults = await Promise.allSettled(affected.map(async (item) => deleteDoc(item.ref)))
      const hasExpenseDeleteFailure = deleteResults.some((result) => result.status === 'rejected')

      if (hasExpenseDeleteFailure) {
        throw new Error('Failed to delete all expenses linked to this category due to permissions.')
      }

      await deleteDoc(doc(categoriesRef, categoryId))
    },

    async createExpense(payload: ExpenseInput, receiptFiles?: File[]) {
      const validatedPayload = validateExpenseCreatePayload(payload)
      // Category is resolved from DB to store canonical name/kind in expense rows.
      const userId = requireUserId(app)
      const categorySnap = await getDocs(query(categoriesRef, where('ownerId', '==', userId)))
      const category = categorySnap.docs
        .map((item) => item.data() as Category)
        .find((item) => item.id === validatedPayload.categoryId)

      if (!category) {
        throw new Error('Invalid category selected.')
      }

      const subtotal = computeSubtotal(toUnitAmount(validatedPayload.unit), validatedPayload.unitPrice)
      const computedGstAmount = validatedPayload.gstApplicable ? Number(((subtotal * validatedPayload.gstPercent) / 100).toFixed(2)) : 0
      const computedTotalCost = Number((subtotal + computedGstAmount).toFixed(2))
      const totalCost = Number(((validatedPayload.totalCost > 0 ? validatedPayload.totalCost : computedTotalCost)).toFixed(2))
      const gstAmount = validatedPayload.gstApplicable ? Number(Math.max(totalCost - subtotal, computedGstAmount).toFixed(2)) : 0

      const receipts = await uploadReceipts(storage, userId, receiptFiles ?? [])

      const next = toExpenseDocument({
        ...validatedPayload,
        categoryName: category.name,
        categoryKind: category.kind,
        gstAmount,
        totalCost,
        receipts,
        createdAt: new Date().toISOString(),
        ownerId: userId,
      })

      const saved = await addDoc(expensesRef, next)

      return {
        ...next,
        id: saved.id,
      }
    },

    async updateExpense(payload: ExpenseUpdateInput, receiptFiles?: File[], options?: { removeReceiptUrls?: string[] }) {
      const validatedPayload = validateExpenseUpdatePayload(payload)
      assertNonEmptyId(validatedPayload.id, 'expense')
      const userId = requireUserId(app)
      const categorySnap = await getDocs(query(categoriesRef, where('ownerId', '==', userId)))
      const category = categorySnap.docs
        .map((item) => item.data() as Category)
        .find((item) => item.id === validatedPayload.categoryId)

      if (!category) {
        throw new Error('Invalid category selected.')
      }

      // Existing row is loaded to preserve createdAt and merge retained receipts.
      const expenseRef = doc(expensesRef, validatedPayload.id)
      const expensesSnap = await getDocs(query(expensesRef, where('ownerId', '==', userId)))
      const existing = expensesSnap.docs
        .map((item) => toExpenseWithDocId(item.id, item.data() as Record<string, unknown>))
        .find((item) => item.id === validatedPayload.id)

      if (!existing) {
        throw new Error('Expense not found.')
      }

      const subtotal = computeSubtotal(toUnitAmount(validatedPayload.unit), validatedPayload.unitPrice)
      const computedGstAmount = validatedPayload.gstApplicable ? Number(((subtotal * validatedPayload.gstPercent) / 100).toFixed(2)) : 0
      const computedTotalCost = Number((subtotal + computedGstAmount).toFixed(2))
      const totalCost = Number(((validatedPayload.totalCost > 0 ? validatedPayload.totalCost : computedTotalCost)).toFixed(2))
      const gstAmount = validatedPayload.gstApplicable ? Number(Math.max(totalCost - subtotal, computedGstAmount).toFixed(2)) : 0

      const removedUrlSet = new Set(options?.removeReceiptUrls ?? [])
      const retainedReceipts = (existing.receipts ?? []).filter((receipt) => !removedUrlSet.has(receipt.url))
      const uploadedReceipts = await uploadReceipts(storage, userId, receiptFiles ?? [])
      const receipts = [...retainedReceipts, ...uploadedReceipts]

      const updated = toExpenseDocument({
        date: validatedPayload.date,
        siteId: validatedPayload.siteId,
        categoryId: validatedPayload.categoryId,
        categoryName: category.name,
        categoryKind: category.kind,
        subcategory: validatedPayload.subcategory,
        description: validatedPayload.description,
        unit: validatedPayload.unit,
        unitPrice: validatedPayload.unitPrice,
        totalCost,
        vendorOrContractorName: validatedPayload.vendorOrContractorName,
        gstApplicable: validatedPayload.gstApplicable,
        gstPercent: validatedPayload.gstPercent,
        gstAmount,
        paymentStatus: validatedPayload.paymentStatus,
        paymentMethod: validatedPayload.paymentMethod,
        notes: validatedPayload.notes,
        receipts,
        createdAt: existing.createdAt,
        ownerId: userId,
      })

      await setDoc(expenseRef, updated)
      return { ...updated, id: validatedPayload.id }
    },

    async deleteExpense(expenseId: string) {
      assertNonEmptyId(expenseId, 'expense')
      await deleteDoc(doc(expensesRef, expenseId))
    },
  }
}
