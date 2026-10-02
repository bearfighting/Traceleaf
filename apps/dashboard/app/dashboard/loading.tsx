import { DashboardHeader } from "../../components/dashboard-shell";
import { Phase6LoadingState } from "../../components/phase6-loading-state";
import { LoadingState } from "../../components/states/loading-state";

export default function DashboardLoading() {
  return (
    <main className="dashboard-shell bg-canvas text-ink">
      <DashboardHeader />
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
          ].map((item, index) => (
            <div
              className={`h-8 animate-pulse rounded-lg ${index === 0 ? "bg-brand-soft" : "bg-slate-200/70"}`}
              key={item}
            />
          ))}
        </aside>
        <div className="min-w-0">
          <header className="mb-6">
            <p className="eyebrow">Analytics</p>
            <h1 className="m-0 text-3xl font-bold tracking-tight">Overview</h1>
            <p className="mt-2 text-sm text-muted">Loading reports for the selected site.</p>
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
          <section className="card" id="overview">
            <LoadingState context={{ siteId: "pending", dateRange: { from: "", to: "" } }} />
          </section>
          <Phase6LoadingState heading="Visitors and Sessions" />
          <Phase6LoadingState heading="Dimension Report" />
        </div>
      </div>
    </main>
  );
}
