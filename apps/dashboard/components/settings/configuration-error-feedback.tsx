import * as UI from "../ui/index";

export function ConfigurationErrorFeedback({
  error,
  onReload,
}: {
  error: string;
  onReload: () => void;
}) {
  return (
    <p className="configuration-error" role="alert">
      {error}{" "}
      {error.includes("Reload") && (
        <UI.Button type="button" onClick={onReload}>
          Reload latest configuration
        </UI.Button>
      )}
    </p>
  );
}
