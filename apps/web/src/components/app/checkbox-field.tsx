"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** A design-system checkbox that submits `name=value` with an ordinary form when ticked. */
export function CheckboxField({
  name,
  value = "true",
  defaultChecked,
  label,
}: {
  name: string;
  value?: string;
  defaultChecked?: boolean;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} name={name} value={value} defaultChecked={defaultChecked} />
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}
