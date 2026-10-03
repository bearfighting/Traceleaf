"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EnvironmentSelector({
  value,
  siteId,
  from,
  to,
  dimension,
}: {
  value: string;
  siteId: string;
  from?: string;
  to?: string;
  dimension?: string;
}) {
  const router = useRouter();
  const [environment, setEnvironment] = useState(value);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams({ site_id: siteId });
    if (environment.trim()) params.set("environment", environment.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (dimension) params.set("dimension", dimension);
    router.push(`/dashboard/settings/environments?${params.toString()}`);
  }

  return (
    <form className="card mb-6 flex flex-wrap items-end gap-3" onSubmit={submit}>
      <label className="configuration-field">
        Environment name
        <input
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          required
        />
      </label>
      <button type="submit">Load environment</button>
      <p className="mb-0 w-full text-sm text-muted">
        Enter an environment name to load or configure its ingest policy.
      </p>
    </form>
  );
}
