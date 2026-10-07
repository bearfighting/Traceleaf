import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { initializeCapabilities, saveCapabilities as persistCapabilities } from "./capability-api";
import { capabilityToggleError, updateCapabilityDraft } from "./capability-domain";

import type { CapabilityResponse } from "../../../lib/settings/configuration-api/types";

export function useCapabilityFlow(siteId: string, initial?: CapabilityResponse) {
  const router = useRouter();
  const [capabilities, setCapabilities] = useState(initial?.configuration.capabilities);
  const [response, setResponse] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setHydrated(true), 0);

    return () => window.clearTimeout(timer);
  }, []);

  const currentResponse =
    response && initial && response.configuration.version === initial.configuration.version
      ? { ...response, effective_state: initial.effective_state }
      : response;

  async function initialize() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await initializeCapabilities(siteId);
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

  function toggle(id: string, enabled: boolean) {
    if (!capabilities) return;
    const issue = capabilityToggleError(capabilities, id, enabled);
    if (issue) {
      setError(issue);

      return;
    }
    setError("");
    setCapabilities(updateCapabilityDraft(capabilities, id, enabled));
  }

  async function save() {
    if (!response || !capabilities || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await persistCapabilities(siteId, response.configuration.version, capabilities);
      setResponse(saved);
      setCapabilities(saved.configuration.capabilities);
      setMessage("Capabilities saved.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Configuration request failed.");
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    hydrated,
    error,
    message,
    capabilities,
    response: currentResponse,
    initialize,
    toggle,
    save,
  };
}
