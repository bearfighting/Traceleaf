"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { saveEnvironmentPolicy } from "../../lib/environment-policy/api";
import { policyFormValues, toEnvironmentPolicyPayload } from "../../lib/environment-policy/domain";

import type { IngestPolicyResponse } from "../../lib/configuration-api/types";

export function useEnvironmentPolicyFlow(
  siteId: string,
  environment: string,
  initial: IngestPolicyResponse | null,
) {
  const router = useRouter();
  const [policy, setPolicy] = useState(initial);
  const [values, setValues] = useState(() => policyFormValues(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setHydrated(true), 0);

    return () => window.clearTimeout(timer);
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await saveEnvironmentPolicy(
        siteId,
        environment,
        toEnvironmentPolicyPayload(values),
        policy,
      );
      setPolicy(saved);
      setValues(policyFormValues(saved));
      setMessage(
        `Website access settings saved. Ingestion is ${saved.policy.enabled ? "enabled" : "disabled"}.`,
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Configuration request failed.");
    } finally {
      setBusy(false);
    }
  }

  const currentPolicy =
    policy && initial && policy.policy.version === initial.policy.version
      ? { ...policy, effective_state: initial.effective_state }
      : policy;

  return { policy: currentPolicy, values, setValues, busy, hydrated, message, error, save };
}
