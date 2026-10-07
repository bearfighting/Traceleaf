"use client";

import capabilityManifest from "../../../../../protocol/capabilities/capabilities.json";
import { CAPABILITY_LABELS } from "../../../lib/settings/configuration-api/types";
import * as UI from "../../ui";
import { ConfigurationErrorFeedback } from "../configuration-error-feedback";
import { EffectiveStateView } from "../effective-state-view";

import type { CapabilityDraft } from "./capability-domain";
import type { CapabilityResponse } from "../../../lib/settings/configuration-api/types";

export function InitializeCapabilitiesPresenter({
  busy,
  error,
  onInitialize,
}: {
  busy: boolean;
  error: string;
  onInitialize: () => void;
}) {
  return (
    <section className="card" aria-label="Capability configuration setup" id="capabilities">
      <h2 className="state-title">Capability configuration is missing</h2>
      <p className="state-description">
        Initialize this Site with Page Views enabled and optional capabilities disabled. You can
        change capabilities after initialization.
      </p>
      {error && (
        <p className="state-error" role="alert">
          {error}
        </p>
      )}
      <UI.Button className="state-action" disabled={busy} onClick={onInitialize}>
        {busy ? "Initializing…" : "Initialize capabilities"}
      </UI.Button>
    </section>
  );
}

export function CapabilityEditorPresenter({
  capabilities,
  response,
  busy,
  hydrated,
  error,
  message,
  onToggle,
  onSave,
  onReload,
}: {
  capabilities: CapabilityDraft;
  response: CapabilityResponse;
  busy: boolean;
  hydrated: boolean;
  error: string;
  message: string;
  onToggle: (id: string, enabled: boolean) => void;
  onSave: () => void;
  onReload: () => void;
}) {
  return (
    <div className="configuration-page" data-hydrated={hydrated}>
      <section className="card" id="capabilities">
        <h2>Site capabilities</h2>
        <EffectiveStateView state={response.effective_state} />
        <div className="configuration-list">
          {Object.entries(capabilities).map(([id, value]) => {
            const definition = capabilityManifest.capabilities.find((item) => item.id === id);
            const unavailable = definition?.status !== "implemented";

            return (
              <label className="configuration-toggle" key={id}>
                <span>
                  <strong>{CAPABILITY_LABELS[id] ?? id}</strong>
                  <small>
                    {definition?.depends_on?.length
                      ? `Requires ${definition.depends_on.map((key) => CAPABILITY_LABELS[key] ?? key).join(" and ")}.`
                      : id === "page_views"
                        ? "Required baseline; always enabled."
                        : unavailable
                          ? "Not available yet."
                          : ""}
                  </small>
                </span>
                <UI.Checkbox
                  type="checkbox"
                  checked={value.enabled}
                  disabled={busy || !hydrated || id === "page_views" || unavailable}
                  onChange={(event) => onToggle(id, event.target.checked)}
                  aria-label={`Enable ${CAPABILITY_LABELS[id] ?? id}`}
                />
              </label>
            );
          })}
        </div>
        <p className="privacy-note">
          <strong>Consent required.</strong> No IP persistence or fingerprinting. These privacy
          constraints cannot be disabled.
        </p>
        {error && <ConfigurationErrorFeedback error={error} onReload={onReload} />}
        {message && (
          <p className="configuration-success" role="status">
            {message}
          </p>
        )}
        <UI.Button type="button" disabled={busy || !hydrated} onClick={onSave}>
          Save capabilities
        </UI.Button>
      </section>
    </div>
  );
}
