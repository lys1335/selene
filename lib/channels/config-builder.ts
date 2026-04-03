import type { ChannelConnectionConfig, ChannelType } from "./types";

function normalizeBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

/**
 * Normalize raw config input into a typed ChannelConnectionConfig.
 * Throws if required fields are missing for the given channel type.
 */
export function buildChannelConfig(
  channelType: ChannelType,
  config: Record<string, unknown> | undefined,
  label?: string | null
): ChannelConnectionConfig {
  if (channelType === "whatsapp") {
    return {
      type: "whatsapp",
      label: typeof label === "string" ? label : undefined,
      authPath: typeof config?.authPath === "string" ? config.authPath : undefined,
      selfChatMode: normalizeBool(config?.selfChatMode),
    };
  }

  if (channelType === "telegram") {
    const botToken = typeof config?.botToken === "string" ? config.botToken.trim() : "";
    if (!botToken) {
      throw new Error("Telegram bot token is required");
    }
    return {
      type: "telegram",
      botToken,
      label: typeof label === "string" ? label : undefined,
    };
  }

  if (channelType === "discord") {
    const botToken = typeof config?.botToken === "string" ? config.botToken.trim() : "";
    if (!botToken) {
      throw new Error("Discord bot token is required");
    }
    return {
      type: "discord",
      botToken,
      label: typeof label === "string" ? label : undefined,
    };
  }

  const botToken = typeof config?.botToken === "string" ? config.botToken.trim() : "";
  const appToken = typeof config?.appToken === "string" ? config.appToken.trim() : "";
  const signingSecret =
    typeof config?.signingSecret === "string" ? config.signingSecret.trim() : "";
  if (!botToken || !appToken || !signingSecret) {
    throw new Error("Slack bot token, app token, and signing secret are required");
  }
  return {
    type: "slack",
    botToken,
    appToken,
    signingSecret,
    label: typeof label === "string" ? label : undefined,
  };
}
