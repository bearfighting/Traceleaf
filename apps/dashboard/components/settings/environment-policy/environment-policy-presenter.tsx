"use client";

import * as UI from "../../ui/index";
import { ConfigurationErrorFeedback } from "../configuration-error-feedback";
import { EffectiveStateView } from "../effective-state-view";

import type { IngestPolicyResponse } from "../../../lib/settings/configuration-api/types";

export interface EnvironmentPolicyValues {
  enabled: boolean;
  originsText: string;
  rateLimit: number;
}

export function EnvironmentPolicyPresenter({
  environment,
  policy,
  values,
  onChange,
  onSave,
  onReload,
  busy,
  hydrated,
  message,
  error,
}: {
  environment: string;
  policy: IngestPolicyResponse | null;
  values: EnvironmentPolicyValues;
  onChange: (values: EnvironmentPolicyValues) => void;
  onSave: () => void;
  onReload: () => void;
  busy: boolean;
  hydrated: boolean;
  message: string;
  error: string;
}) {
  return (
    <div className="configuration-page" data-hydrated={hydrated}>
      <section className="card" id="environment-policy">
        <h2>Website access</h2>
        <p>
          Environment: <strong>{environment}</strong>
        </p>
        {policy ? (
          <EffectiveStateView state={policy.effective_state} />
        ) : (
          <p>
            No environment policy exists yet, so ingestion is currently closed. The initial policy
            and an active Ingest Key are required before events can be accepted.
          </p>
        )}
        <label className="configuration-toggle">
          <span>
            <strong>
              {policy
                ? "Environment ingestion"
                : "Enable environment ingestion when policy is created"}
            </strong>
            <small>
              {policy
                ? "When disabled, the Collector rejects events. When enabled, events still require an allowed Origin and active Ingest Key."
                : "This sets the new policy's enabled flag; it does not open ingestion until an allowed Origin and active Ingest Key are configured."}
            </small>
          </span>
          <UI.Checkbox
            type="checkbox"
            checked={values.enabled}
            disabled={busy || !hydrated}
            onChange={(event) => onChange({ ...values, enabled: event.target.checked })}
            aria-label={
              policy
                ? "Enable environment ingestion"
                : "Enable environment ingestion when policy is created"
            }
          />
        </label>
        <label className="configuration-field">
          Allowed Origins <small>One origin per line, such as https://www.example.com</small>
          <UI.Textarea
            rows={4}
            value={values.originsText}
            disabled={busy || !hydrated}
            onChange={(event) => onChange({ ...values, originsText: event.target.value })}
          />
        </label>
        <label className="configuration-field">
          Rate limit (events per minute)
          <UI.Input
            type="number"
            min={1}
            value={values.rateLimit}
            disabled={busy || !hydrated}
            onChange={(event) => onChange({ ...values, rateLimit: Number(event.target.value) })}
          />
        </label>
        <UI.Button type="button" disabled={busy || !hydrated} onClick={onSave}>
          {policy ? "Save access settings" : "Create environment policy"}
        </UI.Button>
      </section>
      {error && <ConfigurationErrorFeedback error={error} onReload={onReload} />}
      {message && (
        <p className="configuration-success" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
