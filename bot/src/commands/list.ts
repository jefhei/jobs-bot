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
 * Format a Date to a readable string.
 */
function formatDate(date: Date | null | undefined): string {
  if (!date) return "Never";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Command Registration ────────────────────────────────────────────────────

/**
 * Register the /list command handler on a Telegram bot instance.
 *
 * Lists all active WatchConfigs for the user with details.
 */
export function registerListCommand(bot: any): void {
  bot.onText(/\/list/, async (msg: any) => {
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

      const watches = await prisma.watchConfig.findMany({
        where: { userId: user.id, active: true },
      });

      if (watches.length === 0) {
        await bot.sendMessage(
          chatId,
          "📋 You have no active watches. Use /watch to create one.",
          { parse_mode: "HTML" }
        );
        return;
      }

      // Format each watch
      const lines: string[] = [];
      for (const w of watches) {
        const locationText = w.location
          ? escapeHtml(w.location)
          : "Anywhere";
        const sourcesText = w.sources.join(", ");
        const lastPolledText = formatDate(w.lastPolledAt);

        lines.push(
          `<b>Watch</b>\n` +
            `🆔 <code>${escapeHtml(w.id)}</code>\n` +
            `🔍 ${escapeHtml(w.keyword)}\n` +
            `📍 ${locationText}\n` +
            `⏱️ Every ${w.intervalMinutes}min\n` +
            `📡 ${sourcesText}\n` +
            `🕐 Last polled: ${lastPolledText}`
        );
      }

      const message =
        `📋 <b>Your Active Watches</b>\n\n` +
        lines.join("\n\n") +
        `\n\nUse /remove &lt;id&gt; to stop a watch.`;

      await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    } catch (error) {
      console.error("[@jobpulse/bot] Error listing watches:", error);
      await bot.sendMessage(
        chatId,
        "❌ An error occurred while listing your watches. Please try again later.",
        { parse_mode: "HTML" }
      );
    }
  });
}
