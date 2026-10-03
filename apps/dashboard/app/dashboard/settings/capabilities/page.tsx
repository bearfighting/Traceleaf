import { SettingsTaskPage } from "../../../../components/settings-task-page";

export const dynamic = "force-dynamic";

export default function CapabilitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return SettingsTaskPage({ section: "capabilities", searchParams });
}
