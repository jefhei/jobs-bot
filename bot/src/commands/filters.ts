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
 * Format salary number for display.
 */
function formatSalary(min: number | null): string {
  if (min === null) return "";
  return "$" + min.toLocaleString("en-US");
}

/**
 * Format a filter value nicely.
 */
function formatFilterValue(label: string, value: string | number | null): string {
  if (value === null || value === "") return "None";
  if (label === "Min Salary" && typeof value === "number") {
    return formatSalary(value);
  }
  return String(value);
}

// ─── Command Registration ────────────────────────────────────────────────────

/**
 * Register the /filters command handler on a Telegram bot instance.
 *
 * Usage:
 *   /filters              - Show active filters across all watches
 */
export function registerFiltersCommand(bot: any): void {
  bot.onText(/\/filters/, async (msg: any) => {
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

      // Extract the text after /filters
      const text = msg.text || "";
      const args = text.replace(/\/filters(@\w+)?\s*/i, "").trim();

      // Get all watches for the user
      const watches = await prisma.watchConfig.findMany({
        where: { userId: user.id },
      });

      if (watches.length === 0) {
        await bot.sendMessage(
          chatId,
          "📭 You have no watches. Use /watch to create one.",
          { parse_mode: "HTML" }
        );
        return;
      }

      // ─── /filters (show filters) ─────────────────────────────────
      const lines: string[] = [];
      lines.push("🔎 <b>Active Filters</b>");
      lines.push("");

      for (const watch of watches) {
        const keyword = escapeHtml(watch.keyword);
        const location = watch.location ? escapeHtml(watch.location) : "Anywhere";
        const status = watch.active ? "🟢 Active" : "⏸️ Paused";

        lines.push(`📌 <b>${keyword}</b> · 📍 ${location} · ${status}`);
        lines.push(`  🆔 ${watch.id}`);
        lines.push(`  🏷️ Type: ${formatFilterValue("Job Type", watch.jobType)}`);
        lines.push(`  💰 Salary: ${formatFilterValue("Min Salary", watch.minSalary)}`);
        lines.push(`  📊 Experience: ${formatFilterValue("Experience Level", watch.experienceLevel)}`);
        lines.push("");
      }

      lines.push("💡 Use <code>/watch</code> to create a new watch with filters.");
      lines.push("💡 Use <code>/remove &lt;id&gt;</code> to remove a watch.");

      const message = lines.join("\n");
      await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    } catch (error) {
      console.error("[@jobpulse/bot] Error in /filters command:", error);
      await bot.sendMessage(
        chatId,
        "❌ An error occurred while processing the /filters command. Please try again later.",
        { parse_mode: "HTML" }
      );
    }
  });
}
