"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import capabilityManifest from "../../../protocol/capabilities/capabilities.json";
import { configurationRequestError } from "../lib/configuration-api/errors";
import { CAPABILITY_LABELS } from "../lib/configuration-api/types";

import { Button } from "./ui";

import type { ConfigurationLoadResult } from "../lib/configuration-api/server";
import type {
  CapabilityResponse,
  EffectiveState,
  IngestPolicyResponse,
} from "../lib/configuration-api/types";

export function ConfigurationEditor({
  siteId,
  environment,
  result,
  section = "overview",
}: {
  siteId: string;
  environment: string;
  result: ConfigurationLoadResult;
  section?: "overview" | "capabilities" | "environments";
}) {
  if (result.kind === "missing_capabilities")
    return section === "environments" ? (
      <section className="card">
        <h2>Capabilities need initialization</h2>
        <p>Initialize Site capabilities before configuring an environment.</p>
        <a
          href={`/dashboard/settings/capabilities?site_id=${encodeURIComponent(siteId)}&environment=${encodeURIComponent(environment)}`}
        >
          Go to Capabilities
        </a>
      </section>
    ) : (
      <InitializeCapabilities siteId={siteId} />
    );

  if (result.kind !== "ready")
    return (
      <section className="card" role="alert" id="capabilities">
        <h2>Configuration unavailable</h2>
        <p>{result.message}</p>
      </section>
    );

  return (
    <Editor
      key={`${siteId}:${environment}:${result.capabilities.configuration.version}:${result.policy?.policy.version ?? "new"}`}
      siteId={siteId}
      environment={environment}
      initialCapabilities={result.capabilities}
      initialPolicy={result.policy}
      section={section}
    />
  );
}

function InitializeCapabilities({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function initialize() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/sites/${encodeURIComponent(siteId)}/capabilities`, {
        method: "POST",
        headers: { "If-None-Match": "*" },
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(configurationRequestError(response.status, body));
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Capability configuration could not be initialized.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Capability configuration setup" id="capabilities">
      <h2 className="m-0 text-lg font-semibold">Capability configuration is missing</h2>
      <p className="mb-0 mt-2 text-sm text-muted">
        Initialize this Site with Page Views enabled and optional capabilities disabled. You can
        change capabilities after initialization.
      </p>
      {error && (
        <p className="mb-0 mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <Button className="mt-4" disabled={busy} onClick={() => void initialize()}>
        {busy ? "Initializing…" : "Initialize capabilities"}
      </Button>
    </section>
  );
}

function Editor({
  siteId,
  environment,
  initialCapabilities,
  initialPolicy,
  section,
}: {
  siteId: string;
  environment: string;
  initialCapabilities: CapabilityResponse;
  initialPolicy: IngestPolicyResponse | null;
  section: "overview" | "capabilities" | "environments";
}) {
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [policy, setPolicy] = useState(initialPolicy);
  const [policyEnabled, setPolicyEnabled] = useState(initialPolicy?.policy.enabled ?? true);
  const [origins, setOrigins] = useState(initialPolicy?.policy.allowed_origins.join("\n") ?? "");
  const [rateLimit, setRateLimit] = useState(initialPolicy?.policy.rate_limit_per_minute ?? 600);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setHydrated(true), 0);

    return () => window.clearTimeout(timer);
  }, []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function request(path: string, method: string, body?: unknown, version?: number) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (version !== undefined) headers.set("If-Match", `"${version}"`);
    if (method === "POST" && version === undefined) headers.set("If-None-Match", "*");
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(configurationRequestError(response.status, value));
    }

    return value;
  }

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Configuration request failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string, enabled: boolean) {
    const current = capabilities.configuration.capabilities;
    if (id === "page_views") return;
    if (enabled) {
      const dependencies =
        capabilityManifest.capabilities.find((item) => item.id === id)?.depends_on ?? [];
      const missing = dependencies.filter((dependency) => !current[dependency]?.enabled);
      if (missing.length) {
        setError(`Enable ${missing.map((key) => CAPABILITY_LABELS[key]).join(", ")} first.`);

        return;
      }
    } else {
      const dependents = capabilityManifest.capabilities
        .filter((item) => current[item.id]?.enabled && item.depends_on.includes(id))
        .map((item) => CAPABILITY_LABELS[item.id]);
      if (dependents.length) {
        setError(`Disable dependent capabilities first: ${dependents.join(", ")}.`);

        return;
      }
    }
    setError("");
    setCapabilities({
      ...capabilities,
      configuration: {
        ...capabilities.configuration,
        capabilities: { ...current, [id]: { ...current[id], enabled } },
      },
    });
  }

  async function saveCapabilities() {
    await perform(async () => {
      const value = (await request(
        `/api/admin/sites/${encodeURIComponent(siteId)}/capabilities`,
        "PUT",
        { capabilities: capabilities.configuration.capabilities },
        capabilities.configuration.version,
      )) as CapabilityResponse;
      setCapabilities(value);
      setMessage("Capabilities saved.");
    });
  }

  async function savePolicy() {
    await perform(async () => {
      const body = {
        enabled: policyEnabled,
        allowed_origins: origins
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        rate_limit_per_minute: Number(rateLimit),
      };
      const path = `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-policy`;
      const value = (await request(
        path,
        policy ? "PUT" : "POST",
        body,
        policy?.policy.version,
      )) as IngestPolicyResponse;
      setPolicy(value);
      setPolicyEnabled(value.policy.enabled);
      setOrigins(value.policy.allowed_origins.join("\n"));
      setRateLimit(value.policy.rate_limit_per_minute);
      setMessage(
        `Website access settings saved. Ingestion is ${value.policy.enabled ? "enabled" : "disabled"}.`,
      );
    });
  }

  return (
    <div className="configuration-page" data-hydrated={hydrated}>
      {section === "capabilities" ? (
        <section className="card" id="capabilities">
          <h2>Site capabilities</h2>
          <EffectiveStateView state={capabilities.effective_state} />
          <div className="configuration-list">
            {Object.entries(capabilities.configuration.capabilities).map(([id, value]) => {
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
                  <input
                    type="checkbox"
                    checked={value.enabled}
                    disabled={busy || !hydrated || id === "page_views" || unavailable}
                    onChange={(event) => toggle(id, event.target.checked)}
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
          <button type="button" disabled={busy || !hydrated} onClick={saveCapabilities}>
            Save capabilities
          </button>
        </section>
      ) : null}
      {section === "environments" ? (
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
            <input
              type="checkbox"
              checked={policyEnabled}
              disabled={busy || !hydrated}
              onChange={(event) => setPolicyEnabled(event.target.checked)}
              aria-label={
                policy
                  ? "Enable environment ingestion"
                  : "Enable environment ingestion when policy is created"
              }
            />
          </label>
          <label className="configuration-field">
            Allowed Origins <small>One origin per line, such as https://www.example.com</small>
            <textarea
              rows={4}
              value={origins}
              disabled={busy || !hydrated}
              onChange={(event) => setOrigins(event.target.value)}
            />
          </label>
          <label className="configuration-field">
            Rate limit (events per minute)
            <input
              type="number"
              min={1}
              value={rateLimit}
              disabled={busy || !hydrated}
              onChange={(event) => setRateLimit(Number(event.target.value))}
            />
          </label>
          <button type="button" disabled={busy || !hydrated} onClick={savePolicy}>
            {policy ? "Save access settings" : "Create environment policy"}
          </button>
        </section>
      ) : null}
      {error && (
        <ConfigurationErrorFeedback error={error} onReload={() => window.location.reload()} />
      )}
      {message && (
        <p className="configuration-success" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

export function ConfigurationErrorFeedback({
  error,
  onReload,
}: {
  error: string;
  onReload: () => void;
}) {
  return (
    <p className="configuration-error" role="alert">
      {error}{" "}
      {error.includes("Reload") && (
        <button type="button" onClick={onReload}>
          Reload latest configuration
        </button>
      )}
    </p>
  );
}

function EffectiveStateView({ state }: { state: EffectiveState }) {
  return (
    <div className={`effective-state effective-${state.status}`}>
      <strong>Runtime status: {state.status}</strong>
      <span>Stored version {state.stored_version}</span>
      {Object.entries(state.applied_versions).map(([service, version]) => (
        <span key={service}>
          {service}: {version === null ? "not reported" : `version ${version}`}
        </span>
      ))}
    </div>
  );
}
