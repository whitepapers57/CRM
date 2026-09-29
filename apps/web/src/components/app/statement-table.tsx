import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StatementRow } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Money } from "./money-cell";
import { Text } from "./text";

export interface StatementLabels {
  date: string;
  document: string;
  amount: string;
  balance: string;
  opening: string;
  closing: string;
  empty: string;
  kind: Record<StatementRow["kind"], string>;
}

export function StatementTable({
  opening,
  closing,
  rows,
  labels,
}: {
  opening: string;
  closing: string;
  rows: StatementRow[];
  labels: StatementLabels;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.date}</TableHead>
            <TableHead>{labels.document}</TableHead>
            <TableHead className="text-right">{labels.amount}</TableHead>
            <TableHead className="text-right">{labels.balance}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/40">
            <TableCell colSpan={3}><Text variant="caption">{labels.opening}</Text></TableCell>
            <TableCell className="text-right"><Money value={opening} /></TableCell>
          </TableRow>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}><Text variant="caption">{labels.empty}</Text></TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={`${r.kind}-${r.sdId}`}>
              <TableCell className="whitespace-nowrap">{formatDateTime(r.date)}</TableCell>
              <TableCell>
                {labels.kind[r.kind]} <Text as="span" variant="caption">{r.sdId}{r.warehouseName ? ` · ${r.warehouseName}` : ""}</Text>
              </TableCell>
              <TableCell className="text-right"><Money value={r.amount} /></TableCell>
              <TableCell className="text-right"><Money value={r.balance} /></TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/40 font-medium">
            <TableCell colSpan={3}><Text variant="caption">{labels.closing}</Text></TableCell>
            <TableCell className="text-right"><Money value={closing} /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
