import { Card, CardContent } from "@/components/ui/card";
import { Text } from "./text";

/** A failed API call. `message` is already translated or comes from the API's 400 text. */
export function ApiError({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent>
        <Text variant="error" role="alert">{message}</Text>
      </CardContent>
    </Card>
  );
}
