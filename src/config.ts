import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  APPLICATION_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  ADMIN_DISCORD_USER_IDS: z.string().optional(),
  STATE: z.enum(["development", "production"]).default("production"),
  DATABASE_URL: z.string().url().optional(),
  BOT_TIMEZONE: z.string().default("UTC"),
  SETUP_HOST: z.string().default("0.0.0.0"),
  SETUP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SETTINGS_FILE: z.string().default("./data/settings.json"),
  ADMIN_ALLOWED_HOSTS: z
    .string()
    .default("localhost,127.0.0.1,::1"),
});

export const envConfig = schema.parse(process.env);

export type DiscordSettings = {
  discordToken?: string;
  discordClientId?: string;
  discordClientSecret?: string;
  adminDiscordUserIds?: string;
  eventOutputMode?: "channel" | "thread";
  eventOutputChannelId?: string;
  lootOutputChannelId?: string;
  threadAutoDeleteDays?: number;
  templateControlUserIds?: string;
  templateControlRoleIds?: string;
};

export const settingsFromEnv = (): DiscordSettings => ({
  discordToken: envConfig.DISCORD_TOKEN || envConfig.DISCORD_BOT_TOKEN,
  discordClientId: envConfig.DISCORD_CLIENT_ID || envConfig.APPLICATION_ID,
  discordClientSecret: envConfig.DISCORD_CLIENT_SECRET,
  adminDiscordUserIds: envConfig.ADMIN_DISCORD_USER_IDS,
});

export const isDiscordConfigured = (settings: DiscordSettings) => {
  return Boolean(settings.discordToken && settings.discordClientId);
};
