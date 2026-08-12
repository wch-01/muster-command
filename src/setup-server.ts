import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { envConfig, isDiscordConfigured, type DiscordSettings } from "./config.js";
import { registerGlobalCommands, registerGuildCommands } from "./discord/register-commands.js";
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

const formatDuration = (seconds: number | undefined) => {
  if (seconds === undefined) {
    return "Not connected";
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
  ].filter(Boolean);

  return parts.length ? parts.join(" ") : "<1m";
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

const csvSet = (value: string | undefined) =>
  new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const botInvitePermissions = [
  1024n, // View Channels
  2048n, // Send Messages
  16384n, // Embed Links
  65536n, // Read Message History
  17179869184n, // Manage Threads
  34359738368n, // Create Public Threads
  68719476736n, // Create Private Threads
  274877906944n, // Send Messages in Threads
]
  .reduce((total, flag) => total | flag, 0n)
  .toString();
const inviteUrl = (appId: string | undefined) => {
  if (!appId) {
    return undefined;
  }

  const params = new URLSearchParams({
    client_id: appId,
    permissions: botInvitePermissions,
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

const canSeeSystemAdminLink = (
  settings: DiscordSettings,
  user: AuthenticatedUser | undefined,
) => {
  return isAdminUser(settings, user);
};

type SharedServer = {
  id: string;
  name: string;
  iconUrl?: string;
  userProfile?: Awaited<ReturnType<typeof botGuildMemberProfile>>;
};

const availableServersForUser = async (
  user: AuthenticatedUser | undefined,
): Promise<SharedServer[]> => {
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
    state: envConfig.STATE,
    botInviteUrl: inviteUrl(settings.discordClientId),
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
  if (!adminUserIds.length) {
    throw new Error("System Admin requires ADMIN_DISCORD_USER_IDS in the environment file.");
  }

  if (isAdminUser(settings, user)) {
    return;
  }

  throw new Error("System Admin access is only available to the configured Discord admin user.");
};

const renderTopMenu = (
  active: "dashboard" | "app" | "active-events" | "create-event" | "past-events" | "commands" | "templates" | "admin" | "system-admin",
  settings: DiscordSettings,
  user: AuthenticatedUser | undefined,
  showSuperAdmin: boolean,
  activeServer?: { id: string; name: string; userProfile?: { displayName: string } },
  servers: Array<{ id: string; name: string; userProfile?: { displayName: string } }> = [],
) => {
  const item = (href: string, label: string, key: typeof active) =>
    `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`;
  const eventActive = active === "active-events" || active === "create-event" || active === "past-events";
  const profileName = activeServer?.userProfile?.displayName ?? user?.globalName ?? user?.username;

  return `<script>
    (() => {
      const saved = localStorage.getItem("muster-theme");
      const initial = saved === "dark" || saved === "light" ? saved : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.dataset.theme = initial;
      window.syncMusterThemeToggle = () => {
        const dark = document.documentElement.dataset.theme === "dark";
        document.querySelectorAll(".theme-toggle").forEach((button) => {
          button.textContent = dark ? "☀" : "☾";
          button.setAttribute("aria-label", dark ? "Use light mode" : "Use dark mode");
          button.setAttribute("title", dark ? "Use light mode" : "Use dark mode");
        });
      };
      window.toggleMusterTheme = () => {
        const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("muster-theme", theme);
        window.syncMusterThemeToggle();
      };
    })();
  </script><header class="top-menu">
    <a class="brand" href="/app/dashboard">Muster Command</a>
    ${envConfig.STATE === "development" ? `<span class="env-badge">Dev</span>` : ""}
    <nav aria-label="Primary navigation">
      ${item("/app/dashboard", "Dashboard", "dashboard")}
      <a class="${eventActive ? "active" : ""}" href="/app/active-events">Events</a>
      ${item("/slash-commands", "Bot Commands", "commands")}
      ${item("/app/templates", "Templates", "templates")}
      ${item("/admin", "Admin", "admin")}
      ${showSuperAdmin ? item("/system-admin", "System Admin", "system-admin") : ""}
    </nav>
    <div class="user-menu">
      ${`<form class="server-select" method="post" action="/active-server">
                <label for="activeGuildId">Active Server</label>
                <select id="activeGuildId" name="guildId" onchange="if (this.value === '__invite') { window.location.href = '/bot-invite'; } else { this.form.submit(); }">
                  ${servers
                    .map(
                      (server) =>
                        `<option value="${escapeHtml(server.id)}" ${server.id === activeServer?.id ? "selected" : ""}>${escapeHtml(server.name)}</option>`,
                    )
                    .join("")}
                  ${servers.length ? "" : `<option value="">No shared server</option>`}
                  <option disabled>--------</option>
                  <option value="__invite">+ Add bot to another server</option>
                </select>
              </form>`}
        ${profileName ? `<span>${escapeHtml(profileName)}</span>` : ""}
      <button class="theme-toggle" type="button" onclick="window.toggleMusterTheme()" aria-label="Use dark mode" title="Use dark mode">☾</button>
      <a href="/logout">Log out</a>
    </div>
  </header><script>window.syncMusterThemeToggle();</script>`;
};

const sendJson = (response: import("node:http").ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
};

const readJsonBody = async <T>(request: import("node:http").IncomingMessage) => {
  const raw = await readRequestBody(request);
  return (raw ? JSON.parse(raw) : {}) as T;
};

type AdminSettingsInput = {
  discordEventPublishingEnabled?: boolean;
  eventOutputMode?: "channel" | "thread";
  eventOutputChannelId?: string;
  lootOutputChannelId?: string;
  threadAutoDeleteDays?: number;
  templateControlUserIds?: unknown[];
  templateControlRoleIds?: unknown[];
};

const renderSiteFooter = () => `<footer class="site-footer">
    <div class="site-footer-content">
      <span><strong>Muster Command</strong> · Website by <a href="https://webcrafthouse.com/" target="_blank" rel="noopener noreferrer">Web Craft House Games</a></span>
      <div class="site-footer-contact">
        <span>Contact: <a href="mailto:contact@webcrafthouse.com">contact@webcrafthouse.com</a></span>
        <span>Support: <a href="https://webcrafthouse.com/contact/" target="_blank" rel="noopener noreferrer">Contact WCH</a></span>
        <span><a href="https://www.subscribestar.com/webcrafthouse" target="_blank" rel="noopener noreferrer">Support the Build</a></span>
      </div>
    </div>
  </footer>`;

const renderPageStyles = () => `<style>
      :root {
        color-scheme: light;
        font-family: Arial, sans-serif;
        background: #f4f6f8;
        color: #17202a;
      }
      body {
        display: flex;
        flex-direction: column;
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
      .env-badge {
        border: 1px solid #f59e0b;
        border-radius: 999px;
        background: #fffbeb;
        color: #92400e;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
        padding: 5px 8px;
        text-transform: uppercase;
      }
      nav {
        display: flex;
        gap: 4px;
        align-items: center;
        flex: 1;
        flex-wrap: wrap;
      }
      nav a,
      .user-menu a {
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
        flex: 1 0 auto;
        place-items: start center;
        padding: 32px 16px 48px;
      }
      .site-footer {
        align-items: center;
        background: #ffffff;
        border-top: 1px solid #d7dde4;
        box-sizing: border-box;
        color: #64748b;
        display: flex;
        flex: 0 0 52px;
        min-height: 52px;
        padding: 0 18px;
      }
      .site-footer-content {
        align-items: center;
        display: flex;
        gap: 24px;
        justify-content: space-between;
        margin: 0 auto;
        width: min(1180px, 100%);
      }
      .site-footer-contact {
        display: flex;
        gap: 18px;
        white-space: nowrap;
      }
      .site-footer strong {
        color: #334155;
      }
      .site-footer a {
        color: #315f9b;
        text-decoration: none;
      }
      .site-footer a:hover,
      .site-footer a:focus-visible {
        text-decoration: underline;
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
      .stat-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }
      .stat strong {
        display: block;
        font-size: 13px;
        color: #64748b;
        margin-bottom: 4px;
      }
      .stat-heading strong {
        margin-bottom: 0;
      }
      .link-button {
        border: 0;
        background: transparent;
        color: #1d4ed8;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        padding: 0;
        text-decoration: underline;
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
      .user-field-list {
        display: grid;
        gap: 8px;
      }
      .user-field-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
      }
      .user-field-row input {
        margin: 0;
      }
      .user-field-row button,
      .add-user-button {
        padding: 10px 12px;
      }
      .user-field-row button {
        background: #64748b;
      }
      .add-user-button {
        margin-top: 10px;
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
      .modal-backdrop {
        align-items: center;
        background: rgba(15, 23, 42, 0.48);
        display: none;
        inset: 0;
        justify-content: center;
        padding: 24px;
        position: fixed;
        z-index: 30;
      }
      .modal-backdrop[aria-hidden="false"] {
        display: flex;
      }
      .modal-panel {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
        max-height: min(680px, calc(100vh - 48px));
        overflow: auto;
        padding: 20px;
        width: min(620px, 100%);
      }
      .modal-header {
        align-items: center;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        gap: 12px;
        justify-content: space-between;
        margin-bottom: 14px;
        padding-bottom: 12px;
      }
      .modal-header h2 {
        margin: 0;
      }
      .server-list {
        display: grid;
        gap: 8px;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .server-list li {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        display: grid;
        gap: 4px;
        margin: 0;
        padding: 10px;
      }
      .server-list code {
        color: #64748b;
        word-break: break-all;
      }
      .theme-toggle {
        align-items: center;
        background: transparent;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        color: #334155;
        display: inline-flex;
        font-size: 20px;
        height: 34px;
        justify-content: center;
        line-height: 1;
        padding: 0;
        width: 34px;
      }
      html[data-theme="dark"] {
        color-scheme: dark;
        background: #111827;
        color: #e5e7eb;
      }
      html[data-theme="dark"] body { background: #111827; color: #e5e7eb; }
      html[data-theme="dark"] .top-menu,
      html[data-theme="dark"] .site-footer { background: #18212f; border-color: #374151; color: #9ca3af; }
      html[data-theme="dark"] .brand,
      html[data-theme="dark"] nav a,
      html[data-theme="dark"] .user-menu a,
      html[data-theme="dark"] .server-select label,
      html[data-theme="dark"] .site-footer strong,
      html[data-theme="dark"] h1,
      html[data-theme="dark"] h2,
      html[data-theme="dark"] h3 { color: #f3f4f6; }
      html[data-theme="dark"] main,
      html[data-theme="dark"] .modal-panel,
      html[data-theme="dark"] .check-list { background: #1f2937; border-color: #4b5563; color: #e5e7eb; }
      html[data-theme="dark"] .stat,
      html[data-theme="dark"] .server-list li { background: #273449; border-color: #4b5563; }
      html[data-theme="dark"] input,
      html[data-theme="dark"] select,
      html[data-theme="dark"] textarea { background: #111827; border-color: #4b5563; color: #f3f4f6; }
      html[data-theme="dark"] .hint,
      html[data-theme="dark"] .muted,
      html[data-theme="dark"] .stat strong,
      html[data-theme="dark"] .option-row small,
      html[data-theme="dark"] .server-list code { color: #9ca3af; }
      html[data-theme="dark"] .notice,
      html[data-theme="dark"] .invite,
      html[data-theme="dark"] .panel { background: #172554; border-color: #1d4ed8; color: #dbeafe; }
      html[data-theme="dark"] code,
      html[data-theme="dark"] pre { background: #111827; }
      html[data-theme="dark"] .theme-toggle { background: #273449; border-color: #64748b; color: #f3f4f6; }
      html[data-theme="dark"] .site-footer a,
      html[data-theme="dark"] main a,
      html[data-theme="dark"] .link-button { color: #93c5fd; }
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
        .site-footer-content {
          font-size: 12px;
          gap: 10px;
        }
        .site-footer-contact {
          gap: 10px;
        }
        .site-footer-contact span:first-child {
          display: none;
        }
      }
    </style>`;

const renderSystemAdminPage = (
  settings: DiscordSettings,
  notice?: string,
  user?: AuthenticatedUser,
  showSuperAdmin = true,
  activeServer?: { id: string; name: string },
  servers: Array<{ id: string; name: string }> = [],
) => {
  const configured = isDiscordConfigured(settings);
  const loginConfigured = isLoginConfigured(settings);
  const status = botStatus();
  const installedGuilds = botGuilds();
  const badge = configured ? "Configured" : "Not configured";
  const badgeClass = configured ? "ok" : "warn";
  const connection = status.connected ? `Connected as ${status.userTag}` : "Not connected";
  const installedServers = status.connected
    ? `${status.guildCount} installed server${status.guildCount === 1 ? "" : "s"}`
    : "Installed server count unavailable";
  const botUser = status.userTag
    ? `${status.userTag}${status.userId ? ` (${status.userId})` : ""}`
    : "Not connected";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>System Admin</title>
    ${renderPageStyles()}
  </head>
  <body>
    ${renderTopMenu("system-admin", settings, user, showSuperAdmin, activeServer, servers)}
    <div class="page-wrap">
    <main>
      <h1>System Admin</h1>
      ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
      <div class="status">
        <span class="badge ${badgeClass}">${badge}</span>
        <span class="badge neutral">${escapeHtml(connection)}</span>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat-heading">
            <strong>Installed Servers</strong>
            <button class="link-button" type="button" onclick="openInstalledServersModal()">View servers</button>
          </div>
          ${escapeHtml(installedServers)}
        </div>
        <div class="stat"><strong>Bot User</strong>${escapeHtml(botUser)}</div>
        <div class="stat"><strong>Uptime</strong>${escapeHtml(formatDuration(status.uptimeSeconds))}</div>
        <div class="stat"><strong>Signed In</strong>${user ? escapeHtml(user.globalName ?? user.username) : "Discord login required"}</div>
      </div>
      <div class="actions" aria-label="Command registration">
        <form method="post" action="/register-test">
          <button class="secondary" type="submit" ${activeServer ? "" : "disabled"}>Register commands to selected server</button>
        </form>
        <form method="post" action="/register-global">
          <button type="submit">Register commands globally</button>
        </form>
      </div>
      <div class="modal-backdrop" id="installedServersModal" aria-hidden="true" role="presentation" onclick="closeInstalledServersModal(event)">
        <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="installedServersTitle">
          <div class="modal-header">
            <h2 id="installedServersTitle">Installed Servers</h2>
            <button class="secondary" type="button" onclick="closeInstalledServersModal()">Close</button>
          </div>
          ${
            installedGuilds.length
              ? `<ul class="server-list">
                  ${installedGuilds
                    .map((server) => `<li><strong>${escapeHtml(server.name)}</strong><code>${escapeHtml(server.id)}</code></li>`)
                    .join("")}
                </ul>`
              : `<p class="muted">The bot is not connected to any servers.</p>`
          }
        </section>
      </div>
      <section class="help" aria-label="Discord setup help">
        <h2>Discord Developer Portal fields</h2>
        <ul>
          <li><strong>Bot token:</strong> your app -> <code>Bot</code> -> <code>Token</code>. Save as <code>DISCORD_BOT_TOKEN</code> in the environment file.</li>
          <li><strong>Application ID:</strong> your app -> <code>General Information</code> -> <code>Application ID</code>. Save as <code>APPLICATION_ID</code>.</li>
          <li><strong>Client Secret:</strong> your app -> <code>OAuth2</code> -> <code>General</code> -> <code>Client Secret</code>. Save as <code>DISCORD_CLIENT_SECRET</code>.</li>
          <li><strong>Admin Discord user ID:</strong> Discord Developer Mode -> left click your user profile -> Copy User ID. Save as <code>ADMIN_DISCORD_USER_IDS</code>.</li>
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
          <li>Manage Threads</li>
          <li>Create Public Threads</li>
          <li>Create Private Threads</li>
          <li>Send Messages in Threads</li>
        </ul>

        <h3>Privileged gateway intents</h3>
        <ul>
          <li>Enable <strong>Server Members Intent</strong> on the bot page so the admin user checkbox list can load.</li>
        </ul>
      </section>
    </main>
    </div>
    ${renderSiteFooter()}
    <script>
      const installedServersModal = document.getElementById("installedServersModal");
      const openInstalledServersModal = () => {
        installedServersModal?.setAttribute("aria-hidden", "false");
      };
      const closeInstalledServersModal = (event) => {
        if (event && event.target !== installedServersModal) {
          return;
        }
        installedServersModal?.setAttribute("aria-hidden", "true");
      };
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeInstalledServersModal();
        }
      });
    </script>
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

const renderManualUserFieldList = (name: string, selected: Set<string>) => {
  const values = [...selected];
  const rows = values.length ? values : [""];

  return `<div class="user-field-list" data-user-field-list="${escapeHtml(name)}">
    ${rows
      .map(
        (value) => `<div class="user-field-row" data-user-field-row>
          <input name="${escapeHtml(name)}" type="text" value="${escapeHtml(value)}" autocomplete="off" placeholder="User name or Discord user ID" aria-label="Template manager user" />
          <button type="button" onclick="removeUserField(this)">Remove</button>
        </div>`,
      )
      .join("")}
  </div>
  <button class="secondary add-user-button" type="button" data-user-field-name="${escapeHtml(name)}" onclick="addUserField(this.dataset.userFieldName)">+ Add user</button>`;
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
  const selectedTemplateUsers = csvSet(settings.templateControlUserIds);

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
          <h2>Bot Status</h2>
          <p>${activeServer ? `Muster is installed on ${escapeHtml(activeServer.name)}.` : "No active server selected."}</p>
          ${
            generatedInviteUrl && activeServer
              ? `<p><a class="button secondary" href="${escapeHtml(generatedInviteUrl)}" target="_blank" rel="noreferrer">Re-authorize / Update permissions</a></p>`
              : activeServer
                ? `<p class="muted">Application ID is needed before permission update links can be generated.</p>`
                : `<p class="muted">Use Dashboard to add the bot to a server or select a shared server.</p>`
          }
        </section>

        <section class="panel">
          <h2>Bot Output</h2>
          <form method="post" action="/admin/settings">
            <label class="checkbox-row" for="discordEventPublishingEnabled">
              <input
                id="discordEventPublishingEnabled"
                name="discordEventPublishingEnabled"
                type="checkbox"
                value="true"
                ${settings.discordEventPublishingEnabled ? "checked" : ""}
              />
              Publish website events and updates to Discord
            </label>
            <p class="hint">Disabled by default while the website workflow is being developed.</p>

            <label for="eventOutputMode">Event output method</label>
            <select id="eventOutputMode" name="eventOutputMode" onchange="updateOutputFields()">
              <option value="channel" ${outputMode === "channel" ? "selected" : ""}>Dedicated channels</option>
              <option value="thread" ${outputMode === "thread" ? "selected" : ""}>One thread per event</option>
            </select>
            <p class="hint">Thread mode creates a separate event thread inside the selected channel.</p>

            <div class="form-grid">
              <div>
                <label for="eventOutputChannelId">Event output channel</label>
                <select id="eventOutputChannelId" name="eventOutputChannelId" data-selected-channel-id="${escapeHtml(settings.eventOutputChannelId)}">
                  ${
                    settings.eventOutputChannelId
                      ? `<option value="${escapeHtml(settings.eventOutputChannelId)}" selected>Saved channel (${escapeHtml(settings.eventOutputChannelId)})</option>`
                      : `<option value="" selected>Loading channels...</option>`
                  }
                </select>
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
                    ? renderCheckboxList(
                        "templateControlUserIds",
                        permissionOptions.users,
                        selectedTemplateUsers,
                      )
                    : `<p class="notice">Discord did not return the server member list. Enable the bot's Server Members Intent in the Discord Developer Portal if you want user checkboxes here.</p>
                      <p class="hint">Add one user per field. Use the plus button for another user and Remove to delete a field.</p>
                      ${renderManualUserFieldList("templateControlUserIds", selectedTemplateUsers)}`
                }
              </div>
            </div>

            <div class="actions">
              <button type="submit">Save Admin Settings</button>
              <a class="button secondary" href="/slash-commands" target="_blank" rel="noreferrer">Bot Commands</a>
            </div>
          </form>
        </section>
      </main>
    </div>
    ${renderSiteFooter()}
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

      const renderChannelOptions = (select, channels) => {
        const selectedChannelId = select.dataset.selectedChannelId ?? "";
        select.replaceChildren();

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = channels.length ? "Select a channel" : "No eligible text channels found";
        select.append(placeholder);

        let selectedChannelExists = false;
        channels.forEach((channel) => {
          const option = document.createElement("option");
          option.value = channel.id;
          option.textContent = "#" + channel.name;
          option.dataset.channelType = channel.type;
          if (channel.id === selectedChannelId) {
            option.selected = true;
            selectedChannelExists = true;
          }
          select.append(option);
        });

        if (selectedChannelId && !selectedChannelExists) {
          const savedOption = document.createElement("option");
          savedOption.value = selectedChannelId;
          savedOption.textContent = "Saved channel (" + selectedChannelId + ")";
          savedOption.selected = true;
          select.append(savedOption);
        }
      };

      const loadChannelSelectors = async () => {
        const eventChannelSelect = document.getElementById("eventOutputChannelId");
        if (!eventChannelSelect) {
          return;
        }

        try {
          const response = await fetch("/api/guild/channels", {
            headers: { accept: "application/json" },
          });
          const data = await response.json();
          renderChannelOptions(eventChannelSelect, Array.isArray(data.channels) ? data.channels : []);
        } catch (error) {
          eventChannelSelect.replaceChildren();
          const option = document.createElement("option");
          option.value = eventChannelSelect.dataset.selectedChannelId ?? "";
          option.textContent = option.value
            ? "Saved channel (" + option.value + ")"
            : "Could not load channels";
          option.selected = true;
          eventChannelSelect.append(option);
        }
      };

      const createUserFieldRow = (name) => {
        const row = document.createElement("div");
        row.className = "user-field-row";
        row.setAttribute("data-user-field-row", "");

        const input = document.createElement("input");
        input.name = name;
        input.type = "text";
        input.autocomplete = "off";
        input.placeholder = "User name or Discord user ID";
        input.setAttribute("aria-label", "Template manager user");

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => removeUserField(removeButton));

        row.append(input, removeButton);
        return row;
      };

      const addUserField = (name) => {
        const list = name ? document.querySelector('[data-user-field-list="' + name + '"]') : undefined;
        if (!list) {
          return;
        }
        const row = createUserFieldRow(name);
        list.append(row);
        row.querySelector("input")?.focus();
      };

      const removeUserField = (button) => {
        const row = button.closest("[data-user-field-row]");
        const list = row?.parentElement;
        const name = list?.getAttribute("data-user-field-list") ?? "templateControlUserIds";
        row?.remove();
        if (list && !list.querySelector("[data-user-field-row]")) {
          list.append(createUserFieldRow(name));
        }
      };

      window.addUserField = addUserField;
      window.removeUserField = removeUserField;

      updateOutputFields();
      loadChannelSelectors();
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
    <title>Bot Commands</title>
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
          renderLoginPage(
            settings,
            getSessionUser(request),
            url.searchParams.get("returnTo") ?? "/app/dashboard",
          ),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/auth/discord") {
        beginDiscordLogin(
          request,
          response,
          settings,
          url.searchParams.get("returnTo") ?? "/app/dashboard",
        );
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
        response.writeHead(302, { location: "/app/dashboard" });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/bot-invite") {
        const target = inviteUrl(settings.discordClientId);
        response.writeHead(302, { location: target ?? "/admin" });
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

      if (request.method === "GET" && url.pathname === "/active-server") {
        const user = requireAuthenticatedUser(request, response, request.url ?? "/app/dashboard");
        if (!user) {
          return;
        }

        const { servers } = await activeServerForRequest(request, user);
        const guildId = url.searchParams.get("guildId") ?? "";
        if (servers.some((server) => server.id === guildId)) {
          setActiveGuild(request, guildId);
        }

        const returnTo = url.searchParams.get("returnTo");
        response.writeHead(302, {
          location: returnTo?.startsWith("/app/") ? returnTo : "/app/dashboard",
        });
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

        if (request.method === "GET" && url.pathname === "/api/admin") {
          const permissions = activeGuildId
            ? await botGuildPermissionOptions(activeGuildId)
            : { roles: [], users: [], userListAvailable: false };
          sendJson(response, 200, {
            settings: {
              discordEventPublishingEnabled: settings.discordEventPublishingEnabled ?? false,
              eventOutputMode: settings.eventOutputMode ?? "channel",
              eventOutputChannelId: settings.eventOutputChannelId ?? "",
              lootOutputChannelId: settings.lootOutputChannelId ?? "",
              threadAutoDeleteDays: settings.threadAutoDeleteDays ?? 7,
              templateControlUserIds: [...csvSet(settings.templateControlUserIds)],
              templateControlRoleIds: [...idSet(settings.templateControlRoleIds)],
            },
            permissions,
            inviteUrl: inviteUrl(settings.discordClientId),
          });
          return;
        }

        if (request.method === "PUT" && url.pathname === "/api/admin") {
          const body = await readJsonBody<AdminSettingsInput>(request);
          const outputMode = body.eventOutputMode === "thread" ? "thread" : "channel";
          const cleanupDays = Number(body.threadAutoDeleteDays ?? 7);
          await saveSettings({
            discordEventPublishingEnabled: Boolean(body.discordEventPublishingEnabled),
            eventOutputMode: outputMode,
            eventOutputChannelId: body.eventOutputChannelId,
            lootOutputChannelId: outputMode === "channel" ? body.lootOutputChannelId : undefined,
            threadAutoDeleteDays: Number.isInteger(cleanupDays) ? Math.min(Math.max(cleanupDays, 1), 30) : 7,
            templateControlUserIds: (body.templateControlUserIds ?? []).map(String).map((value: string) => value.trim()).filter(Boolean).join(","),
            templateControlRoleIds: (body.templateControlRoleIds ?? []).map(String).map((value: string) => value.trim()).filter(Boolean).join(","),
          }, settings);
          sendJson(response, 200, { ok: true });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/system-admin") {
          requireAdminAccess(request, settings, user);
          sendJson(response, 200, {
            configured: isDiscordConfigured(settings),
            loginConfigured: isLoginConfigured(settings),
            status: botStatus(),
            installedServers: botGuilds(),
          });
          return;
        }

        if (request.method === "POST" && url.pathname === "/api/system-admin/register-guild") {
          requireAdminAccess(request, settings, user);
          if (!activeGuildId) throw new Error("Select a shared server before registering commands.");
          const scope = await registerGuildCommands(settings, activeGuildId);
          sendJson(response, 200, { message: `Slash commands registered for ${scope}.` });
          return;
        }

        if (request.method === "POST" && url.pathname === "/api/system-admin/register-global") {
          requireAdminAccess(request, settings, user);
          const scope = await registerGlobalCommands(settings);
          sendJson(response, 200, { message: `Slash commands registered ${scope}.` });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/bot-commands") {
          const markdown = await readFile("./docs/slash-commands.md", "utf8");
          sendJson(response, 200, { html: markdownToHtml(markdown) });
          return;
        }

        if (
          await handleApiRequest(
            request,
            response,
            url,
            user,
            activeGuildId,
            activeGuildProfileName,
            payload.servers,
          )
        ) {
          return;
        }
      }

      if (
        request.method === "GET" &&
        (url.pathname === "/app" || url.pathname.startsWith("/app/"))
      ) {
        const user = requireAuthenticatedUser(request, response, request.url ?? "/app");
        if (!user) {
          return;
        }

        const payload = await sessionPayload(request, settings, user);
        if (await serveWebApp(url, response, payload)) {
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/admin") {
        response.writeHead(302, { location: "/app/admin" });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/system-admin") {
        response.writeHead(302, { location: "/app/system-admin" });
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/admin/settings") {
        response.writeHead(303, { location: "/app/admin" });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/invite") {
        response.writeHead(302, { location: "/admin" });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/slash-commands") {
        response.writeHead(302, { location: "/app/bot-commands" });
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/register-test") {
        response.writeHead(303, { location: "/app/system-admin" });
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/register-global") {
        response.writeHead(303, { location: "/app/system-admin" });
        response.end();
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      if ((request.url ?? "").startsWith("/api/")) {
        sendJson(response, message.includes("System Admin") ? 403 : 500, { error: message });
        return;
      }
      if (
        message.startsWith("System Admin requires") ||
        message.startsWith("System Admin access is only available")
      ) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end(message);
        return;
      }

      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(message);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(envConfig.SETUP_PORT, envConfig.SETUP_HOST, resolve);
  });

  console.log(`App available at http://localhost:${envConfig.SETUP_PORT}/app`);
  console.log(`System Admin page available at http://localhost:${envConfig.SETUP_PORT}/app/system-admin`);
  return server;
};
