"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/app/text";
import { defaultLocale, translate, type Locale } from "@/i18n/messages";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  // Error boundaries render in the browser, so the cookie is readable here.
  const [locale] = useState<Locale>(() =>
    typeof document !== "undefined" && document.cookie.includes("locale=uz") ? "uz" : defaultLocale,
  );
  return (
    <div className="flex flex-col items-start gap-3">
      <Text variant="error" role="alert">{translate(locale, "errors.unknown")}</Text>
      <Button onClick={reset} className="active:scale-95">{translate(locale, "errors.retry")}</Button>
    </div>
  );
}
