import Link from "next/link";

import { Button } from "../ui";

import type { CreatedSite } from "./site-creation-api";

type SiteCreationResultViewProps = {
  created: CreatedSite | null;
  replayedSiteId: string;
  restored: boolean;
  siteId: string;
  environment: string;
  allowedOrigins: string[];
  replacementKey: string;
  replacementError: string;
  replacementPending: boolean;
  replacementNeedsReview: boolean;
  replacementStatusLoaded: boolean;
  onCopyKey: (key: string) => void;
  onIssueReplacement: () => void;
  onAcknowledgeReview: () => void;
};

export function SiteCreationResultView({
  created,
  replayedSiteId,
  restored,
  siteId,
  environment,
  allowedOrigins,
  replacementKey,
  replacementError,
  replacementPending,
  replacementNeedsReview,
  replacementStatusLoaded,
  onCopyKey,
  onIssueReplacement,
  onAcknowledgeReview,
}: SiteCreationResultViewProps) {
  const key = created?.ingest_key.key || replacementKey;

  return (
    <section className="card onboarding-panel" aria-label="Site creation result">
      <h2 className="onboarding-result-title">
        {created ? "Site created" : "Credentials need recovery"}
      </h2>
      <p className="onboarding-copy">
        Site ID: <code>{siteId}</code>
      </p>
      <p className="onboarding-copy">
        Environment: <code>{environment}</code>
      </p>
      <Link
        className="button-link button-link-secondary"
        href={`/dashboard/settings/overview?site_id=${encodeURIComponent(siteId)}&environment=${encodeURIComponent(environment)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        View connection status in Settings
      </Link>
      {created && (
        <>
          <p className="onboarding-copy">Allowed Origins: {allowedOrigins.join(", ")}</p>
          <h3 className="onboarding-section-title">One-time Ingest Key</h3>
          <p className="onboarding-copy">
            Copy this key now. It is held only in this page&apos;s memory and cannot be recovered
            after leaving or refreshing.
          </p>
        </>
      )}
      {replayedSiteId && (
        <p className="onboarding-notice">
          This request was already completed. Its original key cannot be recovered here.
        </p>
      )}
      {restored && (
        <p className="onboarding-notice">
          The original key is no longer available in this page. Creating a replacement keeps the
          current keys active until you verify the new one.
        </p>
      )}
      {key && (
        <div className="onboarding-key-row">
          <code className="onboarding-key-code">{key}</code>
          <Button variant="secondary" onClick={() => onCopyKey(key)}>
            Copy
          </Button>
        </div>
      )}
      {(replayedSiteId || restored) && (
        <Button
          className="onboarding-recovery-action"
          disabled={
            !replacementStatusLoaded ||
            replacementPending ||
            Boolean(replacementKey) ||
            replacementNeedsReview
          }
          onClick={onIssueReplacement}
        >
          {replacementPending
            ? "Creating replacement key…"
            : !replacementStatusLoaded
              ? "Checking key status…"
              : replacementNeedsReview
                ? "Review key status in Settings"
                : replacementKey
                  ? "Replacement key issued"
                  : "Create replacement key"}
        </Button>
      )}
      {replacementNeedsReview && (
        <div className="onboarding-warning">
          <p>
            Check the environment&apos;s key list in Settings. If a new key appeared, verify it or
            revoke it there before starting another replacement.
          </p>
          <Button
            variant="secondary"
            className="onboarding-warning-action"
            disabled={replacementPending}
            onClick={onAcknowledgeReview}
          >
            I reviewed the key list
          </Button>
        </div>
      )}
      {replacementError && (
        <p role="alert" className="onboarding-error">
          {replacementError}
        </p>
      )}
      {(created || replacementKey) && (
        <>
          <h3 className="onboarding-section-title">Install the browser SDK</h3>
          <pre className="onboarding-code-block">{`# .env.local on the observed Next.js website\nNEXT_PUBLIC_ANALYTICS_TRANSPORT=fetch\nNEXT_PUBLIC_ANALYTICS_ENDPOINT=https://<collector-host>/v1/events\nNEXT_PUBLIC_ANALYTICS_SITE_ID=${siteId}\nNEXT_PUBLIC_ANALYTICS_INGEST_KEY=${key || "<copy the key above>"}`}</pre>
          <p className="onboarding-copy">
            Configure these values on the observed website and replace the Collector URL with your
            deployment&apos;s full POST /v1/events endpoint. This Site uses the {environment}
            environment; the Collector matches it through the configured Origin policy. Keep the key
            out of source control and server logs. Verify events arrive before revoking any older
            key in Settings.
          </p>
        </>
      )}
    </section>
  );
}
