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
        <h2 className="state-title">Site directory unavailable</h2>
        <ErrorState message={result.message} />
      </section>
    );
  }
  if (result.sites.length === 0) {
    return (
      <section className="card" aria-label="Site directory status">
        <h2 className="state-title">No Sites registered</h2>
        <p className="state-description">
          The Site Registry is empty. Add a Site to start collecting Page Views.
        </p>
        <Link className="button-link button-link-primary" href="/dashboard/sites/new">
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
      <h2 className="state-title">No active Sites</h2>
      <p className="state-description">Choose an archived Site to view its historical reports.</p>
      <ul className="state-list">
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
