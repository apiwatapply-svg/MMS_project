# Product Requirements Document: Smart Factory MMS Dashboard

## 1. Objective

Build a Smart Factory Machine Monitoring System dashboard that helps production, maintenance, and management teams see machine performance quickly, reduce manual reporting, and respond to abnormal machine conditions faster.

## 2. Users

- Production supervisor: checks current machine running status, output, target, OEE, and line performance.
- Maintenance engineer: reviews downtime, alarms, machine stop trends, and machine status history.
- Manager: reviews daily/monthly summaries and compares output against target.
- Admin/engineer: configures machine master data, plan targets, holidays, and report settings.

## 3. Problem Statement

Before the system, machine performance was mainly reviewed through manual logs, exported spreadsheets, and delayed operator reports. This made it hard to identify machine losses in real time and caused slow decision-making when output dropped or machines stopped.

## 4. Product Scope

### In Scope

- Real-time machine monitoring for multiple machine areas and machine types.
- Dashboard summary for output, target, OEE, availability, performance, quality, NG, and downtime.
- Daily dashboard and monthly dashboard.
- Machine report and machine NG report.
- Production plan and target configuration.
- Operator working history.
- Machine status timeline from machine-side data.
- SQL Server persistence through Prisma.
- PM2 deployment for on-premise customer server.
- CI workflow for unit tests and frontend build.

### Out of Scope

- PLC program modification.
- Cloud analytics platform.
- Full predictive maintenance model training.
- ERP/MES write-back integration.

## 5. Success Metrics

- Supervisors can identify abnormal machines from one dashboard.
- Daily and monthly production reports can be generated without manual spreadsheet consolidation.
- Machine data can be reviewed by area, type, and machine name.
- Demo data covers all active machine types from 2026-05-01 through 2026-06-30.
- Backend unit tests pass in local and CI environments.

## 6. Functional Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| MMS-001 | Show real-time machine status and latest output by machine | High |
| MMS-002 | Filter machines by area, type, and machine name | High |
| MMS-003 | Store machine master data by area/type/name | High |
| MMS-004 | Store output target and actual output per hour | High |
| MMS-005 | Calculate availability, performance, quality, and OEE | High |
| MMS-006 | Provide daily dashboard report | High |
| MMS-007 | Provide monthly dashboard report | High |
| MMS-008 | Provide machine report and machine NG report | Medium |
| MMS-009 | Support target/plan configuration | Medium |
| MMS-010 | Support PM2 production deployment | High |

## 7. Non-functional Requirements

- Dashboard should be readable at a glance on production office screens.
- Backend APIs should avoid heavy repeated database queries by using cache and scheduled aggregation where appropriate.
- Database schema should keep machine master, target, actual, runtime, OEE, and NG data separated for reporting clarity.
- Deployment should work on an on-premise Windows or Linux customer server.
- Secrets must stay in `.env` and must not be committed.

## 8. User Workflow

```mermaid
flowchart LR
  Req["Get requirements"] --> Master["Prepare machine master data"]
  Master --> Connect["Connect machine data sources"]
  Connect --> Store["Store by type in database"]
  Store --> Dashboard["Realtime dashboard"]
  Dashboard --> Report["Daily / monthly reports"]
  Report --> Decision["Production decision and maintenance action"]
```

## 9. Deliverables

- Working backend and frontend source code.
- SQL Server seed data script for May-June 2026.
- PRD document.
- System architecture document.
- User manual.
- Git and DevOps workflow document.
- CI workflow.
- PM2 deployment config.
