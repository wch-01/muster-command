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
} from "./bot-runtime.js";
import { loadSettings, saveSettings } from "./settings-store.js";
import { handleApiRequest } from "./web-api.js";
import { addEventStreamClient } from "./event-stream.js";
import { commandAccessForGuild, updateCommandAccessForGuild } from "./command-access.js";
import {
  authConfig,
  beginDiscordLogin,
  completeDiscordLogin,
  getSession,
  getSessionUser,
  getRequestOrigin,
  isAdminUser,
  isLoginConfigured,
  logout,
  requireAuthenticatedApiUser,
  requireAuthenticatedUser,
  safeReturnTo,
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
  loginData?: unknown,
  fallbackToIndex = true,
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
    if (!fallbackToIndex) {
      return false;
    }
    filePath = join(webAppRoot, "index.html");
  }

  const contentType = mimeTypes[extname(filePath)] ?? "application/octet-stream";
  let content = await readFile(filePath);
  if (contentType.startsWith("text/html") && (sessionData || loginData)) {
    const html = content.toString("utf8");
    const script = [
      sessionData ? `window.__MUSTER_SESSION__=${JSON.stringify(sessionData)};` : "",
      loginData ? `window.__MUSTER_LOGIN__=${JSON.stringify(loginData)};` : "",
    ].join("").replaceAll("</script", "<\\/script");
    content = Buffer.from(html.replace("</head>", `<script>${script}</script></head>`), "utf8");
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
  tier1RoleIds?: unknown[];
  tier2RoleIds?: unknown[];
  tier3RoleIds?: unknown[];
  tier2Capabilities?: unknown[];
  tier3Capabilities?: unknown[];
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

export const startSetupServer = async () => {
  const server = createServer((request, response) => {
    void (async () => {
      try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const settings = await loadSettings();

      if (request.method === "GET" && url.pathname === "/login") {
        const destination = safeReturnTo(url.searchParams.get("returnTo") ?? "/app/dashboard");
        response.writeHead(302, { location: `/app/login?returnTo=${encodeURIComponent(destination)}` });
        response.end();
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
          const commandAccess = commandAccessForGuild(settings.commandAccessByGuild, activeGuildId ?? "");
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
              tier1RoleIds: [...idSet(commandAccess.tier1RoleIds)],
              tier2RoleIds: [...idSet(commandAccess.tier2RoleIds)],
              tier3RoleIds: [...idSet(commandAccess.tier3RoleIds)],
              tier2Capabilities: commandAccess.tier2Capabilities === undefined ? ["event.end", "loot.add"] : [...idSet(commandAccess.tier2Capabilities)].filter((value) => value !== "-"),
              tier3Capabilities: commandAccess.tier3Capabilities === undefined ? ["event.list", "loot.show"] : [...idSet(commandAccess.tier3Capabilities)].filter((value) => value !== "-"),
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
          const commandAccessByGuild = activeGuildId
            ? updateCommandAccessForGuild(settings.commandAccessByGuild, activeGuildId, {
                tier1RoleIds: (body.tier1RoleIds ?? []).map(String).map((value: string) => value.trim()).filter(Boolean).join(","),
                tier2RoleIds: (body.tier2RoleIds ?? []).map(String).map((value: string) => value.trim()).filter(Boolean).join(","),
                tier3RoleIds: (body.tier3RoleIds ?? []).map(String).map((value: string) => value.trim()).filter(Boolean).join(","),
                tier2Capabilities: (body.tier2Capabilities ?? []).map(String).map((value: string) => value.trim()).filter(Boolean).join(",") || "-",
                tier3Capabilities: (body.tier3Capabilities ?? []).map(String).map((value: string) => value.trim()).filter(Boolean).join(",") || "-",
              })
            : settings.commandAccessByGuild;
          await saveSettings({
            discordEventPublishingEnabled: Boolean(body.discordEventPublishingEnabled),
            eventOutputMode: outputMode,
            eventOutputChannelId: body.eventOutputChannelId,
            lootOutputChannelId: outputMode === "channel" ? body.lootOutputChannelId : undefined,
            threadAutoDeleteDays: Number.isInteger(cleanupDays) ? Math.min(Math.max(cleanupDays, 1), 30) : 7,
            templateControlUserIds: (body.templateControlUserIds ?? []).map(String).map((value: string) => value.trim()).filter(Boolean).join(","),
            templateControlRoleIds: (body.templateControlRoleIds ?? []).map(String).map((value: string) => value.trim()).filter(Boolean).join(","),
            commandAccessByGuild,
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
            publicAppUrl: settings.publicAppUrl ?? getRequestOrigin(request),
            publicAppUrlDetected: !settings.publicAppUrl,
          });
          return;
        }

        if (request.method === "PUT" && url.pathname === "/api/system-admin") {
          requireAdminAccess(request, settings, user);
          const body = await readJsonBody<{ publicAppUrl?: unknown }>(request);
          const publicAppUrl = String(body.publicAppUrl ?? "").trim().replace(/\/$/, "");
          if (!publicAppUrl) throw new Error("Enter the public website URL.");
          let parsed: URL;
          try {
            parsed = new URL(publicAppUrl);
          } catch {
            throw new Error("Enter a valid public website URL.");
          }
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            throw new Error("The public website URL must use HTTP or HTTPS.");
          }
          await saveSettings({ publicAppUrl }, settings);
          sendJson(response, 200, { ok: true });
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
        const loginRoute = url.pathname === "/app/login";
        const publicRoute = ["/app/about", "/app/privacy", "/app/help"].includes(url.pathname);
        const staticAsset =
          url.pathname.startsWith("/app/assets/") ||
          /^\/app\/(?:chunk|main|polyfills|styles)-[A-Z0-9]+\.(?:js|css)$/.test(url.pathname);
        if (loginRoute || publicRoute || staticAsset) {
          const user = getSessionUser(request);
          const destination = safeReturnTo(url.searchParams.get("returnTo") ?? "/app/dashboard");
          const missingSettings = [
            !settings.discordClientId ? "APPLICATION_ID" : "",
            !settings.discordClientSecret ? "DISCORD_CLIENT_SECRET" : "",
            !settings.discordToken ? "DISCORD_BOT_TOKEN" : "",
            !settings.adminDiscordUserIds ? "ADMIN_DISCORD_USER_IDS" : "",
          ].filter(Boolean);
          if (await serveWebApp(url, response, undefined, loginRoute ? {
            configured: isLoginConfigured(settings),
            destination,
            missingSettings,
            redirectUrl: `${getRequestOrigin(request)}/auth/discord/callback`,
            user: user ? { username: user.username, globalName: user.globalName } : undefined,
          } : undefined, loginRoute || publicRoute)) {
            return;
          }
          if (staticAsset) {
            response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            response.end("Not found");
            return;
          }
        }

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
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(envConfig.SETUP_PORT, envConfig.SETUP_HOST, resolve);
  });

  console.log(`App available at http://localhost:${envConfig.SETUP_PORT}/app`);
  console.log(`System Admin page available at http://localhost:${envConfig.SETUP_PORT}/app/system-admin`);
  return server;
};
