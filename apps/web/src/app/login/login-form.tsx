"use client";

import { useActionState } from "react";
import { Field } from "@/components/app/field";
import { Text } from "@/components/app/text";
import { Button } from "@/components/ui/button";
import { login } from "./actions";

export function LoginForm({ labels }: { labels: { login: string; password: string; submit: string; bad_login: string; api_down: string } }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {/* React resets the form after the action; keep what was typed in the login field. */}
      <Field name="login" label={labels.login} autoComplete="username" required defaultValue={state?.login} key={state?.login ?? ""} />
      <Field name="password" type="password" label={labels.password} autoComplete="current-password" required />
      {state?.error && (
        <Text variant="error" role="alert">{state.error === "api_down" ? labels.api_down : labels.bad_login}</Text>
      )}
      <Button type="submit" disabled={pending} className="active:scale-95">
        {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {labels.submit}
      </Button>
    </form>
  );
}
