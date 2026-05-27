# SAM Workspace

Meta-repository ที่รวม AI agent configurations สำหรับพัฒนา SAM platform ด้วย Claude Code

## โครงสร้าง

```
sam-workspace/
├── CLAUDE.md              ← AI agent instructions (business domain, workflow, rules)
├── .claude/agents/        ← Specialist agent definitions
├── docs/                  ← Planning docs, CR analysis
└── web/                   ← SAM codebase (junction/symlink → local clone)
    └── web/
        ├── backend/       ← .NET 10 API
        └── frontend/      ← Next.js 15
```

## Setup (ทำครั้งเดียวต่อเครื่อง)

### สำหรับ Developer ใหม่ (ยังไม่เคย clone)

**1. Clone workspace**

```bash
git clone https://github.com/patjanawat/sam-workspace
cd sam-workspace
```

**2. Clone SAM codebase ไว้ที่ path ที่ต้องการ**

```bash
git clone https://bitbucket.org/manaosoftware/sam <YOUR_PATH>
# ตัวอย่าง:
cmd /c git clone https://bitbucket.org/manaosoftware/sam D:\2025\ManaoSoftware\sam
```

**3. สร้าง Junction ชี้มาที่ web/**

```powershell
# รันใน sam-workspace/
cmd /c mklink /J web <YOUR_PATH>
# ตัวอย่าง:
cmd /c mklink /J web D:\2025\ManaoSoftware\sam
```

**4. ตรวจสอบ**

```powershell
Get-ChildItem web\web  # ควรเห็น backend/ frontend/
```

---

### สำหรับ Developer เดิม (มี submodule อยู่แล้ว)

`web/` submodule ถูกเอาออกแล้ว ต้อง migrate 1 ครั้ง:

**1. Pull workspace ล่าสุด**

```bash
git pull
# web/ จะหายไป (submodule ถูก remove แล้ว)
```

**2. ตรวจสอบว่ามี SAM repo clone อยู่แล้วหรือไม่**

```bash
# ถ้ามีอยู่แล้ว ข้ามไปข้อ 3 ได้เลย
# ถ้าไม่มี ให้ clone ใหม่:
git clone https://bitbucket.org/manaosoftware/sam <YOUR_PATH>
```

**3. สร้าง Junction**

```powershell
# รันใน sam-workspace/
cmd /c mklink /J web <YOUR_PATH>
```

---

> **Junction vs Symlink**
> - `mklink /J` (Junction) — **ไม่ต้องการ Admin** ใช้ได้ทันที ✅
> - `mklink /D` (Symlink) — ต้องการ Admin หรือเปิด Developer Mode ใน Windows Settings

## การใช้งาน

### Git ใน SAM repo

```bash
git -C web status
git -C web checkout -b feature/SAM-123-description
git -C web add .
git -C web commit -m "feat: ..."
git -C web push
```

### Run Backend

```bash
cd web/web/backend
dotnet run --project SamApp.WebApi
```

### Run Frontend

```bash
cd web/web/frontend
npm run dev:local
```

## Agents

| Agent | ใช้เมื่อ |
|---|---|
| `orchestrator` | งาน multi-step ข้าม BE + FE |
| `dotnet-developer` | สร้าง/แก้ BE — endpoints, EF, Hangfire |
| `frontend-developer` | สร้าง/แก้ FE — pages, components, hooks |
| `tester` | เขียน tests หลัง fix bug หรือ implement feature |
| `code-reviewer` | Review code ก่อน commit |
