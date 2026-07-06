import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { type DiscordSettings, envConfig, settingsFromEnv } from "./config.js";

const savedSettingsSchema = z.object({
  discordToken: z.string().optional(),
  discordClientId: z.string().optional(),
  discordGuildId: z.string().optional(),
});

const normalize = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
    discordToken: normalize(input.discordToken) ?? existing.discordToken,
    discordClientId: normalize(input.discordClientId),
    discordGuildId: normalize(input.discordGuildId),
  };

  await mkdir(dirname(envConfig.SETTINGS_FILE), { recursive: true });
  await writeFile(envConfig.SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
};
