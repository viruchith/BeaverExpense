# Beaver Expense Tracker

Beaver Expense Tracker is a responsive web application for managing construction expenses across sites, categories, and timelines.
It is built for day-to-day project accounting tasks such as entry, filtering, reporting, receipt management, and export.

## What This Project Does

- Tracks construction expenses with GST-aware totals.
- Supports site-level budgeting and spend visibility.
- Separates material and labour categories.
- Provides reporting filters and visual summaries.
- Imports from CSV and exports to CSV or JSON bundles.
- Stores receipts with each expense record.
- Uses Firebase in production, with a local-storage fallback for offline/dev usage.

## Core Features

- Authentication
  - Google sign-in via Firebase Authentication.
  - Redirect-based auth flow for reliable browser compatibility.

- Expense Management
  - Create, edit, and delete transactions.
  - Fields include date, site, category, subcategory, unit, unit price, GST, payment details, notes, and receipts.
  - Optimistic row updates for better perceived responsiveness.

- Category and Site Management
  - Create and maintain categories/subcategories.
  - Create and manage sites with budget tracking.

- Reports and Analytics
  - Filter by timeline, site, category, and subcategory.
  - Charts for category split, timeline, and site-wise spend.
  - Paginated report table with load-more behavior.

- Import and Export
  - CSV import for spreadsheet-style expense rows.
  - CSV/JSON export bundle including receipt links/files metadata.

## Tech Stack

- Frontend: React 19, TypeScript, Vite
- Styling/UI: Tailwind CSS, Lucide Icons
- Forms and Validation: React Hook Form, Zod
- Charts: Recharts
- Backend Services: Firebase Auth, Firestore, Cloud Storage, Hosting
- Testing: Vitest, Testing Library

## Project Structure

- src/App.tsx: Main UI, routing-by-view state, forms, reports table, import/export actions
- src/hooks/useAuth.ts: Auth session state and auth diagnostics handling
- src/hooks/useExpenseData.ts: Snapshot loading, pagination, optimistic CRUD orchestration
- src/lib/repository.ts: Runtime data-source switch (Firestore or local fallback)
- src/lib/firestoreRepository.ts: Firestore + Storage data access layer
- src/lib/localRepository.ts: localStorage-backed data access fallback
- src/lib/calculations.ts: Totals, GST, and reporting aggregations
- src/lib/csvImport.ts and src/lib/exports.ts: import/export logic
- firebase/: Firestore indexes/rules and Storage rules

## Prerequisites

- Node.js 20+
- npm 10+
- Firebase project (for cloud mode)
- Firebase CLI (invoked via npx in scripts)

## Local Setup

1. Install dependencies.

```bash
npm install
```

2. Create environment file.

```bash
cp .env.example .env
```

3. Fill `.env` with Firebase values:

- VITE_FIREBASE_API_KEY
- VITE_FIREBASE_AUTH_DOMAIN
- VITE_FIREBASE_PROJECT_ID
- VITE_FIREBASE_STORAGE_BUCKET
- VITE_FIREBASE_MESSAGING_SENDER_ID
- VITE_FIREBASE_APP_ID

4. Start development server.

```bash
npm run dev
```

## Available Scripts

- `npm run dev`: start local dev server
- `npm run build`: type-check and produce production build
- `npm run preview`: preview production bundle locally
- `npm run lint`: run ESLint
- `npm run test`: run Vitest test suite
- `npm run test:watch`: run tests in watch mode
- `npm run firebase:login`: authenticate Firebase CLI
- `npm run firebase:emulators`: start Firebase emulators
- `npm run firebase:deploy:rules`: deploy Firestore/Storage rules and indexes
- `npm run firebase:deploy:hosting`: build and deploy hosting only
- `npm run firebase:deploy`: build and deploy all configured Firebase targets

## Firebase Configuration and Deployment

1. Create a Firebase project.
2. Enable Authentication (Google provider).
3. Enable Firestore Database.
4. Enable Cloud Storage.
5. Update `.firebaserc` with your project id.
6. Log in to Firebase CLI.

```bash
npm run firebase:login
```

7. Deploy all targets.

```bash
npm run firebase:deploy
```

### Deploy Options

- Rules and indexes only:

```bash
npm run firebase:deploy:rules
```

- Hosting only:

```bash
npm run firebase:deploy:hosting
```

## Data Modes

- Firebase mode
  - Enabled when all Firebase environment variables are present.
  - Uses Firestore and Storage with owner-scoped documents.

- Local fallback mode
  - Automatically used when Firebase env values are missing.
  - Persists data in browser localStorage for development continuity.

## Security Notes

- Input validation and sanitization are enforced before persistence.
- Auth errors are generalized for safer UX.
- Receipt and CSV imports include file-size/type checks.
- Firestore and Storage rules are scoped for authenticated ownership patterns.

## Testing and Quality Checks

Run the full quality pass:

```bash
npm run lint
npm run test
npm run build
```

Current tests cover calculations, CSV import/export behavior, and data transformation paths.

## Versioning

Application version is sourced from `package.json` and displayed in the app footer and build metadata.
