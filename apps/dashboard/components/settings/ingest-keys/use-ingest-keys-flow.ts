"use client";

import { useEffect, useRef, useState } from "react";

import { createClientRequestId } from "../../../lib/client-request-id";
import {
  createIngestKey,
  fetchIngestPolicy,
  revokeIngestKey,
} from "../../../lib/settings/ingest-keys/api";

import type {
  CreatedIngestKey,
  IngestPolicyResponse,
} from "../../../lib/settings/configuration-api/types";

const markerKey = (siteId: string, environment: string) =>
  `ingest-keys:${siteId}:${environment}:outcome-unknown`;

export function useIngestKeysFlow(
  siteId: string,
  environment: string,
  initialPolicy: IngestPolicyResponse | null,
) {
  const [policy, setPolicy] = useState(initialPolicy);
  const [secret, setSecret] = useState<CreatedIngestKey | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [reviewRefreshed, setReviewRefreshed] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [listRefreshNeeded, setListRefreshNeeded] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const createInFlight = useRef(false);

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
    const value = await fetchIngestPolicy(siteId, environment);
    setPolicy(value);
    setReviewRefreshed(true);
    setListRefreshNeeded(false);

    return value;
  }

  async function create() {
    if (!policy || createInFlight.current || busy || review || !statusLoaded || listRefreshNeeded)
      return;
    createInFlight.current = true;
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
            requestMarker = createClientRequestId();
            window.localStorage.setItem(key, requestMarker);
            setReview(true);
          } catch {
            setError("Browser storage is unavailable. Enable site storage before issuing a key.");

            return;
          }

          try {
            let created: CreatedIngestKey;
            try {
              created = await createIngestKey(siteId, environment, policy.policy.version);
            } catch (cause) {
              if (
                typeof cause === "object" &&
                cause !== null &&
                "status" in cause &&
                typeof cause.status === "number" &&
                cause.status < 500
              ) {
                try {
                  if (window.localStorage.getItem(key) === requestMarker) {
                    window.localStorage.removeItem(key);
                    setReview(false);
                  }
                } catch {
                  setReview(true);
                }
                if (cause.status === 412) await refresh();
              }

              throw cause;
            }
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
            try {
              if (window.localStorage.getItem(key) === requestMarker) {
                window.localStorage.removeItem(key);
                setReview(false);
              }
            } catch {
              setReview(true);
              setError(
                "Key created successfully, but browser storage could not be cleared. Review the active key list before creating another key.",
              );
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
      createInFlight.current = false;
      setBusy(false);
    }
  }

  async function revoke() {
    if (!policy || !revokeId) return;
    const requestedKeyId = revokeId;
    setBusy(true);
    setError("");
    try {
      const value = await revokeIngestKey(siteId, environment, revokeId, policy.policy.version);
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
        // Keep confirmation open until a valid key list verifies the current state.
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
            setReview(true);
            setError("Could not clear the review marker.");
          }
        },
      );
    } catch {
      setError("Could not coordinate key review across tabs.");
    }
  }

  return {
    policy,
    secret,
    error,
    busy,
    review,
    reviewRefreshed,
    statusLoaded,
    listRefreshNeeded,
    revokeId,
    create,
    revoke,
    refresh,
    completeReview,
    setSecret,
    setRevokeId,
    setBusy,
    setError,
    setReviewRefreshed,
  };
}
