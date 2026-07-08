import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { type DiscordSettings, envConfig, settingsFromEnv } from "./config.js";

const savedSettingsSchema = z.object({
  discordToken: z.string().optional(),
  discordClientId: z.string().optional(),
  discordClientSecret: z.string().optional(),
  discordGuildId: z.string().optional(),
  adminDiscordUserIds: z.string().optional(),
  eventOutputMode: z.enum(["channel", "thread"]).optional(),
  eventOutputChannelId: z.string().optional(),
  lootOutputChannelId: z.string().optional(),
  threadAutoDeleteDays: z.coerce.number().int().min(1).max(30).optional(),
  templateControlUserIds: z.string().optional(),
  templateControlRoleIds: z.string().optional(),
});

const normalize = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const hasSetting = <K extends keyof DiscordSettings>(input: DiscordSettings, key: K) => {
  return Object.prototype.hasOwnProperty.call(input, key);
};

const textSetting = <K extends keyof DiscordSettings>(
  input: DiscordSettings,
  existing: DiscordSettings,
  key: K,
) => {
  return hasSetting(input, key) ? normalize(input[key] as string | undefined) : existing[key];
};

export const loadSavedSettings = async (): Promise<DiscordSettings> => {
  try {
    const raw = await readFile(envConfig.SETTINGS_FILE, "utf8");
    return savedSettingsSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
};

export const loadSettings = async (): Promise<DiscordSettings> => {
  return {
    ...settingsFromEnv(),
    ...(await loadSavedSettings()),
  };
};

export const saveSettings = async (
  input: DiscordSettings,
  existing: DiscordSettings,
): Promise<DiscordSettings> => {
  const next = {
    ...existing,
    discordToken: normalize(input.discordToken) ?? existing.discordToken,
    discordClientId: textSetting(input, existing, "discordClientId"),
    discordClientSecret: normalize(input.discordClientSecret) ?? existing.discordClientSecret,
    discordGuildId: textSetting(input, existing, "discordGuildId"),
    adminDiscordUserIds: textSetting(input, existing, "adminDiscordUserIds"),
    eventOutputMode:
      input.eventOutputMode === "thread" || input.eventOutputMode === "channel"
        ? input.eventOutputMode
        : existing.eventOutputMode ?? "channel",
    eventOutputChannelId: textSetting(input, existing, "eventOutputChannelId"),
    lootOutputChannelId: textSetting(input, existing, "lootOutputChannelId"),
    threadAutoDeleteDays: hasSetting(input, "threadAutoDeleteDays")
      ? input.threadAutoDeleteDays
      : existing.threadAutoDeleteDays ?? 7,
    templateControlUserIds: textSetting(input, existing, "templateControlUserIds"),
    templateControlRoleIds: textSetting(input, existing, "templateControlRoleIds"),
  };

  await mkdir(dirname(envConfig.SETTINGS_FILE), { recursive: true });
  await writeFile(envConfig.SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
};
