import { SettingsTaskPage } from "../../../../components/settings/settings-task-page";

export const dynamic = "force-dynamic";

export default function EnvironmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return SettingsTaskPage({ section: "environments", searchParams });
}
