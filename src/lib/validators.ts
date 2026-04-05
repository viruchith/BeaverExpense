import { z } from 'zod'

import { sanitizeMultilineText, sanitizeText } from './security'
import type { Category, ExpenseInput, ExpenseUpdateInput, Site } from './types'

const MAX_BUDGET = 1_000_000_000
const MAX_MONEY = 1_000_000_000

const parseFiniteNumber = (value: unknown, fieldName: string): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a valid number.`)
  }
  return parsed
}

const parseNonNegativeNumber = (value: unknown, fieldName: string, maxValue: number): number => {
  const parsed = parseFiniteNumber(value, fieldName)
  if (parsed < 0 || parsed > maxValue) {
    throw new Error(`${fieldName} must be between 0 and ${maxValue}.`)
  }
  return parsed
}

const idSchema = z.string().trim().min(1).max(128)

const siteCreateSchema = z.object({
  name: z.string().min(2).max(80),
  location: z.string().min(2).max(120),
  budget: z.number().min(0).max(MAX_BUDGET),
  ownerId: z.string().trim().min(1).max(128).optional(),
})

const siteUpdateSchema = z.object({
  id: idSchema,
  name: z.string().min(2).max(80),
  location: z.string().min(2).max(120),
  budget: z.number().min(0).max(MAX_BUDGET),
  createdAt: z.string().trim().min(1),
  ownerId: z.string().trim().min(1).max(128).optional(),
})

const categoryCreateSchema = z.object({
  name: z.string().min(2).max(60),
  kind: z.enum(['material', 'labour']),
  subcategories: z.array(z.string().min(1).max(80)).max(200),
  ownerId: z.string().trim().min(1).max(128).optional(),
})

const categoryUpdateSchema = z.object({
  id: idSchema,
  name: z.string().min(2).max(60),
  kind: z.enum(['material', 'labour']),
  subcategories: z.array(z.string().min(1).max(80)).max(200),
  createdAt: z.string().trim().min(1),
  ownerId: z.string().trim().min(1).max(128).optional(),
})

const expenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  siteId: idSchema,
  categoryId: idSchema,
  subcategory: z.string().min(1).max(80),
  description: z.string().max(200),
  unit: z.string().max(20),
  unitPrice: z.number().min(0).max(MAX_MONEY),
  totalCost: z.number().min(0).max(MAX_MONEY),
  vendorOrContractorName: z.string().max(120),
  gstApplicable: z.boolean(),
  gstPercent: z.number().min(0).max(28),
  paymentStatus: z.enum(['paid', 'pending', 'partial']),
  paymentMethod: z.enum(['upi', 'cash', 'bank_transfer', 'cheque', 'card', 'other']),
  notes: z.string().max(800),
})

const expenseUpdateSchema = expenseSchema.extend({
  id: idSchema,
})

const normalizeSubcategories = (subcategories: string[]): string[] =>
  Array.from(new Set(subcategories.map((value) => sanitizeText(value, 80)).filter((value) => value.length > 0)))

const assertUnitValue = (unit: string): void => {
  if (!unit) {
    return
  }
  const parsed = Number(unit)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_MONEY) {
    throw new Error('Unit must be a valid non-negative number.')
  }
}

export const validateEntityId = (id: string, entityName: string): string => {
  const parsed = idSchema.safeParse(id)
  if (!parsed.success) {
    throw new Error(`Invalid ${entityName} id.`)
  }
  return parsed.data
}

export const validateSiteCreatePayload = (payload: Omit<Site, 'id' | 'createdAt'>): Omit<Site, 'id' | 'createdAt'> => {
  const normalized = {
    ...payload,
    name: sanitizeText(payload.name, 80),
    location: sanitizeText(payload.location, 120),
    budget: parseNonNegativeNumber(payload.budget, 'Budget', MAX_BUDGET),
  }

  const parsed = siteCreateSchema.safeParse(normalized)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid site payload.')
  }

  return parsed.data
}

export const validateSiteUpdatePayload = (site: Site): Site => {
  const normalized: Site = {
    ...site,
    id: validateEntityId(site.id, 'site'),
    name: sanitizeText(site.name, 80),
    location: sanitizeText(site.location, 120),
    budget: parseNonNegativeNumber(site.budget, 'Budget', MAX_BUDGET),
    createdAt: String(site.createdAt ?? '').trim(),
  }

  const parsed = siteUpdateSchema.safeParse(normalized)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid site payload.')
  }

  return parsed.data
}

export const validateCategoryCreatePayload = (payload: Omit<Category, 'id' | 'createdAt'>): Omit<Category, 'id' | 'createdAt'> => {
  const normalized = {
    ...payload,
    name: sanitizeText(payload.name, 60),
    subcategories: normalizeSubcategories(payload.subcategories ?? []),
  }

  const parsed = categoryCreateSchema.safeParse(normalized)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid category payload.')
  }

  return parsed.data
}

export const validateCategoryUpdatePayload = (category: Category): Category => {
  const normalized: Category = {
    ...category,
    id: validateEntityId(category.id, 'category'),
    name: sanitizeText(category.name, 60),
    subcategories: normalizeSubcategories(category.subcategories ?? []),
    createdAt: String(category.createdAt ?? '').trim(),
  }

  const parsed = categoryUpdateSchema.safeParse(normalized)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid category payload.')
  }

  return parsed.data
}

export const validateExpenseCreatePayload = (payload: ExpenseInput): ExpenseInput => {
  const normalized: ExpenseInput = {
    ...payload,
    date: String(payload.date ?? '').trim(),
    siteId: validateEntityId(payload.siteId, 'site'),
    categoryId: validateEntityId(payload.categoryId, 'category'),
    subcategory: sanitizeText(payload.subcategory, 80),
    description: sanitizeText(payload.description, 200),
    unit: sanitizeText(payload.unit, 20),
    unitPrice: parseNonNegativeNumber(payload.unitPrice, 'Unit price', MAX_MONEY),
    totalCost: parseNonNegativeNumber(payload.totalCost, 'Total cost', MAX_MONEY),
    vendorOrContractorName: sanitizeText(payload.vendorOrContractorName, 120),
    gstApplicable: Boolean(payload.gstApplicable),
    gstPercent: parseNonNegativeNumber(payload.gstPercent, 'GST percentage', 28),
    paymentStatus: payload.paymentStatus,
    paymentMethod: payload.paymentMethod,
    notes: sanitizeMultilineText(payload.notes, 800),
  }

  assertUnitValue(normalized.unit)

  const parsed = expenseSchema.safeParse(normalized)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid expense payload.')
  }

  return parsed.data
}

export const validateExpenseUpdatePayload = (payload: ExpenseUpdateInput): ExpenseUpdateInput => {
  const normalized: ExpenseUpdateInput = {
    ...validateExpenseCreatePayload(payload),
    id: validateEntityId(payload.id, 'expense'),
  }

  const parsed = expenseUpdateSchema.safeParse(normalized)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid expense payload.')
  }

  return parsed.data
}
