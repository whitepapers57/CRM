import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Text } from "./text";

export function UserMenu({ name, label }: { name: string; label: string }) {
  return (
    <form action={logout} className="flex items-center justify-between gap-2">
      <Text variant="caption" truncate>{name}</Text>
      <Button type="submit" variant="ghost" size="sm" className="active:scale-95">{label}</Button>
    </form>
  );
}
