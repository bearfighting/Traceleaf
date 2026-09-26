"use client";

import React, { useEffect, useState } from "react";

import { configurationRequestError } from "../lib/configuration-api/errors";
import { CAPABILITY_LABELS } from "../lib/configuration-api/types";

import type { ConfigurationLoadResult } from "../lib/configuration-api/server";
import type {
  CapabilityResponse,
  CreatedIngestKey,
  EffectiveState,
  IngestPolicyResponse,
} from "../lib/configuration-api/types";

const DEPENDENCIES: Record<string, string[]> = {
  sessions: ["anonymous_visitors"],
  dimensions: ["browser_context"],
  conversions: ["custom_events"],
  funnels: ["conversions", "custom_events"],
};

export function ConfigurationEditor({
  siteId,
  environment,
  result,
}: {
  siteId: string;
  environment: string;
  result: ConfigurationLoadResult;
}) {
  if (result.kind !== "ready")
    return (
      <section className="card" role="alert">
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
    />
  );
}

function Editor({
  siteId,
  environment,
  initialCapabilities,
  initialPolicy,
}: {
  siteId: string;
  environment: string;
  initialCapabilities: CapabilityResponse;
  initialPolicy: IngestPolicyResponse | null;
}) {
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [policy, setPolicy] = useState(initialPolicy);
  const [origins, setOrigins] = useState(initialPolicy?.policy.allowed_origins.join("\n") ?? "");
  const [rateLimit, setRateLimit] = useState(initialPolicy?.policy.rate_limit_per_minute ?? 600);
  const [createdKey, setCreatedKey] = useState<CreatedIngestKey | null>(null);
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
      const missing = (DEPENDENCIES[id] ?? []).filter(
        (dependency) => !current[dependency]?.enabled,
      );
      if (missing.length) {
        setError(`Enable ${missing.map((key) => CAPABILITY_LABELS[key]).join(", ")} first.`);

        return;
      }
    } else {
      const dependents = Object.entries(DEPENDENCIES)
        .filter(([other, deps]) => current[other]?.enabled && deps.includes(id))
        .map(([other]) => CAPABILITY_LABELS[other]);
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
        enabled: policy?.policy.enabled ?? true,
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
      setOrigins(value.policy.allowed_origins.join("\n"));
      setRateLimit(value.policy.rate_limit_per_minute);
      setMessage("Origin and rate limit settings saved.");
    });
  }

  async function createKey() {
    await perform(async () => {
      if (!policy) throw new Error("Create the environment policy before issuing a key.");
      const path = `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-keys`;
      const created = (await request(
        path,
        "POST",
        undefined,
        policy.policy.version,
      )) as CreatedIngestKey;
      setCreatedKey(created);
      const refreshed = (await request(
        `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-policy`,
        "GET",
      )) as IngestPolicyResponse;
      setPolicy(refreshed);
      setMessage("Key created. Copy it now; it will not be shown again.");
    });
  }

  async function revokeKey(keyId: string) {
    await perform(async () => {
      if (!policy) return;
      const path = `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-keys/${encodeURIComponent(keyId)}`;
      const value = (await request(
        path,
        "DELETE",
        undefined,
        policy.policy.version,
      )) as IngestPolicyResponse;
      setPolicy(value);
      setCreatedKey(null);
      setMessage("Ingest key revoked.");
    });
  }

  return (
    <div className="configuration-page" data-hydrated={hydrated}>
      <section className="card">
        <h2>Site capabilities</h2>
        <EffectiveStateView state={capabilities.effective_state} />
        <div className="configuration-list">
          {Object.entries(capabilities.configuration.capabilities).map(([id, value]) => (
            <label className="configuration-toggle" key={id}>
              <span>
                <strong>{CAPABILITY_LABELS[id] ?? id}</strong>
                <small>
                  {DEPENDENCIES[id]?.length
                    ? `Requires ${DEPENDENCIES[id].map((key) => CAPABILITY_LABELS[key]).join(" and ")}.`
                    : id === "page_views"
                      ? "Required baseline; always enabled."
                      : ""}
                </small>
              </span>
              <input
                type="checkbox"
                checked={value.enabled}
                disabled={busy || !hydrated || id === "page_views"}
                onChange={(event) => toggle(id, event.target.checked)}
                aria-label={`Enable ${CAPABILITY_LABELS[id] ?? id}`}
              />
            </label>
          ))}
        </div>
        <p className="privacy-note">
          <strong>Consent required.</strong> No IP persistence or fingerprinting. These privacy
          constraints cannot be disabled.
        </p>
        <button type="button" disabled={busy || !hydrated} onClick={saveCapabilities}>
          Save capabilities
        </button>
      </section>
      <section className="card">
        <h2>Website access</h2>
        <p>
          Environment: <strong>{environment}</strong>
        </p>
        {policy ? (
          <EffectiveStateView state={policy.effective_state} />
        ) : (
          <p>Ingestion stays closed until an environment policy and key are created.</p>
        )}
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
      <section className="card">
        <h2>Ingest Keys</h2>
        <p>Create a replacement before revoking a key currently used by your website.</p>
        <button type="button" disabled={busy || !hydrated || !policy} onClick={createKey}>
          Create Ingest Key
        </button>
        {createdKey && (
          <div className="one-time-secret" role="status">
            <strong>Copy this key now. It will not be shown again.</strong>
            <code>{createdKey.key}</code>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(createdKey.key)}
            >
              Copy key
            </button>
            <button type="button" onClick={() => setCreatedKey(null)}>
              Hide key
            </button>
          </div>
        )}
        <ul className="key-list">
          {(policy?.policy.keys ?? []).map((key) => (
            <li key={key.key_id}>
              <span>
                <code>{key.key_id}</code> · created {new Date(key.created_at).toISOString()}
              </span>
              <button
                type="button"
                disabled={busy || !hydrated}
                onClick={() => void revokeKey(key.key_id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
        {policy && policy.policy.keys.length === 0 && <p>No active ingest keys.</p>}
      </section>
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
