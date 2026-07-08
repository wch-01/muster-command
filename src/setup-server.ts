import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { envConfig, isDiscordConfigured, type DiscordSettings } from "./config.js";
import {
  registerGlobalCommands,
  registerTestGuildCommands,
} from "./discord/register-commands.js";
import {
  botGuildMemberProfile,
  botGuildPermissionOptions,
  botGuilds,
  botStatus,
  startBot,
} from "./bot-runtime.js";
import { loadSettings, saveSettings } from "./settings-store.js";
import { handleApiRequest } from "./web-api.js";
import { addEventStreamClient } from "./event-stream.js";
import {
  authConfig,
  beginDiscordLogin,
  completeDiscordLogin,
  getSession,
  getSessionUser,
  isAdminUser,
  isLoginConfigured,
  logout,
  renderLoginPage,
  requireAuthenticatedApiUser,
  requireAuthenticatedUser,
  setActiveGuild,
  type AuthenticatedUser,
} from "./auth.js";

const escapeHtml = (value: string | undefined) => {
  return (value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
};

const webAppRoot = join(process.cwd(), "public", "browser");

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const serveWebApp = async (
  url: URL,
  response: import("node:http").ServerResponse,
  sessionData?: unknown,
) => {
  if (url.pathname !== "/app" && !url.pathname.startsWith("/app/")) {
    return false;
  }

  const requestPath = url.pathname === "/app" ? "/" : url.pathname.slice("/app".length);
  const normalizedPath = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(webAppRoot, normalizedPath);

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
  } catch {
    filePath = join(webAppRoot, "index.html");
  }

  const contentType = mimeTypes[extname(filePath)] ?? "application/octet-stream";
  let content = await readFile(filePath);
  if (contentType.startsWith("text/html") && sessionData) {
    const html = content.toString("utf8");
    const script = `<script>window.__STARBOT_SESSION__=${JSON.stringify(sessionData).replaceAll("</script", "<\\/script")};</script>`;
    content = Buffer.from(html.replace("</head>", `${script}</head>`), "utf8");
  }

  response.writeHead(200, { "content-type": contentType });
  response.end(content);
  return true;
};

const idSet = (value: string | undefined) =>
  new Set(
    (value ?? "")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );

const inviteUrl = (appId: string | undefined) => {
  if (!appId) {
    return undefined;
  }

  const params = new URLSearchParams({
    client_id: appId,
    permissions: "84992",
    scope: "bot applications.commands",
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
};

const readRequestBody = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 20_000) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
};

const normalizeHost = (host: string | undefined) => {
  const value = (host ?? "").toLowerCase();
  if (value.startsWith("[")) {
    return value.slice(1, value.indexOf("]"));
  }

  return value.replace(/:\d+$/, "");
};

const isAdminRequestAllowed = (request: import("node:http").IncomingMessage) => {
  const host = normalizeHost(request.headers.host);
  const allowedHosts = envConfig.ADMIN_ALLOWED_HOSTS.split(",").map((value) =>
    normalizeHost(value.trim()),
  );

  return allowedHosts.includes(host);
};

const canSeeSuperAdminLink = (
  request: import("node:http").IncomingMessage,
  settings: DiscordSettings,
  user: AuthenticatedUser | undefined,
) => {
  const adminUserIds = authConfig(settings).adminUserIds;
  return isAdminUser(settings, user) || (!adminUserIds.length && isAdminRequestAllowed(request));
};

type SharedServer = {
  id: string;
  name: string;
  userProfile?: Awaited<ReturnType<typeof botGuildMemberProfile>>;
};

const availableServersForUser = async (user: AuthenticatedUser | undefined): Promise<SharedServer[]> => {
  const installed = botGuilds();
  const userGuilds = user?.guilds ?? [];
  const userGuildIds = new Set(userGuilds.map((guild) => guild.id));
  const sharedServers = installed.filter((guild) => userGuildIds.has(guild.id));

  if (!user) {
    return sharedServers.map((server) => ({ ...server }));
  }

  return Promise.all(
    sharedServers.map(async (server) => ({
      ...server,
      userProfile: await botGuildMemberProfile(server.id, user),
    })),
  );
};

const activeServerForRequest = async (
  request: import("node:http").IncomingMessage,
  user: AuthenticatedUser,
) => {
  const servers = await availableServersForUser(user);
  const session = getSession(request);
  const active =
    servers.find((server) => server.id === session?.activeGuildId) ?? servers[0] ?? undefined;
  if (active && session?.activeGuildId !== active.id) {
    setActiveGuild(request, active.id);
  }

  return { active, servers };
};

const sessionPayload = async (
  request: import("node:http").IncomingMessage,
  settings: DiscordSettings,
  user: AuthenticatedUser,
) => {
  const { active, servers } = await activeServerForRequest(request, user);
  return {
    user: {
      id: user.id,
      username: user.username,
      globalName: user.globalName,
      avatar: user.avatar,
    },
    isSuperAdmin: isAdminUser(settings, user),
    activeServer: active,
    servers,
    requiresServerSetup: servers.length === 0,
    requiresGuildReconnect: !Array.isArray(user.guilds),
  };
};

const requireAdminAccess = (
  request: import("node:http").IncomingMessage,
  settings: DiscordSettings,
  user: AuthenticatedUser | undefined,
) => {
  const adminUserIds = authConfig(settings).adminUserIds;
  if (adminUserIds.length && isAdminUser(settings, user)) {
    return;
  }

  if (!adminUserIds.length && isAdminRequestAllowed(request)) {
    return;
  }

  if (adminUserIds.length) {
    throw new Error("Admin access is only available to the configured Discord admin user.");
  }

  const host = request.headers.host ?? "unknown host";
  throw new Error(`Admin access is not allowed from ${host}. Use localhost or Tailscale.`);
};

const renderTopMenu = (
  active: "app" | "commands" | "admin" | "super-admin",
  settings: DiscordSettings,
  user: AuthenticatedUser | undefined,
  showSuperAdmin: boolean,
  activeServer?: { id: string; name: string; userProfile?: { displayName: string } },
  servers: Array<{ id: string; name: string; userProfile?: { displayName: string } }> = [],
) => {
  const item = (href: string, label: string, key: typeof active) =>
    `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`;
  const profileName = activeServer?.userProfile?.displayName ?? user?.globalName ?? user?.username;

  return `<header class="top-menu">
    <a class="brand" href="/app/active-events">Star Citizen Events</a>
    <nav aria-label="Primary navigation">
      <div class="menu-group">
        <button type="button">Events</button>
        <div class="menu-dropdown">
          <a href="/app/active-events">Active Events</a>
          <a href="/app/events">Create Event</a>
          <a href="/app/past-events">Past Events</a>
        </div>
      </div>
      ${item("/slash-commands", "Commands", "commands")}
      ${item("/admin", "Admin", "admin")}
      ${showSuperAdmin ? item("/super-admin", "Super Admin", "super-admin") : ""}
    </nav>
    <div class="user-menu">
      ${
        `<form class="server-select" method="post" action="/active-server">
                <label for="activeGuildId">Active Server</label>
                <select id="activeGuildId" name="guildId" onchange="this.form.submit()">
                  ${servers
                    .map(
                      (server) =>
                        `<option value="${escapeHtml(server.id)}" ${server.id === activeServer?.id ? "selected" : ""}>${escapeHtml(server.name)}</option>`,
                    )
                    .join("")}
                  ${servers.length ? "" : `<option value="">No shared server</option>`}
                </select>
              </form>`
      }
        ${profileName ? `<span>${escapeHtml(profileName)}</span>` : ""}
      <a href="/logout">Log out</a>
    </div>
  </header>`;
};

const renderPageStyles = () => `<style>
      :root {
        color-scheme: light;
        font-family: Arial, sans-serif;
        background: #f4f6f8;
        color: #17202a;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #f4f6f8;
      }
      .top-menu {
        min-height: 56px;
        display: flex;
        align-items: center;
        gap: 18px;
        padding: 0 18px;
        background: #ffffff;
        border-bottom: 1px solid #d7dde4;
        box-shadow: 0 4px 14px rgba(16, 24, 40, 0.05);
      }
      .brand {
        color: #17202a;
        font-size: 18px;
        font-weight: 700;
        text-decoration: none;
        white-space: nowrap;
      }
      nav {
        display: flex;
        gap: 4px;
        align-items: center;
        flex: 1;
        flex-wrap: wrap;
      }
      nav a,
      .user-menu a,
      .menu-group > button {
        border-radius: 6px;
        border: 0;
        background: transparent;
        color: #334155;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 8px 10px;
        text-decoration: none;
      }
      nav a.active {
        color: #ffffff;
        background: #1f6feb;
      }
      .menu-group {
        position: relative;
      }
      .menu-group > button {
        display: block;
      }
      .menu-group:hover > button,
      .menu-group:focus-within > button {
        color: #ffffff;
        background: #1f6feb;
      }
      .menu-dropdown {
        display: none;
        position: absolute;
        z-index: 10;
        top: 100%;
        left: 0;
        min-width: 170px;
        padding: 6px;
        background: #ffffff;
        border: 1px solid #d7dde4;
        border-radius: 8px;
        box-shadow: 0 12px 30px rgba(16, 24, 40, 0.12);
      }
      .menu-dropdown a {
        display: block;
      }
      .menu-group:hover .menu-dropdown,
      .menu-group:focus-within .menu-dropdown {
        display: block;
      }
      .user-menu {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #64748b;
        font-size: 14px;
      }
      .user-menu form {
        margin: 0;
      }
      .server-select {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .server-select label {
        color: #475569;
        font-weight: 700;
      }
      .user-menu select {
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 7px 8px;
        font: inherit;
      }
      .page-wrap {
        display: grid;
        place-items: start center;
        padding: 32px 16px 48px;
      }
      main {
        width: min(720px, 100%);
        background: #ffffff;
        border: 1px solid #d7dde4;
        border-radius: 8px;
        padding: 28px;
        box-shadow: 0 12px 30px rgba(16, 24, 40, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      h2 {
        margin: 24px 0 10px;
        font-size: 20px;
      }
      h3 {
        margin: 18px 0 8px;
        font-size: 16px;
      }
      .status {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 18px 0 24px;
      }
      .stats {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin: 0 0 24px;
      }
      .stat {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 12px;
        background: #f8fafc;
      }
      .stat strong {
        display: block;
        font-size: 13px;
        color: #64748b;
        margin-bottom: 4px;
      }
      .badge {
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 14px;
        font-weight: 700;
      }
      .ok {
        color: #065f46;
        background: #d1fae5;
      }
      .warn {
        color: #92400e;
        background: #fef3c7;
      }
      .neutral {
        color: #334155;
        background: #e2e8f0;
      }
      label {
        display: block;
        margin: 16px 0 6px;
        font-weight: 700;
      }
      input[type="text"],
      input[type="password"],
      input[type="number"],
      select,
      textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 11px 12px;
        font: inherit;
      }
      textarea {
        min-height: 84px;
        resize: vertical;
      }
      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 14px;
      }
      .hint,
      .muted {
        margin: 6px 0 0;
        color: #64748b;
        font-size: 14px;
      }
      .notice {
        margin: 0 0 18px;
        padding: 12px;
        border-radius: 6px;
        background: #eff6ff;
        color: #1e3a8a;
      }
      .actions {
        margin-top: 24px;
        display: flex;
        align-items: center;
        gap: 14px;
        flex-wrap: wrap;
      }
      .button,
      button {
        border: 0;
        border-radius: 6px;
        padding: 11px 16px;
        font: inherit;
        font-weight: 700;
        color: #ffffff;
        background: #2563eb;
        cursor: pointer;
        text-decoration: none;
        display: inline-block;
      }
      .secondary {
        background: #475569;
      }
      .checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 400;
        margin: 0;
      }
      .check-list {
        display: grid;
        gap: 8px;
        max-height: 320px;
        overflow: auto;
        padding: 8px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #ffffff;
      }
      .option-row {
        align-items: flex-start;
        padding: 6px;
      }
      .option-row small {
        display: block;
        color: #64748b;
      }
      .permissions-grid {
        align-items: start;
      }
      .invite,
      .panel {
        margin-top: 24px;
        padding: 14px;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        background: #eff6ff;
      }
      .invite a,
      .quick-links a,
      main a {
        color: #1d4ed8;
        font-weight: 700;
      }
      .quick-links {
        margin-top: 18px;
      }
      .help {
        margin-top: 28px;
        border-top: 1px solid #e2e8f0;
        padding-top: 22px;
      }
      ul {
        margin: 8px 0 0;
        padding-left: 22px;
      }
      li {
        margin: 6px 0;
      }
      code,
      pre {
        background: #f1f5f9;
        border-radius: 4px;
      }
      code {
        padding: 2px 5px;
      }
      pre {
        overflow-x: auto;
        padding: 12px;
      }
      @media (max-width: 720px) {
        .top-menu {
          align-items: flex-start;
          flex-direction: column;
          padding: 12px;
        }
        .user-menu {
          width: 100%;
          justify-content: space-between;
        }
      }
    </style>`;

const renderSuperAdminPage = (
  settings: DiscordSettings,
  notice?: string,
  user?: AuthenticatedUser,
  showSuperAdmin = true,
  activeServer?: { id: string; name: string },
  servers: Array<{ id: string; name: string }> = [],
) => {
  const configured = isDiscordConfigured(settings);
  const loginConfigured = isLoginConfigured(settings);
  const status = botStatus(settings);
  const badge = configured ? "Configured" : "Not configured";
  const badgeClass = configured ? "ok" : "warn";
  const connection = status.connected ? `Connected as ${status.userTag}` : "Not connected";
  const installedServers = status.connected
    ? `${status.guildCount} installed server${status.guildCount === 1 ? "" : "s"}`
    : "Installed server count unavailable";
  const guildBadge =
    status.inConfiguredGuild === undefined
      ? undefined
      : status.inConfiguredGuild
        ? "In selected server"
        : "Not in selected server";
  const guildBadgeClass = status.inConfiguredGuild ? "ok" : "warn";
  const generatedInviteUrl = inviteUrl(settings.discordClientId);
  const adminIdsConfigured = authConfig(settings).adminUserIds.length > 0;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Super Admin</title>
    ${renderPageStyles()}
  </head>
  <body>
    ${renderTopMenu("super-admin", settings, user, showSuperAdmin, activeServer, servers)}
    <div class="page-wrap">
    <main>
      <h1>Super Admin</h1>
      ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
      <div class="status">
        <span class="badge ${badgeClass}">${badge}</span>
        <span class="badge neutral">${escapeHtml(connection)}</span>
        ${guildBadge ? `<span class="badge ${guildBadgeClass}">${guildBadge}</span>` : ""}
      </div>
      <div class="stats">
        <div class="stat"><strong>Installed Servers</strong>${escapeHtml(installedServers)}</div>
        <div class="stat"><strong>Command Mode</strong>Test server for fast updates, global for public servers</div>
        <div class="stat"><strong>Invite</strong>${generatedInviteUrl ? `<a href="/admin">Available on Admin</a>` : "Save Application ID first"}</div>
        <div class="stat"><strong>Discord Login</strong>${loginConfigured ? "Configured" : "Needs Client Secret"}</div>
        <div class="stat"><strong>Signed In</strong>${user ? escapeHtml(user.globalName ?? user.username) : "Bootstrap mode"}</div>
        <div class="stat"><strong>Admin Lock</strong>${adminIdsConfigured ? "Discord user ID required" : "Local/Tailscale bootstrap"}</div>
      </div>
      <form method="post" action="/settings">
        <label for="discordClientId">Application ID</label>
        <input id="discordClientId" name="discordClientId" type="text" value="${escapeHtml(settings.discordClientId)}" autocomplete="off" />
        <p class="hint">Developer Portal path: your app -> General Information -> Application ID.</p>

        <label for="discordClientSecret">Client secret</label>
        <input id="discordClientSecret" name="discordClientSecret" type="password" autocomplete="off" placeholder="${settings.discordClientSecret ? "Client secret saved - leave blank to keep it" : "Paste OAuth2 client secret"}" />
        <p class="hint">Developer Portal path: your app -> OAuth2 -> General -> Client Secret. Add <code>${escapeHtml("http://localhost:3000/auth/discord/callback")}</code> as a redirect while testing locally.</p>

        <label for="discordToken">Bot token</label>
        <input id="discordToken" name="discordToken" type="password" autocomplete="off" placeholder="${settings.discordToken ? "Token saved - leave blank to keep it" : "Paste bot token"}" />
        <p class="hint">Developer Portal path: your app -> Bot -> Token -> Reset Token or View Token. The saved token is never shown again.</p>

        <label for="discordGuildId">Discord server ID</label>
        <input id="discordGuildId" name="discordGuildId" type="text" value="${escapeHtml(settings.discordGuildId)}" autocomplete="off" />
        <p class="hint">Discord path: enable Developer Mode, left click your server icon, then use Copy Server ID at the end of the menu.</p>

        <label for="adminDiscordUserIds">Admin Discord user ID</label>
        <input id="adminDiscordUserIds" name="adminDiscordUserIds" type="text" value="${escapeHtml(settings.adminDiscordUserIds)}" autocomplete="off" />
        <p class="hint">Discord path: enable Developer Mode, left click your user profile, then use Copy User ID at the end of the menu. Separate multiple admin IDs with commas.</p>

        <div class="actions">
          <button type="submit">Save settings</button>
          <label class="checkbox">
            <input type="checkbox" name="registerCommands" value="yes" checked />
            Register slash commands to test server after saving
          </label>
        </div>
      </form>
      <div class="actions" aria-label="Command registration">
        <form method="post" action="/register-test">
          <button class="secondary" type="submit">Register commands to test server</button>
        </form>
        <form method="post" action="/register-global">
          <button type="submit">Register commands globally</button>
        </form>
      </div>
      ${
        generatedInviteUrl
          ? `<section class="invite" aria-label="Invite bot">
              <strong>Bot not in your server yet?</strong>
              <p>Open this invite link, choose your server, and approve the requested scopes and permissions.</p>
              <p><a href="${escapeHtml(generatedInviteUrl)}" target="_blank" rel="noreferrer">Invite this bot to Discord</a></p>
            </section>`
          : `<section class="invite" aria-label="Invite bot">
              <strong>Bot not in your server yet?</strong>
              <p>Save your Application ID first, then this page will show an invite link.</p>
            </section>`
      }
      <p class="quick-links"><a href="/admin" target="_blank" rel="noreferrer">Open server admin page</a> | <a href="/slash-commands" target="_blank" rel="noreferrer">Open slash command reference</a></p>
      <section class="help" aria-label="Discord setup help">
        <h2>Discord Developer Portal fields</h2>
        <ul>
          <li><strong>Bot token:</strong> your app -> <code>Bot</code> -> <code>Token</code>. Keep this private.</li>
          <li><strong>Application ID:</strong> your app -> <code>General Information</code> -> <code>Application ID</code>.</li>
          <li><strong>Public Key:</strong> not needed for this bot.</li>
        </ul>

        <h3>Invite scopes</h3>
        <ul>
          <li><code>bot</code></li>
          <li><code>applications.commands</code> for slash commands</li>
        </ul>

        <h3>Recommended bot permission checkboxes</h3>
        <ul>
          <li>View Channels</li>
          <li>Send Messages</li>
          <li>Embed Links</li>
          <li>Read Message History</li>
        </ul>
      </section>
    </main>
    </div>
  </body>
</html>`;
};

const renderCheckboxList = (
  name: string,
  items: Array<{ id: string; name: string; username?: string }>,
  selected: Set<string>,
) => {
  if (!items.length) {
    return `<p class="muted">No options available.</p>`;
  }

  return `<div class="check-list">
    ${items
      .map(
        (item) => `<label class="checkbox option-row">
          <input type="checkbox" name="${name}" value="${escapeHtml(item.id)}" ${selected.has(item.id) ? "checked" : ""} />
          <span>${escapeHtml(item.name)}${item.username && item.username !== item.name ? ` <small>${escapeHtml(item.username)}</small>` : ""}</span>
        </label>`,
      )
      .join("")}
  </div>`;
};

const renderAdminPage = async (
  settings: DiscordSettings,
  user: AuthenticatedUser | undefined,
  showSuperAdmin: boolean,
  activeServer?: { id: string; name: string },
  servers: Array<{ id: string; name: string }> = [],
  notice?: string,
) => {
  const generatedInviteUrl = inviteUrl(settings.discordClientId);
  const outputMode = settings.eventOutputMode ?? "channel";
  const cleanupDays = settings.threadAutoDeleteDays ?? 7;
  const permissionOptions = activeServer
    ? await botGuildPermissionOptions(activeServer.id)
    : { roles: [], users: [], userListAvailable: false };
  const selectedTemplateRoles = idSet(settings.templateControlRoleIds);
  const selectedTemplateUsers = idSet(settings.templateControlUserIds);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin</title>
    ${renderPageStyles()}
  </head>
  <body>
    ${renderTopMenu("admin", settings, user, showSuperAdmin, activeServer, servers)}
    <div class="page-wrap">
      <main>
        <h1>Admin</h1>
        ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
        <p class="muted">Manage how this server uses the bot.</p>

        <section class="panel">
          <h2>Invite Bot</h2>
          <p>Add the hosted bot to your Discord server to create Star Citizen event signups and participant-only loot pools.</p>
          ${
            generatedInviteUrl
              ? `<p><a class="button" href="${escapeHtml(generatedInviteUrl)}" target="_blank" rel="noreferrer">Invite bot to your server</a></p>`
              : `<p class="notice">The bot owner needs to configure the Application ID on Super Admin before this invite link can be generated.</p>`
          }
          <h3>Discord will ask for</h3>
          <ul>
            <li><code>bot</code> scope</li>
            <li><code>applications.commands</code> scope</li>
            <li>View Channels</li>
            <li>Send Messages</li>
            <li>Embed Links</li>
            <li>Read Message History</li>
          </ul>
        </section>

        <section class="panel">
          <h2>Bot Output</h2>
          <form method="post" action="/admin/settings">
            <label for="eventOutputMode">Event output method</label>
            <select id="eventOutputMode" name="eventOutputMode" onchange="updateOutputFields()">
              <option value="channel" ${outputMode === "channel" ? "selected" : ""}>Dedicated channels</option>
              <option value="thread" ${outputMode === "thread" ? "selected" : ""}>One thread per event</option>
            </select>
            <p class="hint">Thread mode creates a separate event thread inside the selected channel.</p>

            <div class="form-grid">
              <div>
                <label for="eventOutputChannelId">Channel ID</label>
                <input id="eventOutputChannelId" name="eventOutputChannelId" type="text" value="${escapeHtml(settings.eventOutputChannelId)}" autocomplete="off" />
                <p class="hint" data-output-help="channel">Where event signup panels should be posted.</p>
                <p class="hint" data-output-help="thread">Where event threads should be created.</p>
              </div>
              <div data-output-field="loot">
                <label for="lootOutputChannelId">Loot output channel ID</label>
                <input id="lootOutputChannelId" name="lootOutputChannelId" type="text" value="${escapeHtml(settings.lootOutputChannelId)}" autocomplete="off" />
                <p class="hint">Where loot updates and draw results should be posted.</p>
              </div>
              <div data-output-field="threadCleanup">
                <label for="threadAutoDeleteDays">Thread cleanup after loot draw, in days</label>
                <input id="threadAutoDeleteDays" name="threadAutoDeleteDays" type="number" min="1" max="30" value="${cleanupDays}" />
                <p class="hint">7 days is one week.</p>
              </div>
            </div>

            <h2>Permissions</h2>
            <p class="hint">Event and loot bot controls are available to every logged-in user in this server. These permissions are for the upcoming template creation page.</p>
            <div class="form-grid permissions-grid">
              <div>
                <h3>Template manager roles</h3>
                ${renderCheckboxList("templateControlRoleIds", permissionOptions.roles, selectedTemplateRoles)}
              </div>
              <div>
                <h3>Template manager users</h3>
                ${
                  permissionOptions.userListAvailable
                    ? renderCheckboxList("templateControlUserIds", permissionOptions.users, selectedTemplateUsers)
                    : `<p class="notice">Discord did not return the server member list. Enable the bot's Server Members Intent in the Discord Developer Portal if you want user checkboxes here.</p>
                      ${[...selectedTemplateUsers]
                        .map((id) => `<input type="hidden" name="templateControlUserIds" value="${escapeHtml(id)}" />`)
                        .join("")}`
                }
              </div>
            </div>

            <div class="actions">
              <button type="submit">Save Admin Settings</button>
              <a class="button secondary" href="/slash-commands" target="_blank" rel="noreferrer">Commands</a>
            </div>
          </form>
        </section>
      </main>
    </div>
    <script>
      const updateOutputFields = () => {
        const mode = document.getElementById("eventOutputMode")?.value;
        document.querySelectorAll("[data-output-field='loot']").forEach((field) => {
          field.hidden = mode === "thread";
          field.querySelectorAll("input, select, textarea").forEach((input) => input.disabled = mode === "thread");
        });
        document.querySelectorAll("[data-output-field='threadCleanup']").forEach((field) => {
          field.hidden = mode === "channel";
          field.querySelectorAll("input, select, textarea").forEach((input) => input.disabled = mode === "channel");
        });
        document.querySelectorAll("[data-output-help]").forEach((field) => {
          field.hidden = field.getAttribute("data-output-help") !== mode;
        });
      };
      updateOutputFields();
    </script>
  </body>
</html>`;
};

const markdownToHtml = (markdown: string) => {
  const lines = markdown.split(/\r?\n/);
  let html = "";
  let inList = false;
  let inCode = false;
  let codeLines: string[] = [];

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html += `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`;
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      html += `<h3>${escapeHtml(line.slice(4))}</h3>`;
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      html += `<h2>${escapeHtml(line.slice(3))}</h2>`;
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      html += `<h1>${escapeHtml(line.slice(2))}</h1>`;
      continue;
    }

    if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    closeList();
    html += `<p>${escapeHtml(line)}</p>`;
  }

  closeList();
  return html.replaceAll(/`([^`]+)`/g, "<code>$1</code>");
};

const renderCommandsPage = (
  settings: DiscordSettings,
  user: AuthenticatedUser | undefined,
  showSuperAdmin: boolean,
  markdown: string,
  activeServer?: { id: string; name: string },
  servers: Array<{ id: string; name: string }> = [],
) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Commands</title>
    ${renderPageStyles()}
  </head>
  <body>
    ${renderTopMenu("commands", settings, user, showSuperAdmin, activeServer, servers)}
    <div class="page-wrap">
      <main>${markdownToHtml(markdown)}</main>
    </div>
  </body>
</html>`;

export const startSetupServer = async () => {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const settings = await loadSettings();

      if (request.method === "GET" && url.pathname === "/login") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          renderLoginPage(settings, getSessionUser(request), url.searchParams.get("returnTo") ?? "/app"),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/auth/discord") {
        beginDiscordLogin(request, response, settings, url.searchParams.get("returnTo") ?? "/app");
        return;
      }

      if (request.method === "GET" && url.pathname === "/auth/discord/callback") {
        await completeDiscordLogin(request, response, settings, url);
        return;
      }

      if (request.method === "GET" && url.pathname === "/logout") {
        logout(response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(302, { location: "/app/active-events" });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/settings") {
        response.writeHead(302, { location: "/super-admin" });
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/active-server") {
        const user = requireAuthenticatedUser(request, response, request.headers.referer ?? "/app");
        if (!user) {
          return;
        }

          const { servers } = await activeServerForRequest(request, user);
        const body = new URLSearchParams(await readRequestBody(request));
        const guildId = body.get("guildId") ?? "";
        if (servers.some((server) => server.id === guildId)) {
          setActiveGuild(request, guildId);
        }

        response.writeHead(302, { location: request.headers.referer ?? "/app" });
        response.end();
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const user = requireAuthenticatedApiUser(request, response);
        if (!user) {
          return;
        }

        const payload = await sessionPayload(request, settings, user);
        const activeGuildId = payload.activeServer?.id;
        const activeGuildProfileName = payload.activeServer?.userProfile?.displayName;

        if (request.method === "GET" && url.pathname === "/api/events/stream") {
          addEventStreamClient(response);
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/session") {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(payload));
          return;
        }

        if (await handleApiRequest(request, response, url, user, activeGuildId, activeGuildProfileName)) {
          return;
        }
      }

      if (request.method === "GET" && (url.pathname === "/app" || url.pathname.startsWith("/app/"))) {
        const user = requireAuthenticatedUser(request, response, request.url ?? "/app");
        if (!user) {
          return;
        }

        const payload = await sessionPayload(request, settings, user);
        if (!payload.servers.length && !payload.requiresGuildReconnect) {
          response.writeHead(302, { location: "/admin" });
          response.end();
          return;
        }

        if (await serveWebApp(url, response, payload)) {
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/admin") {
        const user = requireAuthenticatedUser(request, response, request.url ?? "/admin");
        if (!user) {
          return;
        }
        const { active, servers } = await activeServerForRequest(request, user);

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          await renderAdminPage(
            settings,
            user,
            canSeeSuperAdminLink(request, settings, user),
            active,
            servers,
          ),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/super-admin") {
        const user =
          isLoginConfigured(settings) || authConfig(settings).adminUserIds.length
            ? requireAuthenticatedUser(request, response, request.url ?? "/super-admin")
            : getSessionUser(request);
        if ((isLoginConfigured(settings) || authConfig(settings).adminUserIds.length) && !user) {
          return;
        }

        requireAdminAccess(request, settings, user);
        const activeInfo = user ? await activeServerForRequest(request, user) : { active: undefined, servers: [] };
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          renderSuperAdminPage(
            settings,
            undefined,
            user,
            canSeeSuperAdminLink(request, settings, user),
            activeInfo.active,
            activeInfo.servers,
          ),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/admin/settings") {
        const user = requireAuthenticatedUser(request, response, request.url ?? "/admin");
        if (!user) {
          return;
        }
        const body = new URLSearchParams(await readRequestBody(request));
        const cleanupDays = Number.parseInt(body.get("threadAutoDeleteDays") ?? "7", 10);
        const outputMode = body.get("eventOutputMode") === "thread" ? "thread" : "channel";
        const nextSettings = await saveSettings(
          {
            eventOutputMode: outputMode,
            eventOutputChannelId: body.get("eventOutputChannelId") ?? undefined,
            lootOutputChannelId: outputMode === "channel" ? body.get("lootOutputChannelId") ?? undefined : undefined,
            threadAutoDeleteDays: Number.isInteger(cleanupDays)
              ? Math.min(Math.max(cleanupDays, 1), 30)
              : 7,
            templateControlUserIds: body.getAll("templateControlUserIds").join(","),
            templateControlRoleIds: body.getAll("templateControlRoleIds").join(","),
          },
          settings,
        );
        const { active, servers } = await activeServerForRequest(request, user);

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          await renderAdminPage(
            nextSettings,
            user,
            canSeeSuperAdminLink(request, nextSettings, user),
            active,
            servers,
            "Admin settings saved.",
          ),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/invite") {
        response.writeHead(302, { location: "/admin" });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/slash-commands") {
        const user = requireAuthenticatedUser(request, response, request.url ?? "/slash-commands");
        if (!user) {
          return;
        }
        const { active, servers } = await activeServerForRequest(request, user);

        const commands = await readFile("./docs/slash-commands.md", "utf8");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          renderCommandsPage(
            settings,
            user,
            canSeeSuperAdminLink(request, settings, user),
            commands,
            active,
            servers,
          ),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/settings") {
        const existing = settings;
        const user =
          isLoginConfigured(existing) || authConfig(existing).adminUserIds.length
            ? requireAuthenticatedUser(request, response, request.url ?? "/admin")
            : getSessionUser(request);
        if (isLoginConfigured(existing) || authConfig(existing).adminUserIds.length) {
          if (!user) {
            return;
          }
        }

        requireAdminAccess(request, existing, user);
        const body = new URLSearchParams(await readRequestBody(request));
        const nextSettings = await saveSettings(
          {
            discordToken: body.get("discordToken") ?? undefined,
            discordClientId: body.get("discordClientId") ?? undefined,
            discordClientSecret: body.get("discordClientSecret") ?? undefined,
            discordGuildId: body.get("discordGuildId") ?? undefined,
            adminDiscordUserIds: body.get("adminDiscordUserIds") ?? undefined,
          },
          existing,
        );

        let notice = (await startBot(nextSettings)).message;
        if (body.get("registerCommands") === "yes") {
          const scope = await registerTestGuildCommands(nextSettings);
          notice += ` Slash commands registered for ${scope}.`;
        }

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          renderSuperAdminPage(
            nextSettings,
            notice,
            user,
            canSeeSuperAdminLink(request, nextSettings, user),
          ),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/register-test") {
        const user = requireAuthenticatedUser(request, response, request.url ?? "/super-admin");
        if (!user) {
          return;
        }

        requireAdminAccess(request, settings, user);
        const scope = await registerTestGuildCommands(settings);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          renderSuperAdminPage(
            settings,
            `Slash commands registered for ${scope}.`,
            user,
            canSeeSuperAdminLink(request, settings, user),
          ),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/register-global") {
        const user = requireAuthenticatedUser(request, response, request.url ?? "/super-admin");
        if (!user) {
          return;
        }

        requireAdminAccess(request, settings, user);
        const scope = await registerGlobalCommands(settings);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          renderSuperAdminPage(
            settings,
            `Slash commands registered ${scope}.`,
            user,
            canSeeSuperAdminLink(request, settings, user),
          ),
        );
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      if (
        message.startsWith("Admin access is not allowed") ||
        message.startsWith("Admin access is only available")
      ) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end(message);
        return;
      }

      response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      response.end(
        renderSuperAdminPage(
          await loadSettings().catch(() => ({})),
          message,
          getSessionUser(request),
        ),
      );
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(envConfig.SETUP_PORT, envConfig.SETUP_HOST, resolve);
  });

  console.log(`App available at http://localhost:${envConfig.SETUP_PORT}/app`);
  console.log(`Super Admin page available at http://localhost:${envConfig.SETUP_PORT}/super-admin`);
  return server;
};
