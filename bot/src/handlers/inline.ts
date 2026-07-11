import { prisma } from "@jobpulse/shared/db";
import { NormalizedJob } from "@jobpulse/shared";

// ─── In-memory State ─────────────────────────────────────────────────────────
// Exported for testing; in production these are replaced by DB calls.

/**
 * Map of "source:sourceId" -> boolean for saved jobs.
 */
export const savedJobs = new Map<string, boolean>();

/**
 * Map of "source:sourceId" -> boolean for dismissed jobs.
 */
export const dismissedJobs = new Map<string, boolean>();

/**
 * Map of "source:sourceId" -> job details used for "similar" queries.
 * Populated by the search command when results are sent.
 */
export const jobDetails = new Map<string, any>();

/**
 * Map of chatId -> NormalizedJob[] for pagination state.
 * Populated by the search command when results are sent.
 */
export const searchResults = new Map<number, NormalizedJob[]>();

// ─── Pagination Constants ────────────────────────────────────────────────────

const JOBS_PER_PAGE = 5;

// ─── Helpers (reused from search.ts) ─────────────────────────────────────────

/**
 * Escape HTML entities for Telegram parse_mode="HTML".
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Format salary as USD currency.
 */
function formatSalary(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Simple relative date formatter.
 */
function formatRelativeDate(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Format a job listing into a single result string (mirrors search.ts formatJob).
 */
function formatJob(job: NormalizedJob, index: number): string {
  const lines: string[] = [];
  lines.push(`<b>${index}. ${escapeHtml(job.title)}</b>`);
  lines.push(`   🏢 <b>${escapeHtml(job.company)}</b>`);

  if (job.location) {
    lines.push(`   📍 ${escapeHtml(job.location)}`);
  }

  if (job.salaryMin !== null || job.salaryMax !== null) {
    const min = job.salaryMin !== null ? formatSalary(job.salaryMin) : "?";
    const max = job.salaryMax !== null ? formatSalary(job.salaryMax) : "?";
    lines.push(`   💰 ${min} – ${max}`);
  }

  if (job.postedAt) {
    lines.push(`   🕐 Posted ${formatRelativeDate(job.postedAt)}`);
  }

  lines.push(`   🔗 <a href="${escapeHtml(job.url)}">View Job</a>`);
  lines.push(`   🏷️ Source: ${job.source}`);

  return lines.join("\n");
}

/**
 * Build the keyboard row for a single job (mirrors search.ts buildJobKeyboard).
 */
function buildJobKeyboard(job: NormalizedJob): any[] {
  return [
    { text: "💾 Save", callback_data: `save:${job.source}:${job.sourceId}` },
    { text: "🔗 Apply", url: job.url },
    { text: "❌ Dismiss", callback_data: `dismiss:${job.source}:${job.sourceId}` },
    { text: "🔍 Similar", callback_data: `similar:${job.source}:${job.sourceId}` },
  ];
}

/**
 * Build navigation keyboard row (mirrors search.ts buildNavKeyboard).
 */
function buildNavKeyboard(page: number, totalPages: number): any[] | null {
  if (totalPages <= 1) return null;

  const buttons: any[] = [];
  if (page > 1) {
    buttons.push({ text: "⬅️ Prev", callback_data: `page:${page - 1}` });
  }
  buttons.push({ text: `📄 ${page}/${totalPages}`, callback_data: "noop" });
  if (page < totalPages) {
    buttons.push({ text: "➡️ Next", callback_data: `page:${page + 1}` });
  }
  return buttons;
}

/**
 * Build option selector keyboard row (mirrors search.ts buildOptionsKeyboard).
 */
function buildOptionsKeyboard(): any[] {
  return [{ text: "🔄 Refresh", callback_data: `refresh:${Date.now()}` }];
}

// ─── Handler Implementation ──────────────────────────────────────────────────

/**
 * Handle the "save" callback: save a job for the user.
 */
async function handleSave(query: any, parts: string[]): Promise<void> {
  const source = parts[1];
  const sourceId = parts[2];
  const key = `${source}:${sourceId}`;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  // Store in-memory
  savedJobs.set(key, true);

  // Try to update DB
  try {
    const match = await prisma.jobMatch.findUnique({
      where: { source_sourceId: { source, sourceId } },
    });
    if (match) {
      await prisma.jobMatch.update({
        where: { id: match.id },
        data: { saved: true },
      });
    }
  } catch {
    // DB not available — in-memory state is sufficient
  }

  const job = jobDetails.get(key);
  const title = job ? escapeHtml(job.title) : "Job";

  await query.bot.sendMessage(chatId, `💾 <b>Saved:</b> ${title}`, {
    parse_mode: "HTML",
    reply_to_message_id: messageId,
  });
}

/**
 * Handle the "dismiss" callback: dismiss a job so it won't reappear.
 */
async function handleDismiss(query: any, parts: string[]): Promise<void> {
  const source = parts[1];
  const sourceId = parts[2];
  const key = `${source}:${sourceId}`;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  // Store in-memory
  dismissedJobs.set(key, true);

  // Try to update DB
  try {
    const match = await prisma.jobMatch.findUnique({
      where: { source_sourceId: { source, sourceId } },
    });
    if (match) {
      await prisma.jobMatch.update({
        where: { id: match.id },
        data: { dismissed: true },
      });
    }
  } catch {
    // DB not available — in-memory state is sufficient
  }

  const job = jobDetails.get(key);
  const title = job ? escapeHtml(job.title) : "Job";

  await query.bot.sendMessage(chatId, `❌ <b>Dismissed:</b> ${title}`, {
    parse_mode: "HTML",
    reply_to_message_id: messageId,
  });
}

/**
 * Handle the "similar" callback: search for similar jobs using the job title.
 */
async function handleSimilar(query: any, parts: string[]): Promise<void> {
  const source = parts[1];
  const sourceId = parts[2];
  const key = `${source}:${sourceId}`;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  const job = jobDetails.get(key);
  if (!job) {
    await query.bot.sendMessage(
      chatId,
      "😕 Sorry, I couldn't find the details for that job. Try a new search.",
      { parse_mode: "HTML", reply_to_message_id: messageId }
    );
    return;
  }

  // Use the job title as the search query for similar jobs
  const keyword = job.title;

  await query.bot.sendMessage(
    chatId,
    `🔍 <b>Similar jobs to:</b> ${escapeHtml(keyword)}\n\n` +
      `Use /search ${escapeHtml(keyword)} to find similar positions.`,
    { parse_mode: "HTML", reply_to_message_id: messageId }
  );
}

/**
 * Handle the "page" callback: navigate to a specific page of search results.
 */
async function handlePage(query: any, parts: string[]): Promise<void> {
  const pageNum = parseInt(parts[1], 10);
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  const results = searchResults.get(chatId);
  if (!results || results.length === 0) {
    await query.bot.sendMessage(
      chatId,
      "😕 These search results have expired. Please run a new /search.",
      { parse_mode: "HTML", reply_to_message_id: messageId }
    );
    return;
  }

  const totalPages = Math.ceil(results.length / JOBS_PER_PAGE);
  const page = Math.min(pageNum, totalPages);
  const zeroBasedPage = page - 1;
  const start = zeroBasedPage * JOBS_PER_PAGE;
  const end = start + JOBS_PER_PAGE;
  const pageJobs = results.slice(start, end);

  const header =
    `🔍 <b>Search Results</b>\n` +
    `📄 Page ${page}/${totalPages} · ${results.length} total\n\n`;
  const body = pageJobs.map((job, i) => formatJob(job, start + i + 1)).join("\n\n");
  const text = header + body;

  // Build inline keyboard
  const keyboard: any[][] = [];
  for (const job of pageJobs) {
    keyboard.push(buildJobKeyboard(job));
  }
  const navRow = buildNavKeyboard(page, totalPages);
  if (navRow) {
    keyboard.push(navRow);
  }
  keyboard.push(buildOptionsKeyboard());

  await query.bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: keyboard,
    },
  });
}

/**
 * Handle the "refresh" callback: re-send the current page of search results.
 */
async function handleRefresh(query: any, _parts: string[]): Promise<void> {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  const results = searchResults.get(chatId);
  if (!results || results.length === 0) {
    await query.bot.sendMessage(
      chatId,
      "😕 These search results have expired. Please run a new /search.",
      { parse_mode: "HTML", reply_to_message_id: messageId }
    );
    return;
  }

  // Default to page 1 on refresh
  const totalPages = Math.ceil(results.length / JOBS_PER_PAGE);
  const page = 1;
  const start = 0;
  const end = start + JOBS_PER_PAGE;
  const pageJobs = results.slice(start, end);

  const header =
    `🔍 <b>Search Results</b>\n` +
    `📄 Page ${page}/${totalPages} · ${results.length} total\n\n`;
  const body = pageJobs.map((job, i) => formatJob(job, i + 1)).join("\n\n");
  const text = header + body;

  // Build inline keyboard
  const keyboard: any[][] = [];
  for (const job of pageJobs) {
    keyboard.push(buildJobKeyboard(job));
  }
  const navRow = buildNavKeyboard(page, totalPages);
  if (navRow) {
    keyboard.push(navRow);
  }
  keyboard.push(buildOptionsKeyboard());

  await query.bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: keyboard,
    },
  });
}

// ─── Quick Start Handlers (from start.ts) ────────────────────────────────────

/**
 * Handle the "search" quick-start callback: prompt user to type /search.
 */
async function handleQuickSearch(query: any): Promise<void> {
  const chatId = query.message.chat.id;

  await query.bot.sendMessage(
    chatId,
    "🔍 <b>Quick Search</b>\n\n" +
      "Use the /search command to find jobs:\n" +
      "<code>/search software engineer</code>\n" +
      "<code>/search design in Remote</code>\n" +
      "<code>/search data - New York</code>",
    { parse_mode: "HTML" }
  );
}

/**
 * Handle the "watch" quick-start callback: prompt user to type /watch.
 */
async function handleQuickWatch(query: any): Promise<void> {
  const chatId = query.message.chat.id;

  await query.bot.sendMessage(
    chatId,
    "👁️ <b>Set Up a Watch</b>\n\n" +
      "Use the /watch command to monitor for new jobs over time:\n" +
      "<code>/watch software engineer in Remote</code>\n\n" +
      "You can also set filters like salary, job type, and sources.\n" +
      "Use /list to see your active watches.",
    { parse_mode: "HTML" }
  );
}

/**
 * Handle the "sources" quick-start callback: prompt user to type /sources.
 */
async function handleQuickSources(query: any): Promise<void> {
  const chatId = query.message.chat.id;

  await query.bot.sendMessage(
    chatId,
    "📡 <b>Job Sources</b>\n\n" +
      "Use /sources to see the available job platforms.\n" +
      "You can configure which sources to search when setting up a watch.",
    { parse_mode: "HTML" }
  );
}

// ─── Main Handler ────────────────────────────────────────────────────────────

/**
 * Register inline button callback_query handlers on a Telegram bot instance.
 *
 * Handles callback_data from inline keyboards in search results and start menu:
 * - save:source:sourceId     → Save a job
 * - dismiss:source:sourceId  → Dismiss a job
 * - similar:source:sourceId  → Find similar jobs
 * - page:N                  → Pagination navigation
 * - refresh:timestamp        → Refresh current search results
 * - noop                    → No operation (just answer callback)
 * - search                  → Quick start search prompt
 * - watch                   → Quick start watch prompt
 * - sources                 → Quick start sources prompt
 */
export function registerInlineHandlers(bot: any): void {
  bot.on("callback_query", async (query: any) => {
    // Attach the bot instance to the query for convenience
    query.bot = bot;

    // Always acknowledge the callback first
    await bot.answerCallbackQuery(query.id);

    const data: string | undefined = query.data;
    if (!data) return;

    const parts = data.split(":");

    switch (parts[0]) {
      case "save":
        await handleSave(query, parts);
        break;
      case "dismiss":
        await handleDismiss(query, parts);
        break;
      case "similar":
        await handleSimilar(query, parts);
        break;
      case "page":
        await handlePage(query, parts);
        break;
      case "refresh":
        await handleRefresh(query, parts);
        break;
      case "noop":
        // Nothing to do — already answered callback
        break;
      case "search":
        await handleQuickSearch(query);
        break;
      case "watch":
        await handleQuickWatch(query);
        break;
      case "sources":
        await handleQuickSources(query);
        break;
      default:
        // Unknown callback data — just acknowledge
        break;
    }
  });
}
