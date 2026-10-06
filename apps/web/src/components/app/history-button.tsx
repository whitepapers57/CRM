"use client";

import { HistoryIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** «История» in a page header: opens that page's history (rendered on the server and passed in). */
export function HistoryButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>
        <HistoryIcon className="size-4" />
        {label}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>{label}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
