import { useCallback, useEffect, useMemo, useState } from 'react'

import { computeGstAmount, computeSubtotal, sortByDateDesc } from '../lib/calculations'
import { getRepository, isFirebaseMode } from '../lib/repository'
import type { BeaverSnapshot, Category, Expense, ExpenseInput, ExpenseUpdateInput, Site } from '../lib/types'

// Converts unit text input to a safe numeric value for subtotal/GST computations.
const toUnitAmount = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const emptySnapshot: BeaverSnapshot = {
  sites: [],
  categories: [],
  expenses: [],
  hasMoreExpenses: false,
}

export const useExpenseData = (enabled = true) => {
  const DEFAULT_EXPENSE_PAGE_SIZE = 120
  // Repository implementation is selected once (Firestore or local mode).
  const repository = useMemo(() => getRepository(), [])
  const [snapshot, setSnapshot] = useState<BeaverSnapshot>(emptySnapshot)
  const [loading, setLoading] = useState(true)
  const [loadingMoreExpenses, setLoadingMoreExpenses] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Loads the first snapshot for all top-level datasets.
  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const next = await repository.loadSnapshot({ pageSize: DEFAULT_EXPENSE_PAGE_SIZE })
      setSnapshot({ ...next, expenses: sortByDateDesc(next.expenses) })
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load expense data.')
    } finally {
      setLoading(false)
    }
  }, [repository])

  // Fetches the next page for report table infinite loading.
  const loadMoreExpenses = useCallback(async () => {
    if (loadingMoreExpenses || !snapshot.hasMoreExpenses) {
      return
    }

    try {
      setLoadingMoreExpenses(true)
      const nextPage = await repository.loadMoreExpenses({ pageSize: DEFAULT_EXPENSE_PAGE_SIZE })
      setSnapshot((current) => ({
        ...current,
        expenses: sortByDateDesc([...current.expenses, ...nextPage.expenses]),
        hasMoreExpenses: nextPage.hasMore,
      }))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load more expenses.')
    } finally {
      setLoadingMoreExpenses(false)
    }
  }, [loadingMoreExpenses, repository, snapshot.hasMoreExpenses])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void refresh()
  }, [enabled, refresh])

  const createSite = useCallback(
    async (payload: Omit<Site, 'id' | 'createdAt'>, options?: { skipRefresh?: boolean }) => {
      const created = await repository.createSite(payload)
      if (!options?.skipRefresh) {
        await refresh()
      }
      return created
    },
    [refresh, repository],
  )

  const updateSite = useCallback(
    async (site: Site, options?: { skipRefresh?: boolean }) => {
      const updated = await repository.updateSite(site)
      if (!options?.skipRefresh) {
        await refresh()
      }
      return updated
    },
    [refresh, repository],
  )

  const deleteSite = useCallback(
    async (siteId: string) => {
      try {
        await repository.deleteSite(siteId)
        await refresh()
        setError(null)
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete site.')
        throw deleteError
      }
    },
    [refresh, repository],
  )

  const createCategory = useCallback(
    async (payload: Omit<Category, 'id' | 'createdAt'>, options?: { skipRefresh?: boolean }) => {
      const created = await repository.createCategory(payload)
      if (!options?.skipRefresh) {
        await refresh()
      }
      return created
    },
    [refresh, repository],
  )

  const updateCategory = useCallback(
    async (category: Category, options?: { skipRefresh?: boolean }) => {
      const updated = await repository.updateCategory(category)
      if (!options?.skipRefresh) {
        await refresh()
      }
      return updated
    },
    [refresh, repository],
  )

  const deleteCategory = useCallback(
    async (categoryId: string) => {
      try {
        await repository.deleteCategory(categoryId)
        await refresh()
        setError(null)
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete category.')
        throw deleteError
      }
    },
    [refresh, repository],
  )

  const createExpense = useCallback(
    async (payload: ExpenseInput, receiptFiles?: File[], options?: { skipRefresh?: boolean }) => {
      const created = await repository.createExpense(payload, receiptFiles)

      // Insert optimistically so users see new row immediately.
      setSnapshot((current) => ({
        ...current,
        expenses: sortByDateDesc([created, ...current.expenses]),
      }))

      if (!options?.skipRefresh) {
        await refresh()
      }

      setError(null)
      return created
    },
    [refresh, repository],
  )

  const updateExpense = useCallback(
    async (payload: ExpenseUpdateInput, receiptFiles?: File[], options?: { removeReceiptUrls?: string[] }) => {
      const previous = snapshot
      const category = snapshot.categories.find((item) => item.id === payload.categoryId)
      if (!category) {
        throw new Error('Invalid category selected.')
      }

      const subtotal = computeSubtotal(toUnitAmount(payload.unit), payload.unitPrice)
      const gstAmount = computeGstAmount(subtotal, payload.gstPercent, payload.gstApplicable)
      const totalCost = payload.totalCost

      // Build optimistic version first for responsive inline table updates.
      const optimisticExpenses: Expense[] = snapshot.expenses.map((item) =>
        item.id === payload.id
          ? {
              ...item,
              ...payload,
              categoryName: category.name,
              categoryKind: category.kind,
              gstAmount,
              totalCost,
            }
          : item,
      )

      setSnapshot((current) => ({ ...current, expenses: sortByDateDesc(optimisticExpenses) }))

      try {
        const updated = await repository.updateExpense(payload, receiptFiles, options)
        setSnapshot((current) => ({
          ...current,
          expenses: sortByDateDesc(current.expenses.map((item) => (item.id === updated.id ? updated : item))),
        }))
      } catch (updateError) {
        // Roll back to server/local previous state on failure.
        setSnapshot(previous)
        setError(updateError instanceof Error ? updateError.message : 'Failed to update expense.')
        throw updateError
      }
    },
    [repository, snapshot],
  )

  const deleteExpense = useCallback(
    async (expenseId: string) => {
      const previous = snapshot
      // Optimistically remove row and restore if backend delete fails.
      setSnapshot((current) => ({
        ...current,
        expenses: current.expenses.filter((item) => item.id !== expenseId),
      }))

      try {
        await repository.deleteExpense(expenseId)
      } catch (deleteError) {
        setSnapshot(previous)
        setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete expense.')
        throw deleteError
      }
    },
    [repository, snapshot],
  )

  return {
    ...snapshot,
    loading,
    loadingMoreExpenses,
    error,
    isFirebase: isFirebaseMode(),
    refresh,
    createSite,
    updateSite,
    deleteSite,
    createCategory,
    updateCategory,
    deleteCategory,
    createExpense,
    updateExpense,
    deleteExpense,
    loadMoreExpenses,
  }
}
