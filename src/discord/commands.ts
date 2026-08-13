import { ChannelType, SlashCommandBuilder, SlashCommandSubcommandBuilder } from "discord.js";

const eventGroup = (group: import("discord.js").SlashCommandSubcommandGroupBuilder) =>
  group
    .setName("event")
    .setDescription("Create and manage event crew signups.")
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("create")
        .setDescription("Create an event signup board.")
        .addStringOption((option) => option.setName("name").setDescription("Event name.").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("preset").setDescription("Starting slot layout.").setRequired(true).addChoices(
          { name: "Combat op", value: "combat-op" },
          { name: "Ground team", value: "ground-team" },
          { name: "Ship crew", value: "ship-crew" },
          { name: "Custom", value: "custom" },
        ))
        .addIntegerOption((option) => option.setName("loot_timelimit").setDescription("How long loot entries stay open after the event ends.").setRequired(true).addChoices(
          { name: "24 hours", value: 24 }, { name: "48 hours", value: 48 },
        ))
        .addStringOption((option) => option.setName("starts_at").setDescription("Optional start time, such as 2026-07-10 20:00 UTC.").setMaxLength(40))
        .addStringOption((option) => option.setName("description").setDescription("Optional event description.").setMaxLength(1000))
        .addStringOption((option) => option.setName("logo_url").setDescription("Optional image URL for this event.").setMaxLength(500))
        .addStringOption((option) => option.setName("custom_slots").setDescription("For Custom: Label:capacity:Category; Fighter:3:Air wing").setMaxLength(500))
        .addChannelOption((option) => option.setName("report_channel").setDescription("Where close reports and loot reports should be posted.").addChannelTypes(ChannelType.GuildText)),
    )
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("Show open signup boards for this server."))
    .addSubcommand((subcommand) => subcommand.setName("end").setDescription("End an event, post attendance, and start the loot timer.").addStringOption(
      (option) => option.setName("event_id").setDescription("Event ID from the signup board.").setRequired(true),
    ));

const lootGroup = (group: import("discord.js").SlashCommandSubcommandGroupBuilder) =>
  group
    .setName("loot")
    .setDescription("Manage participant-only event loot pools.")
    .addSubcommand((subcommand) => subcommand.setName("add").setDescription("Add items to an event loot pool.")
      .addStringOption((option) => option.setName("event_id").setDescription("Event ID from the signup board.").setRequired(true))
      .addStringOption((option) => option.setName("items").setDescription("Names separated by commas, or category|name|quantity|quality|unit.").setRequired(true).setMaxLength(800)))
    .addSubcommand((subcommand) => subcommand.setName("draw").setDescription("Draw winners for an event loot pool immediately.").addStringOption(
      (option) => option.setName("event_id").setDescription("Event ID from the signup board.").setRequired(true),
    ))
    .addSubcommand((subcommand) => subcommand.setName("show").setDescription("Post the current loot pool and bid buttons.").addStringOption(
      (option) => option.setName("event_id").setDescription("Event ID from the signup board.").setRequired(true),
    ));

const musterCommand = new SlashCommandBuilder()
  .setName("mc")
  .setDescription("Muster Command event and loot controls.")
  .addSubcommandGroup(eventGroup)
  .addSubcommandGroup(lootGroup);

export const commands = [musterCommand.toJSON()];
