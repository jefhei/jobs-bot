import TelegramBot from "node-telegram-bot-api";
import { loadBotConfig, BotConfig } from "./config";
import { registerStartCommand } from "./commands/start";

// ─── State ───────────────────────────────────────────────────────────────────

let bot: TelegramBot | null = null;
let currentConfig: BotConfig | null = null;
let isShuttingDown = false;

// ─── Command Registration ────────────────────────────────────────────────────

/**
 * Register all command handlers on the bot instance.
 * Each command uses onText with a regex matching /command or /command@botusername.
 */
function registerCommands(botInstance: TelegramBot): void {
  // /start - Welcome message (with DB user creation)
  registerStartCommand(botInstance);

  // /search - Search for jobs (placeholder)
  botInstance.onText(/\/search/, (msg) => {
    botInstance.sendMessage(
      msg.chat.id,
      "🔍 Search functionality coming soon!"
    );
  });

  // /watch - Set up a job watch (placeholder)
  botInstance.onText(/\/watch/, (msg) => {
    botInstance.sendMessage(
      msg.chat.id,
      "👁️ Watch setup coming soon!"
    );
  });

  // /list - List active watches (placeholder)
  botInstance.onText(/\/list/, (msg) => {
    botInstance.sendMessage(
      msg.chat.id,
      "📋 Listing watches coming soon!"
    );
  });

  // /remove - Remove a watch (placeholder)
  botInstance.onText(/\/remove/, (msg) => {
    botInstance.sendMessage(
      msg.chat.id,
      "🗑️ Remove watch coming soon!"
    );
  });

  // /digest - Get a digest (placeholder)
  botInstance.onText(/\/digest/, (msg) => {
    botInstance.sendMessage(
      msg.chat.id,
      "📊 Digest coming soon!"
    );
  });

  // /pause - Pause/resume a watch (placeholder)
  botInstance.onText(/\/pause/, (msg) => {
    botInstance.sendMessage(
      msg.chat.id,
      "⏸️ Pause/resume coming soon!"
    );
  });

  // /sources - List available job sources (placeholder)
  botInstance.onText(/\/sources/, (msg) => {
    botInstance.sendMessage(
      msg.chat.id,
      "📡 Available sources coming soon!"
    );
  });

  // /filters - Show active filters (placeholder)
  botInstance.onText(/\/filters/, (msg) => {
    botInstance.sendMessage(
      msg.chat.id,
      "🔎 Active filters coming soon!"
    );
  });
}

// ─── Start ───────────────────────────────────────────────────────────────────

/**
 * Start the bot.
 *
 * Accepts an optional config override for testing. When no argument is given,
 * config is loaded from environment variables.
 */
export async function start(configOverride?: BotConfig): Promise<void> {
  const cfg = configOverride ?? loadBotConfig();
  currentConfig = cfg;

  if (cfg.botMode === "webhook") {
    console.log("[@jobpulse/bot] Starting in webhook mode...");

    bot = new TelegramBot(cfg.botToken, {
      webHook: {
        port: cfg.webhookPort,
        autoOpen: false,
      },
      onlyFirstMatch: true,
    });

    // Register all command handlers
    registerCommands(bot);

    // Set the webhook URL with Telegram API
    if (cfg.webhookUrl) {
      await bot.setWebhook(cfg.webhookUrl);
      console.log(`[@jobpulse/bot] Webhook set to ${cfg.webhookUrl}`);
    }

    // Open the webhook HTTP server
    await bot.openWebHook();
  } else {
    console.log("[@jobpulse/bot] Starting in polling mode...");

    bot = new TelegramBot(cfg.botToken, {
      polling: true,
      onlyFirstMatch: true,
    });

    // Register all command handlers
    registerCommands(bot);
  }

  console.log("[@jobpulse/bot] Bot started successfully");
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

export async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("[@jobpulse/bot] Shutting down gracefully...");

  if (bot) {
    // Stop polling if it's active
    if (bot.isPolling()) {
      await bot.stopPolling();
      console.log("[@jobpulse/bot] Polling stopped");
    }

    // Close webhook if it's open
    if (bot.hasOpenWebHook()) {
      await bot.closeWebHook();
      console.log("[@jobpulse/bot] Webhook closed");
    }
  }

  console.log("[@jobpulse/bot] Shutdown complete");
}

// ─── Signal Handling ─────────────────────────────────────────────────────────

process.on("SIGTERM", async () => {
  console.log("[@jobpulse/bot] Received SIGTERM");
  await shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[@jobpulse/bot] Received SIGINT");
  await shutdown();
  process.exit(0);
});

// ─── Exports ─────────────────────────────────────────────────────────────────

export { bot };
export { loadBotConfig, BotConfig } from "./config";
