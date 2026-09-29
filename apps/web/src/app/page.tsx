import { connection } from "next/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiGet, type HealthStatus, type SalesdocStatus } from "@/lib/api";
import { t } from "@/i18n/messages";

function StatusCard({
  title,
  ok,
  label,
  detail,
}: {
  title: string;
  ok: boolean;
  label: string;
  detail?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          <Badge variant={ok ? "default" : "destructive"}>{label}</Badge>
        </div>
        {detail && (
          <CardDescription className="break-words [overflow-wrap:anywhere]">
            {detail}
          </CardDescription>
        )}
      </CardHeader>
    </Card>
  );
}

export default async function Home() {
  await connection();
  const [health, salesdoc] = await Promise.all([
    apiGet<HealthStatus>("/health"),
    apiGet<SalesdocStatus>("/salesdoc/status"),
  ]);

  const salesdocCard = !salesdoc
    ? { ok: false, label: t("status.down") }
    : !salesdoc.configured
      ? {
          ok: false,
          label: t("status.not_configured"),
          detail: t("status.not_configured_hint"),
        }
      : salesdoc.connected
        ? {
            ok: true,
            label: t("status.up"),
            detail: t("status.connected_as", { userId: salesdoc.userId ?? "" }),
          }
        : {
            ok: false,
            label: t("status.down"),
            detail: salesdoc.error?.message ?? t("errors.unknown"),
          };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("app.title")}</h1>
        <p className="text-muted-foreground">{t("app.subtitle")}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatusCard
          title={t("status.api")}
          ok={health !== null}
          label={t(health ? "status.up" : "status.down")}
        />
        <StatusCard
          title={t("status.database")}
          ok={health?.database === "up"}
          label={t(health?.database === "up" ? "status.up" : "status.down")}
        />
        <StatusCard title={t("status.salesdoc")} {...salesdocCard} />
      </div>
    </main>
  );
}
