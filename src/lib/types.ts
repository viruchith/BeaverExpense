export type CategoryKind = 'material' | 'labour'

export type PaymentStatus = 'paid' | 'pending' | 'partial'

export type PaymentMethod = 'upi' | 'cash' | 'bank_transfer' | 'cheque' | 'card' | 'other'

export interface ExpenseReceipt {
  url: string
  name: string
  contentType: string
  size: number
  uploadedAt: string
}

export interface Site {
  id: string
  name: string
  location: string
  budget: number
  createdAt: string
  ownerId?: string
}

export interface Category {
  id: string
  name: string
  kind: CategoryKind
  subcategories: string[]
  createdAt: string
  ownerId?: string
}

export interface Expense {
  id: string
  date: string
  siteId: string
  categoryId: string
  categoryName: string
  categoryKind: CategoryKind
  subcategory: string
  description: string
  unit: string
  unitPrice: number
  totalCost: number
  vendorOrContractorName: string
  gstApplicable: boolean
  gstPercent: number
  gstAmount: number
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  notes: string
  receipts?: ExpenseReceipt[]
  createdAt: string
  ownerId?: string
}

export interface ExpenseInput {
  date: string
  siteId: string
  categoryId: string
  subcategory: string
  description: string
  unit: string
  unitPrice: number
  totalCost: number
  vendorOrContractorName: string
  gstApplicable: boolean
  gstPercent: number
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  notes: string
}

export interface ExpenseUpdateInput extends ExpenseInput {
  id: string
}

export interface BeaverSnapshot {
  sites: Site[]
  categories: Category[]
  expenses: Expense[]
  hasMoreExpenses: boolean
}

export interface ExpensePage {
  expenses: Expense[]
  hasMore: boolean
}

export interface BeaverRepository {
  loadSnapshot: (options?: { pageSize?: number }) => Promise<BeaverSnapshot>
  loadMoreExpenses: (options?: { pageSize?: number }) => Promise<ExpensePage>
  createSite: (payload: Omit<Site, 'id' | 'createdAt'>) => Promise<Site>
  updateSite: (site: Site) => Promise<Site>
  deleteSite: (siteId: string) => Promise<void>
  createCategory: (payload: Omit<Category, 'id' | 'createdAt'>) => Promise<Category>
  updateCategory: (category: Category) => Promise<Category>
  deleteCategory: (categoryId: string) => Promise<void>
  createExpense: (payload: ExpenseInput, receiptFiles?: File[]) => Promise<Expense>
  updateExpense: (payload: ExpenseUpdateInput, receiptFiles?: File[], options?: { removeReceiptUrls?: string[] }) => Promise<Expense>
  deleteExpense: (expenseId: string) => Promise<void>
}
