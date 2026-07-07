import { prisma } from "@jobpulse/shared/db";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WatchCommandArgs {
  keyword: string;
  location?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the query text from a /watch command message.
 * Removes the "/watch" prefix and optional @botusername.
 * Returns null if no query text is present.
 */
function extractQueryFromMessage(text: string | undefined): string | null {
  if (!text) return null;
  // Match /watch optionally followed by @botusername and then the query text
  const match = text.match(/\/watch(?:@\S+)?\s+(.+)/);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Parse a raw query string, extracting the keyword and an optional location.
 *
 * Supports:
 * - `/watch keyword in Location` → { keyword: "keyword", location: "Location" }
 * - `/watch keyword`            → { keyword: "keyword", location: undefined }
 */
function parseQuery(text: string): WatchCommandArgs {
  // Try " in " separator (case-insensitive)
  const inMatch = text.match(/^(.+?)\s+in\s+(.+)$/i);
  if (inMatch) {
    return { keyword: inMatch[1].trim(), location: inMatch[2].trim() };
  }

  // No location — whole text is the keyword
  return { keyword: text.trim(), location: undefined };
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

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_SOURCES = ["linkedin", "indeed", "greenhouse", "lever"] as const;
const DEFAULT_INTERVAL_MINUTES = 30;

// ─── Command Registration ────────────────────────────────────────────────────

/**
 * Register the /watch command handler on a Telegram bot instance.
 *
 * Usage: `/watch <keyword> [in <location>]`
 *
 * Creates a WatchConfig in the database so the monitoring system will
 * periodically check for new job listings matching the criteria.
 */
export function registerWatchCommand(bot: any): void {
  bot.onText(/\/watch/, async (msg: any) => {
    const chatId = msg.chat.id;
    const messageText: string | undefined = msg.text;

    // Extract the query from the message text
    const rawQuery = extractQueryFromMessage(messageText);

    if (!rawQuery) {
      await bot.sendMessage(
        chatId,
        `👁️ <b>Usage:</b> /watch <i>keyword</i> [in <i>location</i>]\n\n` +
          `Examples:\n` +
          `/watch software engineer\n` +
          `/watch software engineer in Remote\n` +
          `/watch product manager in San Francisco`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Parse the keyword and optional location
    const { keyword, location } = parseQuery(rawQuery);

    // Find the user by telegramId
    const telegramId = msg.from?.id !== undefined ? String(msg.from.id) : undefined;

    if (!telegramId) {
      await bot.sendMessage(
        chatId,
        `❌ Could not identify you. Please use /start first.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { telegramId },
      });

      if (!user) {
        await bot.sendMessage(
          chatId,
          `❌ You need to register first. Please use /start to create your account.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // Create the WatchConfig
      const watchConfig = await prisma.watchConfig.create({
        data: {
          userId: user.id,
          keyword,
          location,
          sources: [...DEFAULT_SOURCES],
          intervalMinutes: DEFAULT_INTERVAL_MINUTES,
          notifyVia: ["telegram"],
          active: true,
        },
      });

      // Send confirmation
      const locationText = location ? ` in <b>${escapeHtml(location)}</b>` : "";
      await bot.sendMessage(
        chatId,
        `✅ <b>Watch Created!</b>\n\n` +
          `🔍 Monitoring for: <b>${escapeHtml(keyword)}</b>${locationText}\n` +
          `🆔 Watch ID: <code>${escapeHtml(watchConfig.id)}</code>\n` +
          `⏱️ Check interval: Every ${DEFAULT_INTERVAL_MINUTES} minutes\n` +
          `📡 Sources: ${DEFAULT_SOURCES.join(", ")}\n\n` +
          `Use /list to see your active watches or /remove to stop this watch.`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.error("[@jobpulse/bot] Error creating watch:", error);
      await bot.sendMessage(
        chatId,
        `❌ An error occurred while setting up your watch for <b>${escapeHtml(keyword)}</b>.\n\n` +
          `Please try again later.`,
        { parse_mode: "HTML" }
      );
    }
  });
}
