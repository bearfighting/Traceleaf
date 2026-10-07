import { DashboardLoadingHeader } from "../../components/shared/dashboard-loading-header";

export default function DashboardLoading() {
  return (
    <main className="dashboard-shell">
      <DashboardLoadingHeader />
      <div className="dashboard-container dashboard-layout dashboard-layout-analytics">
        <aside aria-hidden="true" className="loading-sidebar">
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
            <div className="skeleton skeleton-nav-item" key={item} />
          ))}
        </aside>
        <div className="dashboard-content-main">
          <header className="loading-page-heading">
            <p className="eyebrow">Analytics</p>
            <h1 className="page-title">Analytics report</h1>
            <p className="page-description">Loading the selected report.</p>
          </header>
          <div aria-hidden="true" className="loading-filter-bar">
            {["wide", "medium", "medium", "wide", "compact"].map((width, index) => (
              <div className="skeleton skeleton-filter-control" data-width={width} key={index} />
            ))}
          </div>
          <section aria-label="Report loading" className="card">
            <p role="status">Loading report data for the selected site.</p>
            <div aria-hidden="true" className="loading-report-skeleton">
              <div className="skeleton skeleton-line skeleton-line-wide" />
              <div className="skeleton skeleton-line skeleton-line-medium" />
              <div className="skeleton skeleton-report-table" />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
