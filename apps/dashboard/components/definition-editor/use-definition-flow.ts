import { useRouter } from "next/navigation";
import { useState } from "react";

import { DefinitionRequestError, loadLatestDefinitions, saveDefinitions } from "./definition-api";
import {
  addConversion,
  addFunnel,
  addFunnelStep,
  hasUnsavedDefinitionChanges,
  removeFunnelStep,
  updateConversion,
  updateFunnel,
  updateFunnelStep,
} from "./definition-domain";

import type { DefinitionDraft } from "./definition-domain";
import type { DefinitionSetResponse } from "../../lib/configuration-api/types";

export function useDefinitionFlow(
  siteId: string,
  initial: DefinitionSetResponse | null,
  initialMessage: string,
  onSavedMessageChange: (message: string) => void,
) {
  const router = useRouter();
  const [conversions, setConversions] = useState(initial?.conversions ?? []);
  const [funnels, setFunnels] = useState(initial?.funnels ?? []);
  const [baseline, setBaseline] = useState(initial);
  const [revision, setRevision] = useState(initial?.revision);
  const [definitionVersion, setDefinitionVersion] = useState(initial?.definition_version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [versionConflict, setVersionConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const hasUnsavedChanges = hasUnsavedDefinitionChanges({ conversions, funnels }, baseline);

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    onSavedMessageChange("");
    setVersionConflict(false);
    try {
      const saved = await saveDefinitions(siteId, revision, { conversions, funnels });
      setConversions(saved.conversions);
      setFunnels(saved.funnels);
      setRevision(saved.revision);
      setDefinitionVersion(saved.definition_version);
      setBaseline(saved);
      const successMessage = `Saved revision ${saved.definition_version}. Events processed from ${saved.effective_at ?? "the imported baseline"} onward will use it.`;
      setMessage(successMessage);
      onSavedMessageChange(successMessage);
      router.refresh();

      return successMessage;
    } catch (reason) {
      if (reason instanceof DefinitionRequestError && reason.revisionConflict)
        setVersionConflict(true);
      setError(reason instanceof Error ? reason.message : "Could not save definitions.");

      return "";
    } finally {
      setBusy(false);
    }
  }

  async function reloadLatest(force = false) {
    if (hasUnsavedChanges && !force) {
      setConfirmReload(true);

      return;
    }
    setConfirmReload(false);
    setBusy(true);
    setError("");
    setMessage("");
    onSavedMessageChange("");
    try {
      const latest = await loadLatestDefinitions(siteId);
      setConversions(latest.conversions);
      setFunnels(latest.funnels);
      setRevision(latest.revision);
      setDefinitionVersion(latest.definition_version);
      setBaseline(latest);
      setVersionConflict(false);
      setMessage(`Loaded latest definitions at revision ${latest.definition_version}.`);
    } catch (reason) {
      if (reason instanceof DefinitionRequestError && reason.revisionConflict)
        setVersionConflict(true);
      setError(reason instanceof Error ? reason.message : "Could not reload definitions.");
    } finally {
      setBusy(false);
    }
  }

  const draft: DefinitionDraft = { conversions, funnels };
  const actions = {
    updateConversion: (index: number, update: Partial<(typeof conversions)[number]>) =>
      setConversions((current) => updateConversion(current, index, update)),
    addConversion: () => setConversions((current) => addConversion(current)),
    updateFunnel: (index: number, update: Partial<(typeof funnels)[number]>) =>
      setFunnels((current) => updateFunnel(current, index, update)),
    addFunnel: () => setFunnels((current) => addFunnel(current)),
    updateFunnelStep: (
      funnelIndex: number,
      stepIndex: number,
      update: Partial<(typeof funnels)[number]["steps"][number]>,
    ) => setFunnels((current) => updateFunnelStep(current, funnelIndex, stepIndex, update)),
    addFunnelStep: (funnelIndex: number) =>
      setFunnels((current) => addFunnelStep(current, funnelIndex)),
    removeFunnelStep: (funnelIndex: number, stepIndex: number) =>
      setFunnels((current) => removeFunnelStep(current, funnelIndex, stepIndex)),
  };

  return {
    conversions,
    funnels,
    baseline,
    revision,
    definitionVersion,
    busy,
    error,
    message,
    versionConflict,
    confirmReload,
    draft,
    setConfirmReload,
    save,
    reloadLatest,
    actions,
  };
}
