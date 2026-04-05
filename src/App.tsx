import { zodResolver } from '@hookform/resolvers/zod'
import {
  Building2,
  Download,
  Eye,
  FileBarChart2,
  FileJson,
  ListChecks,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  Receipt,
  Save,
  Tags,
  Trash2,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { z } from 'zod'

import { AuthPanel } from './components/AuthPanel'
import { MeasuredChart } from './components/MeasuredChart'
import beaverLogo from './assets/beaverlogo.webp'
import { useAuth } from './hooks/useAuth'
import { useExpenseData } from './hooks/useExpenseData'
import {
  computeTotalCost,
  filterExpenses,
  groupByCategory,
  groupByMonth,
  splitByKind,
  toMoney,
  totalSpend,
} from './lib/calculations'
import { categoryKey, parseExpenseCsv } from './lib/csvImport'
import { downloadExpenseBundle } from './lib/exports'
import { getFirebaseApp } from './lib/repository'
import {
  assertSafeCsvFile,
  assertSafeReceiptFile,
  sanitizeMultilineText,
  sanitizeText,
} from './lib/security'
import type { CategoryKind, Expense, PaymentMethod, PaymentStatus, Site } from './lib/types'

type AlertTone = 'success' | 'danger'

interface AppAlert {
  id: string
  tone: AlertTone
  message: string
}

type AppView = 'dashboard' | 'expense' | 'categories' | 'sites' | 'reports'

// Primary app sections rendered from a single-page view state.
const navItems: Array<{ view: AppView; label: string; icon: LucideIcon }> = [
  { view: 'dashboard', label: 'Dashboard', icon: ListChecks },
  { view: 'expense', label: 'Expense', icon: Receipt },
  { view: 'categories', label: 'Categories', icon: Tags },
  { view: 'sites', label: 'Sites', icon: Building2 },
  { view: 'reports', label: 'Reports', icon: FileBarChart2 },
]

const optionalText = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .or(z.literal(''))

const optionalNumberInput = (label: string, maxValue: number) =>
  z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined || Number.isNaN(value)) {
        return undefined
      }
      return Number(value)
    },
    z.number().min(0, `${label} cannot be negative.`).max(maxValue, `${label} is too large.`).optional(),
  )

const requiredNumberInput = (label: string, maxValue: number) =>
  z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined || Number.isNaN(value)) {
        return undefined
      }
      return Number(value)
    },
    z.number({ message: `${label} is required.` }).min(0, `${label} cannot be negative.`).max(maxValue, `${label} is too large.`),
  )

const parseUnitValue = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const expenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required'),
  siteId: z.string().min(1, 'Site is required'),
  categoryId: z.string().min(1, 'Category is required'),
  subcategory: z.string().min(1, 'Subcategory is required').max(80, 'Subcategory is too long'),
  description: optionalText(200),
  unit: z
    .string()
    .max(20, 'Unit is too long')
    .refine((value) => value === '' || parseUnitValue(value) >= 0, 'Unit must be 0 or greater'),
  unitPrice: optionalNumberInput('Unit price', 10_000_000),
  totalCost: requiredNumberInput('Total cost', 10_000_000),
  vendorOrContractorName: optionalText(120),
  gstApplicable: z.boolean(),
  gstPercent: requiredNumberInput('GST percentage', 28),
  paymentStatus: z.enum(['paid', 'pending', 'partial']),
  paymentMethod: z.enum(['upi', 'cash', 'bank_transfer', 'cheque', 'card', 'other']),
  notes: optionalText(800),
  receipts: z.instanceof(FileList).optional(),
})

const siteSchema = z.object({
  name: z.string().min(2).max(80),
  location: z.string().min(2).max(120),
  budget: z.preprocess(
    (value) => {
      if (typeof value === 'number') {
        return value
      }
      if (typeof value !== 'string') {
        return Number.NaN
      }
      const cleaned = value.replaceAll(',', '').trim()
      if (cleaned.length === 0) {
        return Number.NaN
      }
      return Number(cleaned)
    },
    z.number({ message: 'Budget must be a valid number.' }).min(0).max(1_000_000_000),
  ),
})

const siteEditSchema = z.object({
  name: z.string().min(2).max(80),
  budget: z.preprocess(
    (value) => {
      if (typeof value === 'number') {
        return value
      }
      if (typeof value !== 'string') {
        return Number.NaN
      }
      const cleaned = value.replaceAll(',', '').trim()
      if (cleaned.length === 0) {
        return Number.NaN
      }
      return Number(cleaned)
    },
    z.number({ message: 'Budget must be a valid number.' }).min(0).max(1_000_000_000),
  ),
})

const categoryCreateSchema = z.object({
  name: z.string().min(2).max(60),
  kind: z.enum(['material', 'labour']),
})

type ExpenseFormValues = z.input<typeof expenseSchema>
type ExpenseFormSubmitValues = z.output<typeof expenseSchema>

const editExpenseSchema = expenseSchema.omit({ receipts: true })
  .extend({ receipts: z.instanceof(FileList).optional() })
type EditExpenseFormValues = z.input<typeof editExpenseSchema>
type EditExpenseFormSubmitValues = z.output<typeof editExpenseSchema>

const paymentStatusOptions: PaymentStatus[] = ['paid', 'pending', 'partial']
const paymentMethodOptions: PaymentMethod[] = ['upi', 'cash', 'bank_transfer', 'cheque', 'card', 'other']
const chartPalette = ['#17684e', '#378166', '#9b3e3b', '#8bd6b6', '#b7c9bb']
const receiptAccept = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.csv,.xls,.xlsx,.doc,.docx,image/*,application/pdf,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const today = new Date().toISOString().slice(0, 10)
const appVersionTag = __APP_VERSION__

function App() {
  const currentYear = new Date().getFullYear()
  const auth = useAuth()
  const canLoadData = !auth.isFirebaseAuthEnabled || Boolean(auth.user)

  const {
    sites,
    categories,
    expenses,
    hasMoreExpenses,
    loading,
    loadingMoreExpenses,
    error,
    isFirebase,
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
    refresh,
  } = useExpenseData(canLoadData)

  // Reports panel filters and row-edit state.
  const [activeView, setActiveView] = useState<AppView>('dashboard')
  const [timelinePreset, setTimelinePreset] = useState<'30d' | '90d' | '365d' | 'all'>('30d')
  const [siteFilter, setSiteFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>('')
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const [removeEditReceiptUrls, setRemoveEditReceiptUrls] = useState<string[]>([])
  const [isMutatingExpense, setIsMutatingExpense] = useState(false)
  const [csvImportStatus, setCsvImportStatus] = useState<string>('')
  const [alerts, setAlerts] = useState<AppAlert[]>([])
  const [importDefaultSiteId, setImportDefaultSiteId] = useState<string>('')
  const [blockingMessage, setBlockingMessage] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState<boolean>(() => window.navigator.onLine)
  const reportLoadTriggerRef = useRef<HTMLDivElement | null>(null)
  const skipEditTotalSyncRef = useRef(false)

  const pushAlert = (tone: AlertTone, message: string): void => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setAlerts((current) => [...current, { id, tone, message }])
    globalThis.setTimeout(() => {
      setAlerts((current) => current.filter((item) => item.id !== id))
    }, 3500)
  }

  const [newSite, setNewSite] = useState({ name: '', location: '', budget: '' })
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null)
  const [editSiteDraft, setEditSiteDraft] = useState({ name: '', budget: '' })
  const [newCategory, setNewCategory] = useState({ name: '', kind: 'material' as CategoryKind })
  const [subcategoryDrafts, setSubcategoryDrafts] = useState<Record<string, string>>({})

  const expenseForm = useForm<ExpenseFormValues, undefined, ExpenseFormSubmitValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: today,
      siteId: '',
      categoryId: '',
      subcategory: '',
      description: '',
      unit: '',
      unitPrice: undefined,
      totalCost: 0,
      vendorOrContractorName: '',
      gstApplicable: true,
      gstPercent: 18,
      paymentStatus: 'pending',
      paymentMethod: 'upi',
      notes: '',
      receipts: undefined,
    },
  })

  const editExpenseForm = useForm<EditExpenseFormValues, undefined, EditExpenseFormSubmitValues>({
    resolver: zodResolver(editExpenseSchema),
    defaultValues: {
      date: today,
      siteId: '',
      categoryId: '',
      subcategory: '',
      description: '',
      unit: '',
      unitPrice: undefined,
      totalCost: 0,
      vendorOrContractorName: '',
      gstApplicable: true,
      gstPercent: 18,
      paymentStatus: 'pending',
      paymentMethod: 'upi',
      notes: '',
    },
  })

  const selectedCategoryId = useWatch({ control: expenseForm.control, name: 'categoryId' })
  const unit = useWatch({ control: expenseForm.control, name: 'unit' })
  const unitPrice = useWatch({ control: expenseForm.control, name: 'unitPrice' })
  const gstApplicable = useWatch({ control: expenseForm.control, name: 'gstApplicable' })
  const gstPercent = useWatch({ control: expenseForm.control, name: 'gstPercent' })
  const editUnit = useWatch({ control: editExpenseForm.control, name: 'unit' })
  const editUnitPrice = useWatch({ control: editExpenseForm.control, name: 'unitPrice' })
  const editGstApplicable = useWatch({ control: editExpenseForm.control, name: 'gstApplicable' })
  const editGstPercent = useWatch({ control: editExpenseForm.control, name: 'gstPercent' })
  const editTotalCost = useWatch({ control: editExpenseForm.control, name: 'totalCost' })

  const unitPriceValue = Number(unitPrice ?? 0)
  const gstPercentValue = Number(gstPercent ?? 0)
  const editUnitPriceValue = Number(editUnitPrice ?? 0)
  const editGstPercentValue = Number(editGstPercent ?? 0)
  const editTotalCostValue = Number(editTotalCost ?? 0)

  const selectedCategory = useMemo(
    () => categories.find((item) => item.id === selectedCategoryId),
    [categories, selectedCategoryId],
  )

  const siteNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    sites.forEach((site) => {
      map[site.id] = site.name
    })
    return map
  }, [sites])

  const editingExpense = useMemo(
    () => (editingExpenseId ? expenses.find((item) => item.id === editingExpenseId) ?? null : null),
    [editingExpenseId, expenses],
  )

  useEffect(() => {
    if (!importDefaultSiteId && sites.length > 0) {
      setImportDefaultSiteId(sites[0].id)
    }
  }, [importDefaultSiteId, sites])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const categoryTotals = useMemo(() => groupByCategory(expenses), [expenses])
  const monthlyTotals = useMemo(() => groupByMonth(expenses), [expenses])
  const kindSplit = useMemo(() => splitByKind(expenses), [expenses])
  const total = useMemo(() => totalSpend(expenses), [expenses])
  const estimatedTotal = computeTotalCost(parseUnitValue(unit ?? '0'), unitPriceValue, gstPercentValue, gstApplicable)
  const editEstimatedTotal = computeTotalCost(
    parseUnitValue(editUnit ?? '0'),
    editUnitPriceValue,
    editGstPercentValue,
    editGstApplicable ?? false,
  )

  useEffect(() => {
    expenseForm.setValue('totalCost', estimatedTotal)
  }, [estimatedTotal, expenseForm, unit, unitPriceValue])

  useEffect(() => {
    if (!editingExpenseId) {
      return
    }
    if (skipEditTotalSyncRef.current) {
      skipEditTotalSyncRef.current = false
      return
    }
    editExpenseForm.setValue('totalCost', editEstimatedTotal)
  }, [editEstimatedTotal, editExpenseForm, editUnit, editUnitPriceValue, editingExpenseId])

  const filteredForReports = useMemo(() => {
    const base = filterExpenses(expenses, {
      siteId: siteFilter || undefined,
      categoryId: categoryFilter || undefined,
      timelinePreset,
    })

    if (!subcategoryFilter) {
      return base
    }

    return base.filter((expense) => expense.subcategory === subcategoryFilter)
  }, [categoryFilter, expenses, siteFilter, subcategoryFilter, timelinePreset])

  const reportSubcategoryOptions = useMemo(() => {
    const sourceCategory = categoryFilter ? categories.find((item) => item.id === categoryFilter) : undefined
    const subcategorySet = new Set<string>()

    if (sourceCategory) {
      sourceCategory.subcategories.forEach((value) => {
        const normalized = value.trim()
        if (normalized) {
          subcategorySet.add(normalized)
        }
      })
    } else {
      categories.forEach((category) => {
        category.subcategories.forEach((value) => {
          const normalized = value.trim()
          if (normalized) {
            subcategorySet.add(normalized)
          }
        })
      })
    }

    expenses
      .filter((expense) => !sourceCategory || expense.categoryId === sourceCategory.id)
      .forEach((expense) => {
        const normalized = expense.subcategory.trim()
        if (normalized) {
          subcategorySet.add(normalized)
        }
      })

    return [...subcategorySet].sort((a, b) => a.localeCompare(b))
  }, [categories, categoryFilter, expenses])

  const reportCategoryTotals = useMemo(() => groupByCategory(filteredForReports), [filteredForReports])
  const reportMonthlyTotals = useMemo(() => groupByMonth(filteredForReports), [filteredForReports])

  useEffect(() => {
    // Enables infinite scroll loading while user is on Reports view.
    if (activeView !== 'reports' || !hasMoreExpenses) {
      return
    }

    const trigger = reportLoadTriggerRef.current
    if (!trigger) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry?.isIntersecting && !loadingMoreExpenses) {
          void loadMoreExpenses()
        }
      },
      {
        root: null,
        rootMargin: '220px 0px',
      },
    )

    observer.observe(trigger)
    return () => observer.disconnect()
  }, [activeView, filteredForReports.length, hasMoreExpenses, loadMoreExpenses, loadingMoreExpenses])

  const reportsHasActiveFilters = siteFilter !== '' || categoryFilter !== '' || subcategoryFilter !== '' || timelinePreset !== '30d'

  useEffect(() => {
    // Preloads remaining pages when filters are active to avoid partial filtered totals.
    if (activeView !== 'reports' || !reportsHasActiveFilters) {
      return
    }
    if (!hasMoreExpenses || loadingMoreExpenses) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadMoreExpenses()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    activeView,
    reportsHasActiveFilters,
    hasMoreExpenses,
    loadingMoreExpenses,
    loadMoreExpenses,
    filteredForReports.length,
  ])

  const spendBySite = useMemo(
    () =>
      sites.map((site) => ({
        name: site.name,
        total: expenses.filter((expense) => expense.siteId === site.id).reduce((sum, item) => sum + item.totalCost, 0),
      })),
    [expenses, sites],
  )

  const onSubmitExpense = expenseForm.handleSubmit(async (values) => {
    try {
      const receiptFiles = values.receipts ? Array.from(values.receipts) : []
      receiptFiles.forEach((file) => assertSafeReceiptFile(file))

      await createExpense(
        {
          date: values.date,
          siteId: values.siteId,
          categoryId: values.categoryId,
          subcategory: sanitizeText(values.subcategory, 80),
          description: sanitizeText(values.description, 200),
          unit: sanitizeText(values.unit, 20),
          unitPrice: values.unitPrice ?? 0,
          totalCost: values.totalCost,
          vendorOrContractorName: sanitizeText(values.vendorOrContractorName, 120),
          gstApplicable: values.gstApplicable,
          gstPercent: values.gstPercent,
          paymentStatus: values.paymentStatus,
          paymentMethod: values.paymentMethod,
          notes: sanitizeMultilineText(values.notes, 800),
        },
        receiptFiles,
      )

      pushAlert('success', 'Expense created successfully.')

      expenseForm.reset({
        date: today,
        siteId: '',
        categoryId: '',
        subcategory: '',
        description: '',
        unit: '',
        totalCost: 0,
        vendorOrContractorName: '',
        notes: '',
        unitPrice: undefined,
        gstApplicable: true,
        gstPercent: 18,
        paymentStatus: 'pending',
        paymentMethod: 'upi',
        receipts: undefined,
      })
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Failed to create expense.'
      setCsvImportStatus(message)
      pushAlert('danger', message)
    }
  })

  const handleCreateSite = async (): Promise<void> => {
    const parsed = siteSchema.safeParse({
      name: sanitizeText(newSite.name, 80),
      location: sanitizeText(newSite.location, 120),
      budget: newSite.budget,
    })
    if (!parsed.success) {
      setCsvImportStatus(parsed.error.issues[0]?.message ?? 'Invalid site values.')
      return
    }

    try {
      await createSite({
        name: parsed.data.name,
        location: parsed.data.location,
        budget: parsed.data.budget,
      })
      setNewSite({ name: '', location: '', budget: '' })
      pushAlert('success', 'Site created successfully.')
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Failed to create site.'
      setCsvImportStatus(message)
      pushAlert('danger', message)
    }
  }

  const handleCreateCategory = async (): Promise<void> => {
    const parsed = categoryCreateSchema.safeParse({
      name: sanitizeText(newCategory.name, 60),
      kind: newCategory.kind,
    })
    if (!parsed.success) {
      setCsvImportStatus(parsed.error.issues[0]?.message ?? 'Invalid category values.')
      return
    }

    await createCategory({
      name: parsed.data.name,
      kind: parsed.data.kind,
      subcategories: [],
    })
    setNewCategory({ name: '', kind: 'material' })
  }

  const addSubcategory = async (categoryId: string): Promise<void> => {
    const category = categories.find((item) => item.id === categoryId)
    const value = sanitizeText(subcategoryDrafts[categoryId] ?? '', 80)

    if (!category || !value) {
      return
    }

    const next = [...new Set([...category.subcategories, value])]
    await updateCategory({ ...category, subcategories: next })
    setSubcategoryDrafts((prev) => ({ ...prev, [categoryId]: '' }))
  }

  const removeSubcategory = async (categoryId: string, subcategory: string): Promise<void> => {
    const category = categories.find((item) => item.id === categoryId)
    if (!category) {
      return
    }
    await updateCategory({
      ...category,
      subcategories: category.subcategories.filter((item) => item !== subcategory),
    })
  }

  const exportCsv = async (): Promise<void> => {
    try {
      setBlockingMessage('Preparing CSV export and bundling receipt images...')
       const app = getFirebaseApp()
       if (!app) {
         throw new Error('Firebase not initialized')
       }
        const result = await downloadExpenseBundle(filteredForReports, siteNameMap, 'csv', app)
      setCsvImportStatus(
        `CSV export ready. Included ${result.receiptCount} receipt image${result.receiptCount === 1 ? '' : 's'}${result.skippedReceiptCount > 0 ? `, skipped ${result.skippedReceiptCount}` : ''}.`,
      )
    } catch (exportError) {
      setCsvImportStatus(exportError instanceof Error ? exportError.message : 'CSV export failed.')
    } finally {
      setBlockingMessage(null)
    }
  }

  const exportJson = async (): Promise<void> => {
    try {
      setBlockingMessage('Preparing JSON export and bundling receipt images...')
       const app = getFirebaseApp()
       if (!app) {
         throw new Error('Firebase not initialized')
       }
       const result = await downloadExpenseBundle(filteredForReports, siteNameMap, 'json', app)
      setCsvImportStatus(
        `JSON export ready. Included ${result.receiptCount} receipt image${result.receiptCount === 1 ? '' : 's'}${result.skippedReceiptCount > 0 ? `, skipped ${result.skippedReceiptCount}` : ''}.`,
      )
    } catch (exportError) {
      setCsvImportStatus(exportError instanceof Error ? exportError.message : 'JSON export failed.')
    } finally {
      setBlockingMessage(null)
    }
  }

  const openEditExpense = (expense: Expense): void => {
    const normalizedCategoryName = expense.categoryName.trim().toLowerCase()
    const resolvedCategoryId =
      (expense.categoryId && categories.some((item) => item.id === expense.categoryId) ? expense.categoryId : undefined)
      ?? categories.find((item) => item.name.trim().toLowerCase() === normalizedCategoryName)?.id
      ?? ''

    setEditingExpenseId(expense.id)
    setRemoveEditReceiptUrls([])
    skipEditTotalSyncRef.current = true
    editExpenseForm.reset({
      date: expense.date,
      siteId: expense.siteId,
      categoryId: resolvedCategoryId,
      subcategory: expense.subcategory,
      description: expense.description,
      unit: parseUnitValue(expense.unit) > 0 ? String(parseUnitValue(expense.unit)) : '',
      unitPrice: expense.unitPrice > 0 ? expense.unitPrice : undefined,
      totalCost: expense.totalCost,
      vendorOrContractorName: expense.vendorOrContractorName,
      gstApplicable: expense.gstApplicable,
      gstPercent: expense.gstPercent,
      paymentStatus: expense.paymentStatus,
      paymentMethod: expense.paymentMethod,
      notes: expense.notes,
      receipts: undefined,
    })

    if (!resolvedCategoryId) {
      setCsvImportStatus(
        `Category "${expense.categoryName}" is missing in DB. Add/import categories first, then retry edit.`,
      )
    }
  }

  const closeEditExpense = (): void => {
    setEditingExpenseId(null)
    setRemoveEditReceiptUrls([])
  }

  const submitEditExpense = editExpenseForm.handleSubmit(async (values) => {
    if (!editingExpenseId) {
      return
    }

    setIsMutatingExpense(true)
    try {
      const receiptFiles = values.receipts ? Array.from(values.receipts) : []
      receiptFiles.forEach((file) => assertSafeReceiptFile(file))

      await updateExpense({
        id: editingExpenseId,
        date: values.date,
        siteId: values.siteId,
        categoryId: values.categoryId,
        subcategory: sanitizeText(values.subcategory, 80),
        description: sanitizeText(values.description, 200),
        unit: sanitizeText(values.unit, 20),
        unitPrice: values.unitPrice ?? 0,
        totalCost: values.totalCost,
        vendorOrContractorName: sanitizeText(values.vendorOrContractorName, 120),
        gstApplicable: values.gstApplicable,
        gstPercent: values.gstPercent,
        paymentStatus: values.paymentStatus,
        paymentMethod: values.paymentMethod,
        notes: sanitizeMultilineText(values.notes, 800),
      }, receiptFiles, { removeReceiptUrls: removeEditReceiptUrls })
      setEditingExpenseId(null)
      setRemoveEditReceiptUrls([])
      pushAlert('success', 'Expense updated successfully.')
      setCsvImportStatus('Expense updated successfully.')
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to update expense.'
      setCsvImportStatus(message)
      pushAlert('danger', message)
    } finally {
      setIsMutatingExpense(false)
    }
  })

  const handleDeleteExpense = async (expenseId: string): Promise<void> => {
    const expense = expenses.find((item) => item.id === expenseId)
    const shouldDelete = window.confirm(
      `Delete expense${expense ? ` for ${expense.date} - ${expense.categoryName}` : ''}? This action cannot be undone.`,
    )
    if (!shouldDelete) {
      return
    }

    setIsMutatingExpense(true)
    try {
      await deleteExpense(expenseId)
      if (editingExpenseId === expenseId) {
        setEditingExpenseId(null)
      }
      pushAlert('danger', 'Expense deleted successfully.')
      setCsvImportStatus('Expense deleted successfully.')
    } catch (deleteError) {
      setCsvImportStatus(deleteError instanceof Error ? deleteError.message : 'Failed to delete expense.')
    } finally {
      setIsMutatingExpense(false)
    }
  }

  const handleDeleteCategory = async (categoryId: string): Promise<void> => {
    try {
      await deleteCategory(categoryId)
    } catch (deleteError) {
      setCsvImportStatus(deleteError instanceof Error ? deleteError.message : 'Failed to delete category.')
    }
  }

  const handleDeleteSite = async (siteId: string, siteName: string): Promise<void> => {
    const typedSiteName = window.prompt(
      `Type the site name to confirm deletion: "${siteName}".\nThis will also delete linked expenses created by you for this site.`,
    )

    if (typedSiteName === null) {
      return
    }

    if (typedSiteName.trim() !== siteName) {
      setCsvImportStatus('Site deletion cancelled. Site name did not match exactly.')
      return
    }

    try {
      await deleteSite(siteId)
      setCsvImportStatus(`Deleted site "${siteName}" successfully.`)
    } catch (deleteError) {
      setCsvImportStatus(deleteError instanceof Error ? deleteError.message : 'Failed to delete site.')
    }
  }

  const openEditSite = (site: Site): void => {
    setEditingSiteId(site.id)
    setEditSiteDraft({
      name: site.name,
      budget: String(site.budget),
    })
  }

  const closeEditSite = (): void => {
    setEditingSiteId(null)
    setEditSiteDraft({ name: '', budget: '' })
  }

  const handleUpdateSite = async (): Promise<void> => {
    if (!editingSiteId) {
      return
    }

    const site = sites.find((item) => item.id === editingSiteId)
    if (!site) {
      setCsvImportStatus('Selected site could not be found.')
      closeEditSite()
      return
    }

    const parsed = siteEditSchema.safeParse({
      name: sanitizeText(editSiteDraft.name, 80),
      budget: editSiteDraft.budget,
    })

    if (!parsed.success) {
      setCsvImportStatus(parsed.error.issues[0]?.message ?? 'Invalid site values.')
      return
    }

    try {
      await updateSite({
        ...site,
        name: parsed.data.name,
        budget: parsed.data.budget,
      })
      pushAlert('success', `Updated site "${parsed.data.name}" successfully.`)
      setCsvImportStatus(`Updated site "${parsed.data.name}" successfully.`)
      closeEditSite()
    } catch (updateError) {
      setCsvImportStatus(updateError instanceof Error ? updateError.message : 'Failed to update site.')
    }
  }

  const handleCsvImport = async (file: File | null): Promise<void> => {
    if (!file) {
      return
    }
    if (!importDefaultSiteId) {
      setCsvImportStatus('Please select a default site for imported rows.')
      return
    }

    try {
      assertSafeCsvFile(file)

      setBlockingMessage('Importing expenses and syncing categories...')
      setCsvImportStatus('Import started...')
      const text = await file.text()
      const parsed = parseExpenseCsv(text, importDefaultSiteId)

      const categoriesByKey = new Map(categories.map((category) => [categoryKey(category.name), category]))
      let createdCount = 0

      // Import path auto-creates missing categories and subcategories from CSV rows.
      for (const row of parsed.rows) {
        const normalizedCategoryName = sanitizeText(row.rawCategoryName, 60)
        const normalizedSubcategory = sanitizeText(row.rawSubcategory, 80)
        const key = categoryKey(normalizedCategoryName)
        let category = categoriesByKey.get(key)

        if (!category) {
          const createdCategory = await createCategory({
            name: normalizedCategoryName,
            kind: row.kindHint,
            subcategories: [normalizedSubcategory],
          }, { skipRefresh: true })
          category = createdCategory
          categoriesByKey.set(key, category)
        }

        if (!category.subcategories.includes(normalizedSubcategory)) {
          const updated = { ...category, subcategories: [...category.subcategories, normalizedSubcategory] }
          const updatedCategory = await updateCategory(updated, { skipRefresh: true })
          category = updatedCategory
          categoriesByKey.set(key, updatedCategory)
        }

        await createExpense({
          ...row.expense,
          categoryId: category.id,
          subcategory: sanitizeText(row.expense.subcategory, 80),
          description: sanitizeText(row.expense.description, 200),
          unit: sanitizeText(row.expense.unit, 20),
          totalCost: row.expense.totalCost,
          vendorOrContractorName: sanitizeText(row.expense.vendorOrContractorName, 120),
          notes: sanitizeMultilineText(row.expense.notes, 800),
        }, undefined, { skipRefresh: true })
        createdCount += 1
      }

      await refresh()

      const previewWarnings = parsed.warnings.slice(0, 10)
      const hiddenWarningCount = Math.max(0, parsed.warnings.length - previewWarnings.length)
      const warningSummary =
        parsed.warnings.length > 0
          ? ` Warnings: ${previewWarnings.join(' ')}${hiddenWarningCount > 0 ? ` (+${hiddenWarningCount} more)` : ''}`
          : ''

      setCsvImportStatus(
        `Imported ${createdCount} rows.${warningSummary}`,
      )
    } catch (importError) {
      setCsvImportStatus(importError instanceof Error ? importError.message : 'CSV import failed.')
    } finally {
      setBlockingMessage(null)
    }
  }

  if (auth.loading) {
    return (
      <div className="min-h-screen bg-surface px-4 py-8">
        <p className="mx-auto max-w-md rounded-xl bg-white px-4 py-3 text-sm shadow-card">Checking authentication...</p>
      </div>
    )
  }

  if (auth.isFirebaseAuthEnabled && !auth.user) {
    return (
      <AuthPanel
        onLogin={auth.login}
        errorMessage={auth.authError}
        diagnostics={auth.authDiagnostics}
      />
    )
  }

  return (
    <div className="min-h-screen bg-surface text-slate-900">
      <header className="sticky top-0 z-40 border-b border-emerald-100/80 bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-3 px-4 py-3 md:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2 md:gap-3">
              <img
                src={beaverLogo}
                alt="Beaver Expense logo"
                className="h-9 w-9 shrink-0 rounded-lg object-contain md:h-10 md:w-10"
              />
              <p className="truncate font-headline text-xl font-extrabold tracking-tight text-primary md:text-2xl">Beaver Expense</p>
            </div>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-outline md:text-xs">
              Construction Expense Tracker · {isFirebase ? 'Firebase' : 'Local Mode'}
            </p>
            <div className="mt-1 inline-flex items-center gap-2 text-[11px] text-outline md:text-xs">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
              {isOnline ? 'Online' : 'Offline'}
            </div>
            {auth.user ? (
              <p className="mt-1 max-w-[14rem] truncate text-[11px] text-outline md:max-w-none md:text-xs">
                Signed in as {auth.user.displayName || auth.user.email}
              </p>
            ) : null}
          </div>
          {auth.user ? (
            <button
              onClick={() => void auth.logout()}
              className="rounded-full bg-white px-3 py-2 text-xs font-semibold shadow-card md:hidden"
            >
              <span className="inline-flex items-center gap-1.5">
                <LogOut size={14} />
                Logout
              </span>
            </button>
          ) : null}
          <div className="hidden items-center gap-2 md:flex">
            <nav className="hidden gap-2 md:flex">
              {navItems.map((item) => (
                <button
                  key={item.view}
                  onClick={() => setActiveView(item.view)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    activeView === item.view ? 'bg-primary text-white' : 'bg-surfaceLow text-slate-700 hover:bg-surfaceContainer'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <item.icon size={15} />
                    {item.label}
                  </span>
                </button>
              ))}
            </nav>
            {auth.user ? (
              <button onClick={() => void auth.logout()} className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-card">
                <span className="inline-flex items-center gap-2">
                  <LogOut size={15} />
                  Logout
                </span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6">
        {alerts.length > 0 ? (
          <div className="fixed right-4 top-20 z-[70] flex w-full max-w-sm flex-col gap-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-md border px-4 py-3 text-sm font-semibold shadow-card ${
                  alert.tone === 'success'
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {alert.message}
              </div>
            ))}
          </div>
        ) : null}
        {error ? <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        {loading ? <p className="rounded-xl bg-white px-4 py-3 shadow-card">Loading data...</p> : null}

        {!loading && activeView === 'dashboard' && (
          // Dashboard: KPI cards + high-level spend visualizations.
          <section className="space-y-6 animate-reveal">
            <div className="grid gap-4 md:grid-cols-3">
              <article className="rounded-2xl bg-white p-5 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-widest text-outline">Total Spend</p>
                <p className="mt-2 text-3xl font-black text-primary">{toMoney(total)}</p>
              </article>
              <article className="rounded-2xl bg-white p-5 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-widest text-outline">Material Spend</p>
                <p className="mt-2 text-3xl font-black text-primaryContainer">{toMoney(kindSplit.material)}</p>
              </article>
              <article className="rounded-2xl bg-white p-5 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-widest text-outline">Labour Spend</p>
                <p className="mt-2 text-3xl font-black text-tertiary">{toMoney(kindSplit.labour)}</p>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="min-w-0 rounded-2xl bg-white p-5 shadow-card">
                <h2 className="font-headline text-xl font-bold">Spend by Category</h2>
                <MeasuredChart className="mt-4 h-72 min-w-0" minHeight={220}>
                  {({ width, height }) => (
                    <PieChart width={width} height={height}>
                      <Pie data={categoryTotals} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={100}>
                        {categoryTotals.map((_, index) => (
                          <Cell key={`cat-cell-${index}`} fill={chartPalette[index % chartPalette.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => toMoney(Number(value ?? 0))} />
                    </PieChart>
                  )}
                </MeasuredChart>
              </article>

              <article className="min-w-0 rounded-2xl bg-white p-5 shadow-card">
                <h2 className="font-headline text-xl font-bold">Spend by Site</h2>
                <MeasuredChart className="mt-4 h-72 min-w-0" minHeight={220}>
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={spendBySite}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#d9e6dd" />
                      <XAxis dataKey="name" hide />
                      <YAxis tickFormatter={(value) => `₹${value / 1000}k`} />
                      <Tooltip formatter={(value) => toMoney(Number(value ?? 0))} />
                      <Bar dataKey="total" fill="#17684e" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  )}
                </MeasuredChart>
              </article>
            </div>

            <article className="min-w-0 rounded-2xl bg-white p-5 shadow-card">
              <h2 className="font-headline text-xl font-bold">Timeline</h2>
              <MeasuredChart className="mt-4 h-72 min-w-0" minHeight={220}>
                {({ width, height }) => (
                  <LineChart width={width} height={height} data={monthlyTotals}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d9e6dd" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(value) => `₹${value / 1000}k`} />
                    <Tooltip formatter={(value) => toMoney(Number(value ?? 0))} />
                    <Line type="monotone" dataKey="total" stroke="#17684e" strokeWidth={3} dot={{ r: 3 }} />
                  </LineChart>
                )}
              </MeasuredChart>
            </article>
          </section>
        )}

        {!loading && activeView === 'expense' && (
          // Expense form: validated transaction entry with optional receipts.
          <section className="animate-reveal">
            <h2 className="font-headline text-2xl font-bold">New Expense Entry</h2>
            <form onSubmit={onSubmitExpense} className="mt-4 space-y-4 rounded-2xl bg-white p-5 shadow-card">
              <div className="grid gap-4 md:grid-cols-3">
                <label className="text-sm font-medium">
                  Date <span className="text-red-600">*</span>
                  <input type="date" className="mt-1 w-full rounded-xl" {...expenseForm.register('date')} required />
                </label>
                <label className="text-sm font-medium">
                  Site <span className="text-red-600">*</span>
                  <select className="mt-1 w-full rounded-xl" {...expenseForm.register('siteId')} required>
                    <option value="">Select site</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Category <span className="text-red-600">*</span>
                  <select className="mt-1 w-full rounded-xl" {...expenseForm.register('categoryId')} required>
                    <option value="">Select category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="text-sm font-medium">
                  Subcategory <span className="text-red-600">*</span>
                  <select className="mt-1 w-full rounded-xl" {...expenseForm.register('subcategory')} required>
                    <option value="">Select subcategory</option>
                    {(selectedCategory?.subcategories ?? []).map((subcategory) => (
                      <option key={subcategory} value={subcategory}>
                        {subcategory}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Vendor / Contractor Name <span className="text-outline">(optional)</span>
                  <input className="mt-1 w-full rounded-xl" {...expenseForm.register('vendorOrContractorName')} />
                </label>
                <label className="text-sm font-medium">
                  Description <span className="text-outline">(optional)</span>
                  <input className="mt-1 w-full rounded-xl" {...expenseForm.register('description')} />
                </label>
              </div>

              <div className="grid gap-4 rounded-2xl bg-surfaceLow p-4 md:grid-cols-5">
                <label className="text-sm font-medium">
                  Unit <span className="text-outline">(optional)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="mt-1 w-full rounded-xl"
                    {...expenseForm.register('unit')}
                  />
                </label>
                <label className="text-sm font-medium">
                  Unit Price (₹) <span className="text-outline">(optional)</span>
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 w-full rounded-xl"
                    {...expenseForm.register('unitPrice', { setValueAs: (value) => (value === '' ? undefined : Number(value)) })}
                  />
                </label>
                <label className="text-sm font-medium">
                  Total Cost (₹) <span className="text-red-600">*</span>
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 w-full rounded-xl"
                    {...expenseForm.register('totalCost', { setValueAs: (value) => (value === '' ? undefined : Number(value)) })}
                    required
                  />
                </label>
                <label className="text-sm font-medium">
                  GST % <span className="text-red-600">*</span>
                  <input
                    type="number"
                    className="mt-1 w-full rounded-xl"
                    {...expenseForm.register('gstPercent', { setValueAs: (value) => (value === '' ? undefined : Number(value)) })}
                    required
                  />
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm font-medium">
                  <input type="checkbox" className="rounded" {...expenseForm.register('gstApplicable')} /> GST Applicable
                </label>
                <div className="md:col-span-5">
                  <p className="text-sm text-outline">Calculated Amount (Unit × Unit Price + GST)</p>
                  <p className="text-2xl font-black text-primary">{toMoney(estimatedTotal)}</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="text-sm font-medium">
                  Payment Status <span className="text-red-600">*</span>
                  <select className="mt-1 w-full rounded-xl" {...expenseForm.register('paymentStatus')} required>
                    {paymentStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Payment Method <span className="text-red-600">*</span>
                  <select className="mt-1 w-full rounded-xl" {...expenseForm.register('paymentMethod')} required>
                    {paymentMethodOptions.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Receipts <span className="text-outline">(optional, multiple)</span>
                  <input type="file" multiple accept={receiptAccept} className="mt-1 w-full rounded-xl" {...expenseForm.register('receipts')} />
                  <p className="mt-1 text-xs text-outline">Max 10MB per file. Allowed: images, PDF, CSV, XLS/XLSX, DOC/DOCX.</p>
                </label>
              </div>

              <label className="text-sm font-medium">
                Notes <span className="text-outline">(optional)</span>
                <textarea className="mt-1 w-full rounded-xl" rows={3} {...expenseForm.register('notes')} />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className="rounded-xl bg-primary px-5 py-3 font-bold text-white hover:bg-primaryContainer">
                  <span className="inline-flex items-center gap-2">
                    <Save size={16} />
                    Save Expense
                  </span>
                </button>
                {Object.values(expenseForm.formState.errors).length > 0 ? (
                  <p className="text-sm text-red-600">Please correct the highlighted form fields.</p>
                ) : null}
              </div>
            </form>
          </section>
        )}

        {!loading && activeView === 'categories' && (
          // Category admin: create/remove categories and manage subcategories.
          <section className="space-y-5 animate-reveal">
            <h2 className="font-headline text-2xl font-bold">Category Management</h2>

            <div className="grid gap-3 rounded-2xl bg-white p-4 shadow-card md:grid-cols-3">
              <label className="text-sm font-medium">
                Category Name <span className="text-red-600">*</span>
                <input
                  value={newCategory.name}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, name: event.target.value }))}
                  className="mt-1 w-full rounded-xl"
                  placeholder="New category name"
                  required
                />
              </label>
              <label className="text-sm font-medium">
                Category Kind <span className="text-red-600">*</span>
                <select
                  value={newCategory.kind}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, kind: event.target.value as CategoryKind }))}
                  className="mt-1 w-full rounded-xl"
                  required
                >
                  <option value="material">Material</option>
                  <option value="labour">Labour</option>
                </select>
              </label>
              <button onClick={() => void handleCreateCategory()} className="rounded-xl bg-primary px-4 py-2 font-semibold text-white">
                <span className="inline-flex items-center gap-2">
                  <Plus size={16} />
                  Add Category
                </span>
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {categories.map((category) => (
                <article key={category.id} className="rounded-2xl bg-white p-4 shadow-card">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="font-headline text-lg font-bold">{category.name}</h3>
                      <p className="text-xs uppercase tracking-widest text-outline">{category.kind}</p>
                    </div>
                    <button
                      onClick={() => void handleDeleteCategory(category.id)}
                      className="rounded-lg bg-red-50 px-3 py-1 text-sm font-semibold text-red-700"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Trash2 size={14} />
                        Delete
                      </span>
                    </button>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-2">
                    {category.subcategories.map((subcategory) => (
                      <button
                        key={subcategory}
                        onClick={() => void removeSubcategory(category.id, subcategory)}
                        className="rounded-full bg-surfaceLow px-3 py-1 text-xs font-semibold text-slate-700"
                      >
                        {subcategory} ×
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={subcategoryDrafts[category.id] ?? ''}
                      onChange={(event) =>
                        setSubcategoryDrafts((prev) => ({ ...prev, [category.id]: event.target.value }))
                      }
                      className="w-full rounded-xl"
                      placeholder="Add subcategory"
                      required
                    />
                    <button
                      onClick={() => void addSubcategory(category.id)}
                      className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Plus size={14} />
                        Add
                      </span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {!loading && activeView === 'sites' && (
          // Site admin: budget tracking and site-level removal.
          <section className="space-y-5 animate-reveal">
            <h2 className="font-headline text-2xl font-bold">Site Management</h2>

            <div className="grid gap-3 rounded-2xl bg-white p-4 shadow-card md:grid-cols-4">
              <label className="text-sm font-medium">
                Site Name <span className="text-red-600">*</span>
                <input
                  value={newSite.name}
                  onChange={(event) => setNewSite((prev) => ({ ...prev, name: event.target.value }))}
                  className="mt-1 w-full rounded-xl"
                  placeholder="Site name"
                  required
                />
              </label>
              <label className="text-sm font-medium">
                Location <span className="text-red-600">*</span>
                <input
                  value={newSite.location}
                  onChange={(event) => setNewSite((prev) => ({ ...prev, location: event.target.value }))}
                  className="mt-1 w-full rounded-xl"
                  placeholder="Location"
                  required
                />
              </label>
              <label className="text-sm font-medium">
                Budget <span className="text-red-600">*</span>
                <input
                  type="text"
                  value={newSite.budget}
                  onChange={(event) => setNewSite((prev) => ({ ...prev, budget: event.target.value }))}
                  className="mt-1 w-full rounded-xl"
                  placeholder="Budget (e.g. 250000 or 2,50,000)"
                  required
                />
              </label>
              <button onClick={() => void handleCreateSite()} className="rounded-xl bg-primary px-4 py-2 font-semibold text-white">
                <span className="inline-flex items-center gap-2">
                  <Plus size={16} />
                  Add Site
                </span>
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {sites.map((site) => {
                const spent = expenses
                  .filter((expense) => expense.siteId === site.id)
                  .reduce((sum, item) => sum + item.totalCost, 0)
                const progress = site.budget > 0 ? Math.min(100, (spent / site.budget) * 100) : 0

                return (
                  <article key={site.id} className="rounded-2xl bg-white p-5 shadow-card">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-headline text-lg font-bold">{site.name}</h3>
                        <p className="text-sm text-outline">{site.location}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditSite(site)}
                          className="rounded-lg bg-surfaceLow px-3 py-1 text-sm font-semibold"
                        >
                          <span className="inline-flex items-center gap-1">
                            <Pencil size={14} />
                            Edit
                          </span>
                        </button>
                        <button
                          onClick={() => void handleDeleteSite(site.id, site.name)}
                          className="rounded-lg bg-red-50 px-3 py-1 text-sm font-semibold text-red-700"
                        >
                          <span className="inline-flex items-center gap-1">
                            <Trash2 size={14} />
                            Delete
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 space-y-1">
                      <p className="text-sm text-outline">Spent: {toMoney(spent)}</p>
                      <p className="text-sm text-outline">Budget: {toMoney(site.budget)}</p>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surfaceLow">
                        <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>

            {editingSiteId ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-3 py-6">
                <article className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-card">
                  <div className="flex items-center justify-between">
                    <h3 className="font-headline text-lg font-bold">Edit Site</h3>
                    <button
                      type="button"
                      onClick={closeEditSite}
                      className="rounded-lg bg-surfaceLow px-3 py-1 text-sm font-semibold"
                    >
                      Close
                    </button>
                  </div>

                  <div className="mt-4 space-y-4">
                    <label className="text-sm font-medium">
                      Site Name <span className="text-red-600">*</span>
                      <input
                        value={editSiteDraft.name}
                        onChange={(event) => setEditSiteDraft((prev) => ({ ...prev, name: event.target.value }))}
                        className="mt-1 w-full rounded-xl"
                        placeholder="Site name"
                        required
                      />
                    </label>

                    <label className="text-sm font-medium">
                      Budget <span className="text-red-600">*</span>
                      <input
                        type="text"
                        value={editSiteDraft.budget}
                        onChange={(event) => setEditSiteDraft((prev) => ({ ...prev, budget: event.target.value }))}
                        className="mt-1 w-full rounded-xl"
                        placeholder="Budget (e.g. 250000 or 2,50,000)"
                        required
                      />
                    </label>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleUpdateSite()}
                        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Save size={15} />
                          Save Changes
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={closeEditSite}
                        className="rounded-xl bg-surfaceLow px-4 py-2 text-sm font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            ) : null}
          </section>
        )}

        {!loading && activeView === 'reports' && (
          // Reports hub: filters, charts, import/export, and transaction grid.
          <section className="space-y-5 animate-reveal">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="font-headline text-2xl font-bold">Reports & Export</h2>
              <div className="flex gap-2">
                <button onClick={exportCsv} className="rounded-xl bg-white px-4 py-2 font-semibold shadow-card">
                  <span className="inline-flex items-center gap-2">
                    <Download size={16} />
                    Export CSV
                  </span>
                </button>
                <button onClick={exportJson} className="rounded-xl bg-primary px-4 py-2 font-semibold text-white">
                  <span className="inline-flex items-center gap-2">
                    <FileJson size={16} />
                    Export JSON
                  </span>
                </button>
              </div>
            </div>

            <div className="grid gap-3 rounded-2xl bg-white p-4 shadow-card md:grid-cols-[1fr_1fr_auto]">
              <select value={importDefaultSiteId} onChange={(event) => setImportDefaultSiteId(event.target.value)}>
                <option value="">Choose default site for import</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
              <input
                type="file"
                accept=".csv,text/csv,.txt"
                onChange={(event) => {
                  const file = event.target.files?.item(0) ?? null
                  void handleCsvImport(file)
                  event.currentTarget.value = ''
                }}
              />
              <p className="self-center text-xs text-outline">Import from Excel CSV</p>
            </div>
            {csvImportStatus ? <p className="text-sm text-outline">{csvImportStatus}</p> : null}

            <div className="grid gap-3 rounded-2xl bg-white p-4 shadow-card md:grid-cols-4">
              <select value={timelinePreset} onChange={(event) => setTimelinePreset(event.target.value as typeof timelinePreset)}>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="365d">Last 365 days</option>
                <option value="all">All Time</option>
              </select>
              <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
                <option value="">All sites</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <select value={subcategoryFilter} onChange={(event) => setSubcategoryFilter(event.target.value)}>
                <option value="">All subcategories</option>
                {reportSubcategoryOptions.map((subcategory) => (
                  <option key={subcategory} value={subcategory}>
                    {subcategory}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="min-w-0 rounded-2xl bg-white p-5 shadow-card">
                <h3 className="font-headline text-lg font-bold">Filtered Category Split</h3>
                <MeasuredChart className="mt-4 h-72 min-w-0" minHeight={220}>
                  {({ width, height }) => (
                    <PieChart width={width} height={height}>
                      <Pie data={reportCategoryTotals} dataKey="total" nameKey="name" outerRadius={95}>
                        {reportCategoryTotals.map((_, index) => (
                          <Cell key={`report-cell-${index}`} fill={chartPalette[index % chartPalette.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => toMoney(Number(value ?? 0))} />
                    </PieChart>
                  )}
                </MeasuredChart>
              </article>

              <article className="min-w-0 rounded-2xl bg-white p-5 shadow-card">
                <h3 className="font-headline text-lg font-bold">Filtered Timeline</h3>
                <MeasuredChart className="mt-4 h-72 min-w-0" minHeight={220}>
                  {({ width, height }) => (
                    <LineChart width={width} height={height} data={reportMonthlyTotals}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#d9e6dd" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(value) => `₹${value / 1000}k`} />
                      <Tooltip formatter={(value) => toMoney(Number(value ?? 0))} />
                      <Line type="monotone" dataKey="total" stroke="#17684e" strokeWidth={3} dot={{ r: 3 }} />
                    </LineChart>
                  )}
                </MeasuredChart>
              </article>
            </div>

            <article className="overflow-hidden rounded-2xl bg-white shadow-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="font-headline text-lg font-bold">Transactions</h3>
                <p className="text-sm text-outline">
                  {filteredForReports.length} rows
                  {hasMoreExpenses ? ' (more available)' : ''}
                </p>
              </div>
              <div className="overflow-x-auto">
                {/* Wide table is intentionally scrollable on mobile for full column access. */}
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-surfaceLow text-xs uppercase tracking-widest text-outline">
                    <tr>
                      <th className="px-4 py-3">Actions</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Site</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Subcategory</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Unit</th>
                      <th className="px-4 py-3 text-right">Unit Price</th>
                      <th className="px-4 py-3 text-right">Total Cost</th>
                      <th className="px-4 py-3">Vendor</th>
                      <th className="px-4 py-3">GST</th>
                      <th className="px-4 py-3">GST %</th>
                      <th className="px-4 py-3">GST Amount</th>
                      <th className="px-4 py-3">Payment Status</th>
                      <th className="px-4 py-3">Payment Method</th>
                      <th className="px-4 py-3">Notes</th>
                      <th className="px-4 py-3">Receipts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredForReports.map((expense) => (
                      <tr key={expense.id} className="border-t">
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => openEditExpense(expense)}
                              className="rounded-lg bg-surfaceLow px-3 py-1 text-xs font-semibold"
                            >
                              <span className="inline-flex items-center gap-1">
                                <Pencil size={13} />
                                Edit
                              </span>
                            </button>
                            <button
                              onClick={() => void handleDeleteExpense(expense.id)}
                              disabled={isMutatingExpense}
                              className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                            >
                              <span className="inline-flex items-center gap-1">
                                <Trash2 size={13} />
                                Delete
                              </span>
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">{expense.date}</td>
                        <td className="px-4 py-3">{siteNameMap[expense.siteId] ?? 'Unknown Site'}</td>
                        <td className="px-4 py-3">{expense.categoryName}</td>
                        <td className="px-4 py-3">{expense.subcategory}</td>
                        <td className="px-4 py-3">{expense.description}</td>
                        <td className="px-4 py-3">{expense.unit}</td>
                        <td className="px-4 py-3 text-right">{toMoney(expense.unitPrice)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{toMoney(expense.totalCost)}</td>
                        <td className="px-4 py-3 text-xs">{expense.vendorOrContractorName}</td>
                        <td className="px-4 py-3 text-center">{expense.gstApplicable ? 'Yes' : 'No'}</td>
                        <td className="px-4 py-3 text-right">{expense.gstPercent}%</td>
                        <td className="px-4 py-3 text-right">{toMoney(expense.gstAmount)}</td>
                        <td className="px-4 py-3 text-xs">{expense.paymentStatus}</td>
                        <td className="px-4 py-3 text-xs">{expense.paymentMethod}</td>
                        <td className="px-4 py-3 text-xs max-w-48 truncate">{expense.notes}</td>
                        <td className="px-4 py-3 text-center">
                          {expense.receipts && expense.receipts.length > 0 ? (
                            <span className="inline-block rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">
                              {expense.receipts.length}
                            </span>
                          ) : (
                            <span className="text-xs text-outline">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div ref={reportLoadTriggerRef} className="border-t px-4 py-3 text-center text-sm text-outline">
                {loadingMoreExpenses
                  ? 'Loading more expenses...'
                  : hasMoreExpenses
                    ? reportsHasActiveFilters
                      ? 'Loading remaining pages for accurate filtered report...'
                      : 'Scroll to load more'
                    : 'All available expenses loaded'}
              </div>
            </article>

            {editingExpenseId ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-3 py-6">
                <article className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-card">
                  <div className="flex items-center justify-between">
                    <h3 className="font-headline text-lg font-bold">Edit Expense</h3>
                    <button
                      type="button"
                      onClick={closeEditExpense}
                      className="rounded-lg bg-surfaceLow px-3 py-1 text-sm font-semibold"
                    >
                      Close
                    </button>
                  </div>

                  <form onSubmit={submitEditExpense} className="mt-4 grid gap-3 md:grid-cols-3">
                    <label className="text-sm font-medium">
                      Date <span className="text-red-600">*</span>
                      <input className="mt-1 w-full rounded-xl" type="date" {...editExpenseForm.register('date')} required />
                    </label>
                    <label className="text-sm font-medium">
                      Site <span className="text-red-600">*</span>
                      <select className="mt-1 w-full rounded-xl" {...editExpenseForm.register('siteId')} required>
                        <option value="">Select site</option>
                        {sites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-medium">
                      Category <span className="text-red-600">*</span>
                      <select className="mt-1 w-full rounded-xl" {...editExpenseForm.register('categoryId')} required>
                        <option value="">Select category</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-medium">
                      Subcategory <span className="text-red-600">*</span>
                      <input className="mt-1 w-full rounded-xl" placeholder="Subcategory" {...editExpenseForm.register('subcategory')} required />
                    </label>
                    <label className="text-sm font-medium">
                      Description <span className="text-outline">(optional)</span>
                      <input className="mt-1 w-full rounded-xl" placeholder="Description" {...editExpenseForm.register('description')} />
                    </label>
                    <label className="text-sm font-medium">
                      Vendor / Contractor <span className="text-outline">(optional)</span>
                      <input className="mt-1 w-full rounded-xl" placeholder="Vendor" {...editExpenseForm.register('vendorOrContractorName')} />
                    </label>
                    <label className="text-sm font-medium">
                      Unit <span className="text-outline">(optional)</span>
                      <input
                        className="mt-1 w-full rounded-xl"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Unit"
                        {...editExpenseForm.register('unit')}
                      />
                    </label>
                    <label className="text-sm font-medium">
                      Unit Price <span className="text-outline">(optional)</span>
                      <input
                        className="mt-1 w-full rounded-xl"
                        type="number"
                        step="0.01"
                        placeholder="Unit Price"
                        {...editExpenseForm.register('unitPrice', { setValueAs: (value) => (value === '' ? undefined : Number(value)) })}
                      />
                    </label>
                    <label className="text-sm font-medium">
                      Total Cost (₹) <span className="text-red-600">*</span>
                      <input
                        className="mt-1 w-full rounded-xl"
                        type="number"
                        step="0.01"
                        placeholder="Total Cost"
                        {...editExpenseForm.register('totalCost', { setValueAs: (value) => (value === '' ? undefined : Number(value)) })}
                        required
                      />
                    </label>
                    <label className="flex items-center gap-2 pt-6 text-sm font-medium">
                      <input type="checkbox" {...editExpenseForm.register('gstApplicable')} /> GST Applicable
                    </label>
                    <div className="rounded-xl bg-surfaceLow px-4 py-3 md:col-span-3">
                      <p className="text-sm text-outline">Calculated Amount (Unit × Unit Price + GST)</p>
                      <p className="text-2xl font-black text-primary">{toMoney(editEstimatedTotal)}</p>
                      <p className="mt-1 text-sm text-outline">Editable Total Cost: {toMoney(editTotalCostValue)}</p>
                    </div>
                    <label className="text-sm font-medium">
                      GST % <span className="text-red-600">*</span>
                      <input
                        className="mt-1 w-full rounded-xl"
                        type="number"
                        placeholder="GST %"
                        {...editExpenseForm.register('gstPercent', { setValueAs: (value) => (value === '' ? undefined : Number(value)) })}
                        required
                      />
                    </label>
                    <label className="text-sm font-medium">
                      Payment Status <span className="text-red-600">*</span>
                      <select className="mt-1 w-full rounded-xl" {...editExpenseForm.register('paymentStatus')} required>
                        {paymentStatusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-medium">
                      Payment Method <span className="text-red-600">*</span>
                      <select className="mt-1 w-full rounded-xl" {...editExpenseForm.register('paymentMethod')} required>
                        {paymentMethodOptions.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-medium md:col-span-3">
                      Notes <span className="text-outline">(optional)</span>
                      <textarea className="mt-1 w-full rounded-xl" rows={3} placeholder="Notes" {...editExpenseForm.register('notes')} />
                    </label>

                    <div className="rounded-xl bg-surfaceLow p-3 md:col-span-3">
                      <p className="text-sm font-medium">
                        Receipts <span className="text-outline">(optional)</span>
                      </p>
                      {editingExpense?.receipts && editingExpense.receipts.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          {editingExpense.receipts.map((receipt) => (
                            <div key={receipt.url} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                              <a
                                href={receipt.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 text-sm font-semibold text-primary"
                              >
                                <Eye size={14} />
                                {receipt.name}
                              </a>
                              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={removeEditReceiptUrls.includes(receipt.url)}
                                  onChange={(event) => {
                                    setRemoveEditReceiptUrls((current) =>
                                      event.target.checked
                                        ? [...current, receipt.url]
                                        : current.filter((url) => url !== receipt.url),
                                    )
                                  }}
                                />
                                Remove
                              </label>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-outline">No receipt uploaded for this expense.</p>
                      )}

                      <label className="mt-3 block text-sm font-medium">
                        Upload New Receipts <span className="text-outline">(optional, multiple)</span>
                        <input type="file" multiple accept={receiptAccept} className="mt-1 w-full rounded-xl" {...editExpenseForm.register('receipts')} />
                        <p className="mt-1 text-xs text-outline">Max 10MB per file. Allowed: images, PDF, CSV, XLS/XLSX, DOC/DOCX.</p>
                      </label>
                    </div>

                    <div className="md:col-span-3 flex gap-2">
                      <button
                        type="submit"
                        disabled={isMutatingExpense}
                        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Save size={15} />
                          Save Changes
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={closeEditExpense}
                        className="rounded-xl bg-surfaceLow px-4 py-2 text-sm font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </article>
              </div>
            ) : null}
          </section>
        )}
      </main>

      <footer className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 pb-24 text-xs text-outline md:pb-6">
        <p>Version {appVersionTag}</p>
        <p>Copyright {currentYear} @ viruchith</p>
      </footer>

      {blockingMessage ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 px-4">
          <div className="flex max-w-md items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-card">
            <LoaderCircle className="animate-spin text-primary" size={20} />
            <div>
              <p className="text-sm font-semibold text-slate-900">Please wait</p>
              <p className="text-sm text-outline">{blockingMessage}</p>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="fixed bottom-0 left-0 right-0 border-t border-emerald-100 bg-white/95 px-2 py-2 backdrop-blur md:hidden">
        {/* Mobile bottom navigation for quick section switching. */}
        <div className="grid grid-cols-5 gap-1">
          {navItems.map((item) => (
            <button
              key={item.view}
              onClick={() => setActiveView(item.view)}
              className={`rounded-lg px-2 py-2 text-xs font-semibold ${
                activeView === item.view ? 'bg-primary text-white' : 'text-slate-600'
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <item.icon size={13} />
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

export default App
