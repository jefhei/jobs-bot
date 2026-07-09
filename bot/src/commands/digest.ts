import { prisma } from "@jobpulse/shared/db";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
 * Format a Date to a relative time description.
 */
function formatPostedDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Format salary range for display.
 */
function formatSalary(min: number | null, max: number | null): string {
  if (min === null && max === null) return "";
  const fmt = (v: number) =>
    "$" + v.toLocaleString("en-US");
  if (min !== null && max !== null) return `${fmt(min)} – ${fmt(max)}`;
  if (min !== null) return `From ${fmt(min)}`;
  return `Up to ${fmt(max!)}`;
}

/**
 * Format a single job listing for the digest message.
 */
function formatJobDigest(match: any): string {
  const job = match.job;
  const salaryText = formatSalary(job.salaryMin, job.salaryMax);
  const salaryLine = salaryText ? ` 💰 ${salaryText}` : "";

  return (
    `• <b>${escapeHtml(job.title)}</b> at ${escapeHtml(job.company)}${salaryLine}\n` +
    `  🔗 ${job.url}`
  );
}

// ─── Command Registration ────────────────────────────────────────────────────

/**
 * Register the /digest command handler on a Telegram bot instance.
 *
 * Sends a daily summary of all new job matches from the last 24 hours,
 * grouped by active watch configuration.
 */
export function registerDigestCommand(bot: any): void {
  bot.onText(/\/digest/, async (msg: any) => {
    const chatId = msg.chat.id;
    const telegramId =
      msg.from?.id !== undefined ? String(msg.from.id) : undefined;

    if (!telegramId) {
      await bot.sendMessage(
        chatId,
        "❌ Could not identify you. Please use /start first.",
        { parse_mode: "HTML" }
      );
      return;
    }

    try {
      // Find the user
      const user = await prisma.user.findUnique({
        where: { telegramId },
      });

      if (!user) {
        await bot.sendMessage(
          chatId,
          "❌ You need to register first. Please use /start to create your account.",
          { parse_mode: "HTML" }
        );
        return;
      }

      // Get active watches for the user
      const watches = await prisma.watchConfig.findMany({
        where: { userId: user.id, active: true },
      });

      if (watches.length === 0) {
        await bot.sendMessage(
          chatId,
          "📊 <b>Daily Digest</b>\n\nYou have no active watches. Use /watch to create one.",
          { parse_mode: "HTML" }
        );
        return;
      }

      // Calculate 24 hours ago
      const twentyFourHoursAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000
      );

      // Build the digest — fetch JobMatches from last 24h for all user's watches
      const watchIds = watches.map((w) => w.id);
      const recentMatches = await prisma.jobMatch.findMany({
        where: {
          watchConfigId: { in: watchIds },
          createdAt: { gte: twentyFourHoursAgo },
        },
        include: {
          job: true,
        },
        orderBy: { createdAt: "desc" },
      });

      // Group matches by watchConfigId
      const grouped = new Map<string, typeof recentMatches>();
      for (const match of recentMatches) {
        const existing = grouped.get(match.watchConfigId) || [];
        existing.push(match);
        grouped.set(match.watchConfigId, existing);
      }

      // Build the message
      const lines: string[] = [];
      lines.push("📊 <b>Daily Digest</b>");
      lines.push(
        `Your job matches from the last 24 hours:`
      );
      lines.push("");

      let totalMatches = 0;

      for (const watch of watches) {
        const watchMatches = grouped.get(watch.id) || [];
        totalMatches += watchMatches.length;

        const locationText = watch.location
          ? escapeHtml(watch.location)
          : "Anywhere";
        const matchCountText =
          watchMatches.length === 1
            ? "1 new match"
            : `${watchMatches.length} new matches`;

        lines.push(
          `🔍 <b>${escapeHtml(watch.keyword)}</b> · 📍 ${locationText} · ${matchCountText}`
        );

        // Show up to 5 job listings per watch
        const displayMatches = watchMatches.slice(0, 5);
        for (const match of displayMatches) {
          lines.push(formatJobDigest(match));
        }

        if (watchMatches.length > 5) {
          lines.push(
            `  <i>...and ${watchMatches.length - 5} more</i>`
          );
        }

        lines.push("");
      }

      // If no matches at all, show a summary
      if (totalMatches === 0) {
        lines.push(
          `No new matches in the last 24 hours across ${watches.length} watch${watches.length !== 1 ? "es" : ""}.`
        );
      }

      const message = lines.join("\n");
      await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    } catch (error) {
      console.error("[@jobpulse/bot] Error generating digest:", error);
      await bot.sendMessage(
        chatId,
        "❌ An error occurred while generating your digest. Please try again later.",
        { parse_mode: "HTML" }
      );
    }
  });
}
