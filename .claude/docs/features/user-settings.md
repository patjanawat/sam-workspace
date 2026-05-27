# Feature: User Management & Settings

## Overview

User Management is a system-admin-only feature that handles the full lifecycle of SAM platform users: creating accounts, assigning roles, updating profile and credentials, and managing User Delegate (temporary approval delegation). The Settings > Users page (FE) surfaces this functionality as a CRUD table with role-based filtering and a dialog-based create/edit form.

---

## User Delegate

`UserDelegate` is the mechanism that lets an approver temporarily hand off their approval rights to another user for a date range.

- A delegate record has `DelegateFromDate`, `DelegateToDate`, and a `Status` field.
- Status values: `Normal (0)` = not currently delegating; `Delegate (1)` = actively delegating.
- Status is **not** set manually — it is computed nightly by `UserDelegateStatusUpdateJob` (a .NET `BackgroundService`).
- The job runs **once at midnight UTC+7** (SE Asia Standard Time) each day. It also runs once on application startup.
- Logic: if `today >= DelegateFromDate && today <= DelegateToDate` → status = `Delegate`; otherwise → `Normal`.
- Overlapping job protection via `SemaphoreSlim(1,1)` — if a previous run is still going, the new run is skipped.

---

## Key Backend Endpoints

| Method | Path | Operation | Auth Policy |
|--------|------|-----------|-------------|
| `GET` | `/users` | List all users (filterable by `roleCode` query param) | `SystemAdminOnly` |
| `GET` | `/users/{id}` | Get single user by GUID | `SystemAdminOnly` |
| `GET` | `/users/options` | Get dropdown options: roles, sales offices, sales groups, manager list | `SystemAdminOnly` |
| `POST` | `/users` | Create user (with initial temporary password) | `SystemAdminOnly` |
| `PUT` | `/users/{id}` | Update user (profile, role, email, password reset by admin) | `SystemAdminOnly` |
| `PUT` | `/users/update-password-by-user` | User changes own password | Any authenticated user |
| `GET` | `/me` | Get current user info from JWT claims | Any authenticated user |
| `GET` | `/roles` | List all roles (ordered by name) | Any authenticated user |

---

## Roles

Roles are stored in ASP.NET Identity (`AspNetRoles`) and each has a short `Code` string.

| Code | Full Name |
|------|-----------|
| `srp` | Sale Representative |
| `sam` | Area Sale Manager |
| `sdm` | Sale Division Manager |
| `pte` | Pricing Team |
| `cdr` | Commercial Director |
| `fin` | Finance |
| `adt` | Auditor |
| `sla` | Sale Admin |
| `adm` | System Admin |

Role assignment rules (enforced in both BE validators and FE Zod schemas):
- Every user has **exactly one role** at a time. Updating role removes all previous roles first.
- `srp` requires: `ReportToId` (manager) + `SalesGroupCode` + `SalesOfficeId`.
- `sam` requires: `SalesOfficeId` + `SalesGroupCode` (no manager required).
- All other roles: no `SalesOfficeId` or manager required (fields cleared on save if present).

---

## Key Backend Files

| File | Purpose |
|------|---------|
| `Features/User/Create/CreateUserEndpoints.cs` | POST `/users` — validator, route, auth policy |
| `Features/User/Create/CreateUserCommandHandler.cs` | Creates `ApplicationUser` via `UserManager`, sets `IsTemporaryPassword = true`, assigns role |
| `Features/User/Update/UpdateUserEndpoints.cs` | PUT `/users/{id}` — validator (optional fields), route |
| `Features/User/Update/UpdateUserCommandHandler.cs` | Swaps role (remove all old, add new), updates fields, token-based password reset, sets `IsTemporaryPassword = true` on admin reset |
| `Features/User/UpdatePasswordByUser/UpdatePasswordByUserCommandHandler.cs` | User self-service password change — checks last 5 passwords for reuse (`PasswordHistory` table), sets `IsTemporaryPassword = false` |
| `Features/User/GetAll/GetUsersQueryHandler.cs` | Returns users + `RoleSummary` (count per role, active users only), ordered by most recently updated |
| `Features/User/GetById/GetUserByIdQueryHandler.cs` | Returns single user with roles list |
| `Features/User/GetOptions/GetUserOptionsHandler.cs` | Returns roles, sales offices, sales groups, and manager candidates (active `sam` users only) |
| `Features/User/Me/MeEndpoints.cs` | Reads from JWT claims directly (no DB hit) — returns id, email, name, role, roleCode |
| `Features/User/UserDelegateStatusUpdateJob.cs` | `BackgroundService` — schedules nightly delegate status update |
| `Features/User/UserDelegateStatusUpdateService.cs` | Iterates all `UserDelegate` rows, recomputes status based on today's UTC+7 date |
| `Features/Role/GetAll/GetRolesEndpoints.cs` | GET `/roles` — returns all roles ordered by name |
| `Features/Role/GetAll/GetRolesQueryHandler.cs` | Queries `RoleManager<ApplicationRole>` |

---

## Key Frontend Files

| File | Purpose |
|------|---------|
| `features/settings/users/hooks/index.ts` | Primary hooks module — CRUD hooks using `genericHooks` with auto-invalidation |
| `features/settings/users/hooks/useUsersQuery.ts` | `useUsersList`, `useUserById`, `prefetchUserById`, `ensureUserById` |
| `features/settings/users/hooks/useUsersOptions.ts` | `useUserOptions` — fetches `/users/options`, maps to UI-ready option shapes |
| `features/settings/users/services/user.service.ts` | Raw API calls: `getUsers`, `getUserById`, `createUser`, `updateUser` |
| `features/settings/users/types/user.types.ts` | `GetUsersResult`, `GetUsersResponse`, `GetUserByIdResult`, `CreateUserRequest`, `UpdateUserRequest` |
| `features/settings/users/schema/create-user.schema.ts` | `makeCreateUserSchema(roles)` — dynamic Zod schema with role-based conditional validation |
| `features/settings/users/schema/edit-user.schema.ts` | `makeEditUserSchema(roles)` — same conditional logic, password optional on edit |
| `features/settings/users/components/details/UserDialog.tsx` | Create/Edit user modal dialog |
| `features/settings/users/components/details/UserForm.tsx` | Form inside the dialog — role-conditional fields |
| `features/roles/hooks/useRolesQuery.ts` | `useRolesList`, `useRoleDetail`, `useCreateRole`, `useUpdateRole`, `useDeleteRole` |
| `features/roles/types/role.types.ts` | `RoleInfo`, `GetRolesResponse` |

---

## Key Frontend Hooks

| Hook | Purpose |
|------|---------|
| `useGetUserByIdQuery(id)` | Fetch single user for edit form (enabled only when id is set) |
| `useGetOptions()` | Fetch `/users/options` for role/office/manager dropdowns |
| `useUserOptions(opts?)` | Same with `staleTime: 5min` and mapped output shapes |
| `useCreateUser()` | POST `/users`, auto-invalidates list + related (options) |
| `useUpdateUser(id)` | PUT `/users/{id}`, auto-invalidates list + detail + related |
| `useDeleteUser(id)` | DELETE `/users/{id}`, auto-invalidates list + related |
| `useResetPasswordUser()` | PUT `/users/update-password-by-user` for self-service password change |
| `useUsersList(params)` | List users with optional roleCode filter, page, pageSize |
| `useUserById(id?)` | TanStack Query wrapper, disabled when id is absent |
| `prefetchUsersOptions(qc)` | Server-side prefetch of `/users/options` |
| `ensureUsersOptions(qc)` | Ensure options in cache before render |
| `useRolesList()` | Fetch all roles (no cache — always re-fetches on mount/focus) |

---

## Business Rules & Gotchas

### Password Policy
- Minimum 8 characters; must include at least 3 of: uppercase, lowercase, digit, special character (`!@#$%^&*()-_=+`). No Thai characters.
- Admin-set password (create or admin reset via `PUT /users/{id}`) sets `IsTemporaryPassword = true` — user is prompted to change on next login.
- User self-service change (`PUT /users/update-password-by-user`) sets `IsTemporaryPassword = false`.
- Self-service checks last **5 passwords** from `PasswordHistory` table to prevent reuse (error code: `PASSWORD_DUPLICATED_LAST_5`).
- Admin password reset also unlocks the account (`LockoutEnd = null`, `AccessFailedCount = 0`).

### Role Assignment
- One user = one role at all times (enforced on BE: removes all current roles before adding the new one).
- `RoleCode` is also stored directly on `ApplicationUser.RoleCode` as a denormalized field (source of truth is the ASP.NET Identity `UserRoles` join table).
- Manager candidates in `/users/options` are filtered to **active, non-deleted `sam` users only**.

### Delegate Status Auto-Update
- Do not set `UserDelegate.Status` manually — the background job owns this field.
- Job runs at startup and every midnight UTC+7. Semaphore prevents double-execution.
- If `DelegateFromDate` or `DelegateToDate` is null, status defaults to `Normal`.

### GET /users Response
- Returns `Users` list + `RoleSummary` (active user counts per role in predefined display order).
- List ordering: most recently updated first (`UpdatedDateUTC ?? CreatedDateUTC`), then by name.
- `IsLock` is computed at query time: `LockoutEnd != null && LockoutEnd > now`.

### FE Dynamic Zod Schemas
- Both create and edit schemas are factory functions that accept the roles list and build cross-field conditional rules. Must be rebuilt when roles list changes.

---

## Related Features

- **Approval Settings** (`features/settings/approval/`) — UserDelegate records are created and managed from Approval Settings, not from User Management.
- **Auth / Login** (`Features/Auth/LoginUser/`) — `IsTemporaryPassword` flag triggers forced password change flow on login.
- **Approval Workflow** (`Features/Approval/`) — Delegate status determines which user receives approval tasks during a delegation period.
- **SAP Sync** — SRP/SAM hierarchy (`ReportToId`) feeds the approval chain calculations.
