import Link from "next/link";
import { Text } from "@/components/app/text";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MessageKey } from "@/i18n/messages";
import { getT } from "@/i18n/server";
import type { Locale } from "@/i18n/messages";
import type { KadryEmployee } from "@/lib/api";
import { formatDate, formatQty } from "@/lib/format";
import { DEGREE_KEYS, DIPLOMA_STATUS_KEYS, labelFor, orderLineKey, tenureLabel } from "@/lib/kadry-rules";
import { cn } from "@/lib/utils";
import { DeleteDiploma, DiplomaDialog } from "./diploma-dialog";
import { DeleteRelative, RelativeDialog } from "./relative-dialog";

type T = Awaited<ReturnType<typeof getT>>;

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text variant="caption">{label}</Text>
      <Text as="div" variant="body" className="font-medium">{value ?? "—"}</Text>
    </div>
  );
}
const date = (d: string | null) => (d ? formatDate(d) : "—");
const editLink = (href: string, label: string) => (
  <Link href={href} className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>{label}</Link>
);

/** «Пн 09:00–18:00» per day for a custom schedule; otherwise the position's («По должности: …»). */
function ScheduleLines({ e, t }: { e: KadryEmployee; t: T }) {
  const day = (n: number) => t(`kadry.wd.${n}` as MessageKey);
  if (e.workSchedule && Object.keys(e.workSchedule).length > 0) {
    return (
      <ul>
        {Object.entries(e.workSchedule)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([n, h]) => <li key={n} className="tabular-nums">{day(Number(n))} {h.start}–{h.end}</li>)}
      </ul>
    );
  }
  const p = e.positionSchedule;
  if (p && p.workdays.length > 0 && p.startTime) {
    return <>{t("kadry.schedule_by_position_at", { days: [...p.workdays].sort((a, b) => a - b).map(day).join(", "), time: p.startTime })}</>;
  }
  return <>{t("kadry.schedule_by_position")}</>;
}

export async function WorkTab({ e }: { e: KadryEmployee }) {
  const t = await getT();
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Item label={t("kadry.department")} value={e.departmentName ?? t("kadry.no_department")} />
          <Item label={t("kadry.position")} value={e.positionName} />
          <Item label={t("kadry.employment_type")} value={e.employmentType ? t(`kadry.et.${e.employmentType}` as MessageKey) : null} />
          <Item label={t("kadry.remote")} value={e.remote ? t("common.yes") : t("common.no")} />
          <Item label={t("kadry.schedule")} value={<ScheduleLines e={e} t={t} />} />
          <Item label={t("kadry.rate")} value={e.rate} />
          <Item label={t("kadry.salary")} value={e.salary == null ? null : formatQty(String(e.salary))} />
          <Item label={t("kadry.hired_at")} value={e.hiredAt ? formatDate(e.hiredAt) : null} />
          <Item
            label={t("kadry.order_number")}
            // 12 Oct 2026: value={e.orderNumber || e.orderDate ? t("kadry.order_line", { number: e.orderNumber ?? "—", date: date(e.orderDate) }) : null}
            value={(() => {
              const key = orderLineKey(e.orderNumber, e.orderDate);
              return key ? t(key, { number: e.orderNumber ?? "", date: e.orderDate ? formatDate(e.orderDate) : "" }) : null;
            })()}
          />
          <Item
            label={t("kadry.tenure")}
            value={e.experienceMonths == null ? null : tenureLabel(e.experienceMonths, { years: t("kadry.unit.years_short"), months: t("kadry.unit.months_short") })}
          />
        </div>
        <div>{editLink(`/kadry/sotrudniki/${encodeURIComponent(e.id)}/edit`, t("kadry.edit"))}</div>
      </CardContent>
    </Card>
  );
}

export async function PersonalTab({ e, age }: { e: KadryEmployee; age: number | null }) {
  const t = await getT();
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Item label={t("kadry.last_name")} value={e.lastName} />
          <Item label={t("kadry.first_name")} value={e.firstName} />
          <Item label={t("kadry.middle_name")} value={e.middleName} />
          <Item label={t("kadry.birth_date")} value={e.birthDate ? `${formatDate(e.birthDate)}${age == null ? "" : ` · ${age}`}` : null} />
          <Item label={t("kadry.birth_place")} value={e.birthPlace} />
          <Item label={t("kadry.gender")} value={e.gender ? t(`kadry.g.${e.gender}` as MessageKey) : null} />
          <Item label={t("kadry.citizenship")} value={e.citizenship} />
          <Item label={t("kadry.nationality")} value={e.nationality} />
          <Item label={t("kadry.passport_series")} value={e.passportSeries} />
          <Item label={t("kadry.passport_number")} value={e.passportNumber} />
          <Item label={t("kadry.passport_issued_by")} value={e.passportIssuedBy} />
          <Item label={t("kadry.passport_issued_date")} value={date(e.passportIssuedDate)} />
          <Item label={t("kadry.passport_valid_until")} value={date(e.passportValidUntil)} />
          <Item label={t("kadry.pinfl")} value={e.pinfl} />
          <Item label={t("kadry.inn")} value={e.inn} />
          <Item label={t("kadry.address")} value={e.address} />
          <Item label={t("kadry.phone")} value={e.phone} />
          <Item label={t("kadry.email")} value={e.email} />
          <Item label={t("kadry.education_level")} value={e.educationLevel ? t(`kadry.edu.${e.educationLevel}` as MessageKey) : null} />
        </div>
        <div>{editLink(`/kadry/sotrudniki/${encodeURIComponent(e.id)}/lichnye`, t("kadry.edit"))}</div>
      </CardContent>
    </Card>
  );
}

export async function EducationTab({ e, locale }: { e: KadryEmployee; locale: Locale }) {
  const t = await getT();
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("kadry.degree")}</TableHead>
              <TableHead>{t("kadry.institution")}</TableHead>
              <TableHead>{t("kadry.specialty")}</TableHead>
              <TableHead>{t("kadry.years_col")}</TableHead>
              <TableHead>{t("kadry.series_number")}</TableHead>
              <TableHead>{t("kadry.issued_date")}</TableHead>
              <TableHead>{t("kadry.diploma_status")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {e.diplomas.length === 0 && (
              <TableRow><TableCell colSpan={8}><Text variant="caption">{t("kadry.no_diplomas")}</Text></TableCell></TableRow>
            )}
            {e.diplomas.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.degree ? labelFor(DEGREE_KEYS, d.degree, t) : "—"}</TableCell>
                <TableCell>{d.institution ?? "—"}</TableCell>
                <TableCell>{d.specialty ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{d.enrolledYear ?? "—"}–{d.graduatedYear ?? "—"}</TableCell>
                <TableCell>{d.seriesNumber ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{date(d.issuedDate)}</TableCell>
                <TableCell>{d.status ? labelFor(DIPLOMA_STATUS_KEYS, d.status, t) : "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <DiplomaDialog employeeId={e.id} diploma={d} locale={locale} />
                    <DeleteDiploma employeeId={e.id} diploma={d} locale={locale} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div><DiplomaDialog employeeId={e.id} diploma={null} locale={locale} /></div>
    </div>
  );
}

export async function RelativesTab({ e, locale }: { e: KadryEmployee; locale: Locale }) {
  const t = await getT();
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("kadry.relation")}</TableHead>
              <TableHead>{t("kadry.full_name")}</TableHead>
              <TableHead>{t("kadry.birth_date")}</TableHead>
              <TableHead>{t("kadry.workplace_position")}</TableHead>
              <TableHead>{t("kadry.residence")}</TableHead>
              <TableHead>{t("kadry.phone")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {e.relatives.length === 0 && (
              <TableRow><TableCell colSpan={7}><Text variant="caption">{t("kadry.no_relatives")}</Text></TableCell></TableRow>
            )}
            {e.relatives.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{t(`kadry.rel.${r.relation}` as MessageKey)}</TableCell>
                <TableCell className="font-medium">{r.fullName ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{date(r.birthDate)}</TableCell>
                <TableCell>{r.workplacePosition ?? "—"}</TableCell>
                <TableCell>{r.residenceAddress ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{r.phone ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <RelativeDialog employeeId={e.id} relative={r} locale={locale} />
                    <DeleteRelative employeeId={e.id} relative={r} locale={locale} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div><RelativeDialog employeeId={e.id} relative={null} locale={locale} /></div>
    </div>
  );
}
