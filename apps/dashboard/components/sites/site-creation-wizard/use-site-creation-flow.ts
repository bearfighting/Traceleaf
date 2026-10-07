"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createSite,
  issueReplacementKey,
  loadIngestPolicy,
  ReplacementKeyRequestError,
  SiteCreationRequestError,
  type CreatedSite,
} from "./site-creation-api";
import {
  closeCapabilityDependencies,
  createSitePayload,
  deriveAllowedOrigins,
  deriveOrigin,
  validateSiteCreationStep,
  type Capability,
  type SiteCreationValues,
} from "./site-creation-domain";

type Values = SiteCreationValues;

function replacementAttemptStorageKey(siteId: string, environment: string): string {
  return `site-onboarding:${siteId}:${environment}:replacement-key-outcome-unknown`;
}

function updateReplacementAttemptMarker(key: string, value: "unknown" | null): boolean {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);

    return true;
  } catch {
    return false;
  }
}

export function useSiteCreationFlow(manifest: Capability[]) {
  const searchParams = useSearchParams();
  const restoredSiteId = searchParams.get("site_id");
  const restoredEnvironment = searchParams.get("environment");
  const restored = Boolean(restoredSiteId && restoredEnvironment);
  const [step, setStep] = useState(restored ? 4 : 0);
  const [values, setValues] = useState<Values>({
    name: "",
    websiteUrl: "",
    environment: "production",
    origins: [],
  });
  const [originInput, setOriginInput] = useState("");
  const [selected, setSelected] = useState<string[]>(["page_views"]);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<CreatedSite | null>(null);
  const [creating, setCreating] = useState(false);
  const createInFlight = useRef(false);
  const [replayedSiteId, setReplayedSiteId] = useState("");
  const [idempotency, setIdempotency] = useState<{ payload: string; key: string } | null>(null);
  const [replacementKeys, setReplacementKeys] = useState<Record<string, string>>({});
  const [replacementErrors, setReplacementErrors] = useState<Record<string, string>>({});
  const [pendingReplacementKeys, setPendingReplacementKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const replacementInFlight = useRef(new Set<string>());
  const [replacementReviewByAttempt, setReplacementReviewByAttempt] = useState<
    Record<string, boolean>
  >({});
  const [replacementStatusKey, setReplacementStatusKey] = useState("");
  const websiteOrigin = deriveOrigin(values.websiteUrl);
  const allowedOrigins = deriveAllowedOrigins(values.origins, values.websiteUrl);
  const resultSiteId = created?.site.site_id || replayedSiteId || restoredSiteId || "";
  const resultEnvironment =
    created?.initial_environment || restoredEnvironment || values.environment;
  const replacementAttemptKey = resultSiteId
    ? replacementAttemptStorageKey(resultSiteId, resultEnvironment)
    : "";
  const replacementKey = replacementKeys[replacementAttemptKey] ?? "";
  const replacementError = replacementErrors[replacementAttemptKey] ?? "";
  const replacementPending = pendingReplacementKeys.has(replacementAttemptKey);
  const replacementNeedsReview = replacementReviewByAttempt[replacementAttemptKey] ?? false;
  const replacementStatusLoaded =
    !replacementAttemptKey || replacementStatusKey === replacementAttemptKey;
  const enabledCapabilities = useMemo(
    () => closeCapabilityDependencies(selected, manifest),
    [selected, manifest],
  );

  // Check the marker immediately so an ambiguous key request cannot briefly expose a retry action.
  useEffect(() => {
    if (!replacementAttemptKey) return;
    try {
      // Associate the stored decision with this identity before enabling its retry action.
      const needsReview = window.localStorage.getItem(replacementAttemptKey) === "unknown";
      setReplacementReviewByAttempt((current) => ({
        ...current,
        [replacementAttemptKey]: needsReview,
      }));
    } catch {
      setReplacementReviewByAttempt((current) => ({
        ...current,
        [replacementAttemptKey]: false,
      }));
    } finally {
      setReplacementStatusKey(replacementAttemptKey);
    }
  }, [replacementAttemptKey]);

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }

  function updateWebsiteUrl(websiteUrl: string) {
    const nextOrigin = deriveOrigin(websiteUrl);
    setValues((current) => ({ ...current, websiteUrl }));
    setFieldErrors((current) => ({
      ...current,
      websiteUrl: "",
      ...(nextOrigin ? { origins: "" } : {}),
    }));
  }

  function addOrigin() {
    const origin = deriveOrigin(originInput.trim());
    if (!origin) {
      setFieldErrors((current) => ({ ...current, origins: "Enter a valid http or https Origin." }));

      return;
    }
    update("origins", [...new Set([...values.origins, origin])]);
    setOriginInput("");
  }

  function validate(stepToValidate: number) {
    const next = validateSiteCreationStep(stepToValidate, values, allowedOrigins);
    setFieldErrors(next);

    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (createInFlight.current) return;
    createInFlight.current = true;
    setCreating(true);
    const payload = createSitePayload(values, manifest, enabledCapabilities, allowedOrigins);
    const serialized = JSON.stringify(payload);
    const key = idempotency?.payload === serialized ? idempotency.key : crypto.randomUUID();
    setIdempotency({ payload: serialized, key });
    setError("");
    setFieldErrors({});
    setCreated(null);
    setReplayedSiteId("");
    try {
      const result = await createSite(payload, key);
      if (result.kind === "replayed") {
        setReplayedSiteId(result.siteId);
        window.history.replaceState(
          null,
          "",
          `/dashboard/sites/new?site_id=${encodeURIComponent(result.siteId)}&environment=${encodeURIComponent(values.environment)}`,
        );
        setStep(4);

        return;
      }
      setCreated(result.value);
      window.history.replaceState(
        null,
        "",
        `/dashboard/sites/new?site_id=${encodeURIComponent(result.value.site.site_id)}&environment=${encodeURIComponent(values.environment)}`,
      );
      setStep(4);
    } catch (cause) {
      if (cause instanceof SiteCreationRequestError) {
        setFieldErrors(cause.fieldErrors);
        setError(cause.message);
      } else {
        setError(
          "The result could not be confirmed. Retry manually to check the same request safely.",
        );
      }
    } finally {
      createInFlight.current = false;
      setCreating(false);
    }
  }

  async function issueReplacement() {
    const attemptKey = replacementAttemptKey;
    if (
      !replacementStatusLoaded ||
      replacementPending ||
      replacementInFlight.current.has(attemptKey) ||
      replacementKey ||
      replacementNeedsReview
    )
      return;
    const siteId = resultSiteId;
    const environment = resultEnvironment;
    if (!siteId) {
      setReplacementErrors((current) => ({
        ...current,
        [attemptKey]: "Site identity is missing. Open the Site from Settings and try again.",
      }));

      return;
    }
    replacementInFlight.current.add(attemptKey);
    setPendingReplacementKeys((current) => new Set(current).add(attemptKey));
    setReplacementErrors((current) => ({ ...current, [attemptKey]: "" }));
    let keyRequestStarted = false;
    let definitelyRejected = false;
    try {
      const etag = await loadIngestPolicy(siteId, environment);
      if (!updateReplacementAttemptMarker(attemptKey, "unknown"))
        throw new Error(
          "This browser cannot save the temporary key-request status. Enable site storage before issuing a replacement key.",
        );
      keyRequestStarted = true;
      setReplacementReviewByAttempt((current) => ({ ...current, [attemptKey]: true }));
      try {
        const key = await issueReplacementKey(siteId, environment, etag);
        keyRequestStarted = false;
        setReplacementReviewByAttempt((current) => ({ ...current, [attemptKey]: false }));
        updateReplacementAttemptMarker(attemptKey, null);
        setReplacementKeys((current) => ({ ...current, [attemptKey]: key }));
      } catch (cause) {
        if (cause instanceof ReplacementKeyRequestError && cause.definitelyRejected) {
          definitelyRejected = true;
          setReplacementReviewByAttempt((current) => ({ ...current, [attemptKey]: false }));
          updateReplacementAttemptMarker(attemptKey, null);
        }

        throw cause;
      }
    } catch (cause) {
      if (keyRequestStarted && !definitelyRejected) {
        setReplacementReviewByAttempt((current) => ({ ...current, [attemptKey]: true }));
        updateReplacementAttemptMarker(attemptKey, "unknown");
        setReplacementErrors((current) => ({
          ...current,
          [attemptKey]:
            "The server may have issued a key, but its secret was not received. Check the environment's key list in Settings before allowing another attempt.",
        }));
      } else {
        setReplacementErrors((current) => ({
          ...current,
          [attemptKey]:
            cause instanceof Error ? cause.message : "Could not issue a replacement key.",
        }));
      }
    } finally {
      replacementInFlight.current.delete(attemptKey);
      setPendingReplacementKeys((current) => {
        const next = new Set(current);
        next.delete(attemptKey);

        return next;
      });
    }
  }

  function acknowledgeReplacementReview() {
    if (!replacementAttemptKey || !replacementStatusLoaded || !replacementNeedsReview) return;
    if (!updateReplacementAttemptMarker(replacementAttemptKey, null)) {
      setReplacementErrors((current) => ({
        ...current,
        [replacementAttemptKey]:
          "Could not save the review status in this browser. Enable site storage before allowing another attempt.",
      }));

      return;
    }
    setReplacementReviewByAttempt((current) => ({
      ...current,
      [replacementAttemptKey]: false,
    }));
    setReplacementErrors((current) => ({ ...current, [replacementAttemptKey]: "" }));
  }

  return {
    step,
    setStep,
    values,
    originInput,
    setOriginInput,
    selected,
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
  };
}
