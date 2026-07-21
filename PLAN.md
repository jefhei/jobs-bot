# JobPulse — Full Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Build a three-component job intelligence platform — Telegram Bot, Cron Monitor, CLI Tool — for automated job discovery, aggregation, and monitoring across multiple job boards.

**Architecture:** Monorepo with three packages (bot/, monitor/, cli/) sharing a common core (database schema, job schema, source adapters). PostgreSQL for persistence, Redis for dedup/queue, BullMQ for scheduling. Deployed via containers.

**Tech Stack:** Node.js (Bot + CLI + Monitor), TypeScript, PostgreSQL + Prisma, Redis + BullMQ, Fastify (internal API), Commander.js (CLI), node-telegram-bot-api.

---

## Phase 0: Project Scaffolding

### Task 0.1: [x] Initialize monorepo with package structure

**Objective:** Create the monorepo skeleton with workspaces, TypeScript config, and directory layout.

**Files:**
- Create: `package.json` (root — workspace config)
- Create: `tsconfig.base.json`
- Create: `bot/package.json`
- Create: `monitor/package.json`
- Create: `cli/package.json`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `.gitignore` (exists — update if needed)

**Directory structure:**
```
jobs-bot/
├── package.json              # workspace root
├── tsconfig.base.json
├── .gitignore
├── shared/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── types.ts           # Job, WatchConfig, Source enums
│       ├── schemas/           # Prisma schema lives here
│       │   └── schema.prisma
│       └── adapters/          # Source adapters
│           ├── index.ts
│           ├── base.ts
│           ├── indeed.ts
│           ├── greenhouse.ts
│           ├── lever.ts
│           └── linkedin.ts
├── bot/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── commands/
│       └── handlers/
├── monitor/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── scheduler.ts
│       ├── poller.ts
│       └── dispatcher.ts
└── cli/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts
        └── commands/
```

**Commands:**
```bash
cd /opt/data/jobs-bot
npm init -w shared -y
npm init -w bot -y
npm init -w monitor -y
npm init -w cli -y
```

**Package.json workspace config (root):**
```json
{
  "name": "jobpulse",
  "private": true,
  "workspaces": ["shared", "bot", "monitor", "cli"]
}
```

---

### Task 0.2: [x] Install core dependencies

**Objective:** Install TypeScript, Prisma, Redis client, and dev tooling across all packages.

**Root devDeps:**
- typescript, ts-node, @types/node
- vitest (testing)

**Shared deps:**
- @prisma/client, prisma
- ioredis (Redis client)
- axios (HTTP for source adapters)

**Bot deps:**
- node-telegram-bot-api
- @types/node-telegram-bot-api

**Monitor deps:**
- bullmq (job queue)
- ioredis (already in shared, but bullmq uses its own connection)

**CLI deps:**
- commander
- chalk, cli-table3 (terminal rendering)

**Commands:**
```bash
cd /opt/data/jobs-bot
npm install -D typescript ts-node @types/node vitest
npm install -w shared @prisma/client prisma ioredis axios
npm install -w bot node-telegram-bot-api
npm install -w monitor bullmq
npm install -w cli commander chalk cli-table3
```

---

### Task 0.3: [x] Set up Prisma schema

**Objective:** Define the database schema for users, watch configs, and job history.

**File:** `shared/src/schemas/schema.prisma`

**Schema:**
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String   @id @default(cuid())
  telegramId    String?  @unique
  email         String?  @unique
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  watchConfigs  WatchConfig[]
  notificationSettings NotificationSetting[]
}

model WatchConfig {
  id               String   @id @default(cuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id])
  keyword          String
  location         String?
  jobType          String?  // fulltime | parttime | contract | internship
  minSalary        Int?
  experienceLevel  String?  // entry | mid | senior | lead | exec
  sources          String[] // e.g. ["linkedin", "indeed"]
  intervalMinutes  Int      @default(30)
  notifyVia        String[] @default(["telegram"])
  active           Boolean  @default(true)
  lastPolledAt     DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model JobListing {
  id              String   @id
  source          String
  title           String
  company         String
  location        String?
  type            String?
  salaryMin       Int?
  salaryMax       Int?
  postedAt        DateTime
  url             String
  descriptionSnippet String?
  tags            String[]
  createdAt       DateTime @default(now())
  matchedTo       JobMatch[]
}

model JobMatch {
  id            String      @id @default(cuid())
  jobId         String
  job           JobListing  @relation(fields: [jobId], references: [id])
  watchConfigId String
  watchConfig   WatchConfig @relation(fields: [watchConfigId], references: [id])
  notifiedAt    DateTime?
  dismissed     Boolean     @default(false)
  createdAt     DateTime    @default(now())
  saved         Boolean     @default(false)

  @@unique([jobId, watchConfigId])
}

model NotificationSetting {
  id        String @id @default(cuid())
  userId    String
  user      User   @relation(fields: [userId], references: [id])
  channel   String // telegram | email | webhook
  enabled   Boolean @default(true)
  throttlePerHour Int @default(20)
}
```

---

### Task 0.4: [x] Define shared TypeScript types

**Objective:** Create the core type definitions used across all packages.

**File:** `shared/src/types.ts`

**Types to define:**
- `JobSource` enum: linkedin, indeed, greenhouse, lever, glassdoor, workday, hn, remoteco
- `JobType` enum: fulltime, parttime, contract, internship
- `ExperienceLevel` enum: entry, mid, senior, lead, exec
- `NotifyChannel` enum: telegram, email, webhook
- `JobListing` interface (matches schema + `fingerprint` for dedup)
- `WatchConfigInput` interface (what user provides to create a watch)
- `NormalizedJob` interface (after source adapter normalizes)
- `SearchQuery` interface (for CLI / bot search)
- `SearchResult` interface (results + metadata per source)

---

### Task 0.5: [x] Set up Docker Compose for local dev

**Objective:** Provide docker-compose.yml with PostgreSQL and Redis for local development.

**File:** `docker-compose.yml` (root)

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: jobpulse
      POSTGRES_USER: jobpulse
      POSTGRES_PASSWORD: jobpulse
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

---

## Phase 1: Shared Core

### Task 1.1: [x] Create Prisma client wrapper

**Objective:** Export a singleton Prisma client for use across all packages.

**File:** `shared/src/db.ts`

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
```

---

### Task 1.2: [x] Create Redis client wrapper

**Objective:** Export a singleton Redis client for dedup fingerprint storage.

**File:** `shared/src/redis.ts`

```typescript
import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis: Redis };

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis =
  globalForRedis.redis || new Redis(REDIS_URL, { maxRetriesPerRequest: null });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

export default redis;
```

---

### Task 1.3: [x] Implement Job deduplication utility

**Objective:** Generate SHA-256 fingerprints for (userId + jobId + source) and manage 30-day TTL in Redis.

**File:** `shared/src/dedup.ts`

```typescript
import { createHash } from "crypto";
import { redis } from "./redis";

const DEDUP_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

export function makeFingerprint(userId: string, jobId: string, source: string): string {
  return createHash("sha256")
    .update(`${userId}:${jobId}:${source}`)
    .digest("hex");
}

export async function isDuplicate(userId: string, jobId: string, source: string): Promise<boolean> {
  const fp = makeFingerprint(userId, jobId, source);
  const exists = await redis.get(fp);
  return exists !== null;
}

export async function markSeen(userId: string, jobId: string, source: string): Promise<void> {
  const fp = makeFingerprint(userId, jobId, source);
  await redis.setex(fp, DEDUP_TTL, "1");
}
```

---

### Task 1.4: [x] Implement base source adapter interface

**Objective:** Define the abstract base class all source adapters implement.

**File:** `shared/src/adapters/base.ts`

```typescript
import { NormalizedJob, JobSource } from "../types";

export interface SourceAdapterConfig {
  name: JobSource;
  baseUrl: string;
  rateLimitPerMin?: number;
  retryCount?: number;
}

export abstract class BaseSourceAdapter {
  public readonly config: SourceAdapterConfig;

  constructor(config: SourceAdapterConfig) {
    this.config = config;
  }

  abstract search(
    query: string,
    options?: SearchOptions
  ): Promise<NormalizedJob[]>;

  abstract testConnection(): Promise<boolean>;
}

export interface SearchOptions {
  location?: string;
  jobType?: string;
  minSalary?: number;
  experienceLevel?: string;
}
```

---

### Task 1.5: [x] Implement Indeed source adapter

**Objective:** Fetch jobs from Indeed Publisher API, normalize to Job schema.

**File:** `shared/src/adapters/indeed.ts`

- Extends BaseSourceAdapter
- Uses Indeed Publisher API (requires INDEED_API_KEY env var)
- Normalizes results to NormalizedJob format
- Handles pagination (up to 25 results per request)
- Error handling with exponential backoff

---

### Task 1.6: [x] Implement Greenhouse source adapter

**Objective:** Fetch jobs from Greenhouse public Job Board API.

**File:** `shared/src/adapters/greenhouse.ts`

- Extends BaseSourceAdapter
- Uses Greenhouse Job Board API (no auth required for public boards)
- Boards configured via GREENHOUSE_BOARD_TOKENS env var
- Normalizes to NormalizedJob

---

### Task 1.7: [x] Implement Lever source adapter

**Objective:** Fetch jobs from Lever public Job Postings API.

**File:** `shared/src/adapters/lever.ts`

- Extends BaseSourceAdapter
- Uses Lever Job Postings API (no auth required)
- Companies configured via LEVER_COMPANY_IDS env var
- Normalizes to NormalizedJob

---

### Task 1.8: [x] Implement LinkedIn source adapter (scrape fallback)

**Objective:** Fetch jobs from LinkedIn — attempt official API first, fall back to polite scraping.

**File:** `shared/src/adapters/linkedin.ts`

- Extends BaseSourceAdapter
- Attempts LinkedIn Jobs API v2 with OAuth token
- Falls back to HTML scrape with 10s request interval per domain
- Respects robots.txt

---

### Task 1.9: [x] Implement source adapter registry

**Objective:** Provide a factory that returns the right adapter for a given source name.

**File:** `shared/src/adapters/index.ts`

```typescript
import { JobSource } from "../types";
import { BaseSourceAdapter } from "./base";
import { IndeedAdapter } from "./indeed";
import { GreenhouseAdapter } from "./greenhouse";
import { LeverAdapter } from "./lever";
import { LinkedInAdapter } from "./linkedin";

const adapters = new Map<JobSource, BaseSourceAdapter>();

export function getAdapter(source: JobSource): BaseSourceAdapter {
  if (!adapters.has(source)) {
    switch (source) {
      case "indeed":
        adapters.set(source, new IndeedAdapter());
        break;
      case "greenhouse":
        adapters.set(source, new GreenhouseAdapter());
        break;
      case "lever":
        adapters.set(source, new LeverAdapter());
        break;
      case "linkedin":
        adapters.set(source, new LinkedInAdapter());
        break;
      default:
        throw new Error(`Unknown source: ${source}`);
    }
  }
  return adapters.get(source)!;
}

export function searchAllSources(
  query: string,
  options?: any,
  sources?: JobSource[]
): Promise<{ source: JobSource; jobs: NormalizedJob[]; error?: string }[]> {
  const sourceList = sources || (["indeed", "greenhouse", "lever", "linkedin"] as JobSource[]);
  return Promise.allSettled(
    sourceList.map(async (source) => {
      try {
        const adapter = getAdapter(source);
        const jobs = await adapter.search(query, options);
        return { source, jobs };
      } catch (err) {
        return { source, jobs: [], error: (err as Error).message };
      }
    })
  ).then((results) =>
    results.map((r) =>
      r.status === "fulfilled" ? r.value : { source: "unknown" as JobSource, jobs: [], error: r.reason?.message }
    )
  );
}
```

---

## Phase 2: Cron Monitor

### Task 2.1: [x] Create monitor entry point and configuration

**Objective:** Set up the monitor process that reads WatchConfigs from DB and schedules polls.

**File:** `monitor/src/index.ts`

- Load config from env vars
- Connect to Prisma + Redis
- Initialize BullMQ queue
- Start scheduler (see Task 2.2)
- Handle graceful shutdown (SIGTERM/SIGINT)

---

### Task 2.2: [x] Implement BullMQ scheduler

**Objective:** Schedule polling jobs for active WatchConfigs based on their intervalMinutes.

**Files:**
- Create: `monitor/src/scheduler.ts`
- Create: `monitor/src/__tests__/scheduler.test.ts`

- Uses BullMQ JobScheduler (v5 API)
- On startup: loads all active WatchConfigs from DB, schedules jobs for each
- Randomized jitter (0–120s) offset to avoid rate limit spikes
- Exports: startScheduler, stopScheduler, scheduleWatch, removeWatchSchedule

---

### Task 2.3: [x] Implement poller worker

**Objective:** Process queue jobs — fetch listings from source adapters, deduplicate, store new matches.

**File:** `monitor/src/poller.ts`

- BullMQ Worker that processes each poll job
- Calls the appropriate source adapter(s) for the WatchConfig
- Deduplicates via Redis fingerprint (shared/src/dedup.ts)
- Stores new JobListing + JobMatch in PostgreSQL
- Emits structured log per poll cycle: source, keyword, location, results_count, new_count, latency_ms
- Retry: exponential backoff (5/10/30 min), max 3 retries
- After 3 consecutive failures: flags source as degraded

---

### Task 2.4: [x] Implement notification dispatcher

**Objective:** Send new job matches to the user's configured notification channels.

**File:** `monitor/src/dispatcher.ts`

- Telegram dispatcher: sends formatted message to user via Telegram Bot API
- Email dispatcher: sends via SMTP (configurable)
- Webhook dispatcher: POSTs to user-configured webhook URL
- Per-user throttling: max N alerts/hour (configurable in NotificationSetting)
- Respects Telegram rate limits: 1 msg/sec per chat, 30/sec globally
- On failure: queues for retry (max 3)

---

### Task 2.5: [x] Implement failure alerting (ops channel)

**Objective:** Alert ops if any source fails more than 3 consecutive polls.

**File:** `monitor/src/alerts.ts`

- Tracks consecutive failures per source in Redis
- After 3 consecutive failures: sends alert (console log + optional webhook)
- On successful poll: resets counter for that source

---

## Phase 3: Telegram Bot

### Task 3.1: [x] Create bot entry point with webhook/polling

**Objective:** Set up the Telegram bot with webhook mode (fallback to polling).

**File:** `bot/src/index.ts`

- Uses node-telegram-bot-api
- Webhook mode preferred (response < 500ms)
- Polling fallback if webhook URL not configured
- Registers all command handlers
- Graceful shutdown

---

### Task 3.2: [x] Implement /start command

**Objective:** Onboarding flow — collect initial preferences and store user in DB.

**File:** `bot/src/commands/start.ts`

- Creates/updates User record in PostgreSQL
- Introduction message with available commands
- Optional: inline keyboard for quick source configuration

---

### Task 3.3: [x] Implement /search command

**Objective:** Natural-language one-time search across configured sources.

**File:** `bot/src/commands/search.ts`

- Parses query via simple NLP (keyword extraction: title, location)
- Calls searchAllSources from shared adapters
- Formats results with: title, company, location, salary, posted date, link
- Paginated results (5 per message)
- Includes inline keyboard: Save | Apply | Dismiss | Similar

---

### Task 3.4: [x] Implement /watch command

**Objective:** Add a persistent keyword monitor.

**File:** `bot/src/commands/watch.ts`

- Takes `<keyword> [location]` arguments
- Creates WatchConfig in PostgreSQL
- Notifies user that monitoring is active
- Returns the watch ID for later management

---

### Task 3.5: [x] Implement /list and /remove commands

**Objective:** Show and manage active watchers.

**File:** `bot/src/commands/list.ts`
**File:** `bot/src/commands/remove.ts`

- /list: shows all active watchers with ID, keyword, location, status, last polled
- /remove &lt;id&gt;: deactivates the watch and removes from scheduler

---

### Task 3.6: [x] Implement /digest command

**Objective:** Send a daily summary of all new matches from the last 24 hours.

**File:** `bot/src/commands/digest.ts`

- Aggregates JobMatch records from last 24h for the user
- Groups by watch config
- Sends a single formatted message with counts and top listings

---

### Task 3.7: [x] Implement /pause, /sources, /filters commands

**Objective:** Utility commands for managing alerts and preferences.

**File:** `bot/src/commands/pause.ts`
**File:** `bot/src/commands/sources.ts`
**File:** `bot/src/commands/filters.ts`

- /pause <duration>: temporarily silences all alerts (snooze mode)
- /sources: toggle which job sources are enabled
- /filters: set salary range, experience level, job type preferences

---

### Task 3.8: [x] Implement inline button handlers

**Objective:** Handle Save, Apply, Dismiss, Similar button callbacks on job listings.

**File:** `bot/src/handlers/inline.ts`

- Save: marks JobMatch.saved = true
- Apply: sends the direct URL to user in a private message
- Dismiss: marks JobMatch.dismissed = true (prevents future dedup so it won't re-appear)
- Similar: re-runs search with extracted keywords from the job title

---

## Phase 4: CLI Tool

### Task 4.1: [x] Create CLI entry point with Commander

**Objective:** Set up the CLI binary with command routing.

**File:** `cli/src/index.ts`

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { searchCommand } from "./commands/search";
import { watchCommand } from "./commands/watch";
import { sourcesCommand } from "./commands/sources";
import { configCommand } from "./commands/config";
import { authCommand } from "./commands/auth";

const program = new Command();

program
  .name("jobpulse")
  .description("Intelligent Job Aggregation & Monitoring CLI")
  .version("1.0.0");

program.addCommand(searchCommand);
program.addCommand(watchCommand);
program.addCommand(sourcesCommand);
program.addCommand(configCommand);
program.addCommand(authCommand);

program.parse(process.argv);
```

---

### Task 4.2: [x] Implement `jobpulse search` command

**Objective:** Search all sources and display results in terminal.

**File:** `cli/src/commands/search.ts`

- Positional: `<query>`
- Flags: `--location`, `--type`, `--salary`, `--sources`, `--json`, `--csv`
- Interactive mode: colorized table via cli-table3 + chalk
- Non-interactive: JSON or CSV output
- Respects $NO_COLOR env var
- Parallel source fetching with 5s per-source timeout (fail-open)
- Target: < 3 seconds for 4-source search

---

### Task 4.3: [x] Implement `jobpulse watch` command group

**Objective:** Manage persistent keyword monitors from CLI.

**File:** `cli/src/commands/watch.ts`

- `jobpulse watch add <query>`: registers new monitor (syncs to backend via REST API)
- `jobpulse watch list`: displays all active monitors
- `jobpulse watch remove <id>`: deletes monitor
- `--dry-run` flag on add: preview what would be monitored without saving

---

### Task 4.4: [x] Implement `jobpulse sources` and `config` commands

**Objective:** Manage source configuration and API keys.

**File:** `cli/src/commands/sources.ts`
**File:** `cli/src/commands/config.ts`

- `jobpulse sources list`: shows all sources + API status
- `jobpulse sources test <name>`: pings source and reports connectivity
- `jobpulse config set <key> <value>`: writes to ~/.jobpulse/config.json
- `jobpulse config get <key>`: reads config value
- API keys read from JOBPULSE_* env vars or config file

---

### Task 4.5: [x] Implement `jobpulse auth` command

**Objective:** Authenticate CLI with the JobPulse backend for watch sync.

**File:** `cli/src/commands/auth.ts`

- `jobpulse auth login`: OAuth device flow or API key auth
- `jobpulse auth status`: shows current auth state
- `jobpulse auth logout`: clears stored credentials

---

## Phase 5: Integration & Testing

### Task 5.1: [x] Wire up Bot → Monitor integration

**Objective:** When a user creates a watch via the bot, enqueue an immediate first poll in BullMQ.

**Files:**
- Modify: `bot/src/commands/watch.ts`
- Modify: `monitor/src/scheduler.ts`

- Bot sends BullMQ job via shared Redis connection
- Scheduler picks up the immediate job, then schedules recurring

---

### Task 5.2: [x] Wire up CLI → Backend API

**Objective:** CLI watch commands call a REST API (Fastify) to sync with the backend.

**File:** `shared/src/api.ts` (Fastify server)

- POST /api/watch — create watch
- GET /api/watch — list watches
- DELETE /api/watch/:id — remove watch
- Auth via API token or JWT

---

### Task 5.3: [x] Unit tests — dedup utility

**Objective:** Test fingerprint generation, duplicate detection, and TTL behavior.

**File:** `shared/src/__tests__/dedup.test.ts`

- Test identical inputs produce same fingerprint
- Test different inputs produce different fingerprints
- Test isDuplicate returns true after markSeen
- Test isDuplicate returns false for unseen jobs

---

### Task 5.4: [x] Unit tests — source adapter normalization

**Objective:** Test each source adapter correctly normalizes API responses.

**Files:**
- `shared/src/__tests__/indeed.test.ts`
- `shared/src/__tests__/greenhouse.test.ts`
- `shared/src/__tests__/lever.test.ts`

- Test with mock API responses
- Verify all NormalizedJob fields populated correctly
- Test error handling for malformed responses

---

### Task 5.5: [x] Integration test — end-to-end poll cycle

**Objective:** Test a full poll cycle: adapter fetches → dedup → store → notify.

**File:** `monitor/src/__tests__/poller.test.ts`

- Mock source adapter returns 3 jobs
- Verify 3 JobListings + JobMatches created in DB
- Run poll again — verify 0 new matches (all deduplicated)
- Verify notification dispatch called

---

### Task 5.6: Docker Compose setup verification

**Objective:** Verify the entire stack starts and integrates correctly.

**Commands:**
```bash
docker compose up -d
npx prisma migrate dev --name init
npx prisma db seed
npm run test
docker compose down
```

---

## Phase 6: Documentation & Deployment

### Task 6.1: [x] Write README.md

**File:** `README.md`

- Project overview
- Architecture diagram (ASCII or link)
- Quick start guide (Docker Compose)
- Configuration reference (env vars)
- CLI usage examples
- Bot command reference
- Contributing guide

### Task 6.2: [x] Write .env.example

**File:** `.env.example`

```bash
# Database
DATABASE_URL=postgresql://jobpulse:jobpulse@localhost:5432/jobpulse

# Redis
REDIS_URL=redis://localhost:6379

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Job Source APIs
INDEED_API_KEY=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
GREENHOUSE_BOARD_TOKENS=
LEVER_COMPANY_IDS=

# Notifications
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
NOTIFICATION_FROM=noreply@jobpulse.dev

# Ops Alerting
OPS_WEBHOOK_URL=
```

### Task 6.3: [x] Create Dockerfiles

**Files:**
- `bot/Dockerfile`
- `monitor/Dockerfile`
- `cli/Dockerfile`

Each Dockerfile installs deps, builds TypeScript, sets up the runtime.

### Task 6.4: Add CI/CD (GitHub Actions)

**File:** `.github/workflows/ci.yml`

- Runs on push/PR to main
- Steps: checkout, install deps, lint, type-check, test
- Matrix: latest Node LTS

---

## Summary

| Phase | Tasks | Est. Effort |
|-------|-------|-------------|
| 0: Scaffolding | 5 tasks | Small |
| 1: Shared Core | 9 tasks | Medium |
| 2: Cron Monitor | 5 tasks | Large |
| 3: Telegram Bot | 8 tasks | Large |
| 4: CLI Tool | 5 tasks | Medium |
| 5: Integration & Testing | 6 tasks | Medium |
| 6: Documentation & Deploy | 4 tasks | Small |
| **Total** | **42 tasks** | — |
