import type { DefinitionSetResponse } from "../../lib/configuration-api/types";

export type Conversion = DefinitionSetResponse["conversions"][number];
export type Funnel = DefinitionSetResponse["funnels"][number];
export type FunnelStep = Funnel["steps"][number];
export type PropertyValue = string | number | boolean | null;
export type DefinitionDraft = Pick<DefinitionSetResponse, "conversions" | "funnels">;

export const blankConversion = (): Conversion => ({
  id: "",
  name: "",
  event_name: "",
  active: true,
  properties: {},
});

export const blankFunnel = (): Funnel => ({
  id: "",
  name: "",
  active: true,
  steps: [blankFunnelStep(), blankFunnelStep()],
});

export const blankFunnelStep = (): FunnelStep => ({ event_name: "", properties: {} });

export function addConversion(conversions: Conversion[]): Conversion[] {
  return [...conversions, blankConversion()];
}

export function addFunnel(funnels: Funnel[]): Funnel[] {
  return [...funnels, blankFunnel()];
}

export function updateConversion(
  conversions: Conversion[],
  index: number,
  update: Partial<Conversion>,
): Conversion[] {
  return conversions.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...update } : item,
  );
}

export function updateFunnel(funnels: Funnel[], index: number, update: Partial<Funnel>): Funnel[] {
  return funnels.map((item, itemIndex) => (itemIndex === index ? { ...item, ...update } : item));
}

export function updateFunnelStep(
  funnels: Funnel[],
  funnelIndex: number,
  stepIndex: number,
  update: Partial<FunnelStep>,
): Funnel[] {
  return funnels.map((funnel, index) =>
    index === funnelIndex
      ? {
          ...funnel,
          steps: funnel.steps.map((step, index) =>
            index === stepIndex ? { ...step, ...update } : step,
          ),
        }
      : funnel,
  );
}

export function addFunnelStep(funnels: Funnel[], funnelIndex: number): Funnel[] {
  return funnels.map((funnel, index) =>
    index === funnelIndex ? { ...funnel, steps: [...funnel.steps, blankFunnelStep()] } : funnel,
  );
}

export function removeFunnelStep(
  funnels: Funnel[],
  funnelIndex: number,
  stepIndex: number,
): Funnel[] {
  return funnels.map((funnel, index) =>
    index === funnelIndex
      ? { ...funnel, steps: funnel.steps.filter((_, index) => index !== stepIndex) }
      : funnel,
  );
}

export function addPropertyCondition(value: Record<string, PropertyValue> | null | undefined) {
  const conditions = value ?? {};

  return { ...conditions, [`property_${Object.keys(conditions).length + 1}`]: "" };
}

export function removePropertyCondition(
  value: Record<string, PropertyValue> | null | undefined,
  key: string,
): Record<string, PropertyValue> {
  const next = { ...value };
  delete next[key];

  return next;
}

export function renamePropertyCondition(
  value: Record<string, PropertyValue> | null | undefined,
  key: string,
  nextKey: string,
): Record<string, PropertyValue> {
  const next = removePropertyCondition(value, key);
  next[nextKey] = value?.[key] ?? null;

  return next;
}

export function changePropertyConditionType(
  value: Record<string, PropertyValue> | null | undefined,
  key: string,
  type: "string" | "number" | "boolean" | "null",
): Record<string, PropertyValue> {
  return {
    ...value,
    [key]: type === "null" ? null : type === "boolean" ? false : type === "number" ? 0 : "",
  };
}

export function updatePropertyConditionValue(
  value: Record<string, PropertyValue> | null | undefined,
  key: string,
  nextValue: string | number | boolean,
): Record<string, PropertyValue> {
  return { ...value, [key]: nextValue };
}

export function hasUnsavedDefinitionChanges(
  draft: DefinitionDraft,
  baseline: DefinitionSetResponse | null,
): boolean {
  return (
    JSON.stringify(draft) !==
    JSON.stringify({ conversions: baseline?.conversions ?? [], funnels: baseline?.funnels ?? [] })
  );
}
