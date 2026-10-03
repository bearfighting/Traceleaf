import { redirect } from "next/navigation";

import { legacySettingsRedirect } from "../../../lib/settings-routes";

export default async function LegacySettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacySettingsRedirect(await searchParams));
}
