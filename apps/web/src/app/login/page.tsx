import { redirect } from "next/navigation";
import { Text } from "@/components/app/text";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { getMe } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getMe()) redirect("/");
  const t = await getT();
  return (
    <div className="mx-auto mt-24 w-full max-w-sm">
      <Card>
        <CardHeader>
          <Text as="h1" variant="title">{t("auth.title")}</Text>
          <Text variant="caption">{t("app.title")}</Text>
        </CardHeader>
        <CardContent>
          <LoginForm labels={{ login: t("auth.login"), password: t("auth.password"), submit: t("auth.submit"), bad_login: t("auth.bad_login"), api_down: t("errors.api_down") }} />
        </CardContent>
      </Card>
    </div>
  );
}
