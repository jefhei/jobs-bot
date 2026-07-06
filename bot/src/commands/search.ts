import { searchAllSources } from "@jobpulse/shared";
import { NormalizedJob } from "@jobpulse/shared";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a raw search query string, extracting the keyword and an optional location.
 *
 * Supports:
 * - `/search keyword in Location` → { query: "keyword", location: "Location" }
 * - `/search keyword - Location` → { query: "keyword", location: "Location" }
 * - `/search keyword`            → { query: "keyword", location: undefined }
 */
function parseQuery(text: string): { query: string; location?: string } {
  // Try " in " separator (case-insensitive)
  const inMatch = text.match(/^(.+?)\s+in\s+(.+)$/i);
  if (inMatch) {
    return { query: inMatch[1].trim(), location: inMatch[2].trim() };
  }

  // Try " - " separator
  const dashMatch = text.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) {
    return { query: dashMatch[1].trim(), location: dashMatch[2].trim() };
  }

  // No location — whole text is the query
  return { query: text.trim(), location: undefined };
}

/**
 * Extract the query text from a /search command message.
 * Removes the "/search" prefix and trims the result.
 */
function extractQueryFromMessage(text: string | undefined): string | null {
  if (!text) return null;
  // Match /search optionally followed by @botusername and then the query text
  const match = text.match(/\/search(?:@\S+)?\s+(.+)/);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Format a job listing into a single result string.
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
 * Format a number as USD currency.
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
 * Escape HTML entities for Telegram parse_mode="HTML".
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Pagination constants ────────────────────────────────────────────────────

const JOBS_PER_PAGE = 5;

/**
 * Build the keyboard row for a single job.
 */
function buildJobKeyboard(job: NormalizedJob, _page: number, _totalPages: number): any[] {
  const buttons: any[] = [
    { text: "💾 Save", callback_data: `save:${job.source}:${job.sourceId}` },
    { text: "🔗 Apply", url: job.url },
    { text: "❌ Dismiss", callback_data: `dismiss:${job.source}:${job.sourceId}` },
    { text: "🔍 Similar", callback_data: `similar:${job.source}:${job.sourceId}` },
  ];
  return buttons;
}

/**
 * Build navigation keyboard row for multi-page results.
 */
function buildNavKeyboard(page: number, totalPages: number, _query: string): any[] | null {
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
 * Build option selector keyboard row (e.g. sort/filter buttons).
 */
function buildOptionsKeyboard(): any[] | null {
  return [
    { text: "🔄 Refresh", callback_data: `refresh:${Date.now()}` },
  ];
}

// ─── Command Registration ────────────────────────────────────────────────────

/**
 * Register the /search command handler on a Telegram bot instance.
 *
 * Usage: `/search <keyword> [in|– <location>]`
 *
 * Performs a one-time natural-language search across configured sources
 * and returns paginated results with inline action buttons.
 */
export function registerSearchCommand(bot: any): void {
  bot.onText(/\/search/, async (msg: any, _match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const messageText: string | undefined = msg.text;

    // Extract the query from the message text
    const rawQuery = extractQueryFromMessage(messageText);

    if (!rawQuery) {
      await bot.sendMessage(
        chatId,
        `🔍 <b>Usage:</b> /search <i>keyword</i> [in|– <i>location</i>]\n\n` +
          `Examples:\n` +
          `/search software engineer\n` +
          `/search software engineer in Remote\n` +
          `/search design - New York`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Parse the query
    const { query, location } = parseQuery(rawQuery);

    // Perform the search
    try {
      const results = await searchAllSources(query, { location });

      // Collect all jobs from all sources
      const allJobs: NormalizedJob[] = [];
      for (const result of results) {
        if (result.jobs && result.jobs.length > 0) {
          allJobs.push(...result.jobs);
        }
      }

      if (allJobs.length === 0) {
        await bot.sendMessage(
          chatId,
          `😕 No jobs found matching <b>${escapeHtml(query)}</b>${location ? ` in <b>${escapeHtml(location)}</b>` : ""}.\n\n` +
            `Try different keywords or broaden your search.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // Paginate results
      const totalPages = Math.ceil(allJobs.length / JOBS_PER_PAGE);

      for (let page = 0; page < totalPages; page++) {
        const start = page * JOBS_PER_PAGE;
        const end = start + JOBS_PER_PAGE;
        const pageJobs = allJobs.slice(start, end);

        const pageNumber = page + 1;
        const header =
          `🔍 <b>Search Results</b> for "${escapeHtml(query)}"${location ? ` in ${escapeHtml(location)}` : ""}\n` +
          `📄 Page ${pageNumber}/${totalPages} · ${allJobs.length} total\n\n`;
        const body = pageJobs.map((job, i) => formatJob(job, start + i + 1)).join("\n\n");

        const text = header + body;

        // Build inline keyboard
        const keyboard: any[][] = [];

        // Add individual job action buttons
        for (const job of pageJobs) {
          keyboard.push(buildJobKeyboard(job, pageNumber, totalPages));
        }

        // Add navigation row if multi-page
        const navRow = buildNavKeyboard(pageNumber, totalPages, query);
        if (navRow) {
          keyboard.push(navRow);
        }

        // Add options row
        keyboard.push(buildOptionsKeyboard());

        await bot.sendMessage(chatId, text, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: keyboard,
          },
        });
      }
    } catch (error: any) {
      console.error("[@jobpulse/bot] Search error:", error);
      await bot.sendMessage(
        chatId,
        `❌ An error occurred while searching for <b>${escapeHtml(query)}</b>.\n\n` +
          `Please try again later.`,
        { parse_mode: "HTML" }
      );
    }
  });
}
