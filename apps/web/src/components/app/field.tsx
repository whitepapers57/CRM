import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "./text";

/** The universal Input: label, control, and its own error underneath. */
export function Field({
  label,
  error,
  className,
  ...input
}: { label: string; error?: string } & React.ComponentProps<typeof Input>) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} {...input} />
      {error && (
        <Text id={errorId} role="alert" variant="error" className="mt-1">
          {error}
        </Text>
      )}
    </div>
  );
}
