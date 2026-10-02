import { DashboardHeader } from "../../../components/dashboard-shell";

export default function SettingsLoading() {
  return (
    <main className="dashboard-shell bg-canvas text-ink">
      <DashboardHeader settingsMode />
      <div className="dashboard-container py-8">
        <header className="mb-6">
          <p className="eyebrow">Workspace</p>
          <h1 className="m-0 text-3xl font-bold tracking-tight">Site settings</h1>
          <p className="mt-2 text-sm text-muted">Loading configuration for the selected site.</p>
        </header>
        <div aria-hidden="true" className="mb-6 flex gap-3">
          <div className="h-10 w-48 animate-pulse rounded-lg bg-slate-200/70" />
          <div className="h-10 w-28 animate-pulse rounded-lg bg-slate-200/70" />
        </div>
        <section aria-label="Loading site configuration" className="card">
          <div className="grid gap-3">
            <div className="h-5 w-48 animate-pulse rounded bg-slate-200/70" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-slate-200/70" />
            <div className="h-10 w-2/3 animate-pulse rounded-lg bg-slate-200/70" />
          </div>
        </section>
      </div>
    </main>
  );
}
