"use client";

import React, { useState } from "react";

import * as UI from "../ui";

import {
  addPropertyCondition,
  changePropertyConditionType,
  removePropertyCondition,
  renamePropertyCondition,
  updatePropertyConditionValue,
} from "./definition-editor/definition-domain";
import { useDefinitionFlow } from "./definition-editor/use-definition-flow";

import type { DefinitionLoadResult } from "../../lib/settings/configuration-api/server";
import type { DefinitionSetResponse } from "../../lib/settings/configuration-api/types";

export function DefinitionEditor({
  siteId,
  result,
}: {
  siteId: string;
  result: DefinitionLoadResult;
}) {
  const [savedState, setSavedState] = useState<{ siteId: string; message: string } | null>(null);
  const savedMessage = savedState?.siteId === siteId ? savedState.message : "";
  const onSavedMessageChange = (message: string) =>
    setSavedState(message ? { siteId, message } : null);

  if (result.kind !== "ready")
    return (
      <section className="card" role="alert" id="definitions">
        <h2>Definition management unavailable</h2>
        <p>{result.message}</p>
      </section>
    );

  return (
    <Editor
      key={`${siteId}:${result.definitions?.revision ?? "new"}`}
      siteId={siteId}
      initial={result.definitions}
      savedMessage={savedMessage}
      onSavedMessageChange={onSavedMessageChange}
    />
  );
}

function Editor({
  siteId,
  initial,
  savedMessage,
  onSavedMessageChange,
}: {
  siteId: string;
  initial: DefinitionSetResponse | null;
  savedMessage: string;
  onSavedMessageChange: (message: string) => void;
}) {
  const flow = useDefinitionFlow(siteId, initial, savedMessage, onSavedMessageChange);

  return (
    <DefinitionEditorPresenter
      conversions={flow.conversions}
      funnels={flow.funnels}
      baseline={flow.baseline}
      revision={flow.revision}
      definitionVersion={flow.definitionVersion}
      busy={flow.busy}
      error={flow.error}
      message={flow.message}
      versionConflict={flow.versionConflict}
      confirmReload={flow.confirmReload}
      onConfirmationChange={flow.setConfirmReload}
      onSave={flow.save}
      onReload={flow.reloadLatest}
      actions={flow.actions}
    />
  );
}

export type DefinitionEditorPresenterProps = {
  conversions: ReturnType<typeof useDefinitionFlow>["conversions"];
  funnels: ReturnType<typeof useDefinitionFlow>["funnels"];
  baseline: ReturnType<typeof useDefinitionFlow>["baseline"];
  revision: number | undefined;
  definitionVersion: string | undefined;
  busy: boolean;
  error: string;
  message: string;
  versionConflict: boolean;
  confirmReload: boolean;
  onConfirmationChange: (open: boolean) => void;
  onSave: () => Promise<string>;
  onReload: (force?: boolean) => Promise<void>;
  actions: ReturnType<typeof useDefinitionFlow>["actions"];
};

export function DefinitionEditorPresenter({
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
  onConfirmationChange,
  onSave,
  onReload,
  actions,
}: DefinitionEditorPresenterProps) {
  return (
    <section
      className="card definition-editor"
      aria-label="Conversion and funnel definitions"
      id="definitions"
    >
      <h2>Conversions and funnels</h2>
      <p>
        Each save creates an immutable site revision. Deactivate definitions to preserve their IDs
        and historical facts.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          {versionConflict && (
            <UI.Button type="button" disabled={busy} onClick={() => void onReload()}>
              {busy ? "Loading latest definitions…" : "Reload latest definitions"}
            </UI.Button>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {revision !== undefined && (
        <p>
          Stored revision: {revision} · {definitionVersion}
        </p>
      )}
      <fieldset className="definition-groups" disabled={busy}>
        <section className="definition-group" aria-labelledby="conversions-heading">
          <h3 id="conversions-heading">Conversions</h3>
          {conversions.map((item, index) => (
            <fieldset key={item.id} className="card definition-item">
              <legend>{item.name || item.id || "Conversion"}</legend>
              <label className="definition-field">
                ID{" "}
                <UI.Input
                  value={item.id}
                  disabled={index < (baseline?.conversions.length ?? 0)}
                  onChange={(event) => actions.updateConversion(index, { id: event.target.value })}
                />
              </label>
              <label className="definition-field">
                Name{" "}
                <UI.Input
                  value={item.name}
                  onChange={(event) =>
                    actions.updateConversion(index, { name: event.target.value })
                  }
                />
              </label>
              <label className="definition-field">
                Event name{" "}
                <UI.Input
                  value={item.event_name}
                  onChange={(event) =>
                    actions.updateConversion(index, { event_name: event.target.value })
                  }
                />
              </label>
              <PropertyConditions
                value={item.properties}
                onChange={(properties) => actions.updateConversion(index, { properties })}
              />
              <label className="definition-active-toggle">
                <UI.Checkbox
                  type="checkbox"
                  checked={item.active}
                  onChange={(event) =>
                    actions.updateConversion(index, { active: event.target.checked })
                  }
                />{" "}
                Active
              </label>
            </fieldset>
          ))}
          <UI.Button
            type="button"
            className="button-fit"
            variant="secondary"
            onClick={actions.addConversion}
          >
            Add conversion
          </UI.Button>
        </section>
        <section className="definition-group" aria-labelledby="funnels-heading">
          <h3 id="funnels-heading">Funnels</h3>
          {funnels.map((item, index) => (
            <fieldset key={`${item.id}:${index}`} className="card definition-item">
              <legend>{item.name || item.id || "Funnel"}</legend>
              <label className="definition-field">
                ID{" "}
                <UI.Input
                  value={item.id}
                  disabled={index < (baseline?.funnels.length ?? 0)}
                  onChange={(event) => actions.updateFunnel(index, { id: event.target.value })}
                />
              </label>
              <label className="definition-field">
                Name{" "}
                <UI.Input
                  value={item.name}
                  onChange={(event) => actions.updateFunnel(index, { name: event.target.value })}
                />
              </label>
              <h4 className="definition-subheading">Ordered steps</h4>
              {item.steps.map((step, stepIndex) => (
                <fieldset className="definition-step" key={`step-${stepIndex}`}>
                  <legend>Step {stepIndex + 1}</legend>
                  <label className="definition-field">
                    Event name{" "}
                    <UI.Input
                      value={step.event_name}
                      onChange={(event) =>
                        actions.updateFunnelStep(index, stepIndex, {
                          event_name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <PropertyConditions
                    value={step.properties}
                    onChange={(properties) =>
                      actions.updateFunnelStep(index, stepIndex, { properties })
                    }
                  />
                  {item.steps.length > 2 && (
                    <UI.Button
                      type="button"
                      variant="secondary"
                      onClick={() => actions.removeFunnelStep(index, stepIndex)}
                    >
                      Remove step
                    </UI.Button>
                  )}
                </fieldset>
              ))}
              <UI.Button
                type="button"
                variant="secondary"
                onClick={() => actions.addFunnelStep(index)}
              >
                Add step
              </UI.Button>
              <label className="definition-active-toggle">
                <UI.Checkbox
                  type="checkbox"
                  checked={item.active}
                  onChange={(event) =>
                    actions.updateFunnel(index, { active: event.target.checked })
                  }
                />{" "}
                Active
              </label>
            </fieldset>
          ))}
          <UI.Button
            type="button"
            className="button-fit"
            variant="secondary"
            onClick={actions.addFunnel}
          >
            Add funnel
          </UI.Button>
        </section>
      </fieldset>
      <div className="definition-editor-actions">
        <UI.Button
          type="button"
          className="button-fit"
          disabled={busy}
          onClick={() => void onSave()}
        >
          {busy ? "Saving…" : "Save new revision"}
        </UI.Button>
      </div>
      <UI.AlertDialog
        open={confirmReload}
        title="Discard unsaved changes?"
        description="Reload the latest definitions and discard your unsaved changes?"
        confirmLabel="Reload definitions"
        onCancel={() => onConfirmationChange(false)}
        onConfirm={() => void onReload(true)}
      />
    </section>
  );
}

function PropertyConditions({
  value,
  onChange,
}: {
  value: Record<string, string | number | boolean | null> | null | undefined;
  onChange: (value: Record<string, string | number | boolean | null>) => void;
}) {
  const conditions = value ?? {};

  return (
    <fieldset className="property-conditions">
      <legend>Property conditions</legend>
      {Object.entries(conditions).map(([key, propertyValue], index) => {
        const type = propertyValue === null ? "null" : typeof propertyValue;

        return (
          <div key={`${key}:${index}`} className="property-condition-row">
            <label className="definition-field">
              Key{" "}
              <UI.Input
                value={key}
                onChange={(event) => {
                  onChange(renamePropertyCondition(value, key, event.target.value));
                }}
              />
            </label>
            <label className="definition-field">
              Type{" "}
              <UI.Select
                value={type}
                onChange={(event) => {
                  onChange(
                    changePropertyConditionType(
                      value,
                      key,
                      event.target.value as "string" | "number" | "boolean" | "null",
                    ),
                  );
                }}
              >
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="null">Null</option>
              </UI.Select>
            </label>
            {type === "boolean" ? (
              <label className="definition-field">
                Value{" "}
                <UI.Select
                  value={String(propertyValue)}
                  onChange={(event) =>
                    onChange(
                      updatePropertyConditionValue(value, key, event.target.value === "true"),
                    )
                  }
                >
                  <option value="true">True</option>
                  <option value="false">False</option>
                </UI.Select>
              </label>
            ) : type !== "null" ? (
              <label className="definition-field">
                Value{" "}
                <UI.Input
                  value={String(propertyValue)}
                  type={type === "number" ? "number" : "text"}
                  onChange={(event) =>
                    onChange(
                      updatePropertyConditionValue(
                        value,
                        key,
                        type === "number" ? Number(event.target.value) : event.target.value,
                      ),
                    )
                  }
                />
              </label>
            ) : null}
            <UI.Button type="button" onClick={() => onChange(removePropertyCondition(value, key))}>
              Remove condition
            </UI.Button>
          </div>
        );
      })}
      <UI.Button type="button" onClick={() => onChange(addPropertyCondition(conditions))}>
        Add property condition
      </UI.Button>
    </fieldset>
  );
}
