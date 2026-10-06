"use client";

import Link from "next/link";

import { useSiteCreationFlow } from "./site-creation-wizard/use-site-creation-flow";
import * as UI from "./ui";
import { Button, Input } from "./ui";

import type { Capability } from "./site-creation-wizard/site-creation-domain";

export function SiteCreationWizard({ manifest }: { manifest: Capability[] }) {
  const {
    step,
    setStep,
    values,
    originInput,
    setOriginInput,
    setSelected,
    error,
    fieldErrors,
    created,
    creating,
    replayedSiteId,
    replacementKey,
    replacementError,
    replacementPending,
    replacementNeedsReview,
    replacementStatusLoaded,
    websiteOrigin,
    allowedOrigins,
    resultSiteId,
    resultEnvironment,
    restored,
    enabledCapabilities,
    update,
    updateWebsiteUrl,
    addOrigin,
    validate,
    submit,
    issueReplacement,
    acknowledgeReplacementReview,
  } = useSiteCreationFlow(manifest);
  if (step === 4) {
    const siteId = resultSiteId;
    const env = resultEnvironment;
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
          Environment: <code>{env}</code>
        </p>
        <Link
          className="button-link button-link-secondary"
          href={`/dashboard/settings/overview?site_id=${encodeURIComponent(siteId)}&environment=${encodeURIComponent(env)}`}
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
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(key)}>
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
            onClick={() => void issueReplacement()}
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
              onClick={() => {
                acknowledgeReplacementReview();
              }}
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
              deployment&apos;s full POST /v1/events endpoint. This Site uses the {env} environment;
              the Collector matches it through the configured Origin policy. Keep the key out of
              source control and server logs. Verify events arrive before revoking any older key in
              Settings.
            </p>
          </>
        )}
      </section>
    );
  }

  const steps = ["Site details", "Environment & Origins", "Capabilities", "Review"];

  return (
    <section className="card onboarding-panel" aria-label="Site creation wizard">
      <ol className="onboarding-steps">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className="onboarding-step"
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <div className="onboarding-step-content">
          <label className="form-field">
            Site name
            <Input value={values.name} onChange={(e) => update("name", e.target.value)} />
          </label>
          {fieldErrors.name && <p role="alert">{fieldErrors.name}</p>}
          <label className="form-field">
            Website URL
            <Input
              type="url"
              placeholder="https://example.com"
              value={values.websiteUrl}
              onChange={(e) => {
                updateWebsiteUrl(e.target.value);
              }}
            />
          </label>
          {fieldErrors.websiteUrl && <p role="alert">{fieldErrors.websiteUrl}</p>}
        </div>
      )}
      {step === 1 && (
        <div className="onboarding-step-content">
          <label className="form-field">
            Environment
            <Input
              value={values.environment}
              onChange={(e) => update("environment", e.target.value)}
            />
          </label>
          {fieldErrors.environment && <p role="alert">{fieldErrors.environment}</p>}
          <div>
            <label className="form-field">
              Allowed Origins
              <Input
                value={originInput}
                placeholder="https://www.example.com"
                onChange={(e) => setOriginInput(e.target.value)}
              />
            </label>
            <Button variant="secondary" className="onboarding-add-origin" onClick={addOrigin}>
              Add Origin
            </Button>
            {fieldErrors.origins && <p role="alert">{fieldErrors.origins}</p>}
            <ul className="origin-entry-list">
              {allowedOrigins.map((origin) => (
                <li key={origin} className="origin-entry">
                  <code>{origin}</code>
                  {origin !== websiteOrigin && (
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${origin}`}
                      onClick={() =>
                        update(
                          "origins",
                          values.origins.filter((item) => item !== origin),
                        )
                      }
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <p className="onboarding-copy">
            Origins are validated locally; the Dashboard does not request these URLs.
          </p>
        </div>
      )}
      {step === 2 && (
        <fieldset className="capability-choice-list">
          <legend>Choose implemented capabilities</legend>
          {manifest
            .filter((item) => item.status === "implemented")
            .map((item) => (
              <label key={item.id} className="capability-choice">
                <UI.Checkbox
                  type="checkbox"
                  checked={enabledCapabilities.includes(item.id)}
                  disabled={item.id === "page_views"}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
                {item.id.replaceAll("_", " ")}
                {item.id === "page_views" && " (required)"}
              </label>
            ))}
          <p className="onboarding-copy">Required dependencies are enabled automatically.</p>
        </fieldset>
      )}
      {step === 3 && (
        <div className="onboarding-review">
          <p>
            <b>Name:</b> {values.name}
          </p>
          <p>
            <b>Website:</b> {values.websiteUrl}
          </p>
          <p>
            <b>Environment:</b> {values.environment}
          </p>
          <p>
            <b>Allowed Origins:</b> {allowedOrigins.join(", ")}
          </p>
          <p>
            <b>Capabilities:</b> {enabledCapabilities.join(", ")}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="onboarding-error">
          {error}
        </p>
      )}
      {Object.entries(fieldErrors)
        .filter(([, message]) => Boolean(message))
        .map(([field, message]) => (
          <p role="alert" key={field} className="onboarding-error">
            {field}: {message}
          </p>
        ))}
      <div className="onboarding-wizard-actions">
        <Button
          variant="secondary"
          disabled={step === 0 || creating}
          onClick={() => setStep((current) => current - 1)}
        >
          Back
        </Button>
        {step < 3 ? (
          <Button
            onClick={() => {
              if (validate(step)) setStep((current) => current + 1);
            }}
          >
            Continue
          </Button>
        ) : (
          <Button disabled={creating} onClick={() => void submit()}>
            {creating ? "Creating Site…" : "Create Site"}
          </Button>
        )}
      </div>
    </section>
  );
}
