# System Architecture: Smart Factory MMS Dashboard

## 1. High-level Network Flow

```mermaid
flowchart LR
  subgraph ShopFloor["Shop-floor Network"]
    PLC["Machine PLC / Controller"]
    Sensor["Machine Sensor / Counter / Status Signal"]
    Edge["Machine PC / Edge Gateway"]
  end

  subgraph Server["Factory Server"]
    MQTT["MQTT Broker"]
    Influx["InfluxDB: Raw time-series data"]
    API["Node.js Express API"]
    Worker["Cron / Worker jobs"]
    SQL["SQL Server: Reporting database"]
  end

  subgraph Client["User Client"]
    Browser["Next.js Dashboard Browser"]
  end

  PLC --> Edge
  Sensor --> Edge
  Edge --> MQTT
  Edge --> Influx
  MQTT --> API
  Influx --> Worker
  Worker --> SQL
  API --> SQL
  API --> Browser
  API -->|"Socket.IO realtime updates"| Browser
```

## 2. Data Separation by Machine Type

Machine master data is separated by `machine_area`, `machine_type`, and `machine_name`. Reports can query by area, type, or individual machine.

```mermaid
flowchart TB
  Machine["tbm_machine"] --> Area["machine_area"]
  Machine --> Type["machine_type"]
  Machine --> Name["machine_name"]
  Type --> Target["tb_output_target"]
  Type --> Actual["tb_output_actual"]
  Type --> Runtime["tb_mc_runtime_hourly"]
  Type --> OEE["tb_oee"]
  Type --> NG["tb_machine_ng"]
  Type --> Status["tb_MCStatus"]
```

## 3. Program Flow

```mermaid
sequenceDiagram
  participant Machine as Machine
  participant Edge as Edge/MQTT/Influx
  participant API as Express API
  participant DB as SQL Server
  participant UI as Next.js Dashboard

  Machine->>Edge: Send output, status, model, cycle time
  Edge->>API: Publish latest machine payload through MQTT
  Edge->>API: Provide raw time-series data through InfluxDB
  API->>DB: Upsert hourly output, runtime, availability, OEE
  UI->>API: Request dashboard/report data
  API->>DB: Query by area/type/machine/date
  API-->>UI: Return current summary and report rows
  API-->>UI: Push realtime updates through Socket.IO
```

## 4. ER Diagram

```mermaid
erDiagram
  tbm_machine ||--o{ tb_output_target : "plans"
  tbm_machine ||--o{ tb_output_actual : "actual output"
  tbm_machine ||--o{ tb_cycle_time_actual : "cycle time"
  tbm_machine ||--o{ tb_efficiency_actual : "efficiency"
  tbm_machine ||--o{ tb_availability_actual : "availability"
  tbm_machine ||--o{ tb_oee : "OEE"
  tbm_machine ||--o{ tb_mc_runtime_hourly : "runtime"
  tbm_machine ||--o{ tb_machine_ng : "NG"
  tbm_machine ||--o{ tb_MCStatus : "status"
  tbm_machine ||--o{ tb_MCAlarm : "alarm"
  tbm_operator ||--o{ tb_history_working : "working history"

  tbm_machine {
    int id PK
    string machine_area
    string machine_type
    string machine_name UK
    string status
  }

  tb_output_target {
    int id PK
    date date
    string machine_name
    string model_name
    int pc_target
    float cycle_time_target
    float eff_target
  }

  tb_output_actual {
    int id PK
    date date
    string machine_name
    string model_name
    int Overall
  }

  tb_oee {
    int id PK
    date date
    string machine_name
    float availability
    float performance
    float quality
    float oee_value
    int ng_qty
  }
```

## 5. API Specification

| Area | Endpoint | Purpose |
| --- | --- | --- |
| Machine master | `GET /api/machine/listArea` | List active areas |
| Machine master | `GET /api/machine/listType/:area` | List machine types by area |
| Machine master | `GET /api/machine/listMachines/:area/:type` | List machines by area and type |
| Machine master | `GET /api/machine/listAllMachinesByArea` | Group active machines by area |
| OEE realtime | `GET /api/oee/getLastOEE` | Latest OEE records |
| OEE realtime | `GET /api/oee/getDataTable` | Main dashboard table data |
| OEE realtime | `GET /api/oee/getGraph1` | Dashboard graph data |
| OEE realtime | `GET /api/oee/getGraph2` | Dashboard graph data |
| Report | `GET /api/report/daily-dashboard` | Daily summary dashboard |
| Report | `GET /api/report/monthly-dashboard` | Monthly summary dashboard |
| Report | `GET /api/report/machine-report` | Machine-level production report |
| Report | `GET /api/report/machine-ng-report` | Machine NG report |
| Plan config | `GET /api/planConfig/list` | List machine plan configs |
| Plan config | `POST /api/planConfig/upsert` | Create or update plan config |
| Target | `POST /api/outputTarget/createOutputTargetRange` | Create target plan range |
| Machine status | `GET /api/mcstatus/timeline` | Machine status timeline |
| Machine status | `GET /api/mcstatus/latest-all` | Latest status by machine |

## 6. Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, Bootstrap, AdminLTE, Chart.js |
| Backend | Node.js, Express 5, Socket.IO |
| Database ORM | Prisma |
| Main Database | SQL Server |
| Realtime/raw data | MQTT, InfluxDB |
| Process manager | PM2 |
| Testing | Node assert-based unit tests |
| CI/CD | GitHub Actions |

## 7. Deployment Flow

```mermaid
flowchart LR
  Dev["Developer branch"] --> PR["Pull request / review"]
  PR --> CI["CI: npm test + frontend build"]
  CI --> Build["Build frontend export"]
  Build --> Server["Copy backend + fontend/out to customer server"]
  Server --> Env["Configure .env and DB connection"]
  Env --> PM2["pm2 start ecosystem.config.js"]
  PM2 --> Monitor["pm2 logs / dashboard validation"]
```
