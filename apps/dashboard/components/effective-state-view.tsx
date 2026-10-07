import type { EffectiveState } from "../lib/configuration-api/types";

export function EffectiveStateView({ state }: { state: EffectiveState }) {
  return (
    <div className={`effective-state effective-${state.status}`} role="status" aria-atomic="true">
      <strong>Runtime status: {state.status}</strong>
      <span>Stored version {state.stored_version}</span>
      {Object.entries(state.applied_versions).map(([service, version]) => (
        <span key={service}>
          {service}: {version === null ? "not reported" : `version ${version}`}
        </span>
      ))}
    </div>
  );
}
