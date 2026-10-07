"use client";

import { SiteCreationResultView } from "./site-creation-wizard/site-creation-result";
import { SiteCreationSteps } from "./site-creation-wizard/site-creation-steps";
import { useSiteCreationFlow } from "./site-creation-wizard/use-site-creation-flow";

import type { Capability } from "./site-creation-wizard/site-creation-domain";

export function SiteCreationWizard({ manifest }: { manifest: Capability[] }) {
  const flow = useSiteCreationFlow(manifest);

  if (flow.step === 4) {
    return (
      <SiteCreationResultView
        created={flow.created}
        replayedSiteId={flow.replayedSiteId}
        restored={flow.restored}
        siteId={flow.resultSiteId}
        environment={flow.resultEnvironment}
        allowedOrigins={flow.allowedOrigins}
        replacementKey={flow.replacementKey}
        replacementError={flow.replacementError}
        replacementPending={flow.replacementPending}
        replacementNeedsReview={flow.replacementNeedsReview}
        replacementStatusLoaded={flow.replacementStatusLoaded}
        onCopyKey={(key) => void navigator.clipboard.writeText(key)}
        onIssueReplacement={() => void flow.issueReplacement()}
        onAcknowledgeReview={flow.acknowledgeReplacementReview}
      />
    );
  }

  return (
    <SiteCreationSteps
      manifest={manifest}
      step={flow.step}
      values={flow.values}
      originInput={flow.originInput}
      setOriginInput={flow.setOriginInput}
      setSelected={flow.setSelected}
      error={flow.error}
      fieldErrors={flow.fieldErrors}
      creating={flow.creating}
      websiteOrigin={flow.websiteOrigin}
      allowedOrigins={flow.allowedOrigins}
      enabledCapabilities={flow.enabledCapabilities}
      update={flow.update}
      updateWebsiteUrl={flow.updateWebsiteUrl}
      addOrigin={flow.addOrigin}
      onBack={() => flow.setStep((current) => current - 1)}
      onContinue={() => {
        if (flow.validate(flow.step)) flow.setStep((current) => current + 1);
      }}
      onSubmit={() => void flow.submit()}
    />
  );
}
