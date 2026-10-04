import { DashboardLoadingHeader } from "../../../components/dashboard-loading-header";

export default function SettingsLoading() {
  return (
    <main className="dashboard-shell">
      <DashboardLoadingHeader settingsMode />
      <div className="dashboard-content">
        <header className="loading-page-heading">
          <p className="eyebrow">Workspace</p>
          <h1 className="page-title">Site settings</h1>
          <p className="page-description">Loading configuration for the selected site.</p>
        </header>
        <div aria-hidden="true" className="loading-filter-bar">
          <div className="skeleton skeleton-settings-select" />
          <div className="skeleton skeleton-settings-action" />
        </div>
        <section aria-label="Loading site configuration" className="card">
          <div className="loading-report-skeleton">
            <div className="skeleton skeleton-section-title" />
            <div className="skeleton skeleton-form-line" />
            <div className="skeleton skeleton-form-line skeleton-form-line-short" />
          </div>
        </section>
      </div>
    </main>
  );
}
