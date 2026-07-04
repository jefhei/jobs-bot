// ─── Bot Configuration ───────────────────────────────────────────────────────

export interface BotConfig {
  /** Telegram Bot API token (required) */
  botToken: string;
  /** Operation mode: "polling" (default) or "webhook" */
  botMode: "polling" | "webhook";
  /** Webhook URL (required if botMode is "webhook") */
  webhookUrl: string | undefined;
  /** Port for the webhook HTTP server (default: 8443) */
  webhookPort: number;
  /** Port for the health/listen server (default: 3000) */
  listenPort: number;
}

/**
 * Load bot configuration from environment variables.
 * Throws if BOT_TOKEN is not set.
 */
export function loadBotConfig(): BotConfig {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    throw new Error("BOT_TOKEN environment variable is required");
  }

  const botModeRaw = process.env.BOT_MODE || "polling";
  const botMode = botModeRaw === "webhook" ? "webhook" : "polling";

  const webhookUrl = process.env.BOT_WEBHOOK_URL || undefined;
  const webhookPort = parseInt(process.env.BOT_WEBHOOK_PORT || "8443", 10);
  const listenPort = parseInt(process.env.BOT_LISTEN_PORT || "3000", 10);

  return {
    botToken,
    botMode,
    webhookUrl,
    webhookPort,
    listenPort,
  };
}
