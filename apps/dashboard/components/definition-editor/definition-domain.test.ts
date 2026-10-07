import { describe, expect, it } from "vitest";

import {
  addConversion,
  addFunnel,
  addFunnelStep,
  addPropertyCondition,
  blankConversion,
  blankFunnel,
  changePropertyConditionType,
  hasUnsavedDefinitionChanges,
  removeFunnelStep,
  removePropertyCondition,
  renamePropertyCondition,
  updateConversion,
  updateFunnelStep,
  updatePropertyConditionValue,
} from "./definition-domain";

describe("definition domain", () => {
  it("creates empty conversions and funnels with two ordered steps", () => {
    expect(blankConversion()).toEqual({
      id: "",
      name: "",
      event_name: "",
      active: true,
      properties: {},
    });
    expect(blankFunnel().steps).toEqual([
      { event_name: "", properties: {} },
      { event_name: "", properties: {} },
    ]);
  });

  it("updates definitions immutably and preserves funnel step order", () => {
    const conversions = addConversion([]);
    expect(conversions).toHaveLength(1);
    const updated = updateConversion(conversions, 0, { name: "Payment" });
    expect(updated[0].name).toBe("Payment");
    expect(conversions[0].name).toBe("");

    let funnels = addFunnel([]);
    expect(funnels).toHaveLength(1);
    funnels = addFunnelStep(funnels, 0);
    funnels = updateFunnelStep(funnels, 0, 2, { event_name: "checkout" });
    funnels = removeFunnelStep(funnels, 0, 1);
    expect(funnels[0].steps.map((step) => step.event_name)).toEqual(["", "checkout"]);
  });

  it("adds, removes, renames, and changes property condition values", () => {
    expect(addPropertyCondition({ property_1: "x" })).toEqual({
      property_1: "x",
      property_2: "",
    });
    expect(changePropertyConditionType({ key: "x" }, "key", "number")).toEqual({ key: 0 });
    expect(changePropertyConditionType({ key: "x" }, "key", "boolean")).toEqual({
      key: false,
    });
    expect(changePropertyConditionType({ key: "x" }, "key", "null")).toEqual({ key: null });
    expect(updatePropertyConditionValue({ key: 0 }, "key", 42)).toEqual({ key: 42 });
    expect(renamePropertyCondition({ old: true }, "old", "new")).toEqual({ new: true });
    expect(renamePropertyCondition({ old: true, new: "existing" }, "old", "new")).toEqual({
      new: true,
    });
    expect(removePropertyCondition({ key: null }, "key")).toEqual({});
  });

  it("compares draft contents to an empty or saved baseline", () => {
    const draft = { conversions: [], funnels: [] };
    expect(hasUnsavedDefinitionChanges(draft, null)).toBe(false);
    expect(
      hasUnsavedDefinitionChanges(
        { ...draft, conversions: [blankConversion()] },
        {
          schema_version: 1,
          site_id: "site_one",
          revision: 1,
          definition_version: "definitions-v1",
          effective_at: null,
          conversions: [blankConversion()],
          funnels: [],
        },
      ),
    ).toBe(false);
    expect(hasUnsavedDefinitionChanges({ ...draft, conversions: [blankConversion()] }, null)).toBe(
      true,
    );
  });
});
