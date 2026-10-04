import Link from "next/link";

import capabilitiesManifest from "../../../../../../protocol/capabilities/capabilities.json";
import { SiteCreationWizard } from "../../../../components/site-creation-wizard";

export const dynamic = "force-dynamic";

export default function NewSitePage() {
  return (
    <main className="dashboard-shell min-h-screen bg-canvas text-ink">
      <div className="dashboard-container py-8">
        <Link className="text-sm text-muted underline" href="/dashboard">
          Back to Analytics
        </Link>
        <h1 className="mb-2 mt-5 text-3xl font-bold tracking-tight">Add a Site</h1>
        <p className="mb-6 text-sm text-muted">Set up a Site and its first browser Ingest Key.</p>
        <SiteCreationWizard manifest={capabilitiesManifest.capabilities} />
      </div>
    </main>
  );
}
