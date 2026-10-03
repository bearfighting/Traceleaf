"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { configurationRequestError } from "../lib/configuration-api/errors";

import type { ConfigurationLoadResult } from "../lib/configuration-api/server";
import type { CreatedIngestKey, IngestPolicyResponse } from "../lib/configuration-api/types";

const markerKey = (siteId: string, environment: string) =>
  `ingest-keys:${siteId}:${environment}:outcome-unknown`;

function isKeyMetadata(value: unknown): value is CreatedIngestKey["metadata"] {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<CreatedIngestKey["metadata"]>;

  return (
    typeof metadata.key_id === "string" &&
    metadata.key_id.length > 0 &&
    typeof metadata.created_at === "string" &&
    Number.isFinite(Date.parse(metadata.created_at))
  );
}

function isEffectiveState(value: unknown): value is CreatedIngestKey["effective_state"] {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<CreatedIngestKey["effective_state"]>;

  return (
    (state.status === "current" || state.status === "pending" || state.status === "stale") &&
    Number.isInteger(state.stored_version) &&
    state.stored_version! > 0 &&
    [
      state.applied_versions?.collector,
      state.applied_versions?.processor,
      state.applied_versions?.analytics_api,
    ].every((version) => version === null || Number.isInteger(version))
  );
}

function isCreatedIngestKey(value: unknown): value is CreatedIngestKey {
  if (!value || typeof value !== "object") return false;
  const created = value as Partial<CreatedIngestKey>;

  return (
    typeof created.key === "string" &&
    created.key.length > 0 &&
    isKeyMetadata(created.metadata) &&
    isEffectiveState(created.effective_state)
  );
}

function isIngestPolicyResponse(
  value: unknown,
  siteId: string,
  environment: string,
): value is IngestPolicyResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<IngestPolicyResponse>;
  const policy = response.policy;

  return (
    !!policy &&
    policy.site_id === siteId &&
    policy.environment === environment &&
    Number.isInteger(policy.version) &&
    policy.version > 0 &&
    typeof policy.enabled === "boolean" &&
    Array.isArray(policy.allowed_origins) &&
    policy.allowed_origins.every((origin) => typeof origin === "string") &&
    Array.isArray(policy.keys) &&
    policy.keys.every(isKeyMetadata) &&
    Number.isInteger(policy.rate_limit_per_minute) &&
    policy.rate_limit_per_minute > 0 &&
    isEffectiveState(response.effective_state)
  );
}

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
  const [policy, setPolicy] = useState(initialPolicy);
  const [secret, setSecret] = useState<CreatedIngestKey | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [reviewRefreshed, setReviewRefreshed] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [listRefreshNeeded, setListRefreshNeeded] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setReview(window.localStorage.getItem(markerKey(siteId, environment)) !== null);
      } catch {
        setReview(true);
      }
      setStatusLoaded(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [siteId, environment]);
  useEffect(() => {
    const key = markerKey(siteId, environment);
    function syncReviewMarker(event: StorageEvent) {
      if (event.key !== key) return;
      setReview(event.newValue !== null);
      setReviewRefreshed(false);
    }
    window.addEventListener("storage", syncReviewMarker);

    return () => window.removeEventListener("storage", syncReviewMarker);
  }, [siteId, environment]);

  async function refresh() {
    setReviewRefreshed(false);
    const response = await fetch(
      `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-policy`,
      { cache: "no-store" },
    );
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(configurationRequestError(response.status, value));
    if (!isIngestPolicyResponse(value, siteId, environment))
      throw new Error("The active key list response could not be verified.");
    setPolicy(value);
    setReviewRefreshed(true);
    setListRefreshNeeded(false);

    return value as IngestPolicyResponse;
  }

  async function create() {
    if (!policy || busy || review || !statusLoaded || listRefreshNeeded) return;
    setBusy(true);
    setError("");
    setSecret(null);
    try {
      if (!navigator.locks) {
        setError(
          "This browser cannot coordinate key creation across tabs. Use a browser with Web Locks support.",
        );

        return;
      }
      await navigator.locks.request(
        `ingest-keys:${siteId}:${environment}:create`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            setReview(true);
            setError(
              "Another tab is creating or checking a key. Refresh the active key list before continuing.",
            );

            return;
          }

          const key = markerKey(siteId, environment);
          let requestMarker: string;
          try {
            if (window.localStorage.getItem(key) !== null) {
              setReview(true);
              setError(
                "A key request in another tab needs review. Refresh the active key list before creating another key.",
              );

              return;
            }
            requestMarker = crypto.randomUUID();
            window.localStorage.setItem(key, requestMarker);
            setReview(true);
          } catch {
            setError("Browser storage is unavailable. Enable site storage before issuing a key.");

            return;
          }

          try {
            const response = await fetch(
              `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-keys`,
              {
                method: "POST",
                headers: { "If-Match": `\"${policy.policy.version}\"` },
                cache: "no-store",
              },
            );
            const value: unknown = await response.json().catch(() => null);
            if (!response.ok) {
              if (response.status < 500) {
                if (window.localStorage.getItem(key) === requestMarker) {
                  window.localStorage.removeItem(key);
                  setReview(false);
                }
                if (response.status === 412) await refresh();
              }

              throw new Error(configurationRequestError(response.status, value));
            }
            if (!isCreatedIngestKey(value))
              throw new Error("The key response could not be verified.");
            const created = value;
            setSecret(created);
            setPolicy((current) =>
              current
                ? {
                    ...current,
                    policy: {
                      ...current.policy,
                      version: created.effective_state.stored_version,
                      keys: [
                        ...current.policy.keys.filter(
                          (item) => item.key_id !== created.metadata.key_id,
                        ),
                        created.metadata,
                      ],
                    },
                    effective_state: created.effective_state,
                  }
                : current,
            );
            if (window.localStorage.getItem(key) === requestMarker) {
              window.localStorage.removeItem(key);
              setReview(false);
            }
            try {
              await refresh();
            } catch {
              setListRefreshNeeded(true);
              setError(
                "Key created successfully. Its secret is shown above, but the active key list could not be refreshed. Retry the list refresh before creating another key.",
              );
            }
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "The key request outcome is unknown.",
            );
            try {
              setReview(window.localStorage.getItem(key) !== null);
            } catch {
              setReview(true);
            }
          }
        },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not coordinate key creation.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!policy || !revokeId) return;
    const requestedKeyId = revokeId;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-keys/${encodeURIComponent(revokeId)}`,
        {
          method: "DELETE",
          headers: { "If-Match": `\"${policy.policy.version}\"` },
          cache: "no-store",
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(configurationRequestError(response.status, value));
      if (!isIngestPolicyResponse(value, siteId, environment))
        throw new Error("The policy response could not be verified.");
      setPolicy(value);
      setRevokeId(null);
      setSecret(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke key.");
      try {
        const latest = await refresh();
        if (!latest.policy.keys.some((key) => key.key_id === requestedKeyId)) {
          setRevokeId(null);
          setError(`Key ${requestedKeyId} is no longer active. The revocation has completed.`);
        }
      } catch {
        // Keep the confirmation open until the key's current state can be verified.
      }
    } finally {
      setBusy(false);
    }
  }

  async function completeReview() {
    if (!navigator.locks) {
      setError(
        "This browser cannot coordinate key review across tabs. Use a browser with Web Locks support.",
      );

      return;
    }
    try {
      await navigator.locks.request(
        `ingest-keys:${siteId}:${environment}:create`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            setError("Another tab is still handling a key request. Try again after it finishes.");

            return;
          }
          try {
            window.localStorage.removeItem(markerKey(siteId, environment));
            setReview(false);
            setError("");
          } catch {
            setError("Could not clear the review marker.");
          }
        },
      );
    } catch {
      setError("Could not coordinate key review across tabs.");
    }
  }

  if (result.kind !== "ready")
    return (
      <section className="card" role="alert">
        <h2>Ingest Keys unavailable</h2>
        <p>{result.message}</p>
        <button onClick={() => router.refresh()}>Retry</button>
      </section>
    );
  if (!policy)
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
    <section className="card" aria-label="Ingest Keys">
      <p>
        Create a replacement, update your website, and verify the new key before revoking an
        existing key. Secrets are shown once.
      </p>
      <button
        disabled={busy || review || !statusLoaded || listRefreshNeeded}
        onClick={() => void create()}
      >
        {busy
          ? "Creating…"
          : policy.policy.keys.length
            ? "Create replacement key"
            : "Create Ingest Key"}
      </button>
      {secret && (
        <div className="one-time-secret" role="status">
          <strong>Copy this key now. It will not be shown again.</strong>
          <code>{secret.key}</code>
          <button onClick={() => void navigator.clipboard?.writeText(secret.key)}>Copy key</button>
          <button onClick={() => setSecret(null)}>Hide key</button>
        </div>
      )}
      {listRefreshNeeded && (
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void refresh()
              .then(() => setError(""))
              .catch((cause) =>
                setError(
                  cause instanceof Error
                    ? `Key was created, but the active key list is still unavailable: ${cause.message}`
                    : "Key was created, but the active key list is still unavailable.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Refreshing key list…" : "Refresh active key list"}
        </button>
      )}
      {review && (
        <div role="alert">
          <p>
            A key request may have completed without a confirmed response. Refresh the active key
            list and have an administrator check it before another key can be created.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              setReviewRefreshed(false);
              void refresh().catch((cause) => setError(cause.message));
            }}
          >
            Refresh active key list
          </button>
          <button disabled={busy || !reviewRefreshed} onClick={() => void completeReview()}>
            I checked the key list
          </button>
        </div>
      )}
      <ul className="key-list">
        {policy.policy.keys.map((key) => (
          <li key={key.key_id}>
            <span>
              <code>{key.key_id}</code> · created {new Date(key.created_at).toISOString()} · Active
            </span>
            <button disabled={busy} onClick={() => setRevokeId(key.key_id)}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {policy.policy.keys.length === 0 && <p>No active ingest keys.</p>}
      {revokeId && (
        <div role="alertdialog" aria-label="Confirm key revocation">
          <p>
            After verifying the replacement key, revoke <code>{revokeId}</code>?
          </p>
          <button disabled={busy} onClick={() => setRevokeId(null)}>
            Cancel
          </button>
          <button disabled={busy} onClick={() => void revoke()}>
            Confirm revoke {revokeId}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
