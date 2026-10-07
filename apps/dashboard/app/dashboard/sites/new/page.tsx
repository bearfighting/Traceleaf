import capabilitiesManifest from "../../../../../../protocol/capabilities/capabilities.json";
import { DashboardHeader } from "../../../../components/shared/dashboard-shell";
import { SiteCreationWizard } from "../../../../components/sites/site-creation-wizard";

export const dynamic = "force-dynamic";

export default function NewSitePage() {
  return (
    <main className="dashboard-shell">
      <DashboardHeader analyticsHref="/dashboard" settingsHref="/dashboard/settings/overview" />
      <div className="dashboard-content onboarding-page">
        <h1 className="page-title-compact">Add a Site</h1>
        <p className="page-description-compact">Set up a Site and its first browser Ingest Key.</p>
        <SiteCreationWizard manifest={capabilitiesManifest.capabilities} />
      </div>
    </main>
  );
}
