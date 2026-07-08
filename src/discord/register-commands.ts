import { REST, Routes } from "discord.js";
import { isDiscordConfigured, type DiscordSettings } from "../config.js";
import { commands } from "./commands.js";

export const registerCommands = async (settings: DiscordSettings) => {
  if (!isDiscordConfigured(settings)) {
    throw new Error("Discord token and client ID are required before commands can be registered.");
  }

  const rest = new REST({ version: "10" }).setToken(settings.discordToken!);
  await rest.put(Routes.applicationCommands(settings.discordClientId!), { body: commands });

  return "global";
};

export const registerGuildCommands = async (settings: DiscordSettings, guildId: string) => {
  if (!isDiscordConfigured(settings) || !guildId) {
    throw new Error("Discord token, App ID, and selected server are required.");
  }

  const rest = new REST({ version: "10" }).setToken(settings.discordToken!);
  await rest.put(Routes.applicationGuildCommands(settings.discordClientId!, guildId), {
    body: commands,
  });

  return `selected server ${guildId}`;
};

export const registerGlobalCommands = async (settings: DiscordSettings) => {
  if (!isDiscordConfigured(settings)) {
    throw new Error("Discord token and App ID are required.");
  }

  const rest = new REST({ version: "10" }).setToken(settings.discordToken!);
  await rest.put(Routes.applicationCommands(settings.discordClientId!), { body: commands });

  return "global";
};
