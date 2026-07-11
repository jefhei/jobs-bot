import TelegramBot from "node-telegram-bot-api";
import { loadBotConfig, BotConfig } from "./config";
import { registerStartCommand } from "./commands/start";
import { registerSearchCommand } from "./commands/search";
import { registerWatchCommand } from "./commands/watch";
import { registerListCommand } from "./commands/list";
import { registerRemoveCommand } from "./commands/remove";
import { registerDigestCommand } from "./commands/digest";
import { registerPauseCommand } from "./commands/pause";
import { registerSourcesCommand } from "./commands/sources";
import { registerFiltersCommand } from "./commands/filters";
import { registerInlineHandlers } from "./handlers/inline";

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

  // /search - Search for jobs (natural-language one-time search)
  registerSearchCommand(botInstance);

  // /watch - Set up a job watch
  registerWatchCommand(botInstance);

  // /list - List active watches
  registerListCommand(botInstance);

  // /remove - Remove a watch
  registerRemoveCommand(botInstance);

  // /digest - Get daily digest of new matches
  registerDigestCommand(botInstance);

  // /pause - Pause/resume all watches
  registerPauseCommand(botInstance);

  // /sources - List available job sources
  registerSourcesCommand(botInstance);

  // /filters - Show active filters
  registerFiltersCommand(botInstance);

  // Inline button handlers for callback_query events
  registerInlineHandlers(botInstance);
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
