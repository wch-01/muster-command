import { REST, Routes } from "discord.js";
import { isDiscordConfigured, type DiscordSettings } from "../config.js";
import { commands } from "./commands.js";

export const registerCommands = async (settings: DiscordSettings) => {
  if (!isDiscordConfigured(settings)) {
    throw new Error("Discord token and client ID are required before commands can be registered.");
  }

  const rest = new REST({ version: "10" }).setToken(settings.discordToken!);
  const route = settings.discordGuildId
    ? Routes.applicationGuildCommands(settings.discordClientId!, settings.discordGuildId)
    : Routes.applicationCommands(settings.discordClientId!);

  await rest.put(route, { body: commands });

  return settings.discordGuildId ? `guild ${settings.discordGuildId}` : "global";
};

export const registerTestGuildCommands = async (settings: DiscordSettings) => {
  if (!isDiscordConfigured(settings) || !settings.discordGuildId) {
    throw new Error("Discord token, App ID, and test server ID are required.");
  }

  const rest = new REST({ version: "10" }).setToken(settings.discordToken!);
  await rest.put(Routes.applicationGuildCommands(settings.discordClientId!, settings.discordGuildId), {
    body: commands,
  });

  return `test server ${settings.discordGuildId}`;
};

export const registerGlobalCommands = async (settings: DiscordSettings) => {
  if (!isDiscordConfigured(settings)) {
    throw new Error("Discord token and App ID are required.");
  }

  const rest = new REST({ version: "10" }).setToken(settings.discordToken!);
  await rest.put(Routes.applicationCommands(settings.discordClientId!), { body: commands });

  return "global";
};
