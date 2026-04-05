import { useState } from 'react'
import beaverLogo from '../assets/beaverlogo.webp'

interface AuthPanelProps {
  onLogin: () => Promise<void>
  errorMessage: string
  diagnostics?: {
    code: string
    message: string
    atIso: string
  } | null
}

export const AuthPanel = ({ onLogin, errorMessage, diagnostics }: AuthPanelProps) => {
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await onLogin()
    } catch {
      // Error state is surfaced by the auth hook.
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4">
      <section className="w-full rounded-3xl bg-white p-6 shadow-card">
        <div className="flex items-center gap-3">
          <img src={beaverLogo} alt="Beaver Expense logo" className="h-11 w-11 rounded-lg object-contain md:h-12 md:w-12" />
          <h1 className="font-headline text-3xl font-extrabold text-primary">Beaver Expense</h1>
        </div>
        <p className="mt-1 text-sm text-outline">Secure sign in using your Google account</p>

        {errorMessage ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}

        {import.meta.env.DEV && diagnostics ? (
          <section className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">Auth Diagnostics (dev only)</p>
            <p className="mt-1">Code: {diagnostics.code}</p>
            <p className="mt-1 break-all">Message: {diagnostics.message}</p>
            <p className="mt-1">Time: {diagnostics.atIso}</p>
          </section>
        ) : null}

        <button
          onClick={() => void submit()}
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Please wait...' : 'Continue with Google'}
        </button>
      </section>
    </main>
  )
}
