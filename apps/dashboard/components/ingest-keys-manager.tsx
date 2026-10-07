"use client";

import { useRouter } from "next/navigation";

import { IngestKeysPresenter } from "./ingest-keys/ingest-keys-presenter";
import { useIngestKeysFlow } from "./ingest-keys/use-ingest-keys-flow";
import * as UI from "./ui";

import type { ConfigurationLoadResult } from "../lib/configuration-api/server";

export function IngestKeysManager({
  siteId,
  environment,
  result,
}: {
  siteId: string;
  environment: string;
  result: ConfigurationLoadResult;
}) {
  const router = useRouter();
  const initialPolicy = result.kind === "ready" ? result.policy : null;
  const flow = useIngestKeysFlow(siteId, environment, initialPolicy);

  if (result.kind !== "ready")
    return (
      <section className="card" role="alert">
        <h2>Ingest Keys unavailable</h2>
        <p>{result.message}</p>
        <UI.Button onClick={() => router.refresh()}>Retry</UI.Button>
      </section>
    );
  if (!flow.policy)
    return (
      <section className="card">
        <p>
          No policy exists for this Environment. Configure it in{" "}
          <a
            href={`/dashboard/settings/environments?site_id=${encodeURIComponent(siteId)}&environment=${encodeURIComponent(environment)}`}
          >
            Environments &amp; Origins
          </a>{" "}
          first.
        </p>
      </section>
    );

  return (
    <IngestKeysPresenter
      policy={flow.policy}
      secret={flow.secret}
      error={flow.error}
      busy={flow.busy}
      review={flow.review}
      reviewRefreshed={flow.reviewRefreshed}
      statusLoaded={flow.statusLoaded}
      listRefreshNeeded={flow.listRefreshNeeded}
      revokeId={flow.revokeId}
      onCreate={() => void flow.create()}
      onRevoke={() => void flow.revoke()}
      onRefresh={flow.refresh}
      onCompleteReview={() => void flow.completeReview()}
      onSetSecret={flow.setSecret}
      onSetRevokeId={flow.setRevokeId}
      onSetBusy={flow.setBusy}
      onSetError={flow.setError}
      onBeginReviewRefresh={() => flow.setReviewRefreshed(false)}
    />
  );
}
