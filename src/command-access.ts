export const commandCapabilities = [
  "event.create",
  "event.list",
  "event.end",
  "loot.add",
  "loot.show",
  "loot.draw",
] as const;

export type CommandCapability = (typeof commandCapabilities)[number];

export const defaultTier2Capabilities: CommandCapability[] = ["event.end", "loot.add"];
export const defaultTier3Capabilities: CommandCapability[] = ["event.list", "loot.show"];

export type CommandAccessSettings = {
  tier1RoleIds?: string;
  tier2RoleIds?: string;
  tier3RoleIds?: string;
  tier2Capabilities?: string;
  tier3Capabilities?: string;
};

export const commandAccessForGuild = (
  serialized: string | undefined,
  guildId: string,
): CommandAccessSettings => {
  if (!serialized) return {};
  try {
    const parsed = JSON.parse(serialized) as Record<string, CommandAccessSettings>;
    return parsed[guildId] ?? {};
  } catch {
    return {};
  }
};

export const updateCommandAccessForGuild = (
  serialized: string | undefined,
  guildId: string,
  access: CommandAccessSettings,
) => {
  let parsed: Record<string, CommandAccessSettings> = {};
  try {
    parsed = serialized ? JSON.parse(serialized) as Record<string, CommandAccessSettings> : {};
  } catch {
    parsed = {};
  }
  return JSON.stringify({ ...parsed, [guildId]: access });
};

const values = (input: string | undefined) =>
  new Set((input ?? "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean));

export const configuredCapabilities = (
  input: string | undefined,
  defaults: readonly CommandCapability[],
) => {
  if (input === undefined) return new Set<CommandCapability>(defaults);
  const configured = values(input);
  return new Set(commandCapabilities.filter((capability) => configured.has(capability)));
};

export const memberCommandTier = (roleIds: Iterable<string>, settings: CommandAccessSettings) => {
  const memberRoles = new Set(roleIds);
  if ([...values(settings.tier1RoleIds)].some((id) => memberRoles.has(id))) return 1;
  if ([...values(settings.tier2RoleIds)].some((id) => memberRoles.has(id))) return 2;
  if ([...values(settings.tier3RoleIds)].some((id) => memberRoles.has(id))) return 3;
  return undefined;
};

export const tierAllowsCapability = (
  tier: 1 | 2 | 3 | undefined,
  capability: CommandCapability,
  settings: CommandAccessSettings,
) => {
  if (tier === 1) return true;
  const tier3 = configuredCapabilities(settings.tier3Capabilities, defaultTier3Capabilities);
  if (tier === 3) return tier3.has(capability);
  if (tier === 2) {
    const tier2 = configuredCapabilities(settings.tier2Capabilities, defaultTier2Capabilities);
    return tier2.has(capability) || tier3.has(capability);
  }
  return false;
};
