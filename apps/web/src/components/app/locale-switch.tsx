"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Locale } from "@/i18n/messages";
import { cn } from "@/lib/utils";

function saveLocale(l: Locale) {
  document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
}

export function LocaleSwitch({ current, label }: { current: Locale; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (l: Locale) => {
    saveLocale(l);
    start(() => router.refresh());
  };
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {(["ru", "uz"] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => choose(l)}
          className={cn(
            "rounded-md px-2 py-1 text-xs uppercase transition active:scale-95",
            l === current ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
