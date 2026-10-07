"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import * as UI from "../ui/index";

export function EnvironmentSelector({
  ...props
}: {
  value: string;
  siteId: string;
  from?: string;
  to?: string;
  dimension?: string;
  route?: "environments" | "ingest-keys";
}) {
  return (
    <EnvironmentSelectorForm
      key={`${props.siteId}:${props.route ?? "environments"}:${props.value}`}
      {...props}
    />
  );
}

function EnvironmentSelectorForm({
  value,
  siteId,
  from,
  to,
  dimension,
  route = "environments",
}: {
  value: string;
  siteId: string;
  from?: string;
  to?: string;
  dimension?: string;
  route?: "environments" | "ingest-keys";
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
    router.push(`/dashboard/settings/${route}?${params.toString()}`);
  }

  return (
    <form className="card environment-selector-form" onSubmit={submit}>
      <label className="configuration-field">
        Environment name
        <UI.Input
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          required
        />
      </label>
      <UI.Button type="submit" className="button-fit">
        Load environment
      </UI.Button>
      <p className="environment-selector-help">
        Enter an environment name to load or configure its ingest policy.
      </p>
    </form>
  );
}
