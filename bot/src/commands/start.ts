import { prisma } from "@jobpulse/shared/db";

/**
 * Register the /start command handler on a Telegram bot instance.
 * On /start:
 * 1. Creates or updates a User record by telegramId
 * 2. Sends a welcome message with available commands
 * 3. Provides an inline keyboard for quick actions
 */
export function registerStartCommand(bot: any): void {
  bot.onText(/\/start/, async (msg: any) => {
    const chatId = msg.chat.id;

    // Extract user info from the message
    const telegramId = msg.from?.id !== undefined ? String(msg.from.id) : undefined;
    const firstName = msg.from?.first_name;

    // Create or update the User record in the database
    try {
      await prisma.user.upsert({
        where: { telegramId: telegramId ?? "" },
        update: { telegramId: telegramId ?? "" },
        create: {
          telegramId: telegramId ?? undefined,
          email: undefined,
        },
      });
    } catch (error) {
      // If upsert fails (e.g. telegramId is null/undefined), continue anyway
      console.error("[@jobpulse/bot] Failed to upsert user on /start:", error);
    }

    // Build welcome message
    const welcomeMessage =
      `🤖 Welcome to JobPulse${firstName ? `, ${firstName}` : ""}!` +
      `\n\nI help you find and monitor job listings across multiple platforms.` +
      `\n\nCommands:` +
      `\n/search - Search for jobs` +
      `\n/watch - Set up a job watch` +
      `\n/list - List your active watches` +
      `\n/remove - Remove a watch` +
      `\n/digest - Get a digest of recent matches` +
      `\n/pause - Pause/resume a watch` +
      `\n/sources - List available job sources` +
      `\n/filters - Show your active filters`;

    // Inline keyboard with quick actions
    const replyMarkup = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔍 Search Jobs", callback_data: "search" },
            { text: "👁️ Set Up Watch", callback_data: "watch" },
          ],
          [
            { text: "📡 View Sources", callback_data: "sources" },
          ],
        ],
      },
    };

    await bot.sendMessage(chatId, welcomeMessage, replyMarkup);
  });
}
