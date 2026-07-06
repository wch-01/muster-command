import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { envConfig, isDiscordConfigured, type DiscordSettings } from "./config.js";
import {
  registerGlobalCommands,
  registerTestGuildCommands,
} from "./discord/register-commands.js";
import { botStatus, startBot } from "./bot-runtime.js";
import { loadSettings, saveSettings } from "./settings-store.js";
import { handleApiRequest } from "./web-api.js";

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

const serveWebApp = async (url: URL, response: import("node:http").ServerResponse) => {
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
  response.writeHead(200, { "content-type": contentType });
  response.end(await readFile(filePath));
  return true;
};

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

const requireAdminAccess = (request: import("node:http").IncomingMessage) => {
  if (isAdminRequestAllowed(request)) {
    return;
  }

  const host = request.headers.host ?? "unknown host";
  throw new Error(`Admin access is not allowed from ${host}. Use localhost or Tailscale.`);
};

const renderPage = (settings: DiscordSettings, notice?: string) => {
  const configured = isDiscordConfigured(settings);
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

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Star Citizen Bot Setup</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Arial, sans-serif;
        background: #f4f6f8;
        color: #17202a;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: start center;
        padding: 48px 16px;
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
      input[type="password"] {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 11px 12px;
        font: inherit;
      }
      .hint {
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
      .secondary {
        background: #475569;
      }
      button {
        border: 0;
        border-radius: 6px;
        padding: 11px 16px;
        font: inherit;
        font-weight: 700;
        color: #ffffff;
        background: #2563eb;
        cursor: pointer;
      }
      .checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 400;
        margin: 0;
      }
      .invite {
        margin-top: 24px;
        padding: 14px;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        background: #eff6ff;
      }
      .invite a {
        color: #1d4ed8;
        font-weight: 700;
      }
      .quick-links {
        margin-top: 18px;
      }
      .quick-links a {
        color: #1d4ed8;
        font-weight: 700;
      }
      .help {
        margin-top: 28px;
        border-top: 1px solid #e2e8f0;
        padding-top: 22px;
      }
      .help h2 {
        margin: 0 0 10px;
        font-size: 18px;
      }
      .help h3 {
        margin: 18px 0 8px;
        font-size: 15px;
      }
      .help ul {
        margin: 8px 0 0;
        padding-left: 22px;
      }
      .help li {
        margin: 6px 0;
      }
      code {
        background: #f1f5f9;
        border-radius: 4px;
        padding: 2px 5px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Star Citizen Bot Setup</h1>
      ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
      <div class="status">
        <span class="badge ${badgeClass}">${badge}</span>
        <span class="badge neutral">${escapeHtml(connection)}</span>
        ${guildBadge ? `<span class="badge ${guildBadgeClass}">${guildBadge}</span>` : ""}
      </div>
      <div class="stats">
        <div class="stat"><strong>Installed Servers</strong>${escapeHtml(installedServers)}</div>
        <div class="stat"><strong>Command Mode</strong>Test server for fast updates, global for public servers</div>
        <div class="stat"><strong>Public Invite</strong>${generatedInviteUrl ? `<a href="/invite">Open invite page</a>` : "Save App ID first"}</div>
      </div>
      <form method="post" action="/settings">
        <label for="discordToken">Bot token</label>
        <input id="discordToken" name="discordToken" type="password" autocomplete="off" placeholder="${settings.discordToken ? "Token saved - leave blank to keep it" : "Paste bot token"}" />
        <p class="hint">Developer Portal path: your app -> Bot -> Token -> Reset Token or View Token. The saved token is never shown again.</p>

        <label for="discordClientId">App ID</label>
        <input id="discordClientId" name="discordClientId" type="text" value="${escapeHtml(settings.discordClientId)}" autocomplete="off" />
        <p class="hint">Developer Portal path: your app -> General Information -> App ID. This is also called the client ID in bot code.</p>

        <label for="discordGuildId">Discord server ID</label>
        <input id="discordGuildId" name="discordGuildId" type="text" value="${escapeHtml(settings.discordGuildId)}" autocomplete="off" />
        <p class="hint">Discord path: enable Developer Mode, then right-click your server icon -> Copy Server ID.</p>

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
              <p>Save your App ID first, then this page will show an invite link.</p>
            </section>`
      }
      <p class="quick-links"><a href="/invite" target="_blank" rel="noreferrer">Open public invite page</a> | <a href="/slash-commands" target="_blank" rel="noreferrer">Open slash command reference</a></p>
      <section class="help" aria-label="Discord setup help">
        <h2>Discord Developer Portal fields</h2>
        <ul>
          <li><strong>Bot token:</strong> your app -> <code>Bot</code> -> <code>Token</code>. Keep this private.</li>
          <li><strong>App ID:</strong> your app -> <code>General Information</code> -> <code>App ID</code>.</li>
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
  </body>
</html>`;
};

const renderInvitePage = (settings: DiscordSettings) => {
  const generatedInviteUrl = inviteUrl(settings.discordClientId);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Invite Star Citizen Event Bot</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Arial, sans-serif;
        background: #f4f6f8;
        color: #17202a;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: start center;
        padding: 48px 16px;
      }
      main {
        width: min(680px, 100%);
        background: #ffffff;
        border: 1px solid #d7dde4;
        border-radius: 8px;
        padding: 28px;
        box-shadow: 0 12px 30px rgba(16, 24, 40, 0.08);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
      }
      .button {
        display: inline-block;
        margin: 18px 0;
        border-radius: 6px;
        padding: 12px 16px;
        color: #ffffff;
        background: #2563eb;
        font-weight: 700;
        text-decoration: none;
      }
      .notice {
        padding: 12px;
        border-radius: 6px;
        background: #fef3c7;
        color: #92400e;
      }
      ul {
        padding-left: 22px;
      }
      li {
        margin: 6px 0;
      }
      code {
        background: #f1f5f9;
        border-radius: 4px;
        padding: 2px 5px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Invite Star Citizen Event Bot</h1>
      <p>Add the hosted bot to your Discord server to create Star Citizen event signups and participant-only loot pools.</p>
      ${
        generatedInviteUrl
          ? `<a class="button" href="${escapeHtml(generatedInviteUrl)}" target="_blank" rel="noreferrer">Invite bot to your server</a>`
          : `<p class="notice">The bot owner needs to configure the App ID before this invite page can generate a link.</p>`
      }
      <h2>Discord will ask for</h2>
      <ul>
        <li><code>bot</code> scope</li>
        <li><code>applications.commands</code> scope</li>
        <li>View Channels</li>
        <li>Send Messages</li>
        <li>Embed Links</li>
        <li>Read Message History</li>
      </ul>
      <h2>Try first</h2>
      <ul>
        <li><code>/event create</code> to create an event board.</li>
        <li><code>/loot add</code> to add loot to an event pool.</li>
        <li><code>/loot show</code> to repost the current bidding panel.</li>
      </ul>
      <p><a href="/slash-commands" target="_blank" rel="noreferrer">Open full slash command reference</a></p>
    </main>
  </body>
</html>`;
};

export const startSetupServer = async () => {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (await handleApiRequest(request, response, url)) {
        return;
      }

      if (request.method === "GET" && (await serveWebApp(url, response))) {
        return;
      }

      if (request.method === "GET" && request.url === "/") {
        response.writeHead(302, { location: "/invite" });
        response.end();
        return;
      }

      if (request.method === "GET" && request.url === "/admin") {
        requireAdminAccess(request);
        const settings = await loadSettings();
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderPage(settings));
        return;
      }

      if (request.method === "GET" && request.url === "/invite") {
        const settings = await loadSettings();
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderInvitePage(settings));
        return;
      }

      if (request.method === "GET" && request.url === "/slash-commands") {
        const commands = await readFile("./docs/slash-commands.md", "utf8");
        response.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        response.end(commands);
        return;
      }

      if (request.method === "POST" && request.url === "/settings") {
        requireAdminAccess(request);
        const existing = await loadSettings();
        const body = new URLSearchParams(await readRequestBody(request));
        const settings = await saveSettings(
          {
            discordToken: body.get("discordToken") ?? undefined,
            discordClientId: body.get("discordClientId") ?? undefined,
            discordGuildId: body.get("discordGuildId") ?? undefined,
          },
          existing,
        );

        let notice = (await startBot(settings)).message;
        if (body.get("registerCommands") === "yes") {
          const scope = await registerTestGuildCommands(settings);
          notice += ` Slash commands registered for ${scope}.`;
        }

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderPage(settings, notice));
        return;
      }

      if (request.method === "POST" && request.url === "/register-test") {
        requireAdminAccess(request);
        const settings = await loadSettings();
        const scope = await registerTestGuildCommands(settings);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderPage(settings, `Slash commands registered for ${scope}.`));
        return;
      }

      if (request.method === "POST" && request.url === "/register-global") {
        requireAdminAccess(request);
        const settings = await loadSettings();
        const scope = await registerGlobalCommands(settings);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderPage(settings, `Slash commands registered ${scope}.`));
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      if (message.startsWith("Admin access is not allowed")) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end(message);
        return;
      }

      response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      response.end(renderPage(await loadSettings().catch(() => ({})), message));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(envConfig.SETUP_PORT, envConfig.SETUP_HOST, resolve);
  });

  console.log(`Public invite page available at http://localhost:${envConfig.SETUP_PORT}/invite`);
  console.log(`Admin page available at http://localhost:${envConfig.SETUP_PORT}/admin`);
  return server;
};
