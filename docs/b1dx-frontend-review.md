# B1DX Frontend Projects — Architecture Review

> เปรียบเทียบ 2 โปรเจกต์ frontend ของ B1DX platform กับ best practices และ SAM workspace stack
> วันที่: 2026-05-25

---

## TL;DR

| Project | Verdict | Apply to SAM? |
|---|---|---|
| **b1dx-document-frontend** | Demo-grade — ยังไม่พร้อม production | ❌ ไม่ตรง stack (MUI vs Radix) |
| **b1dx-oms-fulfillment-web** | Production-grade reference | ✅ ตรง stack ~100% — หยิบมาใช้ได้เลย |

**คำแนะนำ**: ใช้ **b1dx-oms-fulfillment-web** เป็นต้นแบบสำหรับ SAM frontend

---

## เปรียบเทียบสรุป

| Aspect | document-frontend | oms-fulfillment-web | SAM workspace |
|---|---|---|---|
| **Next.js** | 16.2 | 15.1 | 15 |
| **React** | 19.2 | 19.2 | 19 |
| **Monorepo** | ❌ single repo | ✅ pnpm + Turbo | (single) |
| **UI lib** | MUI 7 + Syncfusion (paid) | Radix + Tailwind 4 + shadcn | Radix + Tailwind 4 |
| **State** | Context API | TanStack Query v5 + observable store | Zustand + TanStack Query v5 |
| **Forms** | RHF (no validation) | RHF + Zod + zodResolver | RHF + Zod v4 |
| **Table** | Syncfusion (paid license) | DataTable (custom Radix) | TanStack Table |
| **i18n** | ❌ Thai hardcoded | ✅ i18next (en/th) | (ยังไม่มี) |
| **Auth** | 🔴 hardcoded `admin@admin/12345678` | JWT + silent refresh + gateway proxy | JWT + Identity |
| **Token storage** | localStorage (XSS risk) | in-memory + refresh in localStorage | (BE-managed) |
| **Mock** | ❌ none | ✅ MSW v2 + fake DB | MSW v2 |
| **Test** | ❌ zero | ✅ Vitest + Playwright + Testing Library | (FE ยังไม่มี) |
| **CI/CD** | ❌ none | ⚠️ ไม่เจอ workflow file | - |
| **Docs** | ❌ claude.md ผิด (เป็น BE) | ✅ CLAUDE.md + AGENTS.md + mockup ref | CLAUDE.md |

---

## 1. b1dx-document-frontend

**สถานะ**: Admin scaffold ระดับ demo

### ✅ จุดดี
- โครงสร้างโฟลเดอร์เป็นระเบียบ (hybrid `@core/` + `views/`)
- TypeScript strict + path aliases ครบ
- API client abstraction สะอาด (pluggable token/tenant provider)
- Multi-stage Dockerfile + non-root user
- ESLint + Prettier + Stylelint setup

### 🔴 Critical issues
1. **Hardcoded credentials** `admin@admin / 12345678` ใน `src/contexts/AuthContext.tsx:28-29`
2. **localStorage เก็บ user data** — vulnerable to XSS
3. `process.env.API_KEY` reference จาก client-side → leak risk
4. **Syncfusion grids** = paid license — ต้องตรวจสัญญา

### 🟡 Architecture gaps
- ไม่มี data layer caching (raw `fetch`)
- ไม่มี form validation (RHF อยู่แต่ไม่ wired Zod)
- ไม่มี error boundary
- Views = container ใหญ่ (state + API + UI รวมกัน)

### ❌ Missing entirely
- Tests (Vitest, Playwright, MSW)
- i18n (Thai hardcoded)
- CI/CD pipeline
- Form validation library

### Stack mismatch กับ SAM
- MUI 7 vs **Radix** — คนละ paradigm (component-heavy vs headless)
- 3 styling systems ซ้อน (MUI + Emotion + Tailwind)
- Context API vs **Zustand + TanStack Query**

**Verdict**: หยิบได้แค่ **idea** (folder layout, `apiFetch` pattern, Dockerfile) — ไม่ใช่ implementation

---

## 2. b1dx-oms-fulfillment-web

**สถานะ**: Production-grade enterprise admin

### Stack
```
Monorepo: pnpm 10 + Turbo 2 + Changeset
Apps:     b1dx-oms-fulfillment (main), saas-starter (template)
Packages: @b1dx/ui, gateway-core, theme, tokens, types,
          utils, eslint-config, typescript-config
```

| Layer | Tech |
|---|---|
| Framework | Next.js 15.1, React 19.2, TS 5.8 |
| UI | Radix + Tailwind 4 + shadcn-style (`@b1dx/ui`) |
| State | TanStack Query v5 + nuqs + observable auth store |
| Forms | RHF + Zod 3 + zodResolver |
| i18n | i18next + react-i18next (en/th) |
| Mock | MSW v2 (handlers + fake DB) |
| Test | Vitest 4 + Playwright + Testing Library |
| Auth | In-memory access token + silent refresh |
| Gateway | Next route handler proxy → upstream services |

### ✅ จุดดีมาก
1. **Monorepo discipline** — apps/packages แยกชัด, shared config
2. **Feature-based architecture** — `features/{domain}/{components,hooks,services,schemas,types,lib,config}/` + barrel `index.ts`
3. **Route groups** `(app)` กับ `(public)` — auth boundary ชัด
4. **API gateway pattern** — browser ผ่าน Next proxy ไม่ยิง backend ตรง
5. **Token strategy** — access token in-memory, refresh แยก, silent refresh
6. **i18n complete** — schema messages translated (Zod factory รับ translated error)
7. **UI layering** — primitives (`ui/`) ห้าม import ตรง, ต้องผ่าน wrapper (`app/`, `forms/`)
8. **Design tokens** แยก package (`@b1dx/tokens`) → theming consistent
9. **Test pyramid ครบ** — Vitest + Playwright + MSW
10. **Tooling** — Turbo cache, Changeset version, scaffold scripts (`add-component.sh`, `add-feature.sh`, `add-i18n.sh`)
11. **Docs ละเอียด** — CLAUDE.md + AGENTS.md + mockup HTML reference

### ⚠️ จุดที่ระวัง (minor)
| Issue | Severity | Note |
|---|---|---|
| `next.config.ts` ignore lint + TS errors at build | 🟡 | ต้องบังคับใน CI gate แทน |
| Refresh token ใน localStorage | 🟡 | XSS risk — ideal: httpOnly cookie |
| ไม่เจอ CI workflow file | 🟡 | ตรวจอีกที |
| `xlsx 0.18.5` known CVE | 🟢 | run `npm audit` |
| Storybook 8.6 + Vite 6 aging | 🟢 | อัพตามรอบ |
| `packages/utils` minimal | 🟢 | ลบถ้าไม่ใช้จริง |

### Severity verdict
- 🔴 Critical: **none**
- 🟡 Medium: refresh token storage, build error ignore
- 🟢 Low: dep aging

---

## 3. App ที่ดีต้องเป็นยังไง

Reference checklist (Next.js 15+ enterprise admin):

| Pillar | document | oms | Note |
|---|---|---|---|
| Feature-based architecture | partial | ✅ | colocate components/hooks/services/schemas |
| Monorepo + shared design system | ❌ | ✅ | apps + packages แยก |
| Server state: query lib + cache | ❌ | ✅ | TanStack Query v5 |
| Client state: minimal + URL-driven | ❌ | ✅ | Zustand/store + nuqs |
| Forms: schema-first | ❌ | ✅ | Zod + RHF + i18n message |
| UI: headless primitives + tokens | ❌ | ✅ | Radix + Tailwind + tokens package |
| API security: gateway pattern | ❌ | ✅ | proxy route, no direct browser→backend |
| Auth: in-memory token + refresh | ❌ | ✅ | silent refresh, ProtectedRoute |
| Testing: pyramid (unit + E2E) | ❌ | ✅ | Vitest + Playwright + MSW |
| Mocking: parallel dev | ❌ | ✅ | MSW handlers + seeded DB |
| i18n: schema-aware | ❌ | ✅ | i18next, translated validation |
| Tooling: scaffold + cache | ❌ | ✅ | Turbo + scripts |
| Docs: AI-ready | ❌ | ✅ | CLAUDE.md + AGENTS.md |
| CI/CD gate | ❌ | ⚠️ | block merge on lint/test/build |
| Observability | ❌ | ⚠️ | Sentry / RUM |
| Security headers / CSP | ❌ | ⚠️ | CSP in next.config.ts |
| httpOnly cookie for refresh | ❌ | ⚠️ | XSS-safe storage |

**Add ให้ครบ 100%**:
1. CI workflow (lint + typecheck + test + e2e + build) block merge
2. Sentry / observability
3. CSP + security headers
4. Refresh token → httpOnly cookie
5. Dependency audit (Dependabot / Renovate)

---

## 4. คำแนะนำ Apply to SAM Workspace

### หยิบจาก `b1dx-oms-fulfillment-web` ไปใช้ทันที

| Pattern | จาก | ใช้ที่ SAM |
|---|---|---|
| Feature folder shape | `apps/b1dx-oms-fulfillment/src/features/orders/` | `web/web/frontend/src/features/*` |
| Gateway proxy route | `src/app/gateway/proxy/[upstreamKey]/[...path]` | API client layer |
| Auth store + silent refresh | `src/lib/auth/` | Auth flow |
| MSW handler + fake DB structure | `src/mocks/msw/` | Dev/test mock |
| Playwright + Vitest config | `playwright.config.ts`, `vitest.config.ts` | FE test setup |
| i18next setup + locale JSON | `src/lib/i18n/` | Multi-lang support |
| ESLint config restrict deep imports | `packages/eslint-config/` | Import discipline |
| Scaffold scripts | `scripts/add-feature.sh` | Dev productivity |
| CLAUDE.md + AGENTS.md docs | repo root | AI-assisted dev |

### ห้ามใช้จาก `b1dx-document-frontend`
- ❌ Hardcoded auth
- ❌ MUI components (ชน Radix)
- ❌ Syncfusion grids (license risk)
- ❌ raw fetch without caching
- ❌ localStorage for sensitive data

---

## 5. Action Items สำหรับ SAM Frontend

### Phase 1: Foundation (1-2 weeks)
- [ ] เพิ่ม TanStack Query (ถ้ายังไม่มี wire) + QueryProvider
- [ ] เพิ่ม MSW v2 + handlers สำหรับ dev parallel
- [ ] เพิ่ม Vitest + Playwright setup
- [ ] ตั้ง ESLint rule restrict deep imports
- [ ] สร้าง `CLAUDE.md` + `AGENTS.md` สำหรับ frontend

### Phase 2: Architecture (2-3 weeks)
- [ ] Refactor feature folder ให้ตาม `features/{domain}/{components,hooks,services,schemas,types}/`
- [ ] เพิ่ม API gateway proxy route
- [ ] Auth store + silent refresh
- [ ] i18next setup (th/en)

### Phase 3: Quality (1-2 weeks)
- [ ] CI workflow: lint + typecheck + test + build
- [ ] Sentry integration
- [ ] CSP + security headers
- [ ] Dependency audit cron

---

## References

- **b1dx-oms-fulfillment-web**: `D:\2026\b1dx-platform\b1dx-oms-fulfillment-web`
- **b1dx-document-frontend**: `D:\2026\b1dx-platform\b1dx-document-frontend`
- **SAM workspace**: `d:\2026\sam-workspace\web`
