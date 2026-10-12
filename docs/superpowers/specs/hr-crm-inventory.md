# Goodland CRM — HR module: reference inventory for a rebuild

Written 12 Oct 2026 from a read-only study of `D:\goodland\finance` (Next.js 14 + Supabase). Target: rebuild for another company's staff on NestJS + Prisma + Next 16. UI texts are quoted in their original Russian (Uzbek where the source has it); everything else is English.

## 0. Read this first

### 0.1 Which code was studied (important)

The checkout at `D:\goodland\finance` is on branch `feat/hr-module-permissions` at commit `141e657` (23 Sep 2026). It is **80 commits behind `origin/main`** (`ed12bcc`, 9 Oct 2026). Several HR features that are live in production exist only on `origin/main`:

- day-off / shift-swap requests (`legacy/hr-day-off-requests.sql`, `src/features/hr/requests/**`, `src/app/api/requests/**`),
- personal weekly work schedule + early leave (`legacy/hr-employee-work-schedule.sql`, `src/features/hr/workSchedule.ts`),
- inventory self-registration, approval chain, rooms, photo batches, retention cron.

So the inventory below describes **`origin/main` (`ed12bcc`)**, read with `git archive` into a scratch folder (no repo state was changed). The one exception is the call-centre payroll table (`feat/cc-payroll-table`, commit `3ec8511`, **unpushed, SQL unapplied, never rendered** per project notes), which is described from that branch and flagged "(unmerged)". File:line citations are to `origin/main` unless stated; line numbers will not match the older checkout.

### 0.2 Things that cannot be derived from the repo

- The **base DDL of `employees`** (and `profiles`'s later shape, `deals`, `plans`) is not in `legacy/*.sql`; the table was created in the Supabase dashboard. Only `profiles` has a `CREATE TABLE` (`legacy/supabase-setup.sql:7`). The base employee columns below (`id`, `name`, `phone`, `email`, `role`, `user_id`) are inferred from the TypeScript type `Employee` (`src/features/deals/types.ts:506`) and from migrations that `ALTER` the table.
- The **Telegram bot @goodlandhrbot** (`D:\goodland\hr-bot`, hosted separately) and the **Face ID kiosk app** (`D:\goodland\face-kiosk`, Android tablet) and the **Goodland Academy app** (separate Next.js app + separate Supabase project) are NOT in this repo. Their behaviour is known only from the CRM-side routes and from the specs in `docs/superpowers/specs/`.
- The **"Моя зарплата" screen and "Опоздаю" (late warning)** live in the Academy. "Опоздаю" is spec'd as part 2 of the payroll work and is not built.
- Exact RLS for the `profiles` / `roles` / `role_permissions` administration screen («Доступы») is outside HR and not studied beyond what HR needs.

### 0.3 Conventions used across the whole module

- **Time zone**: everything "today"/"month" for attendance, inventory and the kiosk is **Asia/Tashkent (UTC+5, no DST)** — `tashkentParts` in `src/features/hr/faceId/time.ts`; SQL uses `AT TIME ZONE 'Asia/Tashkent'`. Browser-side attendance code uses the *browser's local* date (`todayIso()` in `kpi.ts:28`) — a latent inconsistency to avoid in the rebuild.
- **Language**: Russian UI, with Uzbek (Latin) only for the Telegram bot, the kiosk tablet (late-reason labels `label_ru`/`label_uz`, `employees.telegram_lang`), and bilingual Academy content/events (`title_ru/title_uz`...). Uzbek dates need hand-composed month names (Intl returns "M09").
- **Employee name**: `employees.name` is a denormalised "Фамилия Имя Отчество" string; it is rebuilt from the three name parts on every profile save (`saveHrProfile`, `api.ts:280`) and used for legacy text matching in deals (`deals.agent` is text). `Employee.name` is what every dropdown shows.
- **Soft delete**: staff are never hard-deleted once referenced. "Уволить" = `active=false`, `workflow_status='terminated'`, `terminated_at`, `termination_reason`. Hard delete is only allowed when no deals/plans reference the person (`countEmployeeReferences`, `src/features/settings/api.ts:133`; message: "Нельзя удалить — за сотрудником N связанных записей (сделки/планы). Уволь его вместо удаления, чтобы сохранить историю.").
- **Money**: integers in so'm (BIGINT). **Percent**: integer. **Weekday**: ISO 1=Пн … 7=Вс in all INT[] columns.
- **Alerts/prompts**: the UI uses native `alert()/confirm()/prompt()` for errors/confirmations in most HR screens ("Ошибка: <message>").
- **"Только для роли «Редактор»"** is the tooltip on every disabled write control for users who can only read.

### 0.4 Permission model (affects every section)

Source: `legacy/access-roles.sql`, `access-rls-modules.sql`, `access-role-freeform.sql`, `src/features/access/modules.ts`.

- `profiles(id UUID PK → auth.users CASCADE, full_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'agent', created_at)`. The old CHECK on `role` was dropped; `profiles.role` now holds a **role name** (`roles.name`) or the built-ins `'admin'` (everything) and `'blocked'`.
- `roles(id, name UNIQUE, created_at)`; `role_permissions(role_id → roles CASCADE, module TEXT, level 'reader'|'editor', PK(role_id,module))`. No row = no access.
- Module keys relevant to HR: `hr` (block) with children `hr.administration`, `hr.recruiting`, `hr.onboarding`, `hr.performance` (= attendance + Face ID), `hr.retention`, `hr.payroll`, `hr.inventory`. A reader/editor of a child implies visibility of the parent block; the UI hook `useCanEdit("hr.x")` inherits the parent's editor right.
- SQL helpers (SECURITY DEFINER): `access_can_read(mod)`, `access_can_edit(mod)` (match `module = mod OR module LIKE mod||'.%'`), `access_apply_rls(table, mod, shared=false)` (drops all policies, creates `<t>_rbac_read` FOR SELECT and `<t>_rbac_write` FOR ALL). Applied to: `hiring_plans, termination_reasons, attendance_day_close, attendance_settings, employee_attendance, employee_diplomas, employee_relatives, shifts` → module `hr`; `payroll_sheets, payroll_sheet_rows, salary_accruals` → `hr.payroll`; **`employees, departments, positions, reference_articles` → `hr` with `shared=true` (every authenticated user can READ them, including PII such as passport, PINFL, salary)**. In the rebuild this must be replaced by field-level protection (salary/passport/PINFL only for HR).
- Deliberate exceptions: `candidates` (anonymous INSERT allowed for the public form, `legacy/candidates-rls-restore.sql`), `battleship_*` (any employee plays; HR edits teams/points, `legacy/battleship-rls-restore.sql`), inventory tables (own functions `inventory_can_read/edit/heads`, see §5).
- Some write actions require the **whole `hr` block editor**, not the sub-block: fire an employee (`TerminateEmployeeModal`, `useCanEdit("hr")`), grant/revoke Academy access (`AccountAccessForm`). Intentional ("recruiter must not do HR-admin actions").
- Server routes use `requireModule("hr", {edit:true})` (`src/features/access/server`) or `requireCrmAdmin()` (view access to `hr`) for the Academy-admin routes.
- Trigger `trg_sync_profile_role` (`legacy/hr-sync-profile-roles.sql`) copies `employees.role` into `profiles.role` when `employees.user_id` is set and the role is one of `admin|manager|agent|hr` (legacy; after the free-form roles change the role is managed on «Доступы»).
- A CRM login is an `auth.users` row + `profiles` row, linked to the HR record by `employees.user_id`. HR does **not** create CRM logins (the «Доступы» admin screen does); HR only grants **Academy** logins.

### 0.5 Overall structure

Hub `/hr` (`src/app/(app)/hr/page.tsx`): banner `MonthCheckBanner` (inventory), widget `BirthdaysWidget`, seven cards in this order: «Администрирование» (`/hr/administration`), «Рекрутинг», «Онбординг», «Эффективность» (`/hr/performance`), «Удержание» (`/hr/retention`), «Зарплата» (`/hr/payroll`), «Инвентарь». Titles come from i18n keys `hr.section.*.title/desc`.

`BirthdaysWidget`: active employees whose `birth_date` month equals the current month and day ≥ today; sorted by day; shows "сегодня N" badge, "через N день/дня/дней" and the age they turn (only if birth year > 1900); empty text "Ближайших дней рождения в этом месяце нет".

---

## 1. Сотрудники / Администрирование (`/hr/administration`)

### 1.1 Purpose
Staff register: departments, positions, the employee card (personal data, passport, relatives, diplomas, workplace and schedule), firing/restoring, the Academy-login switch, and the list of firing reasons. It is the master data every other HR section hangs off.

### 1.2 Tables (final shape)

**`employees`** (base DDL not in repo; see 0.2)

| Column | Type | Null / default | Meaning |
|---|---|---|---|
| id | UUID PK | | |
| name | TEXT | NOT NULL | "Фамилия Имя Отчество" (rebuilt from parts); also the legacy join key for deals |
| phone, email | TEXT | null | contacts; email = Academy login and Academy↔CRM link key |
| role | TEXT | null, free text (CHECK dropped) | `agent`, `manager` (shown "Оператор"), `hr`, `admin`, or custom role name; mirrored to profiles.role by trigger |
| user_id | UUID → auth.users | null | CRM login of this person |
| last_name, first_name, middle_name | TEXT | null | name parts |
| birth_date | DATE | null | |
| birth_place, nationality, citizenship | TEXT | null | |
| gender | TEXT | null, CHECK `male`/`female` | "Мужской"/"Женский" |
| passport_series | TEXT | null | 2 letters (UI forces upper-case letters A-ZА-Я, max 2) |
| passport_number | TEXT | null | 7 digits (UI strips non-digits, max 7) |
| passport_issued_by | TEXT | null | |
| passport_issued_date, passport_valid_until | DATE | null | |
| photo_url | TEXT | null | exists, unused by UI (avatar = initials) |
| pinfl | TEXT | null, partial UNIQUE where non-empty | 14 digits (UI strips to ≤14 digits; no hard validation on save) |
| inn | TEXT | null | digits only |
| address | TEXT | null | residence |
| relative_name, relative_relation, relative_phone, relative_workplace, relative_position, relative_address | TEXT | null | one "emergency relative" kept flat (legacy); `relative_email` column exists, no longer used |
| education_level | TEXT | null | `higher`, `incomplete_higher`, `specialized_secondary`, `secondary`, `incomplete_secondary` ("Высшее", "Незаконченное высшее", "Среднее специальное", "Среднее", "Неполное среднее") |
| education_institution, education_specialty, education_qualification | TEXT | null | flat legacy education (real list in `employee_diplomas`) |
| position | TEXT | null | position name (display + legacy text match); legacy values `agent/manager/admin/hunter/closer/both` were nulled |
| position_id | UUID → positions ON DELETE SET NULL | null | real link, source of start time/workdays |
| department_id | UUID → departments ON DELETE SET NULL | null | |
| hired_at | DATE | null | date of hire; attendance/KPI count from here |
| termination_reason | TEXT | null | text copy of the chosen reason |
| terminated_at | TIMESTAMPTZ | null | |
| active | BOOLEAN | NOT NULL DEFAULT true | false = fired (soft delete) |
| workflow_status | TEXT | CHECK `trainee`/`intern`/`active`/`terminated`, DEFAULT 'active' | lifecycle: Обучающийся → Стажёр → Активен → Уволен |
| total_experience_months | INT | null | prior experience, shown "N лет M мес." |
| rate | NUMERIC(4,2) | null | "Ставка" (1.00) |
| salary | BIGINT | null | "Оклад (сум)"; payroll "Заполнить" reads it |
| order_number, order_date | TEXT, DATE | null | hiring order |
| system_registered_at | TIMESTAMPTZ | DEFAULT now() | "Дата регистрации в системе" |
| employment_type | TEXT | null, CHECK `TD`/`GPH`/`IP`/`SZ` | ТД Трудовой договор / ГПХ Гражданско-правовой договор / ИП Индивидуальный предприниматель / СЗ Самозанятый |
| remote | BOOLEAN | NOT NULL DEFAULT false | "Удалённый сотрудник": excluded from attendance journal and KPI |
| workdays | INT[] | null | personal working weekdays (1..7); superseded by `work_schedule` in the UI but still read |
| work_schedule | JSONB | null, CHECK object | `{"1":{"start":"09:00","end":"18:00"},…"7":…}`; missing day = day off; NULL = use position/global (origin/main only) |
| sales_role | TEXT | null, CHECK `hunter`/`closer` | Goodland sales role (хантер / лидоруб), no HR UI found |
| telegram_chat_id | BIGINT | null, partial UNIQUE | @goodlandhrbot link (Face ID letters/photos, notifications) |
| telegram_lang | TEXT | null, CHECK `ru`/`uz` | |
| academy_user_id | TEXT | null | auth id of the Academy account; non-null = "Аккаунт активен" |
| academy_access_expires_at | TIMESTAMPTZ | null | trainee access expiry (7 days); NULL = permanent |
| amocrm_user_id | BIGINT | null | legacy amoCRM manager link |
| amocrm_operator | TEXT | null | value of the amoCRM "Оператор" lead field this person maps to (for meeting plan/fact and call-centre pay) |
| mehnat_reference, mehnat_data (JSONB), mehnat_synced_at | TEXT, JSONB, TIMESTAMPTZ | null | placeholders for my.mehnat.uz (e-labour-book); **no integration exists**, only a free-text field in the profile form |

Indexes: `uniq_employees_pinfl`, `idx_employees_department`, `idx_employees_position_id`, `idx_employees_active`, `uniq_employees_tg_chat`.

**`departments`**: `id UUID`, `name TEXT NOT NULL` (UNIQUE on `lower(name)`), `sort_order INT NOT NULL DEFAULT 0`, `created_at`, `is_sales BOOLEAN NOT NULL DEFAULT false` (only these departments get sales plans), `head_employee_id UUID → employees ON DELETE SET NULL` (head of department: issues inventory, approves day-off requests, approves self-registered inventory). Seeds: «Административно-управленческий персонал», «Отдел продаж», «Отдел управления персоналом», «Надомный труд».

**`positions`**: `id`, `department_id → departments SET NULL`, `name NOT NULL`, `description`, `sort_order`, `created_at`, `start_time TIME` (arrival threshold for this position), `workdays INT[]`. UNIQUE `(coalesce(department_id::text,''), lower(name))`. The special position «Стажёр» (department NULL, sort_order 100) is auto-created (`ensureInternPosition`, `api.ts:1024`).

**`termination_reasons`**: `id`, `label NOT NULL` (UNIQUE lower), `sort_order`, `active BOOLEAN DEFAULT true`, `created_at`. Seeds: «По собственному желанию», «По соглашению сторон», «Истечение срока договора», «Несоответствие занимаемой должности», «Нарушение трудовой дисциплины», «Сокращение штата».

**`employee_diplomas`** (1:N, CASCADE): `degree, institution, specialty TEXT; enrolled_year, graduated_year INT; series_number TEXT; issued_date DATE; status TEXT ("Подтверждён / Не подтверждён" free text); notes TEXT; created_at`. `degree` options come from a constant in `DiplomaForm`: «Бакалавр», «Магистр», «Доктор», «Среднее», «Среднее спец.».

**`employee_relatives`** (1:N, CASCADE): `relation` (spouse/mother/father/child/sibling/other → "Супруг(а)", "Мать", "Отец", "Ребёнок", "Брат/Сестра", "Другое"), `full_name, birth_date, birth_place, workplace_position, residence_address, phone, email, created_at`.

**`reference_articles`** (knowledge base; page `/reference`, not under /hr): `id, title NOT NULL, body NOT NULL DEFAULT '', sort_order, updated_at`. Seeded with «Правила посещаемости и KPI» (full rules text, reproduced in §2.5).

Related but owned by other modules: `profiles`, `roles`, `role_permissions` (0.4); `deals.agent_emp_id/agent2_emp_id/manager_emp_id/lidorub_emp_id` and `plans.employee_id` reference employees (they block hard delete); `meeting_plans(employee_id, period 'YYYY-MM', target_count)` (see §3).

### 1.3 Screens

**List page `/hr/administration`** (`app/(app)/hr/administration/page.tsx`)
- Header `PageHeader` with back to `/hr`; **metrics bar** (5 cards, computed on active non-trainee staff, line ~290): «Всего сотрудников» (hint "работают сейчас"); «Средний возраст» ("лет"/"нет данных"); «Распределение по полу» («М n · x%», «Ж n · y%» + bar); «Средний стаж» (from `hired_at`, shown "3 г 2 мес"); «Текучесть (12 мес)» with hint "уволено N за год" — turnover = fired in last 12 months ÷ ((begin + current)/2), begin = current − hired_12m + fired_12m.
- Left sidebar with two tabs: «Подразделения» (first row «Без подразделения», then departments with counts and a pencil to edit) and «Должности» (position list with counts; click toggles filter; empty text "Должности не созданы. Нажмите «Создать должность» сверху.").
- Right: title = chosen department / position, **«Действия»** gear menu: «Создать рабочее место», «Создать подразделение», «Создать должность», «Причины увольнения» (disabled for non-editors).
- Search «Поиск по ФИО, должности, ПИНФЛ» (also phone, parts); status filter «Работают» / «Уволены» / «Все» (default Работают). Trainees are always hidden here (they live in Onboarding); interns are shown (no department, position «Стажёр»).
- Table columns: №, Должность, Фамилия (+ badge «Обучающийся»/«Стажёр»), Имя, Отчество, Тип занятости (badge ТД/ГПХ/ИП/СЗ), Дата приёма на работу, Аккаунт (email + role badge «Агент/Оператор/HR/Админ», or "нет входа" when email set but no `academy_user_id`, or "нет аккаунта"), Действие. Mobile: card list. Table height is user-resizable (saved in localStorage `hr-admin-table-height`).
- Row actions: edit (workplace form), for interns «Принять на постоянную работу» (confirm: "Принять «<name>» на постоянную работу? Назначьте подразделение и должность после перевода." → `transitionWorkflowStatus(id,'active')`), «Уволить» (opens TerminateEmployeeModal), for fired «Восстановить» (confirm "Восстановить сотрудника «<name>»?"), delete (confirm "Удалить сотрудника «<name>»? Это действие необратимо."; fails with the references message above).
- Row click → card page.

**Forms (all modals)**
- *DepartmentForm* — «Создать отдел»/«Редактировать отдел»: «Название отдела» (placeholder "Например, Отдел продаж"), «Порядок сортировки (0 — первый)», «Руководитель отдела» (searchable employee select, clearable, "Не назначен"; hint "Может выдавать предметы инвентаря сотрудникам этого отдела (если у него есть вход в CRM)."), checkbox «Отдел продаж (сотрудникам выставляются планы продаж)». Buttons: Удалить (confirm `Удалить отдел "<name>"?`), Отмена, Сохранить (disabled without name). Validation: "Введите название отдела". Delete refused: "Нельзя удалить — в отделе N сотрудник(ов). Переведите их в другой отдел или снимите назначение." and "Нельзя удалить — в отделе N предмет(ов) инвентаря. Сначала перенесите их в другой отдел."
- *PositionForm* — «Создать должность»: «Название должности» ("Например: Менеджер по продажам"), «Отдел» ("Без отдела"), «Время прихода (порог опоздания)» (time; "Пусто — берётся общее время из настроек KPI."), «Рабочие дни» (Пн…Вс toggles; "Пусто — берутся общие рабочие дни из настроек KPI. Отметьте, например, субботу для этой должности."), «Описание (необязательно)». Error "Введите название должности". Delete (confirm `Удалить должность «<name>»?`) refused while employees hold it: "Нельзя удалить — на этой должности N сотрудник(ов). Переведите их на другую должность или снимите её и попробуйте снова." (check is by position *name*, `api.ts:120`).
- *WorkplaceForm* (create employee / edit workplace; `WorkplaceForm.tsx`): in create mode first the «ФИО сотрудника» section: Фамилия, Имя, Отчество, ПИНФЛ ("14 цифр"), ИНН. Then «Рабочее место»: Отдел, «Должность / профессия» (choose from the position directory filtered by department; selecting sets both `position_id` and `position`; hint if free-text position not in directory: "Текущая должность «…» не найдена в справочнике — выберите из списка, чтобы привязать время прихода."), «Тип занятости», checkbox «Удалённый сотрудник» ("Не учитывать в отчёте по посещаемости и KPI."), «Рабочие дни» (= `WorkScheduleEditor`: weekday toggles + checkbox «Указать часы работы» → per-day start/end; "Опоздание и ранний уход считаются по этим часам."), «Ставка» (default 1), «Оклад (сум)», «Дата приёма» (default today), «Номер приказа», «Дата приказа» (default today). Schedule validation (`validateScheduleForm`, `workSchedule.ts`): "Отметьте рабочие дни", "Укажите время", "Конец должен быть позже начала". Create sets `role='agent'`, `active=true`, `system_registered_at=now`, builds `name` from parts ("Введите ФИО сотрудника" if empty).
- *HrProfileForm* («Обновить данные» on the card): sections «Личные данные» (Фамилия, Имя, Отчество, Дата рождения, Пол, Гражданство ("Узбекистан"), Серия паспорта, Номер паспорта, ПИНФЛ (14 цифр), ИНН, «Кем выдан паспорт», «Дата выдачи паспорта», «Срок действия», «Место рождения», «Национальность», «Адрес проживания»), «Контакты родственника» (ФИО родственника, «Кем приходится», Телефон, Место работы, Должность, Адрес), «Образование» (Уровень, Учебное заведение, Специальность), «Работа» (Должность, Дата приёма, «Общий стаж (месяцев)», «Причина увольнения» only for fired, «my.mehnat.uz — ссылка/идентификатор» placeholder "Будет интегрировано позже"). Save rebuilds `name`; trims strings to null; experience floor ≥ 0.
- *DiplomaForm*: «Степень / уровень», «Статус», «Учебное заведение», «Специальность», «Год поступления», «Год окончания», «Серия и номер диплома», «Дата выдачи».
- *RelativeForm*: «Степень родства *» (required; alert "Выберите степень родства"), «ФИО», «Дата рождения», «Место работы и должность», «Место жительства», «Телефон».
- *TerminateEmployeeModal* «Увольнение сотрудника»: text "Сотрудник <ФИО> будет помечен как уволенный и перемещён во вкладку «Уволены». Это действие можно отменить кнопкой «Восстановить».", required «Причина увольнения *» select from active reasons ("Справочник причин пуст. Сначала добавьте причины." + link «Открыть справочник»), button «Уволить» ("Увольнение…").
- *TerminationReasonsManager*: CRUD list of reasons (label, sort, active toggle); error "Введите причину увольнения".
- *AccountAccessForm* — «Дать доступ в Академию» / «Доступ в Академию» / «Доступ обучающегося (7 дней)»: Email, Пароль (min 6; "Новый пароль (пусто — не менять)" when exists), hint "Доступ открывается в приложение Academy (goodland-academy). Менеджер войдёт по этому email и паролю. Связка с его данными в CRM — по email."; errors "Введите email", "Для нового доступа задайте пароль (мин. 6 символов)", "Пароль должен быть не короче 6 символов"; «Закрыть доступ в Академию» (confirm `Закрыть доступ в Академию для «<name>»?`).

**Card page `/hr/administration/[id]`**: back; header with initials avatar, full name, lifecycle badge (Обучающийся/Стажёр/Активен/Уволен), grid: ПИНФЛ, Номер паспорта, ИНН, Выдан, Дата рождения, Дата выпуска, Возраст, Срок действия, Пол, Общий стаж; fired banner «Уволен · <date>» + reason ("Причина не указана"); account strip («Аккаунт активен» + email + role + «Управлять» / «Доступа в Академию нет» "Сотрудник есть в кадровой системе, но не может войти в Academy" + «Дать доступ»); button «Обновить данные». Tabs: «Трудовая книжка» (current workplace: Дата начала работы, Отдел, Должность / профессия, Ставка, Оклад, График работы (lines "Пн 09:00–18:00" or "Не задан — время прихода по должности"), Дата регистрации в системе, Номер приказа, Дата приказа; «Редактировать»), «Образование» (diploma table: №, Степень, Учебное заведение, Специальность, Год поступл., Год оконч., Серия и №, Дата выдачи, Статус, Действие; note "Дипломы вводятся вручную. Интеграция с diplom.edu.uz будет добавлена позже."; delete confirm `Удалить диплом <institution>?`), «Родственники» (table №, Степень родства, Фамилия, имя и отчество, Дата рождения, Место работы и должность, Место жительства, Телефон; confirm `Удалить запись о <name>?`), «Больничный лист» and «Гражданско-правовой договор» (**placeholders**), «CV/Объективка» (read-only view; «Партийность», «Учёная степень», «Государственные награды» are fixed "Нет" placeholders), «Face ID» (see §2), «Инвентарь» (see §4).

### 1.4 Business rules
- Lifecycle `trainee → intern → active → terminated` (`transitionWorkflowStatus`, `api.ts:1044`): `terminated` sets `active=false`, `terminated_at=now`; every other value sets `active=true`; moving to `intern` forces `position='Стажёр'`, `position_id=` the auto-created «Стажёр» position, `department_id=NULL` (`legacy/hr-interns-no-department.sql` back-fills existing ones). Interns therefore get their arrival time/workdays from the position «Стажёр».
- Firing (`terminateEmployee`, `api.ts:218`): update flags and reason, then **best-effort revoke of the Academy account** (`DELETE /api/academy/access`); a daily cron (`revokeTerminatedAccess`) is the safety net. Restoring sets `active=true, workflow_status='active'`, clears termination fields (it does not re-grant Academy access).
- Position directory vs free text: arrival time and workdays are resolved via `position_id`, with a name-based fallback (`kpi.ts:73`, `:102`).
- Uniqueness errors (department name, position name within department, PINFL) surface as raw Postgres messages; the rebuild should give friendly text.
- Employees list is a client-side filter over the whole `employees` table loaded with `useHrBundle` (departments + employees + positions + reasons + shifts in one fetch, `fetchHrBundle`, `api.ts:30`).

### 1.5 Integrations
- **Academy app + its Supabase project** (`createAcademyClient`, service role): account create/update/delete (`/api/academy/access`), role `Student` (full) or `Trainee` (training + events only), expiry for trainees, daily crons `expireTraineeAccess` / `revokeTerminatedAccess`. Without it «Дать доступ» and auto-revocation do not work; the rest of the card works.
- Telegram link (for Face ID/letters) is managed on the Face ID tab (§2).
- my.mehnat.uz / diplom.edu.uz: **not implemented** (placeholders only).

### 1.6 Goodland-specific vs generic
Generic: employees, departments, positions, termination reasons, diplomas, relatives, lifecycle, metrics. Uzbekistan-specific (portable to any UZ company): PINFL/INN, passport series+number, employment types ТД/ГПХ/ИП/СЗ, my.mehnat/diplom.edu.uz placeholders. Goodland-specific: `is_sales` departments, `sales_role` hunter/closer, `amocrm_operator`/`amocrm_user_id`, Academy account switch with 7-day trainee access, the roles «Агент/Оператор».

### 1.7 Dependencies
Everything references `employees`: attendance, requests, Face ID, payroll, inventory (holder, head, office manager, act people), recruiting (recruiter, hire), battleship teams, deals/plans. `positions` feed attendance thresholds and workdays; `departments` feed inventory ownership, hiring plans, vacancies, day-off approval chain, call-centre payroll group. `termination_reasons` only feed the fire dialog.

---

## 2. Посещаемость / Эффективность (`/hr/performance`, `/hr/performance/report`, `/hr/performance/face-id`)

### 2.1 Purpose
A daily attendance journal (arrival, departure, status, reason, dress code, shift) for active staff and interns, fed automatically by the Face ID tablet and corrected by HR; a day-closing workflow that freezes a day; a monthly KPI report (attendance %, punctuality %, dress code %) with limits for excused absences; a request workflow for day-offs/swaps; and the Face ID administration (photos, devices, scan log, late-reason list). The same KPI function also drives the employee-facing "Моя эффективность" card on `/dashboard` and the attendance aggregate pushed to the Academy.

### 2.2 Tables (final shape)

**`employee_attendance`** — one row per employee per day. UNIQUE `(employee_id, attendance_date)`; indexes on employee and date.

| Column | Type | Null / default | Meaning |
|---|---|---|---|
| id | UUID PK | | |
| employee_id | UUID → employees ON DELETE CASCADE | NOT NULL | |
| attendance_date | DATE | NOT NULL | Tashkent calendar day |
| shift_id | UUID → shifts ON DELETE SET NULL | null | shift chosen for that day; overrides arrival threshold and disables the early-leave check |
| arrival_time, departure_time | TIME | null | first arrival / last departure |
| status | TEXT | null, CHECK `on_time`,`late`,`absent`,`off` | «Вовремя», «Опоздание», «Отсутствие», «Выходной». `off` = floating day off (neutral, see KPI) |
| reason | TEXT | null, CHECK `excused`,`unexcused`,`day_off`,`sick`,`vacation` | «Уважительная», «Неуважительная», «Отгул», «Больничный», «Отпуск»; meaningful only for `late`/`absent` |
| has_certificate | BOOLEAN | NOT NULL DEFAULT false | sick leave backed by a certificate («есть справка») |
| dress_code_ok | BOOLEAN | null | ✓ / ✕ / unset |
| dress_code_note, notes | TEXT | null | comments |
| late_reason_id | UUID → late_reasons SET NULL | null | reason picked on the kiosk (NULL with text = «Другое») |
| late_reason_text | TEXT | null | wording at scan time, or free text |
| left_early | BOOLEAN | NOT NULL DEFAULT false | left before the end of day per personal schedule (written together with departure, never recomputed retroactively) |
| early_leave_reason | TEXT | null, CHECK `excused`/`unexcused` | |
| created_at, updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Trigger `trg_employee_attendance_day` (BEFORE INSERT/UPDATE/DELETE) calls `attendance_check_day_open()` (`legacy/hr-attendance-kpi.sql:87`, replaced by `hr-attendance-interns-open.sql:11`): if a row exists in `attendance_day_close` for that date the write raises «День % закрыт — изменения невозможны (откройте через «Корректировать»)» (delete: «День % закрыт — запись нельзя удалить»). **Employees with `workflow_status='intern'` are exempt** (interns are marked later in the day than the day is closed).

**`attendance_settings`** — singleton (`id BOOLEAN PK DEFAULT TRUE`, CHECK id): `attendance_threshold INT 90` (% presence), `punctuality_threshold INT 90`, `dresscode_threshold INT 90`, `max_excused_days INT 6` (per month), `max_annual_offtime_days INT 20` (отгул+отпуск per year), `bonus_pct NUMERIC 5` (stored and editable, **not used anywhere else** — intended as "bonus from commission next month"), `default_start_time TIME '10:00'`, `workdays INT[] '{1,2,3,4,5}'`, `tracking_start_date DATE` (first day the journal is kept; the UI falls back to the 1st of the current month), `required_work_minutes INT 480` (Face ID short-day norm), `updated_at`. Readable by any authenticated user (the employee KPI widget); writable by `hr`/`admin`.

**`attendance_day_close`** — presence of a row = the day is closed: `attendance_date DATE PK`, `closed_at TIMESTAMPTZ`, `closed_by UUID`. Readable by everyone logged in (KPI denominators).

**`shifts`** — `id, name NOT NULL, start_time TIME NOT NULL, sort_order, created_at`. "Floating" shifts picked per day.

**`attendance_requests`** (origin/main; `legacy/hr-day-off-requests.sql`) — day-off / swap request: `id UUID`, `employee_id → employees CASCADE NOT NULL`, `kind` CHECK `day_off`/`swap` NOT NULL, `date_off DATE NOT NULL`, `date_work DATE` (CHECK `(kind='swap') = (date_work IS NOT NULL)`), `comment TEXT NOT NULL CHECK (length(btrim(comment))>0)` (cause is mandatory), `status` CHECK `pending_head`,`pending_hr`,`approved`,`rejected`,`cancelled` DEFAULT `pending_head`, `head_employee_id → employees SET NULL`, `head_decided_at`, `head_approved BOOLEAN` (head's own verdict, kept separate from status), `head_comment`, `hr_user_id UUID`, `hr_decided_at`, `hr_comment`, bookkeeping for the bot (`head_notified_at`, `head_reminded_at`, `hr_notified_at`, `employee_notified_state`), `created_at`. UNIQUE partial `(employee_id, date_off) WHERE status IN ('pending_head','pending_hr','approved')` (one live request per date).

**`attendance_day_overrides`** — one-off exceptions to the schedule: `id`, `employee_id CASCADE`, `date`, `kind` CHECK `off`/`work`, `request_id → attendance_requests CASCADE`, `created_at`, UNIQUE `(employee_id, date)`. Written only by `request_decide_hr`; INSERT/UPDATE/DELETE revoked from clients.

**Face ID tables** (needed by the journal: punches, reasons, letters, devices):
- `late_reasons(id, label_ru NOT NULL, label_uz NOT NULL, sort_order, active DEFAULT true, created_at)`; trigger `late_reasons_max_active` allows at most **4 active** («Активных причин опоздания может быть не больше 4»). Reasons are deactivated, never deleted.
- `attendance_devices(id, name NOT NULL, key_hash TEXT UNIQUE NOT NULL (sha256 of the tablet key), admin_pin_hash NOT NULL (sha256 of "<id>:<pin>"), app_version, last_seen_at, queue_size INT DEFAULT 0, queue_oldest_at, health_alert_at, revoked_at, created_by, created_at)`.
- `face_photos(id, employee_id CASCADE, storage_path UNIQUE NOT NULL (bucket face-photos), source CHECK crm/telegram/academy DEFAULT crm, status CHECK pending/approved/rejected DEFAULT pending, quality CHECK ok/no_face/multiple_faces/too_small/blurry, quality_checked_at, uploaded_by, reviewed_by, reviewed_at, reject_note, hr_notified_at, employee_notified_state, created_at)`; trigger `face_photos_max_five`: max 5 pending+approved per employee **per source group (academy vs all others)** («У сотрудника уже 5 фото для Face ID» / «…из Academy»).
- `face_templates(photo_id → face_photos CASCADE, model_version, embedding REAL[] NOT NULL, device_id, created_at, PK(photo_id, model_version))` — service role only; the tablet computes embeddings.
- `attendance_punches(id UUID PK generated by the tablet = idempotency key, device_id NOT NULL, employee_id SET NULL, kind in/out, punched_at, received_at, clock_flag BOOLEAN, attendance_date, recognition CHECK matched/unknown_face/liveness_failed, outcome CHECK saved/already_in/no_checkin/day_closed/inactive/rejected, match_score REAL, liveness_score REAL, snapshot_path (bucket punch-snapshots, nulled after 30 days), attendance_id → employee_attendance SET NULL, late_minutes, worked_minutes, required_minutes, short_day BOOL, short_day_ack BOOL, late_reason_id, late_reason_text, app_version, response JSONB (stored reply for retries), hr_notified_at, employee_notified_at, letter_reminded_at)`.
- `late_letters(id, attendance_id CASCADE, employee_id CASCADE, storage_path (bucket late-letters, nulled after 65 days), telegram_file_id, received_at, hr_notified_at)` — photos of handwritten explanatory notes sent via the bot.
- `hr_telegram_link_codes(code PK, employee_id CASCADE, created_by, expires_at, used_at, used_chat_id BIGINT)` — one-time link codes (TTL 24 h); function `unlink_my_telegram()`.
- `face_academy_scans(id, employee_id CASCADE, academy_user_id UUID, photo_count INT, app_version, created_at)` + function `face_academy_replace(...)` (replaces the employee's Academy photos in one transaction; the "5 scans per 24 h" limit is enforced in the route).
- Private Storage buckets: `face-photos`, `punch-snapshots`, `late-letters` (signed URLs, 600 s in the browser).

### 2.3 Screens

**Journal `/hr/performance`** (`app/(app)/hr/performance/page.tsx`)
- Title «Управление эффективностью», subtitle "Ежедневный учёт прихода и ухода, дресс-кода и комментариев. Время прихода — по личному графику сотрудника, иначе по должности."
- Toolbar: save state ("Сохранение…" / "Ошибка сохранения"), «Настройки KPI» (editor only), «Заявки (N)» toggle (N = requests waiting for HR), link «Месячный отчёт», link «Face ID» (badge = photos awaiting review), date picker (max = today).
- **Day banner** (`DayBanner`): "День открыт — заполните журнал и закройте день." / closed: "День закрыт и зафиксирован. Для правок нажмите «Открыть день»." (non-editors: "…Открыть для правок могут админ или HR.") / future: "Будущий день — ввод недоступен." / non-working: "Выходной день (по настройкам). В KPI не учитывается." / blocked: "Сначала закройте предыдущий день — <date>." with button «К дню <date>». Buttons «Закрыть день», «Открыть день».
- 4 summary cards: «Вовремя», «Опоздания», «Отсутствия», «Нарушения дресс-кода».
- Two tables with identical columns — «Журнал посещаемости» (non-interns, "N сотр.") and «Журнал стажёров» (interns; "· день закрыт, стажёров отмечать можно"): №, Ф.И.О (with chips «отгул по заявке» / «замена» and "по графику 09:00–18:00" or "приход с HH:MM"), Смена, Приход, Уход (+ "раньше на 1 ч 5 мин" / "ушёл раньше"), Отработано, Статус, Причина (+ checkbox «есть справка» for sick), Причина опоздания (kiosk text or "причина не указана"; letter photo links or "нет объяснительной"; "удалено" after 65 days), Ранний уход (reason select), Дресс-код (✓ / ✕ + comment), Комментарии. Empty: "Сотрудников на эту дату нет." Footnote: "Приход и уход приходят с планшета Face ID (значок камеры — снимок скана) и при необходимости правятся вручную. Сегодняшний журнал обновляется раз в минуту."
- Who appears (`page.tsx:243`): `active` not false, `remote` not true, `workflow_status` is `active` or `intern`, `hired_at` (or `system_registered_at`) ≤ date, and visible on that date (`isVisibleOnDate`: works per schedule, or has a `work` override; an `off` override keeps the row visible).
- Editable (`page.tsx:292-299`): user can edit `hr.performance` AND day not closed AND not in the future AND the day is the earliest unclosed working day (cannot skip ahead — `blockedByEarlier`). Interns are editable even on a closed day (`editableInterns`, `:299`).
- Row logic: the status list hides «Выходной» unless the employee works Sundays or already has that status (`:880`); reasons by status: `late` → excused/unexcused only, `absent` → all five (`reasonsForStatus`, `:108`); changing status to `absent`/`off` clears arrival, departure and early leave; entering arrival (on blur, `:897`) auto-sets status via `deriveStatusByThreshold` (arrival ≤ threshold → on_time else late; `absent` is kept); choosing a shift recalculates status and early leave (`:914`); departure on blur (`:886`) computes `left_early` via `earlyLeaveFields` (departure < end of day of the personal schedule, no grace; default reason `unexcused`); "Отработано" = departure−arrival, with chip «короткий день» (+ " · подтвердил" if the employee acknowledged it on the kiosk) when status is `late` and worked < `required_work_minutes` (`:983`).
- A row writes **only the changed fields** (`attendanceUpsertPayload`, `attendancePayload.ts`) so a kiosk scan written meanwhile is not overwritten. The journal never writes `late_reason_*`.
- **Close day** (`onCloseDay`, `:339`): refuses while loading ("Журнал ещё загружается — подождите пару секунд и закройте день снова.") or when more than one employee exists and none has a status ("Ни у одного сотрудника нет статуса — похоже, журнал не загрузился. Обновите страницу: закрывать день по пустому журналу нельзя, иначе все получат «Отсутствие»."); if some have no status: confirm "У N сотр. не заполнен статус. Они будут отмечены как «Отсутствие». Приход и уход с планшета останутся как есть. Закрыть день?", sets only `status='absent'` for them (`closeSweepPatch`), then upserts `attendance_day_close(date, closed_by, closed_at)`. History: on 29 Sep 2026 an older version also nulled arrival/departure and wiped 22 arrivals and 12 departures — hence these guards (`attendanceClose.ts`). Reopen: confirm "Открыть день для корректировки? День снова станет редактируемым." = delete the close row.
- **KPI settings modal** «Настройки KPI эффективности» (`KpiSettingsModal.tsx`): «Порог посещаемости, %» (hint "Присутствие + уважительные"), «Порог пунктуальности, %» ("Вовремя среди дней присутствия"), «Порог дресс-кода, %», «Лимит уважительных, дн/мес» ("Уваж. + больничный без справки. Сверх — как неуваж."), «Лимит отгул+отпуск, дн/год» ("Общий годовой лимит. Сверх — как неуваж."), «Бонус с комиссии, %» ("Начисляется на следующий месяц"), «Время прихода по умолчанию» ("Для должностей без своего времени"), «Учёт с даты» ("С какого дня вести журнал (для закрытия дней)"), «Норма рабочего времени, ч» ("Face ID: опоздавшим, отработавшим меньше, ставится «короткий день»"; stored in minutes), «Рабочие дни» (Пн…Вс). Inline sections: «Смены (время прихода)» with «+ Смена» (default name `Смена N`, time, delete with confirm `Удалить смену «<name>»?`; empty: "Смены не созданы. Добавьте смену, если у сотрудников разное время прихода — в табеле смену можно выбрать на каждый день."; hint "Порог опоздания берётся из смены дня. Если смена не выбрана — используется время должности или общее время.") and «Время прихода по должностям» (one time input per position, saved immediately; "Пусто → используется время по умолчанию."). Validation: "Введите название смены", "Укажите время прихода смены".

**Requests tab «Заявки»** (inside the journal; `RequestsTab.tsx`): filter «Ждут решения» / «Все заявки», department select «Все отделы», employee search «Сотрудник», month; one card per request: employee, kind chip «Отгул»/«Замена», "Отгул dd.mm" + " · выйдет dd.mm", "Причина: …", kiosk evidence "Киоск dd.mm: пришёл 09:58 / не выходил / впереди", warning when a date is closed ("День … закрыт: заявку утвердить можно, но строку в журнале изменит только повторное открытие дня."), head verdict "Руководитель: согласовал/отклонил — comment", HR comment box «Комментарий (обязателен при отказе)», buttons «Утвердить», «Отклонить» (on an approved one: «Отменить утверждение»). Status chips: «У руководителя», «Ждёт HR», «Утверждено», «Отклонено», «Отозвано». Queue sorted oldest-submitted first; history by date_off. Errors "Не удалось загрузить заявки: …", empty "Заявок нет."

**Monthly report `/hr/performance/report`** (`report/page.tsx`): title «Отчёт по посещаемости и KPI», subtitle "Кто требует внимания — сверху. Посещаемость, пунктуальность и дресс-код за месяц."; month picker; 4 clickable filter cards «KPI выполнили (из N)», «Опоздания», «Отсутствия» (+"+N не отм."), «Нарушения дресс-кода»; three watch-lists (top 4) «Злостные опоздатели» (оп.), «Злостные прогульщики» (дн.), «Нарушители дресс-кода» (дн.); table «По сотрудникам» sorted by `severity` (`max(0,90−att)*1.4 + max(0,90−punct) + max(0,90−dress) + unmarked*2`, `:60`), columns Ф.И.О, Дни, Опозд., Ран. уход, Отсут. (+"N не отм."), Уваж. (`excusedDays/max_excused_days`), Посещ., Пункт., Дресс-код (mini bars: green ≥90, amber ≥70, red), KPI («✓ Выполнен» / «✕ Провал» + failing metrics). People with no evaluated days go to a group "Нет данных за месяц (приняты позже / весь месяц отпуск-больничный) — не оцениваются". Interns appear in a separate table «Стажёры — посещаемость без оценки KPI». Collapsible «Правила учёта посещаемости и KPI» table (reason / effect / limit). Empty states: "За <month> нет закрытых дней — KPI ещё не рассчитывается. Закрывайте дни в журнале посещаемости." and "Активных сотрудников нет."

**Employee widget «Моя эффективность»** on `/dashboard` (`MyPerformanceCard.tsx`): current-month tiles (Вовремя, Опоздания, Отсутствия, Дресс-код, KPI "Выполнен/Не выполнен/нет данных"), explanation "Что не дотянуло до KPI:" / "Все условия KPI выполнены", «Детально за период» modal «Детальная посещаемость».

**Face ID admin `/hr/performance/face-id`** (tabs): «Регистрация» (per-employee readiness: «Готов», «Ждёт планшет», «Фото не подошло», «Нет фото»; filters Все / Нет фото / Фото не подошло / Ждут планшет / Готовы; summary "Готовы к отметке: X из Y"; columns «Скан в Академии» / «Академия» ("не привязан")), «На проверке (N)» (HR approves/rejects photos with `reject_note`, can compare with already approved ones; "Новых фото на проверку нет."), «Журнал сканов» (filters employee / tablet / outcome; outcome badges «Записано», «Уже отмечен», «Уход без прихода», «День закрыт», «Не работает», «Не распознан»; recognition «Распознан», «Лицо не распознано», «Не прошёл проверку живости»; "Снимки хранятся 30 дней, затем удаляются автоматически."), «Планшеты» (editors only; «Новый планшет»: Название ("Например: Вход, 1 этаж"), PIN 4 digits → «Создать и показать QR» — the QR encodes `{v:1,url,device,key}` and is shown once; list shows «На связи» / «Нет связи» (silent > 15 min) / «Отозван», app version, queue size; «Сменить PIN», «Отозвать» with confirm `Отозвать планшет «<name>»? Он перестанет работать и сотрёт свои данные.`). Also the editor «Причины опоздания (планшет Face ID)» (RU/UZ text, ▲▼ order, «вкл.»; "Не больше 4 включённых. На планшете после них всегда идёт «Другое»…"). The employee card tab «Face ID»: photo grid + uploader (max 5; "фото HR одобряются сразу", employee uploads need review), last scans, Telegram link («Подключить Telegram» → link code valid 24 h; «Отключить» with confirm "Отключить Telegram? Бот перестанет присылать запросы объяснительных."). Photo tips: "Лицо анфас, взгляд в камеру", "Так же, как сотрудник приходит на работу: в хиджабе, очках — как обычно", "Лицо открыто: без тёмных очков и маски", "Хорошее освещение, без теней на лице".

### 2.4 Kiosk API (how the journal gets filled)
All under `/api/attendance/device/*`, authenticated by the device key (`authenticateDevice`: key → sha256 → `attendance_devices`; revoked devices are told to wipe), `fetchCache='force-no-store'`:
- `GET sync` — everything the tablet needs offline: settings (default start time, required minutes), active late reasons, employees with today's start time (shift / personal schedule / position), approved photos (signed URLs) and existing templates for the tablet's `x-model-version`.
- `GET today` — today's rows (arrival/departure/status of everyone) for "already checked in" and short-day logic.
- `POST templates` — tablet reports photo quality + face embedding.
- `POST punch` (multipart: `data` JSON + `snapshot` JPEG) — rules below; idempotent by punch id; always inserts an `attendance_punches` row, even for rejected scans.
`POST /api/face-id/academy-scan` (Academy bearer token): the employee scans their own face in the Academy; replaces the `source='academy'` photos via `face_academy_replace`.

### 2.5 Business rules and calculations

**Arrival threshold** (`startTimeForRecord` → `startTimeForEmployee`, `kpi.ts:136`, `:73`): shift of the day → personal `work_schedule[weekday].start` → `positions.start_time` (by `position_id`, then by name) → `attendance_settings.default_start_time`. Status `late` iff `HH:MM(arrival) > HH:MM(threshold)` (string compare, **no grace minutes**; `deriveStatusByThreshold`, `:152`).

**Working weekdays** (`workdaysForEmployee`, `:102`): personal schedule days → `employees.workdays` → position workdays → global workdays. A one-off override (`attendance_day_overrides`) beats all of them (`worksOnDate`, `requests/schedule.ts:35`). **End of day for early leave** comes only from the personal schedule and only when no shift is chosen (`endTimeForRecord`, `:125`).

**Kiosk punch decision** (`decidePunch`, `faceId/punch.ts:85`, used by `punch/route.ts`):
- Time: if the tablet clock is more than 2 min ahead of the server (`CLOCK_SKEW_MS`) the server time is used and `clock_flag` is set; date/time are Tashkent.
- Only `recognition='matched'` can write; unknown/liveness failures are only logged (`outcome='rejected'`).
- Employee missing/inactive → `inactive`. Day closed (and employee not an intern) → `day_closed` (also when the DB trigger rejects the write).
- `in`: if the row already has an arrival → `already_in`; else arrival = time, status via threshold, `late_minutes = time − threshold`, late reason id/text stored only when late. The write is conditional (`UPDATE … WHERE arrival_time IS NULL`) so two tablets cannot both win.
- `out`: keeps the **later** of existing/new departure; sets `left_early`/`early_leave_reason` via `earlyLeaveFields`; no arrival → outcome `no_checkin` (departure is still written); otherwise worked = departure − arrival, `short_day = (row.status='late' AND worked < required_work_minutes)`; the tablet asks the employee to confirm (`short_day_ack`).
- Interns' scans are accepted on closed days.

**Day closing and the KPI denominator**: only **closed** days count in KPI. `activeDate` = earliest unclosed working day in `[tracking_start_date; today]` (`page.tsx:201`) — editing is limited to it. A day is a "journal workday" if any visible employee works that weekday or someone has a `work` override that day (`isJournalWorkday`, `requests/schedule.ts:95`).

**KPI per employee per month** (`computeEmployeeKpi`, `kpi.ts:223-450`). Inputs: the employee's records, the set of closed dates that were *his* working dates (`kpiWorkingDates` = closed ∩ `isVisibleOnDate`; includes swap days and keeps day-off days so they reach the annual limit), settings, hire date (earlier days ignored), prior year-to-date count of day_off+vacation.
1. Closed working day with no record/status → unexcused absence ("не отм.", counts as a violation).
2. `status='off'`: covered 1:1 by worked Sundays that month (neutral); "Выходной" beyond the worked-Sunday credit = unexcused absence (in the denominator).
3. `on_time`/`late` (present): in the denominator; `left_early` and dress-code ✕ are counted. Violation if late and reason≠excused, or left early and early reason≠excused. Excused late/early consumes the monthly limit (`max_excused_days`); within the limit it still counts as punctual; beyond it → violation.
4. `absent`: reason `sick` + certificate → neutral (out of the denominator); `sick` without certificate → monthly excused limit (within = counts as attended, beyond = violation; in the denominator); `day_off`/`vacation` → shared annual limit (`max_annual_offtime_days`, year-to-date, chronological): within = neutral (out of the denominator), beyond = absence + violation; `excused` → monthly limit like sick-without-certificate; `unexcused`/no reason → absence + violation.
5. `attendancePct = round((present + excusedAbsentWithinLimit)/workdays·100)`; `punctualityPct = round(punctualDays/present·100)`; `dresscodePct = round((present − dressViol)/present·100)`.
6. Pass: `workdays>0 && attendance ≥ attendance_threshold`, `punctuality == null || ≥ punctuality_threshold`, `dresscode != null && ≥ dresscode_threshold`; overall `pass` = all three.
Interns are shown but not scored; `remote` employees are excluded from journal and report. The staff-facing explanation is the seeded article «Правила посещаемости и KPI» (floating Sunday rule: "Каждое отработанное воскресенье даёт право на 1 «Выходной». Можно взять авансом; не отработанный аванс — штраф (неуважительное отсутствие).").

**Request state machine** (`requests/rules.ts`, `legacy/hr-day-off-requests.sql`): employee → head of department → HR. `request_create` (service role) starts in `pending_head` unless the department has no head or the employee *is* the head (then `pending_hr`); rejects empty cause ("Нужно указать причину"). `request_decide_head`: approve → `pending_hr`; reject → `rejected` (comment mandatory: "При отказе нужна причина"); only from `pending_head` ("Заявка уже решена или не ждёт руководителя"). `request_decide_hr` (SQL `:191`, requires `access_can_edit('hr')`, else "Недостаточно прав"): allowed from `pending_hr`, `rejected` (HR may overrule the head) or `approved` (undo); never from `pending_head` ("Заявка не готова к решению HR"); reject needs a comment. **Approve** → upserts `attendance_day_overrides` (`date_off` kind `off`; `date_work` kind `work` for swaps) and inserts a journal row `status='absent', reason='day_off', notes='Отгул по заявке: <comment>'` (ON CONFLICT DO NOTHING; a closed day makes the insert fail silently with a NOTICE). **Reject/undo** → deletes the overrides, and deletes the journal row only if it still has `reason='day_off'`, no arrival/departure and notes starting `Отгул по заявке:`. `request_cancel`: the employee can cancel while `pending_head`/`pending_hr` ("Заявку уже решили"). Client validation (`validateRequest`): "Нужно указать причину", "Выберите дату отгула", "Выберите день, когда выйдете вместо отгула", "Для отгула день выхода не нужен", "Дни должны быть разными", "В этот день вы и так не работаете", "В этот день вы и так работаете". Past dates are allowed (explaining an absence after the fact). Kiosk evidence = any `matched` punch (not only `saved`) on the date (`punchEvidence.ts`). The Academy talks to `/api/requests/{mine,create,department,decide}` with the Academy token; heads decide in the Academy; HR decides in the CRM.

### 2.6 Integrations
- **Face ID kiosk tablet (P30 Android app `face-kiosk`)** — without it arrival/departure are all manual; all `/api/attendance/device/*` routes and the `face_*`/`attendance_punches`/`attendance_devices` tables, "короткий день" and snapshots exist for it. Face recognition runs on the tablet (CPU); the CRM stores photos and templates.
- **Telegram bot @goodlandhrbot** (external service, reads/writes Supabase with a service-role key; `D:\goodland\hr-bot`): links employees via `/start emp_<code>`; HR alerts for every punch (late with snapshot, unknown face, short day), asks the employee for an explanatory-note photo (stored in `late_letters`) and forwards letters to recruiters, daily 18:00 reminder, tablet-offline alerts (>15 min), new-photo-to-review alerts, day-off request notifications (head on arrival, HR after head approval, employee on final decision, one reminder after 24 h); retention jobs at 03:00 (delete snapshots >30 days, letters >65 days, expired link codes). Without it: no letters and no notifications — the journal itself still works.
- **Goodland Academy**: employees file day-off requests there; face scan from the Academy; a daily CRM job pushes a monthly attendance aggregate (`on_time, late, absent, attendance_pct, punctuality_pct, dress_pct, kpi_ok`) into the Academy table `sales_stats.attendance` (`academySync.ts`).
- Supabase Storage (private buckets) for photos, snapshots, letters.

### 2.7 Goodland-specific vs generic
Generic: journal, statuses/reasons, shifts, schedules, closing, KPI with limits, requests workflow, Face ID. Goodland-specific: `bonus_pct` ("бонус с комиссии" for sales), the Academy push, the floating-Sunday «Выходной» rule (staff who work a Sunday earn one floating day off), the bot/Academy names; 90/90/90 thresholds and the 6/20-day limits are only defaults.

### 2.8 Dependencies
Needs `employees` (workflow_status, remote, hired_at, work_schedule, workdays, position_id), `positions` (start_time/workdays), `departments.head_employee_id` (requests), `shifts`. Feeds: call-centre payroll (worked days, lates), the Academy aggregate, the dashboard widget, day-off overrides.

---

## 3. Зарплата (`/hr/payroll`, module `hr.payroll`)

### 3.1 Purpose
Monthly payroll sheets («ведомости ВЗ-00001») listing salary / commission / bonus accruals per employee, which — when posted — create double-entry postings in the company's general ledger (GL); a report «Расчёты с персоналом» (opening balance, accrued, paid, closing per employee, with a printable reconciliation act); and (unmerged branch) a 12-column call-centre operator pay table that fills the sheet automatically from attendance, meeting plans, amoCRM funnel data and deals.

Payroll is the HR section **most tied to the rest of the product**: the sheet posts to the ledger (`gl_*`), payouts come from the cash module (`cash_operations`), commissions come from `deals`. A standalone HR rebuild can keep sheets + rows and drop posting/report, or keep them if a ledger exists.

### 3.2 Tables (final shape)

**`payroll_sheets`**: `id UUID`, `seq BIGINT GENERATED ALWAYS AS IDENTITY` (document number, shown `ВЗ-` + 5-digit zero-padded), `period TEXT NOT NULL CHECK ^\d{4}-\d{2}$`, `status TEXT NOT NULL DEFAULT 'draft' CHECK draft|posted`, `note TEXT`, `created_by → auth.users`, `created_at`, `posted_at`. RLS: `access_apply_rls(..., 'hr.payroll')` (was admin-only originally).

**`payroll_sheet_rows`**: `id`, `sheet_id → payroll_sheets CASCADE NOT NULL`, `employee_id → employees CASCADE NOT NULL`, `kind TEXT NOT NULL DEFAULT 'salary' CHECK salary|commission|bonus` («Оклад», «Комиссия», «Премия»), `amount BIGINT NOT NULL DEFAULT 0 CHECK >= 0`, `deal_id → deals SET NULL`, `note`, `dept_group TEXT CHECK cc|other` (tab the row belongs to; NULL = by the employee's current department — stored per row so a past month stays correct after a transfer). Indexes on sheet and employee.

**`salary_accruals`** (legacy, superseded by sheets, still has RLS): `employee_id CASCADE`, `period`, `amount BIGINT >= 0`, `note`, `created_by`, `created_at`, UNIQUE `(employee_id, period)`.

**Call-centre settings**: `gl_cash_settings.call_center_department_id UUID → departments SET NULL` (the department whose employees go to the «Колл-центр» tab and to a separate P&L article); P&L article `articles_pl('PL-OPEX-SAL-CC', 'ФОТ колл-центра', 'opex', 305)` next to `PL-OPEX-SAL` («ФОТ (оклады)»). `gl_cash_settings` also holds `start_date` (months on/before it are not posted) — owned by the finance module.

**`payroll_cc_lines`** — *(unmerged branch `feat/cc-payroll-table`, `legacy/payroll-cc-lines.sql`, SQL not yet applied)*: one operator in one sheet; UNIQUE `(sheet_id, employee_id)`; `sheet_id → payroll_sheets CASCADE`, `employee_id → employees CASCADE`; `fixed_salary BIGINT`, `work_days INT`, `worked_days INT`, `salary_prorated BIGINT`, `lates_fined INT`, `fine BIGINT`, `meetings_plan INT NULL`, `meetings_fact INT`, `kpi_meetings BIGINT`, `kpi_meetings_prorated BIGINT`, `sla_ok INT`, `sla_base INT`, `kpi_sla BIGINT`, `crm_ok BOOLEAN DEFAULT false`, `kpi_crm BIGINT`, `deals_count INT`, `deals_bonus BIGINT`, `accrued BIGINT CHECK >=0`, `advance BIGINT DEFAULT 0 CHECK >=0`, `to_pay BIGINT` (may be negative), `calculated_at TIMESTAMPTZ`. RLS `access_apply_rls('payroll_cc_lines','hr.payroll')`. Function `payroll_cc_save(p_sheet_id, p_lines jsonb)` (SECURITY INVOKER, one transaction): fails on unknown sheet ("Ведомость не найдена"), on posted ("Ведомость уже проведена"), on period < `2026-10` ("Ведомость до октября 2026 — архив"); replaces all `payroll_cc_lines` of the sheet and re-creates the sheet's `dept_group='cc'` rows (`kind='salary'`, `amount=accrued`, only `accrued > 0`) so posting and reports keep reading `payroll_sheet_rows`.

**`meeting_plans`** (read by the CC calc): `id`, `employee_id → employees CASCADE`, `employee_name`, `period 'YYYY-MM'`, `target_count INT DEFAULT 0`, `updated_at`, UNIQUE `(employee_id, period)` — plus `employees.amocrm_operator`.

### 3.3 Screens

**`/hr/payroll`** (`app/(app)/hr/payroll/page.tsx`): back to `/hr`; no view right → `NoAccess`. Tabs: «Ведомости» and «Расчёты с персоналом» (branch `feat/cc-payroll-table` adds a first tab «Колл-центр»).

*Tab «Ведомости»*: button «Создать ведомость» (creates a draft for the current month and opens it), selector «Отдел колл-центра» ("Не выбран"; tooltip: "Сотрудники этого отдела начисляются отдельной вкладкой ведомости и на статью ОПиУ «ФОТ колл-центра»"), table columns Месяц ("Октябрь 2026"), Документ (`ВЗ-00012`), Статус («Черновик» / «Проведена»), Сумма начислений (sum of row amounts), trash icon on drafts (confirm `Удалить ведомость ВЗ-00012?`). Empty: "Ведомостей нет. Нажми «Создать ведомость», чтобы начислить зарплату за месяц."

*Sheet editor modal* (`PayrollSheetEditor.tsx`, title «Ведомость ВЗ-00012» + status chip): «Месяц» month picker; button «Заполнить и рассчитать» (fills **salaries only**, `employees.salary > 0`, active employees; with call-centre split only the current tab; commissions are never auto-added — "они начисляются из сделок"); when a call-centre department is set, two tabs «Колл-центр» / «Остальные сотрудники» with per-tab totals and article names («ФОТ колл-центра» / «ФОТ (оклады)»); grid columns «Сотрудник» (searchable; own-group employees first, department as sublabel), «Вид» (Оклад / Комиссия / Премия), «Сумма» (digits with space grouping), move-row arrow «Перенести на вкладку «…»», remove ✕; «Добавить строку»; totals «Итого колл-центр»/«Итого остальные» and «Итого начислено по ведомости». Footer: draft → «Удалить» (confirm "Удалить ведомость?"), «Записать» (save only), «Провести» (save + post); posted → read-only with «Распровести» and «Закрыть». Empty-tab text: "Строк нет. Нажми «Заполнить и рассчитать» — подставятся оклады сотрудников колл-центра." Errors: `alert("Ошибка: …")`.

*Tab «Расчёты с персоналом»* (`PayrollReport.tsx`): period picker, search «Поиск по ФИО…», legs «Зарплата» / «Комиссии» / «Вместе», 3 KPI tiles («Начислено за период», «Выплачено за период», «Остаток на конец»), table per department (rows «Итого по подразделению», «Итого») with columns Сотрудник, Начало, Начислено, Выплачено, Конец (separately for «Зарплата · 2200» and «Комиссии · 2000»); click a person → **printable reconciliation act** «Акт сверки взаиморасчётов» (summary by article + operation detail «Оклад/Комиссия/Премия · Ведомость ВЗ-…» and «Выплата · <cash account> · …»; "За период начислений и выплат не было."; popup-blocker message "Разрешите всплывающие окна, чтобы распечатать акт."). Footnote: "Нажми на сотрудника, чтобы открыть акт сверки. «Начало» — входящий остаток по счёту (2200 зарплата, 2000 комиссии) на дату отсечения; обороты считаются после неё. Комиссии — строки ведомостей и выплаты по сделкам; зарплата — оклады/премии и выплаты сотруднику."

*Tab «Колл-центр»* *(unmerged)* — see 3.4.

### 3.4 Business rules and calculations

**Posting a sheet** (`setPayrollSheetStatus` → `accruePayrollSheetToGl`, `finance/api.ts:450`, `:477`; lines built by `payrollAccrualLines`, `payrollLines.ts:97`): on «Провести» the sheet status becomes `posted` (`posted_at=now`) and one GL entry is synced through RPC `gl_sync_entries` with `external_ref = 'payroll:<sheetId>'`, `entry_date` = last day of the sheet month, description «Начисление ФОТ за <YYYY-MM>», source `manual`. **Only `salary` and `bonus` rows are accrued; `commission` rows are not** (commissions come from deals). Lines: expense **Dr 6000** split into two articles — `PL-OPEX-SAL` (others) and `PL-OPEX-SAL-CC` (call centre; a row is "call centre" if `dept_group='cc'`, or, for old rows without a group, if the employee is currently in the call-centre department) — and liability **Cr 2200 (salary payable) per employee** (`counterparty_type='employee'`), so the debt is personal. A negative per-employee total (deduction) flips to Dr 2200 / Cr of the article. If the accrual total is 0, or the month is on/before `gl_cash_settings.start_date`, any earlier posting is rolled back instead (`gl_rollback_external`). «Распровести» → status `draft` + `gl_rollback_external('payroll:<id>')`. Saving a sheet **replaces all its rows** (delete + insert, rows with no employee or amount ≤ 0 dropped; amount rounded to integer).

**«Расчёты с персоналом»** (`PayrollReport.tsx`): salary leg = posted sheet rows of kinds salary/bonus (account 2200) minus cash payouts classified as salary (cash category mapped to account 2200); commission leg = posted sheet rows `commission` plus payouts linked to a deal (`deal_id`, recipient agent/agent2/manager resolved via `deals.*_emp_id`) or categories mapped to account 2000. Opening balances come from the GL opening-balance table by *counterparty name* matching `employees.name` (case-insensitive) — a fragile join; payouts that map to other accounts (dividends 2600, loans 1200) are ignored; months on/before the GL start date are in the openings.

**Call-centre operator pay (unmerged)** — spec `docs/superpowers/specs/2026-10-10-call-center-payroll-design.md`, code `src/features/finance/ccPayroll*.ts` on `feat/cc-payroll-table`. Constants in `ccPayrollRates.ts`: `CC_TABLE_FROM='2026-10'` (earlier sheets are "Архив"), fixed salary default 3 000 000 (`employees.salary`), KPI meetings 3 000 000, KPI SLA 500 000 at ≥ 50 %, KPI CRM 500 000, deal bonus 200 000 per deal for 1–2 deals / 500 000 per deal for ≥ 3, late fine 5 % of fixed, 10-minute grace, 3 free warned lates per month. Per operator (`ccPayLine`):
- `work_days` = working days of the month by the employee's schedule (overrides → personal → position → global; counted from the 1st, not from hire date); `worked_days` = closed days with status `on_time`/`late`, capped at `work_days`; day off / sick / vacation are unpaid by assumption.
- `salary_prorated = fixed × worked/work_days`.
- `fine = lates_fined × 5 % × fixed`; a lateness counts if status `late`, arrival − threshold > 10 min on a closed day; with an *approved "Опоздаю"* the first 3 per month are free (not built yet — the approved-dates set is empty today).
- `kpi_meetings = 3 000 000 × share(plan, fact)` where share = 0 if < 50 %, 0.4 if 50–89 %, 1 if ≥ 90 %, 0 if no plan; `kpi_meetings_prorated = kpi_meetings × worked/work_days`. Plan = `meeting_plans.target_count`; fact = meetings held in the amoCRM main funnel by lead field «Оператор» = `employees.amocrm_operator` (same as report r12 «План/факт встреч»).
- `kpi_sla = 500 000` if «Дозвон за 10 мин» (calls within 10 min / leads of the month, rounded to 0.1 %) ≥ 50 %, not prorated; `kpi_crm = 500 000` when the checkbox «CRM AMO» is ticked (a future owner script will set it), not prorated.
- `deals_bonus = deals × (200 000 if deals < 3 else 500 000)`; deals = sold, non-rejected deals where the operator is the "лидоруб" (`deals.lidorub_emp_id`, else by name `lidorub`) in the month.
- `accrued = max(0, salary_prorated + kpi_meetings_prorated + kpi_sla + kpi_crm + deals_bonus − fine)`; `to_pay = accrued − advance` (advance typed by hand; red when negative: "Аванс больше начислений — сотрудник должен").
- Server route `POST /api/hr/payroll/cc-calc` (`{sheetId, employeeIds?}`, needs `hr.payroll` editor; 409 `SHEET_POSTED` for posted sheets) computes and returns lines **without saving**; «Записать» calls `payroll_cc_save`. Recalculation keeps `advance` and `crm_ok` already on screen.
- UI (`CallCenterPayroll.tsx`, `CcPayrollTable.tsx`, `CcPayrollArchive.tsx`): tab «Колл-центр» → «Текущая» / «Архив»; month selector («Месяц»), sheet label («Ведомость»), buttons «Заполнить и рассчитать», «Записать», «+ Сотрудник», «Убрать из таблицы»; 12 columns «ФИО | Фикса | Окладный оклад (месяц) | Штраф | KPI встреча | Окладный KPI (месяц) | KPI SLA | KPI CRM AMO | Бонус сделки | Начисления | Аванс | Итог к выдаче» and row «ИТОГО»; cell hints "{worked} из {work} рабочих дней", "Опозданий больше 10 минут со штрафом: {n} × {fine}", "{fact} из {plan} встреч ({pct} %) → {share} %", "Плана встреч на месяц нет", "Дозвон за 10 мин: {pct} % ({ok} из {base}), нужно от 50 %", "Лидов за месяц нет", "Сделок: {n} × {rate}", "Отметьте, если скрипт CRM AMO пройден", "Нет привязки к оператору amoCRM — встречи и SLA не найдены"; banners "Закрыты не все дни журнала ({n}) — цифры неполные.", "Не выбран отдел колл-центра. Выберите его на вкладке «Ведомости».", "За этот месяц ведомости нет." (+ «Создать ведомость»), "Новая таблица — с октября 2026. Более ранние месяцы — во вкладке «Архив».", "Есть незаписанные изменения. Уйти без записи?", "Ведомость проведена — таблица только для чтения.", errors "Ведомость уже проведена", "Нет прав редактора на «Зарплату»". Every UI string exists in ru and uz in `lib/i18n.tsx`. The old three-column sheet editor is kept for archive sheets; for sheets from October 2026 its «Колл-центр» tab becomes read-only with a link «Открыть таблицу колл-центра →».

**Academy «Моя зарплата» (operator pay, not in HR screens)** — `src/features/academy/server/operatorPay.ts`: salary + meetings bonus (3 000 000 × share 0/0.4/1) + 500 000 per deal (+50 000 each at ≥ 110 % of plan) − 50 000 per unexcused late. It is *display only* and **differs from the new CC table** (the spec lists this as an open mismatch).

### 3.5 Integrations
- **General ledger / cash module** (`gl_sync_entries`, `gl_rollback_external`, `gl_cash_settings`, `gl_*` dictionaries, `cash_operations`, `cash_categories` mapping to accounts 2000/2200): required for posting and for «Расчёты с персоналом». Without them only the sheet CRUD works.
- **Deals** (`deals.agent_emp_id`, `agent2_emp_id`, `manager_emp_id`, `lidorub_emp_id`): commission leg and CC deal bonus.
- **amoCRM** (`sales_leads`, `sales_stage_events`, funnel facts): CC meetings fact and SLA %, `employees.amocrm_operator` mapping.
- **Attendance journal** (closed days, statuses, schedules, shifts) for CC worked days/lates.
- **Academy / Telegram "Опоздаю"**: future input for fine exemptions (not built).

### 3.6 Goodland-specific vs generic
Generic: sheets, rows, kinds, posting to a ledger with per-employee payable, reconciliation act. Goodland-specific: the entire call-centre table (lidorub operators, meetings plan, SLA «Дозвон за 10 мин», "CRM AMO" script, deal bonus tiers), `dept_group` split and article `ФОТ колл-центра`, commissions (real-estate agents' share from deals), the Academy «Моя зарплата».

### 3.7 Dependencies
`employees` (salary, department, amocrm_operator), `departments` (call-centre setting), attendance, `deals`, GL/cash modules, `meeting_plans`, amoCRM sales tables.

---

## 4. Инвентарь (`/hr/inventory`, `/hr/inventory/[number]`, print pages `/print/inventory`, `/print/inventory-act`)

### 4.1 Purpose
Register of office assets with an auto-generated inventory number `GL-000123`, QR stickers, photos at intake and a **monthly photo check**, assignment to a department and an employee (with accessories travelling with the main item), handover/return **acts** that employees confirm in the Academy, and an Academy-driven **self-registration with a three-step approval chain** (department head → office manager → HR). Specs: `docs/superpowers/specs/2026-09-21-hr-inventory-design.md`, `…-handover-acts-…`, `…-act-confirm-…`, `…-self-registration-…`, `2026-10-01-inventory-rooms-design.md`.

### 4.2 Tables (final shape)

**`inventory_items`**

| Column | Type | Null / default | Meaning |
|---|---|---|---|
| id | UUID PK | DEFAULT gen_random_uuid() (client may supply it so photos can be uploaded to `{id}/` first) | |
| number | TEXT UNIQUE NOT NULL | set by trigger `inventory_items_before`: `'GL-' || lpad(nextval('inventory_number_seq'),6,'0')` | immutable ("Инвентарный номер менять нельзя"); regex `^GL-\d{6}$` |
| name | TEXT NOT NULL CHECK btrim<>'' | | |
| category | TEXT | null | free text; suggestions «Техника», «Оргтехника», «Мебель», «Телефония», «Прочее» + already-used values |
| serial_number, description | TEXT | null | |
| purchase_date | DATE | null | |
| price | NUMERIC(18,2) CHECK >= 0 | null | so'm |
| department_id | UUID → departments **ON DELETE RESTRICT** | NOT NULL | owning department |
| employee_id | UUID → employees SET NULL | null | holder; NULL = "у отдела" |
| status | TEXT | NOT NULL DEFAULT 'ok', CHECK `ok,needs_repair,in_repair,broken,lost,written_off` | «Исправно», «Требует ремонта», «В ремонте», «Сломано», «Утеряно», «Списано» |
| write_off_reason | TEXT | null | |
| parent_id | UUID → inventory_items SET NULL | null | accessory/part of a main item (one level only) |
| registered_by | UUID → employees SET NULL | null | who registered it from the Academy (NULL = HR) |
| approval | TEXT | NOT NULL DEFAULT 'approved', CHECK `head,office,hr,approved,returned` | approval step: «Ждёт руководителя», «Ждёт офис-менеджера», «Ждёт HR», «Согласован», «Вернули» |
| approval_note | TEXT | null | return reason |
| sticker_printed_at | TIMESTAMPTZ | null | NULL on an approved item = still in the print queue; items existing before the feature were back-filled with `created_at` |
| room_id | UUID → inventory_rooms SET NULL | null | where it stands |
| created_at, updated_at | TIMESTAMPTZ | NOT NULL | |
| created_by | UUID → auth.users | DEFAULT auth.uid() | |
Indexes: department, employee, parent, `approval <> 'approved'` (partial), room.

**`inventory_photos`**: `id`, `item_id CASCADE`, `kind` CHECK `intake`/`monthly`, `period TEXT CHECK ^\d{4}-\d{2}$` (Tashkent month, set by trigger — no back-dating), `path` (bucket `inventory-photos`, `{item_id}/{uuid}.jpg`), `status` (same six values), `note`, `taken_by`, `taken_at`, `batch_id UUID` (photos of one shoot, 1–3, share it). Update trigger forbids changing item/kind/period.

**`inventory_events`** (history, written only by triggers/functions): `id BIGINT identity`, `item_id CASCADE`, `kind` CHECK `created,edited,department_changed,assigned,unassigned,status_changed,checked,photo_replaced,parent_changed,accessory_linked,accessory_unlinked,act,registered,approved,returned`, `data JSONB`, `actor UUID DEFAULT auth.uid()`, `at`.

**`inventory_acts`**: `id`, `number INT UNIQUE DEFAULT nextval('inventory_act_seq')` (shown «№ 12»), `kind` CHECK `handover`/`return`, `employee_id SET NULL`, `employee_name TEXT NOT NULL` (snapshot), `act_date DATE DEFAULT today(Tashkent)`, `note`, `created_by`, `created_at`, **`confirmation` CHECK `received`/`not_received`**, `confirmed_at`, `confirm_note`. Partial index of unconfirmed handovers per employee.
**`inventory_act_items`**: `act_id CASCADE`, `item_id SET NULL`, `sort`, snapshot `number, name, serial_number, status, parent_number`.
**`inventory_act_people`**: `act_id CASCADE`, `employee_id SET NULL`, `name` (snapshot), `role` CHECK `issuer` («Выдал»/«Принял») / `approver` («Согласовал»), `sort`.
**`inventory_people_sets`**: saved signer sets — `id`, `name UNIQUE CHECK btrim<>''`, `members JSONB array of {employee_id, role}`, `created_by`, `created_at`, `updated_at`.
**`inventory_settings`**: single row (`only_row BOOLEAN PK DEFAULT TRUE CHECK`), `office_manager_employee_id → employees SET NULL`, `updated_at`.
**`inventory_rooms`**: `id`, `name NOT NULL CHECK btrim<>''` (UNIQUE on `lower(regexp_replace(btrim(name),'\s+',' ','g'))`), `floor TEXT` ("2", "цоколь", "мансарда"), `department_id SET NULL` (NULL = shared room: warehouse, meeting room), `archived BOOLEAN DEFAULT false`, `created_at`, `created_by`.
Related: `departments.head_employee_id` (see §1). Storage bucket `inventory-photos` (private; read for readers or the department head of the item's folder, write for editors).
Audit trigger `zz_audit_log` (`audit_row_change()`) is attached to items, photos, acts and people sets (company-wide audit log table, outside HR).

### 4.3 Permissions (database-enforced)
- `inventory_can_edit()` = editor on `hr.inventory` **or** editor on the whole `hr` block; `inventory_can_read()` = reader on `hr.inventory` or can edit; `inventory_heads(dept)` = the current user is the `head_employee_id` of that department; `inventory_is_office_manager()` = current user is `inventory_settings.office_manager_employee_id`.
- Items: read for readers or the head of the item's department; insert only editors; update for editors **or heads**, but trigger `inventory_items_before` lets a head change *only `employee_id`* (assign/take back) and only for a not-written-off item of their department and a working employee of the same department ("Руководитель отдела может только выдать предмет сотруднику или забрать его", "Предмет списан — выдавать его нельзя", "Это предмет другого отдела", "Можно выдать только работающему сотруднику своего отдела"); the office manager may additionally set `sticker_printed_at` (only that column, only to non-null); delete only role `admin`. SQL editor / service role (no `auth.uid()`) bypass the trigger.
- Accessories: `inventory_items_accessory` trigger (HR only may link/unlink: "Привязывать и отвязывать аксессуары может только HR"; "Предмет не может быть аксессуаром самого себя"; "Основной предмет не найден"; "Аксессуар не может иметь своих аксессуаров"; "У предмета есть аксессуары — сделать его аксессуаром нельзя"). A non-written-off accessory always copies department and holder of its parent; `inventory_items_accessory_follow` pushes parent's department/holder changes down to accessories.
- Acts: no direct writes; only `inventory_create_act` (SECURITY DEFINER). Acts are visible to readers and to heads of any item's department in the act. People sets: HR writes; readers and any department head read.
- Rooms: read by readers and department heads; write by HR **or office manager**.

### 4.4 Screens

**List `/hr/inventory`** (`InventoryPage.tsx`). No access → «Нет доступа к разделу «Инвентарь».» (a department head without a role still gets in for their own items). Tabs (`?tab=`): «Предметы», «Акты», «Настройки» (editors only). Filter bar: search «Номер, название, серийный, сотрудник» (also room name), selects «Все отделы», «Все кабинеты» (+ «Без кабинета»), «Все сотрудники», «Все статусы», checkboxes «Без фото за <месяц>», «Показать списанные», «На согласовании», «Без наклейки»; buttons «Выдать по акту», «Принять по акту» (act forms, preselected items), «Печать QR (N)» (selection or the "no sticker" queue), «Добавить». Table: select checkbox, Фото (main intake photo), Номер, Название (set with parts listed inline), Категория, Отдел, Кабинет, Сотрудник («у отдела», «уволен» marker), Статус, «Этот месяц» (✓ if a photo exists for the current Tashkent month — intake counts too), edit pencil; footer "Показано N из M"; empty "Предметов пока нет. Нажмите «Добавить», чтобы внести первый." / "Ничего не найдено — измените фильтры." Sets: parts (accessories) are grouped under their main item (`groupSets`), filters on search/status/unchecked/no-sticker look inside parts; department/employee/approval filters use the main item.

**Item form** (`ItemForm.tsx`, modal; also used from the table): title «Новый предмет» / `Изменить GL-…` / `Аксессуар к GL-…`; fields in order: «Фото предмета *» (1–3 photos, camera/gallery; edit: «Новые фото (заменить)»), «Название *» ("Например, Ноутбук HP 250 G9"), «Категория» ("Выберите или впишите"), «Серийный номер», «Описание» ("Модель, цвет, комплектация, особые приметы"), «Дата покупки», «Цена, сум» (digits with spaces), «Аксессуар к» ("Самостоятельный предмет"; hint when chosen "Отдел и сотрудник — как у GL-…: …. Аксессуар выдаётся и забирается вместе с ним."), «Отдел *», «Сотрудник» ("У отдела"), «Кабинет» (only for stand-alone items; "Не указан"), «Статус», «Комплект» (list of parts: name "Часть комплекта: монитор, клавиатура, мышь…", category "Категория — как у предмета", serial, photos per part; «Добавить часть»). Buttons «Сохранить», «Добавить аксессуар», «Создать и напечатать QR». Validation: "Сфотографируйте предмет", "Введите название предмета", "Выберите отдел", "Цена должна быть числом не меньше нуля", "Сделайте хотя бы одно фото", "Не больше трёх фото", "У части комплекта нет названия", «Кабинет не сохранён: …», "Предмет GL-… создан, но не сохранились части: «…» — …. Нажмите «Сохранить» ещё раз." Creation flow (`createItem`, `api.ts:209`): resize photos to ≤1280 px JPEG q0.85 → upload to `{id}/…` → insert item (trigger assigns the number) → RPC `inventory_add_intake` (`"Предмет GL-… создан, но фото не сохранились (…). Добавьте фото в «Изменить»."`). A set is saved as main item + parts created one by one (a failed part is reported, not rolled back).

**Item page `/hr/inventory/GL-000123`** (`ItemPage.tsx`): invalid number → "«…» — это не инвентарный номер."; missing → "Предмет GL-… не найден."; header with number, name, status chip, approval chip, "Аксессуар к GL-… · name", "Причина списания: …"; details grid Категория / Кабинет / Серийный номер / Дата покупки / Цена / Добавлен; buttons «Изменить», «Печать QR» ("с аксессуарами: N"), «Списать»; cards: **Согласование** (`ApprovalCard`, shown to HR when the step is HR: «Подтвердить» / «Вернуть» with required note, placeholder "Причина: это не наше, нет серийного номера…"; hint line "Ждём руководителя отдела: <name>" / "Руководитель отдела не назначен" / "Ждём офис-менеджера: <name>" / "Офис-менеджер не выбран" / "Ждём HR" / "Вернули: <note>"; shows "Завёл: <employee>"), **У кого** (`HolderCard`: Отдел, Сотрудник; buttons «Выдать по акту», «Принять по акту», «Оформить акт»; for an accessory "Аксессуар: всегда у того же, у кого GL-…. Выдаётся и забирается вместе с ним."; for a fired holder "Сотрудник уволен — примите предмет по акту возврата."), **Проверка за <месяц>** (`MonthCheckCard`: status select, note "Заметка: царапина, не включается…", photos, «Сохранить проверку», «Переснять»; "Фото при поступлении — снято в этом месяце"), **Аксессуары** (`AccessoriesCard`: "Пока нет. Зарядка, мышь, сумка — у каждого будет свой номер и QR, а выдаваться они будут вместе с этим предметом."; «Добавить аксессуар», «Отвязать»), photo timeline by shoot, **История** (events rendered by `describeEvent`, e.g. "Добавлен в отдел «…», выдан: …", "Выдан: … (был у …)", "Возвращён в отдел", "Статус: Исправно → Сломано · причина: …", "Фото за сентябрь 2026: Исправно · note", "Заменено главное фото", "Привязан как аксессуар к GL-…", "Акт выдачи № 12", "Заведён сотрудником — отдел «…»", "Подтвердил руководитель отдела: …", "Вернул HR: … — note"). Write-off modal «Списать GL-…»: required reason (placeholder "Причина: сломан без ремонта, утерян, продан…"; "Укажите причину списания"); text "«name» уйдёт из ежемесячной проверки и скроется из таблицы (его покажет галочка «Показать списанные»). Предмет и его история остаются."

**Acts**: tab «Акты» (`ActsList`: №, Дата, Вид «Выдача»/«Возврат», Сотрудник, Предметов, Людей, Подтверждение; empty "Актов пока нет. Отметьте предметы в таблице и нажмите «Выдать по акту».") and the form (`ActForm`, title «Выдать по акту» / «Принять по акту»): «Сотрудник — принял / сдал» ("Выберите сотрудника"; fired people marked "(уволен)", only allowed for returns), «Дата акта», «Предметы» (chosen list with accessories as "↳ … — аксессуар, вместе с основным", "+ предмет" picker limited by `fitsAct`), «Люди в акте» (issuer = «Выдал»/«Принял», approver = «Согласовал»; "+ человек"; saved sets: «Набор: выберите…», «Наборы» manager, «Сохранить как набор…» with "Название, например «Выдача техники: офис»"; info "Набор «…» сохранён", "Из набора убраны уволенные: N"), «Заметка» ("Необязательно"), problems list (the same rules as the DB function), «Сохранить акт». After saving the browser opens `/print/inventory-act?n=N`: printable «Акт приёма-передачи № N» / «Акт возврата № N» with the sentence "Настоящим актом сотрудник <name> принял(а)/сдал(а) следующие предметы:", table «№ / Инв. номер / Наименование / Серийный номер / Состояние», "Примечание: …", signature lines «подпись» per person (roles Выдал/Принял/Согласовал/Принял|Сдал).
**Stickers** `/print/inventory?n=GL-000001,GL-000002`: A4 sheet **3 × 8 = 24 stickers of 70 × 37 mm**, "Начать с ячейки" (continue on a partly used sheet), "Линии для разрезания" toggle, QR encodes `https://sdelki.goodland.uz/hr/inventory/GL-000123` (hard-coded production origin `INVENTORY_QR_ORIGIN` so a locally printed sticker never points to localhost), parts show "→ GL-parent". Print hints: "В окне печати: масштаб 100 %, поля «Нет». Лист A4 — 24 наклейки 70 × 37 мм…". Button «Отметить напечатанными» → `inventory_mark_printed(ids)` ("Отмечает печать только HR или офис-менеджер"; only approved items).
**Settings tab**: «Офис-менеджер» select ("Не выбран"; "Подписывает вторым и печатает наклейки"), «Кабинеты» list (name "Название: Кабинет 3, Переговорная, Склад", "Этаж — можно не указывать", department "Общий кабинет", archive «В архив»/«Вернуть», counter "предметов: N"; errors "Введите название кабинета", "Кабинет с таким названием уже есть"; "Пока ни одного кабинета — добавьте первый."). Employee card tab «Инвентарь» (`EmployeeInventoryTab`): items currently held + acts ("За сотрудником ничего не числится."). HR hub banner `MonthCheckBanner` from the **25th** (Tashkent) of each month: "Проверка инвентаря за <месяц>: сфотографировано X из Y. До конца месяца осталось сфотографировать N." + «Показать несфотографированные».

### 4.5 Business rules and calculations
- **Numbering**: item `GL-` + 6 digits from sequence `inventory_number_seq` (gap-tolerant, never reused); act number = plain integer from `inventory_act_seq` (`№ 1, № 2…`).
- **Monthly check** (`inventory_save_check`, `hr-inventory-photo-batches.sql`; editors only: "Фотопроверку сохраняет только HR"): requires 1–3 photos ("Нужно от одного до трёх фото") and a valid status; deletes the same-month `monthly` photos (the old files are removed by the client), inserts the new ones with a fresh `batch_id`, sets the item's status, writes one `checked` event. "Checked this month" = any photo (monthly *or intake*) with `period` = current Tashkent month; written-off and not-yet-approved items are excluded from the month summary (`period.ts monthSummary`). Banner window from day 25 (`BANNER_FROM_DAY`).
- **Retention**: monthly photos older than **12 months** are deleted by `inventory_expired_check_photos` + route `GET /api/cron/inventory-retention` (scheduled with pg_cron + pg_net on the 1st at 22:30 UTC with the vault secret `cron_secret`); intake photos live forever.
- **Assignment**: HR assigns to any working employee; a head only within own department; accessories follow the main item; fired holders force the "return act" path.
- **Acts** (`inventory_create_act`, `hr-inventory-acts.sql:99`): needs login; kind handover|return ("Неизвестный вид акта"); employee required ("Выберите сотрудника"); handing to a fired employee refused ("Сотрудник уволен — выдавать ему нельзя"; returns from fired are fine); at least one item ("Выберите хотя бы один предмет", "Предмет не найден — обновите страницу"); an accessory must come with its parent ("Аксессуар % выдаётся вместе с основным предметом %"); handover of a written-off item refused ("% списан — выдавать нельзя"); an item held by someone else must be returned first ("% сейчас у % — сначала оформите возврат"); return only from the holder ("% не у этого сотрудника — вернуть его по акту нельзя"); a department head is limited to own-department items and employees ("Предмет % — не вашего отдела", "Сотрудник не из отдела предмета %"); people list must be non-empty with at least one issuer ("Добавьте людей в акт", "Укажите, кто выдал|принял") and only working employees ("В акте могут быть только работающие сотрудники"). In one transaction it writes the act, snapshots of items (incl. non-written-off accessories) and people, moves main items (`employee_id` = employee, or NULL for return) and logs an `act` event per item. Not-yet-approved items cannot be put in an act (`fitsAct`).
- **Employee confirmation** (Academy): `GET/POST /api/academy/acts` — the employee sees unconfirmed handover acts and answers `received` or `not_received` (+ note) once; one conditional UPDATE (own act, handover, `confirmation IS NULL`), else 409 `not_pending`. CRM shows chips: «Подтвердил <dd.mm.yyyy hh:mm>», «Не получал: <note>», «Ожидает подтверждения» (returns have none).
- **Self-registration chain** (`hr-inventory-self-registration.sql`; Academy route `/api/academy/inventory`): employee registers an item with 1–3 photos → `inventory_register` (department taken from the employee: "Сначала HR укажет ваш отдел"; name required "Без названия предмет не завести"; item gets `approval='head'`, holder = the registrant; the auto `created` event is replaced by `registered`). `inventory_approve_step(item, employee, ok, note)` — step `head` may be done only by `departments.head_employee_id`, step `office` only by the configured office manager ("Сейчас не ваш шаг"); approve → `office` then `hr`; reject needs a note ("Напишите причину возврата") → `returned`. HR's last word is `inventory_approve_hr` (HR editor only, "Подтверждает только HR"): approve → `approved`; reject → `returned`. `inventory_resubmit` lets the registrant fix a returned item (name/category/serial, optionally replace photos → returns old paths so the route deletes the files) and sends it back to `head`. Approved items enter the sticker print queue (`sticker_printed_at IS NULL`).
- **Rooms**: `inventory_set_room(items[], room)` (editors only: "Кабинет предмету ставит тот, кто может менять предметы"; "Кабинет не найден") moves the items *and their parts* and writes an `edited` event `{room_id:[old,new]}` per changed item.

### 4.6 Integrations
- **Supabase Storage** (private bucket `inventory-photos`, signed upload URLs for the Academy, signed read URLs 1 h) — mandatory for photos; **camera** access in the browser (`<input type=file capture>`).
- **Goodland Academy** (`/api/academy/inventory`, `/api/academy/acts`, `/api/academy/acts/history`; Bearer token of the Academy session resolved to an employee by `academyEmployee`, CORS locked to the Academy origin) — without it: no self-registration, no approval by heads/office manager, no employee confirmation of acts. The HR-only part (items, photos, assign, acts, stickers) works without it.
- pg_cron/pg_net + Vercel for the monthly retention call. Browser printing (`window.print`, `@page` A4).
- Audit-log subsystem (`audit_row_change`).

### 4.7 Goodland-specific vs generic
Mostly generic (assets, QR, acts, monthly photo audit, rooms). Goodland-specific: the number prefix `GL-`, the hard-coded QR origin `https://sdelki.goodland.uz`, the Academy-based employee flows, the "office manager" role, and cron host.

### 4.8 Dependencies
`departments` (RESTRICT, head), `employees` (holder, registrant, office manager, act people), `profiles`/roles (editor check), the audit log table, Academy app.

---

## 5. Онбординг (`/hr/onboarding`, public form `/onboarding`, module `hr.onboarding`)

### 5.1 Purpose
Takes a person who has passed the interview and is invited to training: they fill a public questionnaire (a chat-style "HR-помощник" with no login), HR reviews it, turns it into an employee in status `trainee` ("Обучающийся", with a 7-day Academy trainee login), and then moves the person along `trainee → intern → active` or closes them. The page is a unified work-list of new applications and trainees. (Interns moved to «Администрирование» and are no longer shown here.)

### 5.2 Tables
**`candidates`** is shared with Recruiting (§6). The onboarding questionnaire writes the personal part; final shape of those columns: `id UUID PK`, `last_name, first_name, middle_name TEXT`, `birth_date DATE`, `gender TEXT` (male|female, no CHECK on candidates), `citizenship, birth_place, nationality TEXT`, `passport_series, passport_number, passport_issued_by TEXT`, `passport_issued_date, passport_valid_until DATE`, `pinfl, inn TEXT`, `phone, email, address TEXT`, `relative_name, relative_relation, relative_phone TEXT`, `relative_birth_date DATE`, `relative_workplace TEXT`, `relative_address TEXT`, `education_level, education_institution, education_specialty, education_qualification TEXT`, `status TEXT NOT NULL DEFAULT 'new' CHECK new|reviewing|approved|rejected`, `notes TEXT`, `submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `reviewed_by → auth.users`, `reviewed_at`, `approved_employee_id → employees SET NULL`. (The recruiting columns are in §6.2.)
RLS (`legacy/candidates-rls-restore.sql`): **INSERT for anon + authenticated with no check** (public form), SELECT for `access_can_read('hr')`, UPDATE and DELETE for `access_can_edit('hr')`.

Employees created from a candidate get `workflow_status='trainee'`, `role='agent'`, `active=true`, `system_registered_at=now`, the chosen department/position (text), plus copied personal fields and one `employee_relatives` row built from the flat relative fields (no duplicates by normalised name).

### 5.3 Screens

**Public form `/onboarding`** (`app/onboarding/page.tsx` + `OnboardingBot`): branded header "GoodLand Property" / «Анкета кандидата», a chat that asks the questions below one by one with a progress bar, then submits once (`submitCandidate`, anonymous INSERT with `status:'new'`; on error "Не удалось отправить: …" and steps back). Success screen at the end. Intro: "Привет 👋 Я HR-помощник. Помогу заполнить твою кадровую карточку — это займёт 5–7 минут.\n\n📋 Подготовь заранее: паспорт (можно фото), номер ПИНФЛ и ИНН — они понадобятся для анкеты.\n\nГотов?". Outro: "Готово! 🎉 Спасибо, твоя анкета сохранена. HR проверит данные и подтвердит при необходимости."

Question order (required unless marked optional): 1 «Как тебя зовут? Введи Фамилию, Имя и Отчество через пробел.» (validation "Введи минимум фамилию и имя"; split into last/first/middle); 2 «Когда ты родился? Выбери дату.»; 3 «Пол?» (Мужской/Женский); 4 «Гражданство?» (placeholder Узбекистан); 5 «Где ты родился?» (opt.); 6 «Национальность?» (opt.); 7 «Серия паспорта — 2 буквы.» ("Серия должна состоять ровно из 2 символов"); 8 «Номер паспорта — 7 цифр.» ("Номер должен состоять из 7 цифр"); 9 «Кем выдан паспорт?» (opt.); 10 «Дата выдачи паспорта?» (opt.); 11 «Срок действия паспорта?» (opt.); 12 «ПИНФЛ — 14 цифр.» ("ПИНФЛ должен быть из 14 цифр"); 13 «ИНН?» (opt.); 14 «Твой телефон?» (+998 mask hint); 15 «Email?» (opt.); 16 «Адрес проживания?» (opt.); 17–22 relative (all opt.): ФИО, «Кем он(а) тебе приходится?», дата рождения, «Место работы и должность», «Где проживает родственник? (адрес)», «Телефон родственника?»; 23–25 education (opt.): «Какое у тебя образование?» (5 levels), «Учебное заведение?», «Специальность?». The form does **not** ask for position or vacancy.

**HR page `/hr/onboarding`** (`app/(app)/hr/onboarding/page.tsx`): back arrow; card «Анкета для обучающихся» with the public link `<origin>/onboarding` (copy button «Скопировать» → «Готово!», open-in-new-tab) and text "Ссылка для тех, кто прошёл собеседование и пришёл на обучение. Они без авторизации заполняют анкету. Дальше — заявка попадает в таблицу ниже как «Новая заявка», HR проверяет и переводит на обучение."; status filter select ("Все активные (N)" = new applications + trainees; «Новая заявка», «На обучении», «Отклонённые», each with count); table №, ФИО (+ phone, PINFL; employees link to their card), Должность, Статус (chips «Новая заявка», «На обучении», «Стажёр», «Отклонена»), «Подал заявку», Действие. Empty: "Пока никого нет. Поделись ссылкой выше с кандидатами — они появятся здесь со статусом «Новая заявка»." Approved candidates are skipped (they appear as trainees).
Actions by row (all disabled for non-editors of `hr.onboarding`, tooltip «Только для роли «Редактор»»):
- New application: «Проверить» (review modal), ✕ reject (browser `prompt`: "Причина отклонения заявки «ФИО»:"; cancel = abort; empty → alert "Укажите причину отклонения.").
- Rejected: trash (confirm `Удалить отклонённую заявку «ФИО»?`).
- Trainee: «Дать доступ» / «Доступ ✓» (AccountAccessForm variant trainee: Academy login valid **7 days**, role Trainee = only "Обучение" + "События"), «Сдал экзамен → Стажёр» (confirm `Сдал экзамен — перевести в стажёра «ФИО»?`), ✕ «Закрыть (не прошёл онбординг)» (opens the fire dialog with required reason, so the trainee is terminated), pencil → employee card.
- Intern (visible only if you came from elsewhere): «Принят на работу» (confirm `Принять на постоянную работу «ФИО»?` → `active`).

**Review modal «Проверка заявки»** (`CandidateReviewModal.tsx`): shows the submitted data in sections «📞 Контакты» (Телефон, Адрес), «👤 Личные данные» (Дата рождения, Пол, Гражданство, Национальность, Место рождения), «🪪 Паспорт и ID» (Паспорт, Кем выдан, Дата выдачи, Срок действия, ПИНФЛ, ИНН), «👨‍👩‍👧 Родственник» (ФИО, Кем приходится, Телефон), «🎓 Образование» (Уровень, Учебное заведение, Специальность, Квалификация), "Заявка подана: <date>". Two modes: (a) new person — fields «Подразделение» ("Без отдела") and «Должность»; button «Одобрить и добавить как обучающегося» ("Создаём…"); note "После одобрения создастся запись сотрудника со статусом «Обучающийся». Аккаунт с доступом к платформе HR сможет создать после прохождения обучения и сдачи экзамена." (b) checkbox «Это действующий сотрудник» ("Если кандидат уже работает у нас, отметь — данные привяжутся к его карточке (заполнятся только пустые поля, ничего не перезапишется).") with «Сотрудник» select → «Привязать к сотруднику» ("Привязываем…"); alert "Выбери действующего сотрудника". Errors: "У кандидата не заполнено ФИО — нельзя создать сотрудника".

### 5.4 Business rules
- `approveCandidate` (`api.ts:785`): creates the employee (trainee), creates the relative row, then sets candidate `status='approved'`, `stage='hired'`, `hired_at`, `last_activity_at`, `reviewed_at`, `approved_employee_id`. `attachCandidateToEmployee` (`:880`) fills only **empty** employee fields from the 25 mapped candidate fields, then the same candidate update. `rejectCandidate`: `status='rejected'`, `stage='rejected'`, `rejected_reason` and `notes` = reason.
- Lifecycle moves via `transitionWorkflowStatus` (§1.4).
- Trainee access expires automatically: `employees.academy_access_expires_at = now + 7 days`; daily cron `expireTraineeAccess` deletes the Academy account when the date passes; fired employees are revoked by `revokeTerminatedAccess`.
- Interns appear in the attendance journal (separate block) but are not scored by KPI.

### 5.5 Integrations
Academy (create/remove trainee accounts) — without it the «Дать доступ» button fails ("ACADEMY_CLIENT_FAILED"); everything else works. Public form needs anonymous write access to `candidates` (in a NestJS rebuild: a public endpoint with rate limiting / captcha). `/onboarding` is a chat UI, not a Telegram bot.

### 5.6 Goodland-specific vs generic
Generic: public questionnaire → review → employee record; Uzbek identity fields (PINFL/INN/passport). Goodland-specific: the Academy trainee login (7 days, role Trainee), the exact "обучение → экзамен → стажёр" pipeline wording and the "GoodLand Property" branding.

### 5.7 Dependencies
`candidates`, `employees`, `employee_relatives`, `departments`, `positions`, termination reasons, Academy. Feeds recruiting funnel counters (`hired`), hiring-plan fact (employees hired in the month), attendance (interns).

---

## 6. Рекрутинг (`/hr/recruiting`, module `hr.recruiting`)

### 6.1 Purpose
An amoCRM-style hiring CRM: Kanban funnel of candidates, vacancies with time-to-fill, manual daily funnel counters, recruiting analytics, plan/fact of hiring, hh.ru import of vacancies/responses/messages, and a per-candidate chat with an optional LLM "HR-агент" that can draft or auto-send Telegram replies.

### 6.2 Tables (final shape)
**`candidates`** — personal columns as in §5.2 plus the CRM columns (`legacy/hr-recruitment-crm.sql`): `stage TEXT NOT NULL DEFAULT 'new' CHECK new|screening|interview|test|offer|hired|rejected` (labels «Новый», «Скрининг», «Собеседование», «Тест / задание», «Оффер», «Нанят», «Отказ»); `source TEXT NOT NULL DEFAULT 'form' CHECK form|hh|manual|referral|telegram|other` (labels «Анкета», «hh.ru», «Вручную», «Рекомендация», «Telegram», «Другое»); `position TEXT`; `recruiter_id → employees SET NULL`; `vacancy_id → hr_vacancies SET NULL`; `rejected_reason TEXT`; `first_contact_at`, `hired_at`, `last_activity_at TIMESTAMPTZ`; `hh_negotiation_id TEXT` (UNIQUE when set), `hh_resume_id`, `hh_vacancy_id`, `resume_url TEXT`; `telegram_chat_id BIGINT` (UNIQUE when set); `agent_mode TEXT NOT NULL DEFAULT 'off' CHECK off|draft|auto`. Legacy `status` is kept in sync with `stage` (hired→approved, rejected→rejected, otherwise reviewing/new). Indexes on stage and vacancy.
**`hr_vacancies`**: `id`, `title NOT NULL`, `department_id → departments SET NULL`, `position TEXT`, `plan_count INT NOT NULL DEFAULT 1 CHECK >=0`, `status NOT NULL DEFAULT 'open' CHECK open|closed|cancelled` («Открыта», «Закрыта», «Снята»), `opened_at DATE NOT NULL DEFAULT current_date`, `closed_at DATE`, `target_days INT CHECK >=0`, `hh_vacancy_id TEXT` (UNIQUE when set), `notes TEXT`, `created_at`, `updated_at`.
**`candidate_stage_events`**: `id`, `candidate_id CASCADE`, `from_stage TEXT`, `to_stage TEXT NOT NULL`, `changed_by → auth.users SET NULL`, `changed_at`. (Written on every stage move by the app, not by a trigger.)
**`candidate_messages`**: `id`, `candidate_id CASCADE`, `direction` in|out, `author` agent|human|candidate (default human), `channel` inapp|telegram|hh (default inapp), `body TEXT NOT NULL`, `external_id TEXT` (UNIQUE per candidate when set — hh message dedupe), `is_draft BOOLEAN DEFAULT false`, `meta JSONB`, `created_at`.
**`hr_funnel_daily`**: `id`, `vacancy_id → hr_vacancies CASCADE` (NULL = common funnel), `date DATE NOT NULL`, nine INT counters default 0 — `responses` («Откликов»), `phone_interviews` («Кол-во телефонных интервью»), `invited` («Приглашены на собеседование»), `came` («Пришло на собеседование»), `onboarding_access` («Выдан доступ на онбординг»), `passed_onboarding` («Прошли онбординг → стажировка»), `started_internship` («Вышло на стажировку»), `failed_internship` («Не прошли стажировку»), `hired` («Вышли на работу») — `created_at`, `updated_at`; UNIQUE `(coalesce(vacancy_id::text,''), date)`.
**`hr_funnel_plans`**: `id`, `period 'YYYY-MM'`, `stage` (new…hired, no rejected), `target_count INT >=0`, UNIQUE `(period, stage)` — **API exists, no screen uses it**.
**`hiring_plans`**: `id`, `period`, `department_id → departments CASCADE` (NULL = company-wide), `target_count INT >=0`, `notes`, timestamps, UNIQUE `(period, coalesce(department_id::text,''))` — **table, API and `HiringPlanForm` exist but nothing mounts them**; the visible plan is computed from vacancies (below).
RLS for the hr_* tables: `access_apply_rls(..., 'hr')`.

### 6.3 Screens (`app/(app)/hr/recruiting/page.tsx`)
Header «Найм — CRM кандидатов» / "Воронка кандидатов, сроки закрытия, аналитика и переписка HR-агента." Tabs: «Воронка (N)» (N = candidates not hired/rejected), «Воронка и сроки», «План найма».

*Tab «Воронка»* (Kanban): `HhSyncCard` («hh.ru — отклики кандидатов», button «Синхронизировать»; result "Готово: вакансий N, новых откликов N, сообщений N."; text "Подтягивает вакансии работодателя и новые отклики в воронку. Также идёт автоматически раз в сутки."; unconfigured → "Интеграция с hh.ru не настроена: задайте HH_ACCESS_TOKEN и HH_EMPLOYER_ID в переменных окружения."), checkbox «Показать отказы (N)», button «Кандидат». Board: 6 columns (new, screening, interview, test, offer, hired); cards show name, position, recruiter first name, source and a "⏳ N дн." badge when stuck (**no activity for ≥ 7 days**, `STUCK_DAYS`, only for non-final stages; hint "Без движения дольше нормы"); drag & drop with mouse (5 px threshold), long-press 300 ms on touch, edge autoscroll, Esc cancels, arrows on the card move to the neighbouring stage ("перенести сюда"); on failure "Не удалось перенести кандидата — карточка вернулась на прежний этап. Проверьте связь и попробуйте ещё раз."; footnote "Перетащите карточку мышью в любой этап — вперёд или назад (Esc — отменить). На телефоне — удержите карточку и тяните. Стрелки на карточке двигают на соседний этап." Rejected list (when toggled) shows name and `rejected_reason`. Empty: "Кандидатов пока нет. Добавьте вручную, синхронизируйте hh.ru или поделитесь публичной анкетой со страницы «Онбординг»."
*Add candidate* (`AddCandidateModal` «Новый кандидат»): Фамилия, Имя, Телефон, «Должность / интерес», «Источник» (Вручную / Рекомендация / Другое), «Вакансия», «Ответственный рекрутер», «Ссылка на резюме» (https://…), «Заметки»; alert "Введите имя или фамилию кандидата"; defaults `source=manual`, `stage=new`, `status=new`.
*Candidate drawer* (`CandidateCrmDrawer`): contact (Телефон, link «Резюме»), «Этап воронки» stage buttons + «Отказ» (sets rejected), «Вакансия», «Ответственный рекрутер», «Режим HR-агента» (Выключен — ручная переписка / Черновики — ИИ предлагает, вы отправляете / Авто — ИИ отвечает сам в Telegram), «Ссылка-приглашение в Telegram» (`https://t.me/<NEXT_PUBLIC_TELEGRAM_BOT_USERNAME>?start=hr_<candidateId>`, «Копировать», "Отправьте кандидату — по ней он привяжет свой Telegram, и переписка (в т.ч. HR-агента) пойдёт туда."; warning when the env var is missing), «Заметки», and the chat `CandidateChat` («Переписка», badge «Telegram привязан» / «Только в CRM»; empty "Переписки пока нет. Напишите кандидату или попросите HR-агента начать диалог."; field "Написать кандидату…"; button "HR-агент: сгенерировать черновик" / "HR-агент: ответить сейчас"; drafts marked "Черновик · " with «Отправить» / delete; error "Агент не смог ответить"; hint "Кандидат не привязан к Telegram — сообщения сохраняются в CRM. Пришлите ему ссылку-приглашение из карточки, чтобы вести переписку в Telegram.").
*Tab «Воронка и сроки»*: month select (2 months ahead … 9 back), `RecruitingOverview` tiles «Открытых вакансий», «Кандидатов в работе», «Нанято за месяц», «Срок найма» (avg days candidate `submitted_at`→`hired_at` for those hired in the month), «Срок закрытия» (avg days `opened_at`→`closed_at` of vacancies closed in the month); `RecruitingInsights` panels «Источники кандидатов» (Источник / Всего / Нанято / Конв.), «Нагрузка рекрутёров» (Рекрутёр / В работе / Нанял / Отказ; "Не назначен"), «Причины отказов (N)» (Причина / Кол-во / Доля; reason = `rejected_reason` or notes or "Без причины"), «Зависшие кандидаты (N)» ("Все кандидаты в движении 👍"); «Ежедневная воронка» (`DailyFunnelPanel`: pick «▦ Все вакансии (по блокам)» / «Общая воронка (без вакансии)» / one vacancy; a grid of the nine counters × days of the month, inline editing saves a cell at a time (`saveFunnelDailyCell` upserts the (vacancy, day) row and writes only the edited column, values floored at 0); totals "Итоговая воронка за <месяц>" with columns Этап / Всего / «Конверсия с пред.» / «От откликов», «Не прошли стажировку» shown separately (not in the descending funnel), tiles «Срок в работе / закрытия», «Средний срок найма», «Конверсия отклик → найм»); `VacanciesPanel` (table Вакансия / Отдел / План / Статус / В работе (days) / Действия; «+ Вакансия»; close button with confirm `Закрыть вакансию «…»? Зафиксируется срок закрытия.`; delete confirm `Удалить вакансию «…»?`; empty "Вакансий пока нет. Добавьте первую — по ней будем считать срок закрытия."); `VacancyForm` («Новая вакансия»: «Название вакансии *» (placeholder "Менеджер по продажам новостроек", alert "Введите название вакансии"), «Должность», «Подразделение», «План (чел.)», «План закрытия, дней» ("напр. 30"), «Статус», «Дата открытия», «Дата закрытия», «Заметки (условия, требования — их видит HR-агент)»).
*Tab «План найма»* (`HiringPlanFactPanel`): month select; text "План формируется автоматически из вакансий: сколько мест открыто по подразделениям в выбранном месяце. Факт — сколько сотрудников принято. Управляйте вакансиями на вкладке «Воронка и сроки»."; tiles «План» ("Из N вакан. за <месяц>" / "Нет открытых вакансий"), «Факт» ("Принято в <месяц>"), «% выполнения» ("План перевыполнен 🎉"), "Прогноз к концу месяца" (current month only, by current pace); table «По подразделениям»: №, Подразделение, План, Факт, Выполнение (with «Без подразделения» row; empty "Нет открытых вакансий в этом месяце…").

### 6.4 Business rules
- **Stage move** (`moveCandidateStage`, `api.ts:1164`): effective stage = `stage`, or `hired`/`rejected` from legacy `status`, else `new`; no-op if unchanged; patch sets `stage`, `last_activity_at`, syncs `status` (rejected→rejected, hired→approved + `hired_at`, else reviewing), sets `first_contact_at` the first time the stage leaves `new`; then inserts a `candidate_stage_events` row (`from_stage`, `to_stage`, `changed_by`). Moving to `hired` on the board does **not** create an employee — hiring is done through Onboarding (`approveCandidate`).
- **Vacancy save** (`saveVacancy`, `api.ts:1087`): title required ("Название вакансии обязательно"); `plan_count` floor ≥ 0 default 1; `status='closed'` without date → `closed_at = today`; `status='open'` → `closed_at = null`.
- **Plan** for a month = sum of `plan_count` over vacancies "active in the month" (not cancelled, `opened_at` ≤ month end, and not closed before month start) grouped by department; **Fact** = active employees whose `hired_at` (or `system_registered_at`) falls in the month; % = fact/plan; forecast = fact/elapsed share of month.
- **Stuck** = ≥ 7 days since `last_activity_at` (or `submitted_at`) in a non-final stage.
- **hh.ru sync** (`runHhSync`, `features/hr/server/hhSync.ts`): `fetchEmployerVacancies` → upsert `hr_vacancies` by `hh_vacancy_id` (title/position = vacancy name, `status = archived ? closed : open`, `opened_at` from `published_at`); for each vacancy `fetchVacancyNegotiations` → insert `candidates` (source `hh`, stage `new`, FIO from the resume, position = resume title / vacancy name, `hh_negotiation_id/resume_id/vacancy_id`, `resume_url`, `submitted_at = negotiation date`, `notes = "hh: <state>"`) de-duplicated by `hh_negotiation_id`; then imports negotiation messages into `candidate_messages` (channel `hh`, direction by `participant_type`, dedupe by `external_id`). Triggered by the button (`POST /api/hr/hh/sync`, needs editor of block `hr`) and by `GET /api/hr/hh/sync/cron` (header `x-vercel-cron: 1` or `Authorization: Bearer $CRON_SECRET`; also folded into the daily `/api/cron/crm`). Needs env `HH_ACCESS_TOKEN`, `HH_EMPLOYER_ID` (`lib/hh.ts`).
- **HR agent** (`generateAgentReply`, `features/hr/server/hrAgent.ts`): system prompt in Russian ("вежливый и профессиональный HR-рекрутер агентства недвижимости «Goodland — центр новостроек» (Ташкент)… коротко, по делу, на «вы»… 1–4 предложения… не выдумывай условия… не обещай зарплату цифрой"), includes candidate name/position and vacancy title/position/notes, history mapped in→user / out→assistant (drafts excluded). Mode `auto` sends via Telegram when `telegram_chat_id` is set and stores the message (author `agent`); `draft`/manual call stores `is_draft=true` for a recruiter to send (`POST /api/hr/messages/[id]/send`). Manual send `POST /api/hr/candidates/[id]/message` (needs `hr` editor) delivers to Telegram if linked and stores it (author `human`, channel `telegram|inapp`); empty body → 400 "Пустое сообщение". Telegram webhook (`/api/telegram/webhook`) binds a chat when a candidate opens `/start hr_<candidateId>`, stores incoming messages (author `candidate`) and, in `auto` mode, triggers the agent. LLM via `lib/llm.ts` (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; message "HR-агент не настроен: не задан ключ LLM (ANTHROPIC_API_KEY / OPENAI_API_KEY).").

### 6.5 Integrations (which features need what)
- **hh.ru API** (token + employer id): vacancy/response/message import only.
- **Telegram Bot API** (`lib/telegram.ts`, webhook, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`): candidate chat in Telegram and auto-replies. This is the CRM's own Telegram webhook bot (env `TELEGRAM_BOT_TOKEN`, route `/api/telegram/webhook`, tables `telegram_links`/`telegram_link_codes`/`telegram_sessions` from `legacy/telegram-integration.sql`), not the Face-ID helper @goodlandhrbot.
- **LLM provider**: HR-agent drafts/auto replies.
- **Onboarding public form** feeds new candidates (`source=form`).
- Without any of them the Kanban, vacancies, daily funnel, analytics and plan/fact still work.

### 6.6 Goodland-specific vs generic
Generic: Kanban funnel, vacancies, stage history, daily funnel counters, hh.ru import, analytics. Goodland-specific: the daily-funnel stage names (they mirror the owner's Google sheet and include "доступ на онбординг", "Прошли онбординг → стажировка", "стажировка" which are Goodland's training process), the agent's prompt text (real-estate agency "Goodland — центр новостроек"), the link to Onboarding/Academy.

### 6.7 Dependencies
`employees` (recruiters, hired people for fact), `departments`, `hr_vacancies`, `candidates` (shared with Onboarding), Telegram/hh/LLM env configuration.

---

## 7. Удержание и развитие (`/hr/retention`, module `hr.retention`)

### 7.1 Purpose
Retention tools: two internal games for staff — **«Морской бой»** (1-vs-1 Battleship) and a **«Командный зачёт»** (team points for meetings/showings/deals that double as "shots") — plus the **Academy admin**: edit the training course, see per-manager progress, control access; and the **calendar of events/notices** shown to staff in the Academy.

Hub `/hr/retention`: back button, section «Игры» with cards «Морской бой» ("Сразитесь с коллегой один на один: создайте партию, отправьте ссылку сопернику и играйте. Классический режим или на лимит выстрелов.") and «Командный зачёт» ("Команды зарабатывают баллы за встречи, показы и сделки. Баллы — это выстрелы в «Морском бою». Турнирная таблица и начисление баллов."); section «Развитие» with «Обучение» ("Редактируйте курс Академии — видео, тесты, уроки и модули. Смотрите аналитику прохождения по менеджерам и управляйте их доступом.") and «События» ("Календарь событий Академии: создавайте, редактируйте и удаляйте события и уведомления — они видны менеджерам в приложении.").

### 7.2 Tables
**`battleship_games`**: `id UUID`, `created_at`, `updated_at` (trigger-touched), `mode TEXT NOT NULL DEFAULT 'classic' CHECK classic|custom`, `status NOT NULL DEFAULT 'lobby' CHECK lobby|placing|playing|finished`, `turn NOT NULL DEFAULT 'host' CHECK host|guest`, `winner CHECK host|guest|draw` (NULL while playing), `host_id → auth.users CASCADE NOT NULL`, `host_name`, `guest_id → auth.users SET NULL`, `guest_name`, `host_state JSONB`, `guest_state JSONB` (each `{ships:[{cells:[{x,y}]}], ready, shots:[{x,y,hit}], shotsLeft|null}`), `board_size INT NOT NULL DEFAULT 10 CHECK 10|15`. RLS: select for host, guest, or while `guest_id IS NULL` (join by link); insert only as host; update by participants or to take the empty guest slot; delete by host. Supabase **Realtime** publication is enabled for this table (live updates between two browsers).
**`battleship_teams`**: `id`, `name NOT NULL`, `color TEXT DEFAULT 'indigo'` (palette keys indigo/emerald/amber/rose/sky/slate), `sort_order`, `created_at`; seeded «Команда 1…4» (indigo, emerald, amber, rose).
**`battleship_team_members`**: `employee_id PK → employees CASCADE` (an employee is in at most one team), `team_id → battleship_teams CASCADE`, `created_at`.
**`battleship_points`**: `id`, `employee_id CASCADE NOT NULL`, `team_id → battleship_teams SET NULL` (team at the time of award), `activity CHECK meeting|show|deal`, `points NUMERIC(8,1) NOT NULL`, `qty INT NOT NULL DEFAULT 1`, `note`, `occurred_on DATE DEFAULT current_date`, `created_by → auth.users`, `created_at`.
RLS for teams/members/points: **everyone logged in reads**, writes need `access_can_edit('hr')`.
**Events** (`events`), **course content** (`course_content(id, data jsonb, updated_at)`, rows `main` (Лидорубы), `hunter`, `rop`) and **profiles** (Academy users: `id`, `email`, `full_name`, `role` (Student/manager/Trainee/Admin/blocked), `track` (lidorub|hunter|rop), `rank`, `completed_modules`, …) live **in the Academy's own Supabase project**, not in the CRM database. `events`: `id`, `title_ru, title_uz, desc_ru, desc_uz`, `event_date DATE`, `event_time`, `type` (`event`|`notice`), `recurrence` (`none|daily|weekly|monthly|yearly`, default none), `recurrence_until` ('YYYY-MM-DD' or ''). The CRM reads/writes them with a service-role client via `/api/academy/{events,content,managers,access}` (guard `requireCrmAdmin` = view access to block `hr`).

### 7.3 Screens
**«Морской бой»** (`BattleshipLobby`, `BattleshipGame`; any logged-in user): lobby «Новая партия» — «Правило игры»: «Классический» ("Выстрелы не ограничены, играем до полного разгрома флота.") or «Произвольный» ("У каждого свой лимит выстрелов — задаёте его при расстановке. Кончились — пропускаешь. Победа по сбитым кораблям, …"); «Поле»: «10×10 · обычное» ("Классический флот: 1×4, 2×3, 3×2, 4×1 (20 клеток).") or «15×15 · большое» ("Увеличенный флот: 1×5, 2×4, 3×3, 4×2, 5×1 (35 клеток). Лучше для больших лимитов выстрелов."); «Создать и получить ссылку» (game URL `/hr/retention/battleship/<id>` to send to the opponent, who must be logged in); «Мои партии» (last 15; statuses «Ждёт соперника», «Расстановка», «Идёт бой», «Завершена»). Game screen: placement panel (drag/click ships, «Горизонтально/Вертикально», «Случайно», «Очистить», "Осталось расставить: 4-палубный, …", "Флот готов — можно начинать.", custom mode «Ваш лимит выстрелов» ("Соперник задаёт свой лимит отдельно."), «Готов к бою», "Корабли расставлены. Ждём соперника…"), then boards with fleet tracker ("осталось X/Y"). Errors: "Партия не в фазе боя", "Сейчас не ваш ход", "У вас закончились выстрелы", "Сюда уже стреляли"; DB hints "Таблица морского боя не обновлена. Выполните миграцию legacy/hr-battleship-board-size.sql…".
**«Командный зачёт»** (`TeamStandings`): sorted standings (points desc, then team sort_order) with per-player breakdown, header «Командный зачёт», buttons «Команды» (`TeamManageModal` «Команды и состав»: add team (default name `Команда N`), rename, colour, delete, assign employees to teams "Без команды"), «Сбросить очки» (confirm "Сбросить все накопленные очки? Команды и состав останутся — удалятся только начисления. Действие необратимо."), «Начислить баллы»; info line "Встреча +1, показ +2, сделка +5. Баллы команды = доступные выстрелы в «Морском бою»."; «Последние начисления» with delete ×. Management buttons only for `profiles.role` in `admin|manager|hr`. `AwardPointsModal` «Начислить баллы»: «Команда» → «Сотрудник» ("В этой команде нет сотрудников — добавьте их в разделе «Команды»."), checkbox «Совместно (две команды) — баллы делятся пополам» → «Вторая команда» + «Второй сотрудник», «Активность» (Встреча / Показ / Сделка), «Количество», «Дата», «Комментарий (необязательно)» ("Напр.: показ на Юнусабаде"); validation "Выберите сотрудника", "Выберите второго сотрудника", "Совместная активность — два разных сотрудника"; button «Начислить +N» (+ " ×2" for joint). **TV board** `/tv/board/<TV_BOARD_TOKEN>` (public, no login; `GET /api/tv/teams?k=<token>` returns only names and points, 503 if `TV_BOARD_TOKEN` unset, 401 "Неверная ссылка"): full-screen rotating slides (data refresh 20 s, slide rotation 10 s): teams, "Топ игроков", detail slides; "Зачёт за <period> · баллы за встречи, показы и сделки", trophy for the leader.
**«Обучение»** (`AcademyAdmin`, tabs «Контент», «Аналитика», «Доступы»): *Контент* — editor for `course_content.data` (course title and mentor, modules → lessons, each with title (RU/UZ), duration, video URL, presentation text, quiz questions with options per language and correct-answer index; one course per track: «Лидорубы» (row `main`), «Хантеры», «РОП»); *Аналитика* — table Менеджер / Ранг / Прогресс ("done/total · %") / Текущий модуль ("Курс пройден") / Роль; *Доступы* — table Менеджер / «Ветка обучения» / «Доступ» / Действия with options «Открыт — полный доступ» (`manager`), «Обучающийся — только обучение» (`Trainee`), «Закрыт — нет доступа» (`blocked`), «Админ» (`Admin`); "Сохранено ✓"; empty "В Академии пока нет менеджеров."
**«События»** (`/hr/retention/events`): list of events/notices as date tiles (day + month abbreviation), type chip «Событие»/«Уведомление», time, "↻ Ежедневно/Еженедельно/Ежемесячно/Ежегодно" recurrence, RU or UZ title, description; «Добавить событие»; edit pencil; delete (confirm "Удалить событие?"). Modal «Новое событие»/«Изменить событие»: Тип, Дата, Время, Повторение (+ «Повторять до»), «Название (RU)» ("Собрание отдела…"), «Название (UZ)», «Описание (RU)», «Описание (UZ)»; errors "Укажите дату.", "Укажите название.". Empty "Событий пока нет. Нажмите «Добавить событие».", "Календарь событий Академии — виден менеджерам".

### 7.4 Business rules
- **Battleship** (`features/battleship/logic.ts`): Russian rules — ships may not touch, even diagonally (`canPlace`); fleet complete check by sizes; a hit gives another shot while shots remain; a sunk ship reveals its cells plus the forbidden ring around it; win = all opponent ships sunk. In `custom` mode each player sets `shotsLeft`; when a player has none the opponent keeps shooting; when both are out the winner is decided by more ships sunk, then more cells hit, else draw (`winnerByScore`). Shots are applied client-side and written with `UPDATE … WHERE turn = side` as the race guard (`shoot`, `api.ts`); the game moves lobby→placing when a guest joins (`UPDATE … WHERE guest_id IS NULL`), placing→playing when both are ready (`turn='host'`).
- **Team points** (`features/battleship/teams.ts`, `teamsApi.ts`): activity weights meeting 1, show 2, deal 5 (constant `ACTIVITY`); `points = qty × weight`, halved and rounded to 0.1 for a joint activity (each of the two employees gets a row); the row stores the employee's current team; standings = sum of members' points per team. Entry is **manual** (no automatic import from deals).
- Academy access: role strings above; `track` selects which course row is shown; changes go through `PATCH /api/academy/managers {id, role|track}`.

### 7.5 Integrations
- **Supabase Realtime** (Battleship live sync).
- **Goodland Academy app and its separate Supabase project** (events, course, profiles): everything under «Обучение» and «События» is a remote editor for that app and does not work without the Academy project's service key (`createAcademyClient`, errors `ACADEMY_CLIENT_FAILED`). Games and the team standings are CRM-only.
- TV board token env `TV_BOARD_TOKEN`.

### 7.6 Goodland-specific vs generic
Goodland-specific: the whole section — points for "встречи/показы/сделки" (real-estate sales activities), tracks «Лидорубы/Хантеры/РОП», Academy course/events content, TV leaderboard. Generic ideas worth reusing: team gamification with manual points; 1-v-1 browser Battleship (self-contained, ~1 200 lines of logic/UI).

### 7.7 Dependencies
`employees` (team membership, points), `profiles` (names/roles for games), Academy project, deals (conceptually; no data link).

---

## 8. Cross-cutting summary

### 8.1 Dependency map (what references what)

```
auth.users ─(user_id)─ employees ──┬─ departments (department_id; head_employee_id back-reference)
profiles/roles/role_permissions    ├─ positions (position_id; start_time, workdays)
                                   ├─ employee_diplomas, employee_relatives (CASCADE)
                                   ├─ employee_attendance ── shifts, late_reasons
                                   │      └─ attendance_punches ── attendance_devices; late_letters
                                   ├─ attendance_requests ── attendance_day_overrides
                                   ├─ face_photos ── face_templates; hr_telegram_link_codes; face_academy_scans
                                   ├─ payroll_sheet_rows ── payroll_sheets ── payroll_cc_lines*  (→ GL, cash, deals)
                                   ├─ inventory_items (holder, registered_by, office manager) ── rooms, photos, events, acts, act_people, people_sets
                                   ├─ candidates (recruiter_id, approved_employee_id) ── hr_vacancies ── hr_funnel_daily
                                   │        └─ candidate_messages, candidate_stage_events
                                   ├─ battleship_team_members ── battleship_teams; battleship_points
                                   ├─ meeting_plans, deals.*_emp_id, plans.employee_id   (sales side)
                                   └─ Academy: academy_user_id, academy_access_expires_at  (external project)
```
- `employees` is the hub: nothing in HR works without it. `departments.head_employee_id` is used by three flows (inventory assignment/approval, day-off approval, department head views). `positions` drive attendance thresholds. `employment_type`, `salary`, `rate` are informational except `salary` (payroll "Заполнить").
- Lifecycle `workflow_status` is read by attendance (who appears), onboarding (who is listed), administration (who is hidden), Face ID (`inactive` outcome) and the kiosk (interns on closed days).
- Removing a department is blocked by employees (app check) and inventory items (FK RESTRICT); removing a position by employees (name check); deleting an employee by deals/plans.

### 8.2 Integration matrix (what stops working without each)

| Integration | Section(s) | What breaks without it |
|---|---|---|
| Face ID kiosk tablet app (`face-kiosk`) + device API | Attendance | automatic arrival/departure, short-day logic, snapshots; journal becomes manual |
| Telegram bot @goodlandhrbot (external Node service, service-role access to the DB) | Attendance, requests | explanatory-note photos (`late_letters`), HR/employee/head notifications, tablet offline alerts, Face ID photo upload via Telegram, data retention jobs (snapshots 30 d, letters 65 d) |
| CRM Telegram webhook bot (`TELEGRAM_BOT_TOKEN`) | Recruiting | candidate chat in Telegram, HR-agent auto replies |
| Goodland Academy (separate app + Supabase project; service key; Bearer tokens) | Administration (accounts), Onboarding (7-day trainee login), Day-off requests (employee + head screens), Inventory (self-registration, approvals, act confirmation), Face scan, Retention (course/events/access), Payroll («Моя зарплата» display) | those specific screens/flows; the HR core still works |
| hh.ru API (`HH_ACCESS_TOKEN`, `HH_EMPLOYER_ID`) | Recruiting | import of vacancies/responses/messages |
| LLM provider (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) | Recruiting | HR-agent replies |
| amoCRM tables + funnel facts | Payroll (call-centre table) | meetings fact and SLA % |
| GL / cash module (`gl_*`, `cash_*`) | Payroll | posting of sheets, «Расчёты с персоналом», acts |
| Supabase Storage (private buckets: `face-photos`, `punch-snapshots`, `late-letters`, `inventory-photos`) | Attendance, Inventory | all photos |
| Supabase Realtime | Battleship | live game updates |
| pg_cron + pg_net + vault secret | Inventory | monthly purge of old check photos |
| Vercel cron (`/api/cron/crm`, daily) | Onboarding/Admin/Recruiting | trainee-access expiry, revocation of fired employees' Academy accounts, hh sync, attendance push to Academy |
| my.mehnat.uz, diplom.edu.uz | Administration | nothing (placeholders only) |

### 8.3 What is Goodland-specific vs generic

| Part | Verdict |
|---|---|
| Employees, departments, positions, diplomas, relatives, firing reasons, lifecycle (Uzbek identity fields) | **Generic** (Uzbekistan-specific fields PINFL/INN/passport; employment types ТД/ГПХ/ИП/СЗ) |
| Attendance journal, shifts, schedules, day close, KPI, requests, Face ID | **Generic** (the Face ID kiosk is a separate product to rebuild or replace) |
| `bonus_pct` ("бонус с комиссии"), Academy attendance push, `sales_role`, `is_sales`, `amocrm_*` columns | **Goodland sales business** |
| Payroll sheets and ledger posting | Generic mechanism, but ledger coupling is Goodland's finance module |
| Call-centre pay table, «Колл-центр» tab/article, deal bonus tiers, SLA «Дозвон за 10 мин», CRM AMO | **Goodland call-centre / lidorub specific** |
| Commission leg of «Расчёты с персоналом», `deals.*_emp_id` | **Goodland real-estate commissions** |
| Inventory (items, QR, monthly photos, acts, rooms) | **Generic** (prefix `GL-`, hard-coded QR domain and Academy flows are Goodland) |
| Onboarding public form + trainee → intern pipeline | Generic shape, **Goodland process** (Academy, exam, 7-day login) |
| Recruiting Kanban, vacancies, hh.ru, daily funnel | **Generic** (daily-funnel stage names and agent prompt are Goodland) |
| Battleship, team points, Academy course/events admin, TV board | **Goodland-specific** (retention gamification tied to sales activities and the Academy app) |

### 8.4 Pitfalls and design lessons visible in the code (worth applying in the rebuild)
1. **Never let "close day" write time fields**; guard closing against not-yet-loaded data (29 Sep 2026 incident).
2. **Partial upserts** for the journal so kiosk writes and manual edits do not overwrite each other.
3. **Idempotent kiosk punches** (client-generated UUID, stored reply) and **conditional UPDATE** for arrival (`arrival_time IS NULL`).
4. Keep a head's/office manager's limited rights **in the database** (trigger checks column-by-column), and all multi-step changes (acts, approvals, monthly checks, request decisions) in single transactions/functions.
5. Soft-delete staff; copy names into acts/snapshots so printed documents never change.
6. `employees` currently readable by every logged-in user including passport/PINFL/salary — fix with field-level access.
7. `text` names are still used as join keys in places (positions by name when deleting, GL openings by employee name, `deals.agent` text) — use ids.
8. Browser-local dates in KPI helpers vs Tashkent dates on the server — use one timezone everywhere.
9. Next 14 caches `fetch` in GET handlers even with `force-dynamic` (`fetchCache='force-no-store'` needed) — a Next-specific trap, not relevant to NestJS.
10. Several tables/APIs are built but unused (`hiring_plans`, `hr_funnel_plans`, `salary_accruals`, `attendance_settings.bonus_pct`, `employees.photo_url`, `mehnat_*`, `reference_articles` is used on `/reference`) — do not rebuild them blindly.

## 9. Not determined / open

- The original DDL of `employees` (and `deals`, `plans`) — base columns inferred; the exact `NOT NULL`/default list of `employees.id/name/phone/email/role/user_id/created_at` is unknown.
- Behaviour of the **@goodlandhrbot** service and the **kiosk app** beyond the specs and CRM-side routes (their repos were not read).
- The **Academy-side** screens (employee profile "Отгулы и замены", "Моя зарплата", inventory registration) and the full `/api/requests/*` request validation on the server (only the spec, `rules.ts` and `legacy/hr-day-off-requests.sql` were read; the route files exist in `src/app/api/requests/`).
- Exact `access_apply_rls`-style policies for `late_reasons`, devices, photos (they use `access_can_read/edit('hr')`; `employee_attendance` etc. ended up under `access_apply_rls(...,'hr')` in `access-rls-modules.sql`, which runs after the original policies, so the older role-based policies in `hr-attendance.sql`/`hr-all-in-one.sql` are superseded — the order of migration application on production was not verified).
- The call-centre payroll table (`feat/cc-payroll-table`) is unmerged and "never rendered"; numbers/labels may still change. "Опоздаю" (late warnings that exempt fines) is only specified.
- Other unmerged HR-adjacent branches exist (`feat/inventory-transfer-confirm` — docs only; `feat/academy-v2` — Academy v2 routes; `feat/amo-users-mapping`/`feat/office-visits` are already in `origin/main` but are sales screens, not HR) and were not studied.
- `sales_role` has no HR screen; `employees.photo_url`, `mehnat_*` are unused fields.
- The CV tab fields «Партийность», «Учёная степень», «Государственные награды» are static placeholders ("Нет").
- Line numbers cite `origin/main` at `ed12bcc` (read via `git archive`, not the checked-out branch).
