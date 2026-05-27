# Feature: Auth

## Overview

Auth ครอบคลุม login/logout, JWT token management, route protection, และ role-based page access. Backend ใช้ ASP.NET Identity + JWT Bearer. Frontend ใช้ Next.js middleware + cookies-next + reverse proxy pattern.

---

## Login Flow

```
User → POST /login (AllowAnonymous, Carter endpoint)
  → ASP.NET Identity PasswordSignInAsync
  → JwtTokenGenerator (HMAC SHA-256)
  → Response: { token, roleCode, isTemporaryPassword, tokenExpiry, ... }
  → FE: cookies-next stores all fields in browser cookies (maxAge 3600s)
  → Redirect to role's default landing page (from permissions.ts)
```

---

## Key Backend Endpoints

| Method | Path | Auth | หมายเหตุ |
|--------|------|------|----------|
| `POST` | `/login` | Anonymous | ASP.NET Identity sign-in → JWT response |
| `POST` | `/logout` | Authorized | Clears server-side state (if any) |
| `GET` | `/me` | Authorized | Returns claims from JWT (no DB hit) |
| `PUT` | `/users/update-password-by-user` | Authorized | User self-service password change |

---

## JWT Token

- Algorithm: **HMAC SHA-256**
- Expiry: configured in `TokenSettings:AccessTokenExpireHours` (appsettings.json)
- Payload claims: `userId`, `email`, `name`, `roleCode`, `isTemporaryPassword`
- `JwtSlidingTokenMiddleware` (BE): refreshes token on every request, sends new token in `X-Slided-Token` response header

> ⚠️ **Gap**: Frontend has no code to read `X-Slided-Token` — session extension is client-side cookie only, not real sliding token refresh. If token expires mid-session, user must re-login.

---

## Frontend Token Storage (cookies-next)

Cookies set on login (maxAge 3600s):

| Cookie | Value |
|--------|-------|
| `token` | JWT Bearer token |
| `roleCode` | User's role code (e.g., `srp`, `sam`) |
| `isTemporaryPassword` | `"true"` / `"false"` |
| `tokenExpiry` | Expiry timestamp |

---

## Reverse Proxy Pattern

All API calls go through Next.js route handler at `/gateway/proxy/*`:

```
Browser → Next.js /gateway/proxy/* → reads `token` cookie → adds Authorization: Bearer <token> → forwards to Backend API
```

Direct browser-to-backend calls are NOT used. This keeps the token server-side accessible and avoids CORS issues.

---

## Route Protection (middleware.ts)

`src/middleware.ts` checks cookies on every request:

| Condition | Action |
|-----------|--------|
| No `token` cookie | Redirect `/login` |
| `isTemporaryPassword === "true"` | Redirect `/login` (force password change) |
| Wrong path for role | Redirect `/forbidden` |
| Valid token + correct role | Allow |

Role permissions and default landing pages defined in `src/shared/constants/permissions.ts`.

---

## Key Frontend Files

| File | Purpose |
|------|---------|
| `src/middleware.ts` | Route protection — cookie checks + role-based redirects |
| `src/shared/constants/permissions.ts` | Role → allowed paths + default landing page mapping |
| `src/app/login/` | Login page + form |
| `src/server/` | Server actions + API client (reads token cookie, calls gateway) |
| `src/app/api/gateway/proxy/[...path]/route.ts` | Reverse proxy — injects Authorization header |

---

## Key Backend Files

| File | Purpose |
|------|---------|
| `Features/Auth/LoginUser/LoginUserEndpoint.cs` | POST `/login` endpoint (Carter) |
| `Features/Auth/LoginUser/LoginUserCommandHandler.cs` | Identity sign-in + JWT generation |
| `Infrastructure/Auth/JwtTokenGenerator.cs` | Creates JWT with claims |
| `Infrastructure/Middleware/JwtSlidingTokenMiddleware.cs` | Refreshes token in `X-Slided-Token` header (unused by FE) |
| `appsettings.json` → `TokenSettings` | `AccessTokenExpireHours`, `SecretKey`, `Issuer`, `Audience` |

---

## Business Rules & Gotchas

1. **`isTemporaryPassword` blocks all access**: middleware redirects to `/login` immediately. User must change password before accessing anything else.

2. **Role = single, immutable during session**: `roleCode` stored in cookie at login. Role change by admin takes effect only on next login.

3. **`/me` endpoint reads JWT claims only** — no DB hit. Fields: `id`, `email`, `name`, `role`, `roleCode`.

4. **Lockout**: after N failed login attempts (configured in Identity options), account is locked. Admin unlock via `PUT /users/{id}` (sets `LockoutEnd = null`, `AccessFailedCount = 0`).

5. **Sliding token not implemented on FE**: `X-Slided-Token` header is sent by BE but not consumed by FE. Token effectively has fixed expiry from login time.

6. **Cookie maxAge = 3600s**: hardcoded in cookies-next call. If `AccessTokenExpireHours` on BE is longer, FE cookie expires first. If shorter, BE rejects valid-looking cookie token.

7. **Proxy route is catch-all**: `/gateway/proxy/[...path]` — all API endpoints are relative paths under this. Adding a new BE endpoint requires no FE proxy config changes.

---

## Related Features

- **User Management** (`Features/User/`) — `IsTemporaryPassword` flag triggers forced password change flow
- **Role permissions** (`features/roles/`) — role codes map to UI access rights
- **All protected endpoints** — require `[Authorize]` or specific policy; JWT validated by ASP.NET Bearer middleware
