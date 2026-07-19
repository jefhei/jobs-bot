# 🎯 JobPulse

**Intelligent Job Aggregation & Monitoring Platform**

JobPulse is a TypeScript monorepo that searches, monitors, and notifies you about job listings across multiple platforms — LinkedIn, Indeed, Greenhouse, and Lever — all at once. Built for job seekers and recruiters who want real-time, deduplicated job intelligence delivered to Telegram, email, or webhooks.

---

## 📋 Table of Contents

- [✨ Overview](#-overview)
- [🏗️ Architecture](#️-architecture)
- [⚡ Quick Start](#-quick-start)
- [🔧 Configuration Reference](#-configuration-reference)
- [🤖 Telegram Bot Commands](#-telegram-bot-commands)
- [💻 CLI Usage](#-cli-usage)
- [📁 Project Structure](#-project-structure)
- [🧪 Development](#-development)
- [📄 License & Contributing](#-license--contributing)

---

## ✨ Overview

| Feature | Description |
|---|---|
| **Multi-Source Search** | Query LinkedIn, Indeed, Greenhouse, and Lever simultaneously |
| **Persistent Monitors** | Create keyword watches that poll on configurable intervals (default: 30 min) |
| **Smart Dedup** | SHA-256 fingerprinting with 30-day Redis TTL eliminates duplicates across runs |
| **Telegram Bot** | Interactive bot with inline buttons — Save, Apply, Dismiss, Similar |
| **Multi-Channel Alerts** | Notify via Telegram, email, or custom webhook |
| **Daily Digest** | Summarize new matches during quiet hours |
| **Fail-Open** | Individual source errors never block other sources |
| **Degradation Detection** | Auto-skip sources after 3 consecutive failures, with ops alerting |
| **Throttled Notifications** | Per-user, per-channel rate limits prevent spam (configurable alerts/hour) |
| **CLI Tool** | Full-featured terminal interface with colorized tables, JSON/CSV export |

**Target Audience:**

- **Job Seekers** — Monitor multiple platforms with one bot, get instant alerts for matching roles
- **Recruiters** — Track market activity across companies and platforms
- **Data Analysts** — Export structured job data via JSON/CSV for analysis

---

## 🏗️ Architecture

JobPulse is a **monorepo with 4 npm workspaces** that communicate through a shared data layer and a job queue.

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Telegram    │     │   Fastify    │     │     CLI      │
│    Bot       │────▶│   REST API   │     │  (Commander) │
│  (bot/)      │     │  (shared/)   │     │    (cli/)    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                     │
       │         ┌──────────┴──────────┐          │
       │         │     Shared Core      │          │
       │         │  ┌────────────────┐  │          │
       │         │  │  Prisma ORM    │  │          │
       ├─────────┤  │  Redis Client  │  ├──────────┤
       │         │  │  Source Adapters│  │          │
       │         │  │  Dedup Engine  │  │          │
       │         │  └────────────────┘  │          │
       │         └──────────┬───────────┘          │
       │                    │                      │
       │        ┌───────────┴────────────┐         │
       │        │     BullMQ Queue        │         │
       │        │    (Redis-backed)      │         │
       │        └───────────┬────────────┘         │
       │                    │                      │
       │         ┌──────────┴───────────┐          │
       │         │   Monitor Service    │          │
       │         │  ┌────────────────┐  │          │
       └─────────┤  │  Scheduler     │  │          │
                 │  │  Poller Worker │  │          │
                 │  │  Dispatcher    │  │          │
                 │  │  Alerter       │  │          │
                 │  └────────────────┘  │          │
                 └──────────────────────┘          │
```

**Data Flow:**
1. **Bot / CLI / API** — Users create `WatchConfig`s (keyword + filters + sources)
2. **Scheduler** — BullMQ `JobScheduler` enqueues poll jobs per active WatchConfig with randomized jitter
3. **Poller Worker** — Calls source adapters (Indeed, Greenhouse, Lever, LinkedIn), deduplicates via Redis SHA-256 fingerprints, upserts `JobListing` + `JobMatch` in PostgreSQL
4. **Dispatcher** — Sends notifications via Telegram/email/webhook with per-user throttling
5. **Inline Actions** — Users Save/Apply/Dismiss jobs directly from Telegram inline buttons

**Key Patterns:**
- **Fail-Open** — `Promise.allSettled` across sources; errors captured per-source
- **Exponential Backoff** — Poll retries at 5, 10, 30 min intervals (max 3 attempts)
- **Graceful Shutdown** — SIGTERM/SIGINT handlers across all services

---

## ⚡ Quick Start

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Docker** & **Docker Compose** (for PostgreSQL 16 + Redis 7)
- **npm** 9+

### Setup

```bash
# 1. Clone and install dependencies
git clone <repo-url> jobpulse
cd jobpulse
npm install

# 2. Start PostgreSQL and Redis
docker compose up -d

# 3. Initialize the database schema
npx prisma migrate dev --name init --schema=shared/src/schemas/schema.prisma

# 4. Create your .env file
cat > .env << 'EOF'
DATABASE_URL=postgresql://jobpulse:jobpulse@localhost:5432/jobpulse
REDIS_URL=redis://localhost:6379
BOT_TOKEN=your_telegram_bot_token_here
BOT_MODE=polling
API_PORT=3001
EOF

# 5. Build all packages
npm run build
```

### Running Components

You can run any component individually or all together:

```bash
# Start the Telegram bot (polling mode)
node bot/dist/index.js

# Start the monitor service (scheduler + poller + dispatcher)
node monitor/dist/index.js

# Start the REST API server
node -e "require('@jobpulse/shared').startApiServer()"

# Use the CLI
node cli/dist/index.js search "software engineer" --location "Remote"
```

Or use the provided scripts from `package.json`:

```bash
npm run build       # Build all workspaces
npm test            # Run all test suites
npm run typecheck   # Type-check all workspaces
```

### First Run with Telegram

1. Talk to [@BotFather](https://t.me/BotFather) on Telegram to create a bot and get your `BOT_TOKEN`
2. Set `BOT_TOKEN` and `BOT_MODE=polling` in `.env`
3. Start the bot component
4. Open Telegram, find your bot, and send `/start`

---

## 🔧 Configuration Reference

All configuration is via environment variables. Copy `.env.example` or create your own.

### Core

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://jobpulse:***@localhost:5432/jobpulse` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |

### Telegram Bot

| Variable | Default | Description |
|---|---|---|
| `BOT_TOKEN` | _(required)_ | Telegram Bot API token from [@BotFather](https://t.me/BotFather) |
| `BOT_MODE` | `polling` | Operation mode: `polling` or `webhook` |
| `BOT_WEBHOOK_URL` | — | Public HTTPS URL for webhook mode (required if `BOT_MODE=webhook`) |
| `BOT_WEBHOOK_PORT` | `8443` | Port for webhook HTTP server |
| `BOT_LISTEN_PORT` | `3000` | Bot health/listen port |

### API Server

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `3001` | Fastify REST API port |

### Monitor Service

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Monitor service port |
| `POLL_QUEUE_NAME` | `job-polls` | BullMQ queue name for poll jobs |
| `MAX_CONCURRENT_POLLS` | `5` | Max concurrent poll worker jobs |
| `HEALTH_CHECK_PORT` | `9090` | Health check HTTP server port |
| `NODE_ENV` | `development` | Environment (`development` / `production`) |
| `LOG_LEVEL` | `info` | Log verbosity |

### Source Adapters

| Variable | Description |
|---|---|
| `INDEED_API_KEY` | Indeed Publisher API key |
| `GREENHOUSE_BOARD_TOKENS` | Comma-separated Greenhouse board tokens |
| `LEVER_COMPANY_IDS` | Comma-separated Lever company IDs |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn OAuth access token (API mode) |

> **Note:** If no LinkedIn token is set, the adapter falls back to web scraping with a browser User-Agent header.

### Notifications

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | — | SMTP server hostname for email notifications |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `OPS_WEBHOOK_URL` | — | Webhook URL for ops alerts (source degradation, etc.) |

---

## 🤖 Telegram Bot Commands

| Command | Description | Usage |
|---|---|---|
| `/start` | Welcome message and setup guide | `/start` |
| `/search <query> [in <location>]` | One-time job search across all sources | `/search software engineer in Remote` |
| `/watch <keyword> [in <location>]` | Create a persistent job monitor | `/watch react developer in San Francisco` |
| `/list` | Show all active watches | `/list` |
| `/remove` | Remove a watch (interactive) | `/remove` |
| `/digest` | Get a daily digest of new matches | `/digest` |
| `/pause` | Pause or resume all active watches | `/pause` |
| `/sources` | List available job sources and their status | `/sources` |
| `/filters` | Show active filters for your searches | `/filters` |

### Inline Buttons

When job results are displayed, inline keyboard buttons are available:

| Button | Action |
|---|---|
| 💾 **Save** | Bookmark the job for later |
| 🔗 **Apply** | Open the job application URL |
| ❌ **Dismiss** | Hide this job permanently |
| 🔍 **Similar** | Search for similar positions |
| ⬅️ / ➡️ | Paginate through results |
| 🔄 **Refresh** | Re-fetch current page of results |

---

## 💻 CLI Usage

The CLI is the `jobpulse` command, built with [Commander.js](https://github.com/tj/commander.js).

```
jobpulse <command> [options]
```

### `jobpulse search`

Search all job sources simultaneously.

```bash
jobpulse search "software engineer"
jobpulse search "react developer" --location "Remote"
jobpulse search "product manager" --type fulltime --salary 100000
jobpulse search "data scientist" --sources linkedin,indeed --json
jobpulse search "designer" --csv > jobs.csv
```

| Flag | Description |
|---|---|
| `-l, --location <location>` | Filter by location |
| `-t, --type <type>` | Job type: `fulltime`, `parttime`, `contract`, `internship` |
| `-s, --salary <salary>` | Minimum salary filter |
| `--sources <sources>` | Comma-separated source list (e.g., `linkedin,indeed`) |
| `--json` | Output as JSON |
| `--csv` | Output as CSV |

### `jobpulse watch`

Manage persistent job monitors.

```bash
jobpulse watch add "software engineer" --location "Remote" --type fulltime
jobpulse watch add "react developer" --dry-run     # Preview without saving
jobpulse watch list                                  # Show all watches
jobpulse watch remove 1                             # Remove watch by ID
```

| Flag | Description |
|---|---|
| `-l, --location <location>` | Location filter |
| `-t, --type <type>` | Job type filter |
| `-s, --salary <salary>` | Minimum salary |
| `--sources <sources>` | Comma-separated sources |
| `--interval <minutes>` | Polling interval (default: 30) |
| `--dry-run` | Preview without saving |

### `jobpulse sources`

List and test job source connectivity.

```bash
jobpulse sources list                    # Show all sources and their status
jobpulse sources test linkedin           # Test connectivity for a specific source
```

### `jobpulse config`

Manage CLI configuration (stored in `~/.jobpulse/config.json`).

```bash
jobpulse config set api_key abc123       # Set a config value
jobpulse config get api_key              # Get a config value
```

### `jobpulse auth`

Authenticate with the JobPulse backend.

```bash
jobpulse auth login <api-key>            # Login with API key
jobpulse auth status                     # Show auth status
jobpulse auth logout                     # Logout and clear credentials
```

---

## 📁 Project Structure

```
jobpulse/
├── package.json                    # Monorepo root (npm workspaces)
├── tsconfig.base.json              # Shared TypeScript config
├── vitest.config.ts                # Vitest test runner config
├── docker-compose.yml              # PostgreSQL 16 + Redis 7
├── .env                            # Environment variables
│
├── shared/                         # @jobpulse/shared — common library
│   ├── package.json
│   ├── src/
│   │   ├── index.ts                # Re-exports all public API
│   │   ├── types.ts                # Core types (JobSource, NormalizedJob, etc.)
│   │   ├── db.ts                   # Prisma client (singleton, Neon adapter)
│   │   ├── redis.ts                # Redis client (ioredis singleton)
│   │   ├── dedup.ts                # SHA-256 fingerprint + 30-day Redis TTL
│   │   ├── api.ts                  # Fastify REST API (POST/GET/DELETE /api/watch)
│   │   ├── adapters/
│   │   │   ├── base.ts             # Abstract base class + SearchOptions
│   │   │   ├── index.ts            # Adapter registry + searchAllSources()
│   │   │   ├── indeed.ts           # Indeed Publisher API adapter
│   │   │   ├── greenhouse.ts       # Greenhouse Boards API adapter
│   │   │   ├── lever.ts            # Lever API adapter
│   │   │   └── linkedin.ts         # LinkedIn API + web scrape adapter
│   │   ├── schemas/
│   │   │   └── schema.prisma       # Prisma schema (User, WatchConfig, etc.)
│   │   └── __tests__/              # Unit tests
│   └── dist/                       # Compiled output
│
├── bot/                            # @jobpulse/bot — Telegram bot
│   ├── package.json
│   ├── src/
│   │   ├── index.ts                # Entry: webhook or polling, graceful shutdown
│   │   ├── config.ts               # BotConfig loader (BOT_TOKEN, BOT_MODE, etc.)
│   │   ├── queue.ts                # BullMQ poll queue client
│   │   ├── commands/
│   │   │   ├── start.ts            # /start — welcome + user registration
│   │   │   ├── search.ts           # /search — one-time job search
│   │   │   ├── watch.ts            # /watch — create WatchConfig + enqueue poll
│   │   │   ├── list.ts             # /list — active watches
│   │   │   ├── remove.ts           # /remove — delete a watch
│   │   │   ├── digest.ts           # /digest — daily digest
│   │   │   ├── pause.ts            # /pause — pause/resume watches
│   │   │   ├── sources.ts          # /sources — list available sources
│   │   │   └── filters.ts          # /filters — show active filters
│   │   ├── handlers/
│   │   │   └── inline.ts           # Inline button handlers (Save/Apply/Dismiss/Similar)
│   │   └── __tests__/              # Unit tests
│   └── dist/
│
├── monitor/                        # @jobpulse/monitor — cron/poller service
│   ├── package.json
│   ├── src/
│   │   ├── index.ts                # Entry: Prisma connect, Redis check, queue init
│   │   ├── config.ts               # MonitorConfig loader
│   │   ├── scheduler.ts            # BullMQ JobScheduler with randomized jitter
│   │   ├── poller.ts               # Worker: fetch sources, dedup, store jobs
│   │   ├── dispatcher.ts           # Notify via Telegram/email/webhook + throttling
│   │   ├── alerts.ts               # Source degradation tracking + ops alerting
│   │   └── __tests__/              # Unit tests
│   └── dist/
│
├── cli/                            # @jobpulse/cli — terminal tool
│   ├── package.json
│   ├── src/
│   │   ├── index.ts                # Commander.js entry point
│   │   ├── commands/
│   │   │   ├── search.ts           # jobpulse search (colorized tables, JSON, CSV)
│   │   │   ├── watch.ts            # jobpulse watch (add/list/remove, --dry-run)
│   │   │   ├── sources.ts          # jobpulse sources (list/test)
│   │   │   ├── config.ts           # jobpulse config (set/get)
│   │   │   └── auth.ts             # jobpulse auth (login/status/logout)
│   │   └── __tests__/              # Unit tests
│   └── dist/
│
└── node_modules/                   # Shared dependencies
```

### Prisma Data Model

```
User
├── telegramId? (unique)
├── email? (unique)
├── apiKey? (unique)
├── watchConfigs[]
└── notificationSettings[]

WatchConfig
├── userId ──────────→ User
├── keyword
├── location?
├── jobType?
├── minSalary?
├── experienceLevel?
├── sources[]         (e.g., ["linkedin", "indeed"])
├── intervalMinutes   (default: 30)
├── notifyVia[]       (default: ["telegram"])
├── active
├── lastPolledAt?
└── jobMatches[]

JobListing
├── id                (fingerprint: "source:sourceId")
├── source
├── title
├── company
├── location?
├── type?
├── salaryMin?
├── salaryMax?
├── postedAt
├── url
├── descriptionSnippet?
├── tags[]
└── matchedTo[]

JobMatch (unique on [jobId, watchConfigId])
├── jobId ────────────→ JobListing
├── watchConfigId ────→ WatchConfig
├── notifiedAt?
├── dismissed
├── saved
└── createdAt

NotificationSetting (unique on [userId, channel])
├── userId ───────────→ User
├── channel            (telegram | email | webhook)
├── enabled
└── throttlePerHour    (default: 20)
```

---

## 🧪 Development

### Scripts

```bash
npm run build          # Build all workspaces
npm test               # Run all test suites with Vitest
npm run typecheck      # Type-check all workspaces (tsc --noEmit)
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests for a specific workspace
npx vitest run --project shared
npx vitest run --project bot
npx vitest run --project monitor
npx vitest run --project cli

# Watch mode during development
npx vitest
```

### Adding a New Source Adapter

1. Create a new file `shared/src/adapters/<name>.ts`
2. Extend `BaseSourceAdapter` (from `shared/src/adapters/base.ts`):
   ```typescript
   import { BaseSourceAdapter } from './base';
   import { NormalizedJob, JobSource } from '../types';

   export class MyAdapter extends BaseSourceAdapter {
     constructor() {
       super({ name: 'my-source', baseUrl: 'https://api.example.com' });
     }

     async search(query: string, options?: SearchOptions): Promise<NormalizedJob[]> {
       // Fetch and normalize jobs from your source
     }

     async testConnection(): Promise<boolean> {
       // Verify API connectivity
     }
   }
   ```
3. Register your adapter in `shared/src/adapters/index.ts`:
   - Add the import
   - Add a case to the `createAdapter()` switch
   - Optionally add it to `DEFAULT_SOURCES`
4. Update the `JobSource` union type in `shared/src/types.ts`
5. Add the corresponding environment variable key to the CLI's `sources.ts` command
6. Write tests in `shared/src/__tests__/<name>.test.ts`

### Working with Prisma

```bash
# Generate Prisma client after schema changes
npx prisma generate --schema=shared/src/schemas/schema.prisma

# Create a new migration
npx prisma migrate dev --name <migration-name> --schema=shared/src/schemas/schema.prisma

# Open Prisma Studio (GUI for your database)
npx prisma studio --schema=shared/src/schemas/schema.prisma
```

### Debugging

- **Monitor logs** — All monitor components log with `[@jobpulse/monitor]` prefix
- **Bot logs** — Bot logs with `[@jobpulse/bot]` prefix
- **Redis** — Check Redis keys: `redis-cli keys '*'` (fingerprints stored as SHA-256 hashes, 30-day TTL)
- **BullMQ** — Queue named `job-polls`; inspect with `redis-cli llen bull:job-polls:wait`
- **Health Check** — Monitor exposes health at `http://localhost:9090`

---

## 📄 License & Contributing

### License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

### Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork** the repository
2. **Branch** from `main` (`git checkout -b feature/my-feature`)
3. **Develop** with tests — ensure `npm test` and `npm run typecheck` pass
4. **Commit** with clear, descriptive messages
5. **Open a Pull Request** against `main`

**Development priorities:**
- Additional source adapters (Glassdoor, Workday, Hacker News, Remote.co types are already defined)
- Email notification delivery (placeholder dispatcher)
- OAuth device flow for CLI authentication
- Enhanced similarity search for the "Similar" inline button
- Dashboard / web UI

---

> Built with ❤️ using TypeScript, Node.js, PostgreSQL, Redis, and BullMQ.
