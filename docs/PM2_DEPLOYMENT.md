# PM2 Deployment Guide

This guide explains how to deploy Smart Factory MMS Dashboard on a customer on-premise Windows or Linux server after CI has passed.

## Deployment Goal

The production server runs one PM2 process:

- `mms-dashboard-api`: Node.js Express API on port `5005`.

The backend also serves the exported Next.js frontend from `fontend/out`, so users open the dashboard through the backend URL.

## 1. Pre-Deployment Checklist

- GitHub Actions CI is green on `main`.
- Node.js 22 or newer is installed.
- SQL Server is reachable from the server.
- MQTT broker and InfluxDB are reachable if live machine I/O is enabled.
- `backend/.env` exists on the server and is not committed to Git.
- Port `5005` is available or `PORT` is changed in `ecosystem.config.js`.
- PM2 is installed globally.

```bash
npm install -g pm2
```

## 2. First-Time Deployment

```bash
git clone https://github.com/apiwatapply-svg/MMS_project.git
cd MMS_project
```

Create `backend/.env` from the example and update real customer values:

```bash
cd backend
cp .env.example .env
```

Required production values:

```env
DATABASE_URL="sqlserver://USER:PASSWORD@SERVER:1433/DATABASE;trustServerCertificate=true"
ENABLE_MACHINE_IO=true
ENABLE_CRON_WORKER=true
DEMO_AUTO_SEED_MSSQL=false
MQTT_URL="mqtt://BROKER_IP:1883"
INFLUX_HOST="INFLUX_IP"
INFLUX_PORT="8086"
INFLUX_DATABASE="machine_db"
```

Install backend dependencies and generate Prisma Client:

```bash
npm ci --omit=dev
npx prisma generate
```

Build frontend:

```bash
cd ../fontend
npm ci
npm run build
```

Start PM2 from the project root:

```bash
cd ..
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 3. Repeat Deployment

Use this flow when a new version has passed GitHub Actions and needs to be deployed.

```bash
cd MMS_project
git pull

cd backend
npm ci --omit=dev
npx prisma generate

cd ../fontend
npm ci
npm run build

cd ..
pm2 restart mms-dashboard-api --update-env
pm2 save
```

Or run the deployment helper from the project root:

```bash
bash scripts/deploy_pm2.sh
```

This helper performs:

1. `git pull --ff-only origin main`
2. backend `npm ci --omit=dev`
3. backend `npm run prisma:generate`
4. frontend `npm ci`
5. frontend `npm run build`
6. `pm2 restart mms-dashboard-api --update-env` or first-time `pm2 start ecosystem.config.js`
7. `/api/health` verification

## 4. Automatic CD with GitHub Actions and SSH

This project supports SSH-based CD from GitHub Actions. The flow is:

```mermaid
flowchart LR
  Push["git push to main"] --> CI["CI: test and build"]
  CI --> DeployJob["deploy-production job"]
  DeployJob --> SSH["SSH to customer server"]
  SSH --> Pull["git pull on server"]
  Pull --> Build["npm ci + prisma generate + frontend build"]
  Build --> PM2["pm2 restart"]
  PM2 --> Health["curl /api/health"]
```

The deploy job runs only after the `test-and-build` CI job passes. If SSH secrets are not configured, the deploy job skips deployment and prints which secrets are missing.

Add these repository secrets in GitHub:

```text
Settings > Secrets and variables > Actions > New repository secret
```

Required secrets:

| Secret | Example | Meaning |
| --- | --- | --- |
| `DEPLOY_HOST` | `203.0.113.10` | Public IP, DNS name, or VPN-reachable host of the customer server. |
| `DEPLOY_USER` | `deploy` | SSH username on the customer server. |
| `DEPLOY_PATH` | `/opt/MMS_project` | Absolute path of the cloned project on the customer server. |
| `SSH_PRIVATE_KEY` | private key text | Private key that can SSH into `DEPLOY_USER@DEPLOY_HOST`. |

Optional secrets:

| Secret | Example | Meaning |
| --- | --- | --- |
| `DEPLOY_PORT` | `22` | SSH port. Defaults to `22` if empty. |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan` | Pinned SSH host key. If empty, GitHub Actions runs `ssh-keyscan` during deployment. |

### Create SSH Key for Deployment

On your development machine:

```bash
ssh-keygen -t ed25519 -C "mms-github-actions-deploy" -f ~/.ssh/mms_github_actions
```

Put the public key on the customer server:

```bash
cat ~/.ssh/mms_github_actions.pub
```

Add that public key into:

```text
~/.ssh/authorized_keys
```

Copy the private key content into GitHub secret `SSH_PRIVATE_KEY`:

```bash
cat ~/.ssh/mms_github_actions
```

### Prepare the Customer Server

The project must already be cloned once on the customer server:

```bash
git clone https://github.com/apiwatapply-svg/MMS_project.git /opt/MMS_project
cd /opt/MMS_project
```

Create `backend/.env`, install PM2, and run the first deployment manually:

```bash
npm install -g pm2
bash scripts/deploy_pm2.sh
```

After this, every push to `main` can deploy automatically when CI passes.

## 5. Verification After Deployment

Check PM2:

```bash
pm2 status
pm2 logs mms-dashboard-api
```

Check API health:

```bash
curl http://localhost:5005/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "mms-backend"
}
```

Open the dashboard:

```text
http://SERVER_IP:5005/
```

Verify these pages:

- `/oee_production/layout_dashboard`
- `/machine_working`
- `/oee_production/daily_report`
- `/oee_production/monthly_report`
- `/oee_production/machine_report`
- `/oee_production/machine_ng`

## 6. Rollback

If the new deployment has a problem, return to the previous commit and restart PM2.

```bash
git log --oneline -5
git switch main
git checkout PREVIOUS_COMMIT_SHA

cd backend
npm ci --omit=dev
npx prisma generate

cd ../fontend
npm ci
npm run build

cd ..
pm2 restart mms-dashboard-api --update-env
```

After the issue is fixed, switch back to `main`:

```bash
git switch main
```

## 7. Troubleshooting

Port is already used:

```bash
pm2 stop mms-dashboard-api
netstat -ano | findstr :5005
```

Prisma cannot connect:

- Check `DATABASE_URL`.
- Check SQL Server firewall.
- Check SQL Server TCP/IP is enabled.
- Check username/password and database name.

Machine data is not updating:

- Check `ENABLE_MACHINE_IO=true`.
- Check MQTT broker URL and network route.
- Check InfluxDB host, port, and database.
- Check backend logs with `pm2 logs mms-dashboard-api`.

Frontend route shows blank or old page:

- Re-run `cd fontend && npm run build`.
- Restart PM2.
- Clear browser cache if needed.
