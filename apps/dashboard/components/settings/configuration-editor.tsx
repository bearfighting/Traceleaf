"use client";

import React from "react";

import {
  CapabilityEditorPresenter,
  InitializeCapabilitiesPresenter,
} from "./capability-editor/capability-presenter";
import { useCapabilityFlow } from "./capability-editor/use-capability-flow";
import { ConfigurationErrorFeedback } from "./configuration-error-feedback";
import { EnvironmentPolicyPresenter } from "./environment-policy/environment-policy-presenter";
import { useEnvironmentPolicyFlow } from "./environment-policy/use-environment-policy-flow";

import type { ConfigurationLoadResult } from "../../lib/settings/configuration-api/server";
import type {
  CapabilityResponse,
  IngestPolicyResponse,
} from "../../lib/settings/configuration-api/types";

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

  if (section === "capabilities")
    return (
      <CapabilityEditor
        key={`${siteId}:${result.capabilities.configuration.version}`}
        siteId={siteId}
        initial={result.capabilities}
      />
    );

  return (
    <Editor
      key={`${siteId}:${environment}:${result.capabilities.configuration.version}:${result.policy?.policy.version ?? "new"}`}
      siteId={siteId}
      environment={environment}
      initialPolicy={result.policy}
      section={section}
    />
  );
}

function InitializeCapabilities({ siteId }: { siteId: string }) {
  const flow = useCapabilityFlow(siteId);

  return (
    <InitializeCapabilitiesPresenter
      busy={flow.busy}
      error={flow.error}
      onInitialize={() => void flow.initialize()}
    />
  );
}

function CapabilityEditor({ siteId, initial }: { siteId: string; initial: CapabilityResponse }) {
  const flow = useCapabilityFlow(siteId, initial);
  if (!flow.capabilities || !flow.response) return null;

  return (
    <CapabilityEditorPresenter
      capabilities={flow.capabilities}
      response={flow.response}
      busy={flow.busy}
      hydrated={flow.hydrated}
      error={flow.error}
      message={flow.message}
      onToggle={flow.toggle}
      onSave={() => void flow.save()}
      onReload={() => window.location.reload()}
    />
  );
}

function Editor({
  siteId,
  environment,
  initialPolicy,
  section,
}: {
  siteId: string;
  environment: string;
  initialPolicy: IngestPolicyResponse | null;
  section: "overview" | "capabilities" | "environments";
}) {
  const flow = useEnvironmentPolicyFlow(siteId, environment, initialPolicy);
  if (section !== "environments") return null;

  return (
    <EnvironmentPolicyPresenter
      environment={environment}
      policy={flow.policy}
      values={flow.values}
      onChange={flow.setValues}
      onSave={() => void flow.save()}
      onReload={() => window.location.reload()}
      busy={flow.busy}
      hydrated={flow.hydrated}
      message={flow.message}
      error={flow.error}
    />
  );
}

export { ConfigurationErrorFeedback };
