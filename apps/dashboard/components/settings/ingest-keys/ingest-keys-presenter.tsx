"use client";

import * as UI from "../../ui/index";

import type {
  CreatedIngestKey,
  IngestPolicyResponse,
} from "../../../lib/settings/configuration-api/types";

export function IngestKeysPresenter({
  policy,
  secret,
  error,
  busy,
  review,
  reviewRefreshed,
  statusLoaded,
  listRefreshNeeded,
  revokeId,
  onCreate,
  onRevoke,
  onRefresh,
  onCompleteReview,
  onSetSecret,
  onSetRevokeId,
  onSetBusy,
  onSetError,
  onBeginReviewRefresh,
}: {
  policy: IngestPolicyResponse;
  secret: CreatedIngestKey | null;
  error: string;
  busy: boolean;
  review: boolean;
  reviewRefreshed: boolean;
  statusLoaded: boolean;
  listRefreshNeeded: boolean;
  revokeId: string | null;
  onCreate: () => void;
  onRevoke: () => void;
  onRefresh: () => Promise<unknown>;
  onCompleteReview: () => void;
  onSetSecret: (value: CreatedIngestKey | null) => void;
  onSetRevokeId: (value: string | null) => void;
  onSetBusy: (value: boolean) => void;
  onSetError: (value: string) => void;
  onBeginReviewRefresh: () => void;
}) {
  return (
    <section className="card ingest-key-card" aria-label="Ingest Keys">
      <div className="ingest-key-actions">
        <p>
          Create a replacement, update your website, and verify the new key before revoking an
          existing key. Secrets are shown once.
        </p>
        <UI.Button
          disabled={busy || review || !statusLoaded || listRefreshNeeded}
          onClick={onCreate}
        >
          {busy
            ? "Creating…"
            : policy.policy.keys.length
              ? "Create replacement key"
              : "Create Ingest Key"}
        </UI.Button>
      </div>
      {secret && (
        <div className="one-time-secret">
          <p role="status">Ingest Key created. Copy this key now; it will not be shown again.</p>
          <code>{secret.key}</code>
          <UI.Button onClick={() => void navigator.clipboard?.writeText(secret.key)}>
            Copy key
          </UI.Button>
          <UI.Button onClick={() => onSetSecret(null)}>Hide key</UI.Button>
        </div>
      )}
      {listRefreshNeeded && (
        <UI.Button
          disabled={busy}
          onClick={() => {
            onSetBusy(true);
            void onRefresh()
              .then(() => onSetError(""))
              .catch((cause) =>
                onSetError(
                  cause instanceof Error
                    ? `Key was created, but the active key list is still unavailable: ${cause.message}`
                    : "Key was created, but the active key list is still unavailable.",
                ),
              )
              .finally(() => onSetBusy(false));
          }}
        >
          {busy ? "Refreshing key list…" : "Refresh active key list"}
        </UI.Button>
      )}
      {review && (
        <div role="alert">
          <p>
            A key request may have completed without a confirmed response. Refresh the active key
            list and have an administrator check it before another key can be created.
          </p>
          <UI.Button
            disabled={busy}
            onClick={() => {
              onBeginReviewRefresh();
              void onRefresh().catch((cause) =>
                onSetError(
                  cause instanceof Error
                    ? cause.message
                    : "The active key list response could not be verified.",
                ),
              );
            }}
          >
            Refresh active key list
          </UI.Button>
          <UI.Button disabled={busy || !reviewRefreshed} onClick={onCompleteReview}>
            I checked the key list
          </UI.Button>
        </div>
      )}
      <ul className="key-list">
        {policy.policy.keys.map((key) => (
          <li key={key.key_id}>
            <span>
              <code>{key.key_id}</code> · created {new Date(key.created_at).toISOString()} · Active
            </span>
            <UI.Button disabled={busy} onClick={() => onSetRevokeId(key.key_id)}>
              Revoke
            </UI.Button>
          </li>
        ))}
      </ul>
      {policy.policy.keys.length === 0 && <p>No active ingest keys.</p>}
      {error && <p role="alert">{error}</p>}
      <UI.AlertDialog
        open={revokeId !== null}
        title="Confirm key revocation"
        description={
          <>
            After verifying the replacement key, revoke <code>{revokeId}</code>?
          </>
        }
        confirmLabel={`Revoke ${revokeId ?? "key"}`}
        busy={busy}
        onCancel={() => onSetRevokeId(null)}
        onConfirm={onRevoke}
      />
    </section>
  );
}
