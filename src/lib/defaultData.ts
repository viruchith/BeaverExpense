import type { Category, Site } from './types'

const nowIso = () => new Date().toISOString()

export const defaultSites: Site[] = [
  {
    id: 'site-main',
    name: 'Beaver Residency - Phase 1',
    location: 'Bengaluru',
    budget: 6500000,
    createdAt: nowIso(),
  },
]

export const defaultCategories: Category[] = [
  {
    id: 'cat-materials',
    name: 'Materials',
    kind: 'material',
    subcategories: ['Cement', 'Steel', 'Bricks', 'Sand', 'Electrical'],
    createdAt: nowIso(),
  },
  {
    id: 'cat-labour',
    name: 'Labour',
    kind: 'labour',
    subcategories: ['Masonry', 'Carpentry', 'Plumbing', 'Painting', 'Electrician'],
    createdAt: nowIso(),
  },
]
