import Link from "next/link";
import React from "react";

import { ErrorState } from "./states/error-state";

import type { SiteSelection } from "../config/sites";
import type { SiteDirectoryResult } from "../lib/site-management/client";
import type { ManagedSite } from "../lib/site-management/client";

export function SiteDirectoryState({ result }: { result: SiteDirectoryResult }) {
  if (
    result.kind === "unconfigured" ||
    result.kind === "unauthorized" ||
    result.kind === "unavailable"
  ) {
    return (
      <section className="card" aria-label="Site directory status">
        <h2 className="m-0 text-lg font-semibold">Site directory unavailable</h2>
        <ErrorState message={result.message} />
      </section>
    );
  }
  if (result.sites.length === 0) {
    return (
      <section className="card" aria-label="Site directory status">
        <h2 className="m-0 text-lg font-semibold">No Sites registered</h2>
        <p className="mb-0 mt-2 text-sm text-muted">
          The Site Registry is empty. Add a Site to start collecting Page Views.
        </p>
        <Link
          className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-brand bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          href="/dashboard/sites/new"
        >
          Add a Site
        </Link>
      </section>
    );
  }

  return null;
}

export function SiteSelectionState({
  selection,
  sites,
}: {
  selection: SiteSelection;
  sites: ManagedSite[];
}) {
  if (selection.kind === "selected") return null;
  if (selection.kind === "unknown") {
    return (
      <section className="card">
        <ErrorState
          message={`Site ${selection.requestedSiteId} is not present in the Site Registry.`}
        />
      </section>
    );
  }
  if (selection.kind === "no_sites") return null;

  return (
    <section className="card">
      <h2 className="m-0 text-lg font-semibold">No active Sites</h2>
      <p className="mt-2 text-sm text-muted">
        Choose an archived Site to view its historical reports.
      </p>
      <ul className="mb-0 mt-3 list-disc pl-5">
        {sites.map((site) => (
          <li key={site.site_id}>
            <Link href={`/dashboard?site_id=${encodeURIComponent(site.site_id)}`}>
              {site.display_name || site.site_id} ({site.site_id})
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
