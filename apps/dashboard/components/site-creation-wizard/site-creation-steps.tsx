import { Button, Checkbox, Input } from "../ui";

import type { Capability, SiteCreationValues } from "./site-creation-domain";
import type { Dispatch, SetStateAction } from "react";

type UpdateSiteCreationValue = <Key extends keyof SiteCreationValues>(
  key: Key,
  value: SiteCreationValues[Key],
) => void;

type SiteCreationStepsProps = {
  manifest: Capability[];
  step: number;
  values: SiteCreationValues;
  originInput: string;
  setOriginInput: Dispatch<SetStateAction<string>>;
  setSelected: Dispatch<SetStateAction<string[]>>;
  error: string;
  fieldErrors: Record<string, string>;
  creating: boolean;
  websiteOrigin: string | null;
  allowedOrigins: string[];
  enabledCapabilities: string[];
  update: UpdateSiteCreationValue;
  updateWebsiteUrl: (websiteUrl: string) => void;
  addOrigin: () => void;
  onBack: () => void;
  onContinue: () => void;
  onSubmit: () => void;
};

export function SiteCreationSteps({
  manifest,
  step,
  values,
  originInput,
  setOriginInput,
  setSelected,
  error,
  fieldErrors,
  creating,
  websiteOrigin,
  allowedOrigins,
  enabledCapabilities,
  update,
  updateWebsiteUrl,
  addOrigin,
  onBack,
  onContinue,
  onSubmit,
}: SiteCreationStepsProps) {
  const steps = ["Site details", "Environment & Origins", "Capabilities", "Review"];

  return (
    <section className="card onboarding-panel" aria-label="Site creation wizard">
      <ol className="onboarding-steps">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className="onboarding-step"
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <div className="onboarding-step-content">
          <label className="form-field">
            Site name
            <Input value={values.name} onChange={(e) => update("name", e.target.value)} />
          </label>
          {fieldErrors.name && <p role="alert">{fieldErrors.name}</p>}
          <label className="form-field">
            Website URL
            <Input
              type="url"
              placeholder="https://example.com"
              value={values.websiteUrl}
              onChange={(e) => updateWebsiteUrl(e.target.value)}
            />
          </label>
          {fieldErrors.websiteUrl && <p role="alert">{fieldErrors.websiteUrl}</p>}
        </div>
      )}
      {step === 1 && (
        <div className="onboarding-step-content">
          <label className="form-field">
            Environment
            <Input
              value={values.environment}
              onChange={(e) => update("environment", e.target.value)}
            />
          </label>
          {fieldErrors.environment && <p role="alert">{fieldErrors.environment}</p>}
          <div>
            <label className="form-field">
              Allowed Origins
              <Input
                value={originInput}
                placeholder="https://www.example.com"
                onChange={(e) => setOriginInput(e.target.value)}
              />
            </label>
            <Button variant="secondary" className="onboarding-add-origin" onClick={addOrigin}>
              Add Origin
            </Button>
            {fieldErrors.origins && <p role="alert">{fieldErrors.origins}</p>}
            <ul className="origin-entry-list">
              {allowedOrigins.map((origin) => (
                <li key={origin} className="origin-entry">
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
          <p className="onboarding-copy">
            Origins are validated locally; the Dashboard does not request these URLs.
          </p>
        </div>
      )}
      {step === 2 && (
        <fieldset className="capability-choice-list">
          <legend>Choose implemented capabilities</legend>
          {manifest
            .filter((item) => item.status === "implemented")
            .map((item) => (
              <label key={item.id} className="capability-choice">
                <Checkbox
                  type="checkbox"
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
          <p className="onboarding-copy">Required dependencies are enabled automatically.</p>
        </fieldset>
      )}
      {step === 3 && (
        <div className="onboarding-review">
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
        <p role="alert" className="onboarding-error">
          {error}
        </p>
      )}
      {Object.entries(fieldErrors)
        .filter(([, message]) => Boolean(message))
        .map(([field, message]) => (
          <p role="alert" key={field} className="onboarding-error">
            {field}: {message}
          </p>
        ))}
      <div className="onboarding-wizard-actions">
        <Button variant="secondary" disabled={step === 0 || creating} onClick={onBack}>
          Back
        </Button>
        {step < 3 ? (
          <Button onClick={onContinue}>Continue</Button>
        ) : (
          <Button disabled={creating} onClick={onSubmit}>
            {creating ? "Creating Site…" : "Create Site"}
          </Button>
        )}
      </div>
    </section>
  );
}
