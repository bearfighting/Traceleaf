"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, Input } from "./ui";

type Capability = { id: string; status: string; depends_on: string[] };
type Values = { name: string; websiteUrl: string; environment: string; origins: string[] };
type Created = {
  site: { site_id: string };
  initial_environment: string;
  ingest_key: { key: string; key_id: string };
};

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

export function deriveOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      return null;

    return parsed.origin;
  } catch {
    return null;
  }
}

export function closeCapabilityDependencies(ids: string[], manifest: Capability[]): string[] {
  const byId = new Map(manifest.map((item) => [item.id, item]));
  const enabled = new Set(["page_views", ...ids]);
  const include = (id: string) => {
    const capability = byId.get(id);
    if (!capability) return;
    enabled.add(id);
    capability.depends_on.forEach(include);
  };
  [...enabled].forEach(include);

  return [...enabled].filter((id) => byId.get(id)?.status === "implemented");
}

export function siteCreateFieldName(path: string): string {
  const segments = path
    .replace(/^\/+/, "")
    .split(/[/.]/)
    .filter(Boolean)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  const field = ["display_name", "website_url", "allowed_origins"].find((candidate) =>
    segments.includes(candidate),
  );
  const leaf = field ?? [...segments].reverse().find((segment) => !/^\d+$/.test(segment));

  switch (leaf) {
    case "display_name":
      return "name";
    case "website_url":
      return "websiteUrl";
    case "allowed_origins":
      return "origins";
    default:
      return leaf || "form";
  }
}

export function SiteCreationWizard({ manifest }: { manifest: Capability[] }) {
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
  const [created, setCreated] = useState<Created | null>(null);
  const [creating, setCreating] = useState(false);
  const createInFlight = useRef(false);
  const [replayedSiteId, setReplayedSiteId] = useState("");
  const [idempotency, setIdempotency] = useState<{ payload: string; key: string } | null>(null);
  const [replacementKey, setReplacementKey] = useState("");
  const [replacementError, setReplacementError] = useState("");
  const [replacementPending, setReplacementPending] = useState(false);
  const [replacementNeedsReview, setReplacementNeedsReview] = useState(false);
  const [replacementStatusLoaded, setReplacementStatusLoaded] = useState(false);
  const websiteOrigin = deriveOrigin(values.websiteUrl);
  const allowedOrigins = [
    ...new Set([...values.origins, ...(websiteOrigin ? [websiteOrigin] : [])]),
  ];
  const resultSiteId = created?.site.site_id || replayedSiteId || restoredSiteId || "";
  const resultEnvironment =
    created?.initial_environment || restoredEnvironment || values.environment;
  const replacementAttemptKey = resultSiteId
    ? replacementAttemptStorageKey(resultSiteId, resultEnvironment)
    : "";
  const enabledCapabilities = useMemo(
    () => closeCapabilityDependencies(selected, manifest),
    [selected, manifest],
  );

  // Check the marker immediately so an ambiguous key request cannot briefly expose a retry action.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!replacementAttemptKey) {
      setReplacementStatusLoaded(true);

      return;
    }
    try {
      setReplacementNeedsReview(window.localStorage.getItem(replacementAttemptKey) === "unknown");
    } catch {
      setReplacementNeedsReview(false);
    } finally {
      setReplacementStatusLoaded(true);
    }
  }, [replacementAttemptKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    const next: Record<string, string> = {};
    if (stepToValidate === 0) {
      if (!values.name.trim()) next.name = "Enter a Site name.";
      if (!websiteOrigin) next.websiteUrl = "Enter a valid http or https website URL.";
    }
    if (stepToValidate === 1) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(values.environment))
        next.environment = "Use 1–64 letters, numbers, _ or -, starting with a letter or number.";
      if (!websiteOrigin || !allowedOrigins.includes(websiteOrigin))
        next.origins = "Allowed Origins must include the website URL Origin.";
    }
    setFieldErrors(next);

    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (createInFlight.current) return;
    createInFlight.current = true;
    setCreating(true);
    const payload = {
      display_name: values.name.trim(),
      website_url: values.websiteUrl.trim(),
      environment: values.environment,
      capabilities: Object.fromEntries(
        manifest.map((item) => [item.id, enabledCapabilities.includes(item.id)]),
      ),
      allowed_origins: allowedOrigins,
    };
    const serialized = JSON.stringify(payload);
    const key = idempotency?.payload === serialized ? idempotency.key : crypto.randomUUID();
    setIdempotency({ payload: serialized, key });
    setError("");
    setFieldErrors({});
    setCreated(null);
    setReplayedSiteId("");
    try {
      const response = await fetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: serialized,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        const apiError = body?.error;
        const details = apiError?.details;
        if (Array.isArray(details)) {
          const mapped: Record<string, string> = {};
          for (const detail of details) {
            if (typeof detail?.path === "string" && typeof detail?.message === "string") {
              mapped[siteCreateFieldName(detail.path)] = detail.message;
            }
          }
          setFieldErrors(mapped);
        }
        setError(
          typeof apiError?.message === "string"
            ? apiError.message
            : "Site creation failed. Check the details and try again.",
        );

        return;
      }
      if (response.status === 200) {
        setReplayedSiteId(body.site.site_id);
        window.history.replaceState(
          null,
          "",
          `/dashboard/sites/new?site_id=${encodeURIComponent(body.site.site_id)}&environment=${encodeURIComponent(values.environment)}`,
        );
        setStep(4);

        return;
      }
      setCreated(body as Created);
      window.history.replaceState(
        null,
        "",
        `/dashboard/sites/new?site_id=${encodeURIComponent(body.site.site_id)}&environment=${encodeURIComponent(values.environment)}`,
      );
      setStep(4);
    } catch {
      setError(
        "The result could not be confirmed. Retry manually to check the same request safely.",
      );
    } finally {
      createInFlight.current = false;
      setCreating(false);
    }
  }

  async function issueReplacement() {
    if (!replacementStatusLoaded || replacementPending || replacementKey || replacementNeedsReview)
      return;

    const siteId = resultSiteId;
    const environment = resultEnvironment;
    if (!siteId) {
      setReplacementError("Site identity is missing. Open the Site from Settings and try again.");

      return;
    }

    setReplacementPending(true);
    setReplacementError("");
    let keyRequestStarted = false;
    let definitelyRejected = false;
    try {
      const base = `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-policy`;
      const policyResponse = await fetch(base, { cache: "no-store" });
      if (policyResponse.status === 404) {
        throw new Error(
          "No environment policy exists. Configure the environment explicitly in Settings before issuing a replacement key.",
        );
      }
      if (!policyResponse.ok) {
        const policyError = (await policyResponse.json()) as { error?: { message?: string } };

        throw new Error(policyError.error?.message || "Could not load environment policy.");
      }
      const etag = policyResponse.headers.get("ETag");
      if (!etag) throw new Error("Environment policy is missing its version tag.");

      if (!updateReplacementAttemptMarker(replacementAttemptKey, "unknown")) {
        throw new Error(
          "This browser cannot save the temporary key-request status. Enable site storage before issuing a replacement key.",
        );
      }
      keyRequestStarted = true;
      setReplacementNeedsReview(true);
      const keyResponse = await fetch(
        `/api/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-keys`,
        {
          method: "POST",
          headers: { "If-Match": etag },
          cache: "no-store",
        },
      );
      if (!keyResponse.ok && keyResponse.status < 500) {
        definitelyRejected = true;
        setReplacementNeedsReview(false);
        updateReplacementAttemptMarker(replacementAttemptKey, null);
      }
      const result = (await keyResponse.json()) as { key?: string; error?: { message?: string } };
      if (!keyResponse.ok)
        throw new Error(result?.error?.message || "Could not issue a replacement key.");
      if (!result.key) throw new Error("The replacement key response was invalid.");
      keyRequestStarted = false;
      setReplacementNeedsReview(false);
      updateReplacementAttemptMarker(replacementAttemptKey, null);
      setReplacementKey(result.key);
    } catch (cause) {
      if (keyRequestStarted && !definitelyRejected) {
        setReplacementNeedsReview(true);
        updateReplacementAttemptMarker(replacementAttemptKey, "unknown");
        setReplacementError(
          "The server may have issued a key, but its secret was not received. Check the environment's key list in Settings before allowing another attempt.",
        );
      } else {
        setReplacementError(
          cause instanceof Error ? cause.message : "Could not issue a replacement key.",
        );
      }
    } finally {
      setReplacementPending(false);
    }
  }

  if (step === 4) {
    const siteId = resultSiteId;
    const env = resultEnvironment;
    const key = created?.ingest_key.key || replacementKey;

    return (
      <section className="card max-w-3xl" aria-label="Site creation result">
        <h2 className="text-xl font-semibold">
          {created ? "Site created" : "Credentials need recovery"}
        </h2>
        <p className="mt-2 text-sm text-muted">
          Site ID: <code>{siteId}</code>
        </p>
        <p className="text-sm text-muted">
          Environment: <code>{env}</code>
        </p>
        <Link
          className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold"
          href={`/dashboard/settings?site_id=${encodeURIComponent(siteId)}&environment=${encodeURIComponent(env)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View connection status in Settings
        </Link>
        {created && (
          <>
            <p className="text-sm text-muted">Allowed Origins: {allowedOrigins.join(", ")}</p>
            <h3 className="mt-5 font-semibold">One-time Ingest Key</h3>
            <p className="text-sm text-muted">
              Copy this key now. It is held only in this page&apos;s memory and cannot be recovered
              after leaving or refreshing.
            </p>
          </>
        )}
        {replayedSiteId && (
          <p className="mt-3 text-sm">
            This request was already completed. Its original key cannot be recovered here.
          </p>
        )}
        {restored && (
          <p className="mt-3 text-sm">
            The original key is no longer available in this page. Creating a replacement keeps the
            current keys active until you verify the new one.
          </p>
        )}
        {key && (
          <div className="mt-3 flex gap-2">
            <code className="break-all rounded bg-slate-100 p-3">{key}</code>
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(key)}>
              Copy
            </Button>
          </div>
        )}
        {(replayedSiteId || restored) && (
          <Button
            className="mt-4"
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
          <div className="mt-3 rounded-lg border border-amber-700/20 bg-warning-soft p-3 text-sm text-amber-900">
            <p>
              Check the environment&apos;s key list in Settings. If a new key appeared, verify it or
              revoke it there before starting another replacement.
            </p>
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() => {
                updateReplacementAttemptMarker(replacementAttemptKey, null);
                setReplacementNeedsReview(false);
                setReplacementError("");
              }}
            >
              I reviewed the key list
            </Button>
          </div>
        )}
        {replacementError && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {replacementError}
          </p>
        )}
        {(created || replacementKey) && (
          <>
            <h3 className="mt-6 font-semibold">Install the browser SDK</h3>
            <pre className="mt-2 overflow-auto rounded bg-slate-950 p-4 text-sm text-white">{`# .env.local on the observed Next.js website\nNEXT_PUBLIC_ANALYTICS_TRANSPORT=fetch\nNEXT_PUBLIC_ANALYTICS_ENDPOINT=https://<collector-host>/v1/events\nNEXT_PUBLIC_ANALYTICS_SITE_ID=${siteId}\nNEXT_PUBLIC_ANALYTICS_INGEST_KEY=${key || "<copy the key above>"}`}</pre>
            <p className="mt-2 text-sm text-muted">
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
    <section className="card max-w-3xl" aria-label="Site creation wizard">
      <ol className="mb-6 flex flex-wrap gap-3 text-sm">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className={step === index ? "font-semibold text-blue-700" : "text-muted"}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <div className="grid gap-4">
          <label className="grid gap-1">
            Site name
            <Input value={values.name} onChange={(e) => update("name", e.target.value)} />
          </label>
          {fieldErrors.name && <p role="alert">{fieldErrors.name}</p>}
          <label className="grid gap-1">
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
        <div className="grid gap-4">
          <label className="grid gap-1">
            Environment
            <Input
              value={values.environment}
              onChange={(e) => update("environment", e.target.value)}
            />
          </label>
          {fieldErrors.environment && <p role="alert">{fieldErrors.environment}</p>}
          <div>
            <label className="grid gap-1">
              Allowed Origins
              <Input
                value={originInput}
                placeholder="https://www.example.com"
                onChange={(e) => setOriginInput(e.target.value)}
              />
            </label>
            <Button variant="secondary" className="mt-2" onClick={addOrigin}>
              Add Origin
            </Button>
            {fieldErrors.origins && <p role="alert">{fieldErrors.origins}</p>}
            <ul>
              {allowedOrigins.map((origin) => (
                <li key={origin} className="mt-2 flex items-center gap-2">
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
          <p className="text-sm text-muted">
            Origins are validated locally; the Dashboard does not request these URLs.
          </p>
        </div>
      )}
      {step === 2 && (
        <fieldset>
          <legend className="mb-3 font-semibold">Choose implemented capabilities</legend>
          {manifest
            .filter((item) => item.status === "implemented")
            .map((item) => (
              <label key={item.id} className="mb-2 flex gap-2">
                <input
                  type="checkbox"
                  className="mt-1 accent-brand"
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
          <p className="mt-3 text-sm text-muted">
            Required dependencies are enabled automatically.
          </p>
        </fieldset>
      )}
      {step === 3 && (
        <div className="space-y-2 text-sm">
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
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {Object.entries(fieldErrors)
        .filter(([, message]) => Boolean(message))
        .map(([field, message]) => (
          <p role="alert" key={field} className="mt-2 text-sm text-red-700">
            {field}: {message}
          </p>
        ))}
      <div className="mt-6 flex justify-between">
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
