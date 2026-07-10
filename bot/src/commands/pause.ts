import { prisma } from "@jobpulse/shared/db";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Parse a duration string like "1h", "30m", "2h" into total minutes.
 * Returns null if format is invalid.
 */
function parseDuration(input: string): number | null {
  const match = input.match(/^(\d+)(h|m)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "h") return value * 60;
  return value; // minutes
}

/**
 * Format minutes into a human-readable string.
 */
function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

// ─── Command Registration ────────────────────────────────────────────────────

/**
 * Register the /pause command handler on a Telegram bot instance.
 *
 * Usage:
 *   /pause          - Show current pause status
 *   /pause 1h       - Pause all watches for 1 hour
 *   /pause 30m      - Pause all watches for 30 minutes
 *   /pause resume   - Resume all paused watches
 */
export function registerPauseCommand(bot: any): void {
  bot.onText(/\/pause/, async (msg: any) => {
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

      // Extract the text after /pause
      const text = msg.text || "";
      const args = text.replace(/\/pause(@\w+)?\s*/i, "").trim();

      // ─── /pause resume ────────────────────────────────────────────
      if (args.toLowerCase() === "resume") {
        const pausedWatches = await prisma.watchConfig.findMany({
          where: { userId: user.id, active: false },
        });

        if (pausedWatches.length === 0) {
          await bot.sendMessage(
            chatId,
            "✅ All your watches are already active. Nothing to resume.",
            { parse_mode: "HTML" }
          );
          return;
        }

        await prisma.watchConfig.updateMany({
          where: { userId: user.id, active: false },
          data: { active: true },
        });

        // Clear the pause state
        await prisma.notificationSetting.upsert({
          where: {
            userId_channel: { userId: user.id, channel: "pause_state" },
          },
          update: { enabled: false },
          create: {
            userId: user.id,
            channel: "pause_state",
            enabled: false,
            throttlePerHour: 0,
          },
        });

        await bot.sendMessage(
          chatId,
          `▶️ Resumed all paused watches.\n\n` +
            `${pausedWatches.length} watch${pausedWatches.length !== 1 ? "es" : ""} now active again.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // ─── /pause <duration> ────────────────────────────────────────
      if (args) {
        const minutes = parseDuration(args);
        if (minutes === null) {
          await bot.sendMessage(
            chatId,
            "❌ Invalid duration format. Use e.g. <code>30m</code> (minutes) or <code>1h</code> (hours).\n\n" +
              "Usage: /pause [duration|resume]\n" +
              "  <code>/pause</code> — show pause status\n" +
              "  <code>/pause 1h</code> — pause for 1 hour\n" +
              "  <code>/pause 30m</code> — pause for 30 minutes\n" +
              "  <code>/pause resume</code> — resume all watches",
            { parse_mode: "HTML" }
          );
          return;
        }

        // Check how many watches are currently active
        const activeWatches = await prisma.watchConfig.findMany({
          where: { userId: user.id, active: true },
        });

        if (activeWatches.length === 0) {
          await bot.sendMessage(
            chatId,
            "⏸️ All your watches are already paused.",
            { parse_mode: "HTML" }
          );
          return;
        }

        // Pause all active watches
        await prisma.watchConfig.updateMany({
          where: { userId: user.id, active: true },
          data: { active: false },
        });

        // Store pause info in notification settings
        await prisma.notificationSetting.upsert({
          where: {
            userId_channel: { userId: user.id, channel: "pause_state" },
          },
          update: {
            enabled: true,
            throttlePerHour: minutes,
          },
          create: {
            userId: user.id,
            channel: "pause_state",
            enabled: true,
            throttlePerHour: minutes,
          },
        });

        await bot.sendMessage(
          chatId,
          `⏸️ Paused ${activeWatches.length} watch${activeWatches.length !== 1 ? "es" : ""} for ${formatDuration(minutes)}.\n\n` +
            `Use <code>/pause resume</code> to reactivate them early.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // ─── /pause (no args — show status) ───────────────────────────
      const allWatches = await prisma.watchConfig.findMany({
        where: { userId: user.id },
      });

      if (allWatches.length === 0) {
        await bot.sendMessage(
          chatId,
          "📭 You have no watches. Use /watch to create one.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const activeCount = allWatches.filter((w) => w.active).length;
      const pausedCount = allWatches.length - activeCount;

      if (pausedCount === 0) {
        await bot.sendMessage(
          chatId,
          `✅ All ${allWatches.length} watch${allWatches.length !== 1 ? "es" : ""} are currently <b>active</b>.\n\n` +
            `To pause: <code>/pause 1h</code> or <code>/pause 30m</code>`,
          { parse_mode: "HTML" }
        );
      } else if (activeCount === 0) {
        // Try to find pause duration from notification settings
        const pauseSetting = await prisma.notificationSetting.findUnique({
          where: {
            userId_channel: { userId: user.id, channel: "pause_state" },
          },
        });

        let durationText = "";
        if (pauseSetting?.enabled && pauseSetting.throttlePerHour > 0) {
          durationText = ` (for ${formatDuration(pauseSetting.throttlePerHour)})`;
        }

        await bot.sendMessage(
          chatId,
          `⏸️ All ${allWatches.length} watch${allWatches.length !== 1 ? "es" : ""} are currently <b>paused</b>${durationText}.\n\n` +
            `Use <code>/pause resume</code> to reactivate them.`,
          { parse_mode: "HTML" }
        );
      } else {
        await bot.sendMessage(
          chatId,
          `⚠️ <b>Partially paused:</b> ${activeCount} active, ${pausedCount} paused out of ${allWatches.length} watch${allWatches.length !== 1 ? "es" : ""}.\n\n` +
            `Use <code>/pause 1h</code> to pause all active watches, or <code>/pause resume</code> to reactivate paused ones.`,
          { parse_mode: "HTML" }
        );
      }
    } catch (error) {
      console.error("[@jobpulse/bot] Error in /pause command:", error);
      await bot.sendMessage(
        chatId,
        "❌ An error occurred while processing the /pause command. Please try again later.",
        { parse_mode: "HTML" }
      );
    }
  });
}
