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
 * Extract the watch ID from a /remove command message.
 * Handles /remove <id> and /remove@botusername <id>.
 */
function extractWatchIdFromMessage(
  text: string | undefined
): string | null {
  if (!text) return null;
  const match = text.match(
    /\/remove(?:@\S+)?\s+(.+)/
  );
  if (!match) return null;
  return match[1].trim();
}

// ─── Command Registration ────────────────────────────────────────────────────

/**
 * Register the /remove command handler on a Telegram bot instance.
 *
 * Usage: `/remove <watch_id>`
 *
 * Sets the matching WatchConfig's active flag to false (soft-delete).
 */
export function registerRemoveCommand(bot: any): void {
  bot.onText(/\/remove/, async (msg: any) => {
    const chatId = msg.chat.id;
    const messageText: string | undefined = msg.text;

    // Extract watch ID from the message
    const watchId = extractWatchIdFromMessage(messageText);

    if (!watchId) {
      await bot.sendMessage(
        chatId,
        "❌ Usage: /remove &lt;watch_id&gt;\n\nUse /list to find your watch IDs.",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Find the user by telegramId
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

      // Find and deactivate the watch (only if it belongs to this user)
      const updatedWatch = await prisma.watchConfig.update({
        where: {
          id: watchId,
          userId: user.id,
        },
        data: {
          active: false,
        },
      });

      await bot.sendMessage(
        chatId,
        `✅ Watch for '${escapeHtml(updatedWatch.keyword)}' has been stopped.`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.error("[@jobpulse/bot] Error removing watch:", error);
      await bot.sendMessage(
        chatId,
        "❌ An error occurred while removing the watch. Please try again later.",
        { parse_mode: "HTML" }
      );
    }
  });
}
