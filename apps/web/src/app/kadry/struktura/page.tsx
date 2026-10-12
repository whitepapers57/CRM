import { ApiError } from "@/components/app/api-error";
import { HistoryButton } from "@/components/app/history-button";
import { HistoryList } from "@/components/app/history-list";
import { PageHeader } from "@/components/app/page-header";
import { StickyToolbar } from "@/components/app/sticky-toolbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MessageKey } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { apiGet, type AuditEntry, type KadryStructure } from "@/lib/api";
import { DeleteDepartment, DepartmentDialog } from "./department-dialog";
import { DeletePosition, PositionDialog } from "./position-dialog";

export default async function StructurePage() {
  const t = await getT();
  const locale = await getLocale();
  const [res, history, emps] = await Promise.all([
    apiGet<KadryStructure>("/kadry/structure"),
    apiGet<AuditEntry[]>("/kadry/history/structure"),
    apiGet<{ id: string; name: string }[]>("/kadry/employees"),
  ]);
  const header = (
    <StickyToolbar>
      <PageHeader back="/kadry" title={t("kadry.structure")}>
        <HistoryButton label={t("history.open")}>
          <HistoryList bare entries={history.ok ? history.data : []} />
        </HistoryButton>
      </PageHeader>
    </StickyToolbar>
  );
  if (!res.ok) return <>{header}<ApiError message={res.status === 0 ? t("errors.api_down") : res.message || t("errors.unknown")} /></>;
  const { departments, positions } = res.data;
  const employees = emps.ok ? emps.data.map((e) => ({ id: e.id, name: e.name })) : [];
  const nextDeptSort = departments.reduce((m, d) => Math.max(m, d.sortOrder), 0) + 10;
  const nextPosSort = positions.reduce((m, p) => Math.max(m, p.sortOrder), 0) + 10;
  return (
    <>
      {header}
      <Card>
        <CardHeader>
          <CardTitle>{t("kadry.departments")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kadry.name")}</TableHead>
                  <TableHead>{t("kadry.head")}</TableHead>
                  <TableHead className="text-right">{t("kadry.count")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.headName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.employeeCount}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <DepartmentDialog department={d} nextSort={nextDeptSort} employees={employees} locale={locale} />
                        <DeleteDepartment id={d.id} name={d.name} locale={locale} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div><DepartmentDialog department={null} nextSort={nextDeptSort} employees={employees} locale={locale} /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("kadry.positions")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kadry.position")}</TableHead>
                  <TableHead>{t("kadry.department")}</TableHead>
                  <TableHead>{t("kadry.start_time")}</TableHead>
                  <TableHead>{t("kadry.workdays")}</TableHead>
                  <TableHead className="text-right">{t("kadry.count")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.departmentName ?? t("kadry.no_department")}</TableCell>
                    <TableCell className="tabular-nums">{p.startTime ?? "—"}</TableCell>
                    <TableCell>{p.workdays.length ? p.workdays.map((d) => t(`kadry.wd.${d}` as MessageKey)).join(", ") : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.employeeCount}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <PositionDialog position={p} nextSort={nextPosSort} departments={departments} locale={locale} />
                        <DeletePosition id={p.id} name={p.name} locale={locale} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div><PositionDialog position={null} nextSort={nextPosSort} departments={departments} locale={locale} /></div>
        </CardContent>
      </Card>
    </>
  );
}
