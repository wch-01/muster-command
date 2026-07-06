import { registerCommands } from "./discord/register-commands.js";
import { loadSettings } from "./settings-store.js";

const scope = await registerCommands(await loadSettings());
console.log(`Registered command groups for ${scope}.`);
