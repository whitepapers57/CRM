"use client";

import { useState, useTransition } from "react";
import { Text } from "@/components/app/text";
import { Button } from "@/components/ui/button";
import { translate, type Locale } from "@/i18n/messages";
import { restoreReceipt } from "./actions";

/** «Восстановить» on a deleted row of the list; sits above the row's whole-row link. */
export function RestoreButton({ sdId, locale }: { sdId: string; locale: Locale }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="relative z-10 mt-1 font-sans no-underline!">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        className="active:scale-95"
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await restoreReceipt(sdId);
            if (!r.ok) setError(r.message || translate(locale, "errors.unknown"));
          })
        }
      >
        {pending && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {translate(locale, "receipt.restore")}
      </Button>
      {error && <Text role="alert" variant="error" className="mt-1">{error}</Text>}
    </div>
  );
}
