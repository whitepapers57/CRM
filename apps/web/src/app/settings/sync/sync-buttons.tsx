"use client";

import { useState, useTransition } from "react";
import { Text } from "@/components/app/text";
import { Button } from "@/components/ui/button";
import { runSync } from "./actions";

export function SyncButtons({
  labels,
}: {
  labels: { run: string; full: string; running: string; alreadyRunning: string; started: string; failed: string };
}) {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<"incremental" | "full" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const go = (k: "incremental" | "full") => {
    setKind(k);
    setMessage(null);
    start(async () => {
      const r = await runSync(k);
      if (!r.ok) setMessage(r.message || labels.failed);
      else setMessage(r.alreadyRunning ? labels.alreadyRunning : labels.started);
    });
  };

  const spinner = <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => go("incremental")} disabled={pending} className="active:scale-95">
          {pending && kind === "incremental" && spinner}
          {labels.run}
        </Button>
        <Button variant="outline" onClick={() => go("full")} disabled={pending} className="active:scale-95">
          {pending && kind === "full" && spinner}
          {labels.full}
        </Button>
      </div>
      {pending && <Text variant="caption" role="status">{labels.running}</Text>}
      {message && <Text variant="caption" role="status">{message}</Text>}
    </div>
  );
}
