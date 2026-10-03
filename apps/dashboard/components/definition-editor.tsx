"use client";

import { useRouter } from "next/navigation";
import React, { useState } from "react";

import { configurationRequestError } from "../lib/configuration-api/errors";

import type { DefinitionLoadResult } from "../lib/configuration-api/server";
import type { DefinitionSetResponse } from "../lib/configuration-api/types";

type Conversion = DefinitionSetResponse["conversions"][number];
type Funnel = DefinitionSetResponse["funnels"][number];
const blankConversion = (): Conversion => ({
  id: "",
  name: "",
  event_name: "",
  active: true,
  properties: {},
});
const blankFunnel = (): Funnel => ({
  id: "",
  name: "",
  active: true,
  steps: [
    { event_name: "", properties: {} },
    { event_name: "", properties: {} },
  ],
});

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
  const router = useRouter();
  const [conversions, setConversions] = useState(initial?.conversions ?? []);
  const [funnels, setFunnels] = useState(initial?.funnels ?? []);
  const [baseline, setBaseline] = useState(initial);
  const [revision, setRevision] = useState(initial?.revision);
  const [definitionVersion, setDefinitionVersion] = useState(initial?.definition_version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(savedMessage);
  const [versionConflict, setVersionConflict] = useState(false);
  const hasUnsavedChanges =
    JSON.stringify({ conversions, funnels }) !==
    JSON.stringify({ conversions: baseline?.conversions ?? [], funnels: baseline?.funnels ?? [] });

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    onSavedMessageChange("");
    setVersionConflict(false);
    try {
      const response = await fetch(
        `/api/admin/sites/${encodeURIComponent(siteId)}/conversion-funnel-definitions`,
        {
          method: revision === undefined ? "POST" : "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(revision === undefined
              ? { "If-None-Match": "*" }
              : { "If-Match": `"${revision}"` }),
          },
          body: JSON.stringify({ conversions, funnels }),
          cache: "no-store",
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) setVersionConflict(true);

        throw new Error(configurationRequestError(response.status, body));
      }
      const saved = body as DefinitionSetResponse;
      setConversions(saved.conversions);
      setFunnels(saved.funnels);
      setRevision(saved.revision);
      setDefinitionVersion(saved.definition_version);
      setBaseline(saved);
      const savedMessage = `Saved revision ${saved.definition_version}. Events processed from ${saved.effective_at ?? "the imported baseline"} onward will use it.`;
      setMessage(savedMessage);
      onSavedMessageChange(savedMessage);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save definitions.");
    } finally {
      setBusy(false);
    }
  }

  async function reloadLatest() {
    if (
      hasUnsavedChanges &&
      !window.confirm("Reload the latest definitions and discard your unsaved changes?")
    )
      return;

    setBusy(true);
    setError("");
    setMessage("");
    onSavedMessageChange("");
    try {
      const response = await fetch(
        `/api/admin/sites/${encodeURIComponent(siteId)}/conversion-funnel-definitions`,
        { method: "GET", cache: "no-store" },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(configurationRequestError(response.status, body));
      const latest = body as DefinitionSetResponse;
      setConversions(latest.conversions);
      setFunnels(latest.funnels);
      setRevision(latest.revision);
      setDefinitionVersion(latest.definition_version);
      setBaseline(latest);
      setVersionConflict(false);
      setMessage(`Loaded latest definitions at revision ${latest.definition_version}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reload definitions.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Conversion and funnel definitions" id="definitions">
      <h2>Conversions and funnels</h2>
      <p>
        Each save creates an immutable site revision. Deactivate definitions to preserve their IDs
        and historical facts.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          {versionConflict && (
            <button type="button" disabled={busy} onClick={() => void reloadLatest()}>
              {busy ? "Loading latest definitions…" : "Reload latest definitions"}
            </button>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {revision !== undefined && (
        <p>
          Stored revision: {revision} · {definitionVersion}
        </p>
      )}
      <fieldset disabled={busy}>
        <h3>Conversions</h3>
        {conversions.map((item, index) => (
          <fieldset key={item.id} className="card">
            <legend>{item.name || item.id || "Conversion"}</legend>
            <label>
              ID{" "}
              <input
                value={item.id}
                disabled={index < (baseline?.conversions.length ?? 0)}
                onChange={(event) =>
                  setConversions(
                    conversions.map((row, i) =>
                      i === index ? { ...row, id: event.target.value } : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Name{" "}
              <input
                value={item.name}
                onChange={(event) =>
                  setConversions(
                    conversions.map((row, i) =>
                      i === index ? { ...row, name: event.target.value } : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Event name{" "}
              <input
                value={item.event_name}
                onChange={(event) =>
                  setConversions(
                    conversions.map((row, i) =>
                      i === index ? { ...row, event_name: event.target.value } : row,
                    ),
                  )
                }
              />
            </label>
            <PropertyConditions
              value={item.properties}
              onChange={(properties) =>
                setConversions(
                  conversions.map((row, i) => (i === index ? { ...row, properties } : row)),
                )
              }
            />
            <label>
              <input
                type="checkbox"
                checked={item.active}
                onChange={(event) =>
                  setConversions(
                    conversions.map((row, i) =>
                      i === index ? { ...row, active: event.target.checked } : row,
                    ),
                  )
                }
              />{" "}
              Active
            </label>
          </fieldset>
        ))}
        <button type="button" onClick={() => setConversions([...conversions, blankConversion()])}>
          Add conversion
        </button>
        <h3>Funnels</h3>
        {funnels.map((item, index) => (
          <fieldset key={`${item.id}:${index}`} className="card">
            <legend>{item.name || item.id || "Funnel"}</legend>
            <label>
              ID{" "}
              <input
                value={item.id}
                disabled={index < (baseline?.funnels.length ?? 0)}
                onChange={(event) =>
                  setFunnels(
                    funnels.map((row, i) =>
                      i === index ? { ...row, id: event.target.value } : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Name{" "}
              <input
                value={item.name}
                onChange={(event) =>
                  setFunnels(
                    funnels.map((row, i) =>
                      i === index ? { ...row, name: event.target.value } : row,
                    ),
                  )
                }
              />
            </label>
            <h4>Ordered steps</h4>
            {item.steps.map((step, stepIndex) => (
              <fieldset key={`step-${stepIndex}`}>
                <legend>Step {stepIndex + 1}</legend>
                <label>
                  Event name{" "}
                  <input
                    value={step.event_name}
                    onChange={(event) =>
                      setFunnels(
                        funnels.map((row, i) =>
                          i === index
                            ? {
                                ...row,
                                steps: row.steps.map((value, j) =>
                                  j === stepIndex
                                    ? { ...value, event_name: event.target.value }
                                    : value,
                                ),
                              }
                            : row,
                        ),
                      )
                    }
                  />
                </label>
                <PropertyConditions
                  value={step.properties}
                  onChange={(properties) =>
                    setFunnels(
                      funnels.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              steps: row.steps.map((value, j) =>
                                j === stepIndex ? { ...value, properties } : value,
                              ),
                            }
                          : row,
                      ),
                    )
                  }
                />
                {item.steps.length > 2 && (
                  <button
                    type="button"
                    onClick={() =>
                      setFunnels(
                        funnels.map((row, i) =>
                          i === index
                            ? { ...row, steps: row.steps.filter((_, j) => j !== stepIndex) }
                            : row,
                        ),
                      )
                    }
                  >
                    Remove step
                  </button>
                )}
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() =>
                setFunnels(
                  funnels.map((row, i) =>
                    i === index
                      ? { ...row, steps: [...row.steps, { event_name: "", properties: {} }] }
                      : row,
                  ),
                )
              }
            >
              Add step
            </button>
            <label>
              <input
                type="checkbox"
                checked={item.active}
                onChange={(event) =>
                  setFunnels(
                    funnels.map((row, i) =>
                      i === index ? { ...row, active: event.target.checked } : row,
                    ),
                  )
                }
              />{" "}
              Active
            </label>
          </fieldset>
        ))}
        <button type="button" onClick={() => setFunnels([...funnels, blankFunnel()])}>
          Add funnel
        </button>
      </fieldset>
      <button type="button" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save new revision"}
      </button>
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
    <fieldset>
      <legend>Property conditions</legend>
      {Object.entries(conditions).map(([key, propertyValue], index) => {
        const type = propertyValue === null ? "null" : typeof propertyValue;

        return (
          <div key={`${key}:${index}`}>
            <label>
              Key{" "}
              <input
                value={key}
                onChange={(event) => {
                  const next = { ...value };
                  delete next[key];
                  next[event.target.value] = propertyValue;
                  onChange(next);
                }}
              />
            </label>
            <label>
              Type{" "}
              <select
                value={type}
                onChange={(event) => {
                  const nextType = event.target.value;
                  onChange({
                    ...value,
                    [key]:
                      nextType === "null"
                        ? null
                        : nextType === "boolean"
                          ? false
                          : nextType === "number"
                            ? 0
                            : "",
                  });
                }}
              >
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="null">Null</option>
              </select>
            </label>
            {type === "boolean" ? (
              <label>
                Value{" "}
                <select
                  value={String(propertyValue)}
                  onChange={(event) => onChange({ ...value, [key]: event.target.value === "true" })}
                >
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </label>
            ) : type !== "null" ? (
              <label>
                Value{" "}
                <input
                  value={String(propertyValue)}
                  type={type === "number" ? "number" : "text"}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      [key]: type === "number" ? Number(event.target.value) : event.target.value,
                    })
                  }
                />
              </label>
            ) : null}
            <button
              type="button"
              onClick={() => {
                const next = { ...value };
                delete next[key];
                onChange(next);
              }}
            >
              Remove condition
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onChange({ ...conditions, [`property_${Object.keys(conditions).length + 1}`]: "" })
        }
      >
        Add property condition
      </button>
    </fieldset>
  );
}
