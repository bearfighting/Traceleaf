import { DashboardLoadingHeader } from "../../components/dashboard-loading-header";

export default function DashboardLoading() {
  return (
    <main className="dashboard-shell bg-canvas text-ink">
      <DashboardLoadingHeader />
      <div className="dashboard-container grid gap-8 py-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <aside aria-hidden="true" className="hidden content-start gap-2 lg:grid">
          {[
            "Overview",
            "Traffic",
            "Page views",
            "Top pages",
            "Dimensions",
            "Audience",
            "Visitors",
            "Sessions",
            "Engagement",
            "Experience",
            "Geography",
            "Outcomes",
          ].map((item) => (
            <div className="h-8 animate-pulse rounded-lg bg-slate-200/70" key={item} />
          ))}
        </aside>
        <div className="min-w-0">
          <header className="mb-6">
            <p className="eyebrow">Analytics</p>
            <h1 className="m-0 text-3xl font-bold tracking-tight">Analytics report</h1>
            <p className="mt-2 text-sm text-muted">Loading the selected report.</p>
          </header>
          <div
            aria-hidden="true"
            className="mb-6 flex flex-wrap gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm"
          >
            {["w-40", "w-36", "w-36", "w-44", "w-32"].map((width, index) => (
              <div
                className={`h-10 animate-pulse rounded-lg bg-slate-200/70 ${width}`}
                key={index}
              />
            ))}
          </div>
          <section aria-label="Report loading" className="card">
            <p role="status">Loading report data for the selected site.</p>
            <div aria-hidden="true" className="mt-4 grid gap-3">
              <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200/70" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200/70" />
              <div className="h-24 animate-pulse rounded bg-slate-200/70" />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
