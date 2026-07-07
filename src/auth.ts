import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { envConfig, type DiscordSettings } from "./config.js";

export type AuthenticatedUser = {
  id: string;
  username: string;
  globalName?: string;
  avatar?: string;
  guilds?: Array<{ id: string; name: string; owner?: boolean; permissions?: string }>;
};

type Session = {
  user: AuthenticatedUser;
  activeGuildId?: string;
  expiresAt: number;
};

const sessionCookie = "starbot_session";
const stateCookie = "starbot_oauth_state";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 14;
const oauthStateMaxAgeSeconds = 60 * 10;
const sessions = new Map<string, Session>();
const oauthStates = new Map<string, { returnTo: string; expiresAt: number }>();

const escapeHtml = (value: string | undefined) => {
  return (value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
};

const parseCookieHeader = (header: string | undefined) => {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies.set(name, decodeURIComponent(value));
    }
  }

  return cookies;
};

const isHttpsRequest = (request: IncomingMessage) => {
  return request.headers["x-forwarded-proto"] === "https";
};

const cookie = (
  request: IncomingMessage,
  name: string,
  value: string,
  maxAgeSeconds: number,
) => {
  const secure = isHttpsRequest(request) ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
};

const expiredCookie = (name: string) => {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
};

const pruneExpired = () => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
    }
  }

  for (const [state, entry] of oauthStates) {
    if (entry.expiresAt <= now) {
      oauthStates.delete(state);
    }
  }
};

const safeReturnTo = (value: string | null | undefined) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/app";
  }

  return value;
};

export const getRequestOrigin = (request: IncomingMessage) => {
  const proto = request.headers["x-forwarded-proto"]?.toString() ?? "http";
  const host = request.headers["x-forwarded-host"]?.toString() ?? request.headers.host ?? "localhost";
  return `${proto}://${host}`;
};

export const authConfig = (settings: DiscordSettings) => {
  return {
    clientId: settings.discordClientId,
    clientSecret: settings.discordClientSecret,
    adminUserIds: (settings.adminDiscordUserIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  };
};

export const isLoginConfigured = (settings: DiscordSettings) => {
  const config = authConfig(settings);
  return Boolean(config.clientId && config.clientSecret);
};

export const getSessionUser = (request: IncomingMessage) => {
  pruneExpired();
  const sessionId = parseCookieHeader(request.headers.cookie).get(sessionCookie);
  if (!sessionId) {
    return undefined;
  }

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return undefined;
  }

  return session.user;
};

export const getSession = (request: IncomingMessage) => {
  pruneExpired();
  const sessionId = parseCookieHeader(request.headers.cookie).get(sessionCookie);
  if (!sessionId) {
    return undefined;
  }

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return undefined;
  }

  return session;
};

export const setActiveGuild = (request: IncomingMessage, guildId: string) => {
  const session = getSession(request);
  if (session) {
    session.activeGuildId = guildId;
  }
};

export const isAdminUser = (settings: DiscordSettings, user: AuthenticatedUser | undefined) => {
  const adminUserIds = authConfig(settings).adminUserIds;
  if (!adminUserIds.length || !user) {
    return false;
  }

  return adminUserIds.some((id) => {
    const left = Buffer.from(id);
    const right = Buffer.from(user.id);
    return left.length === right.length && timingSafeEqual(left, right);
  });
};

export const redirectToLogin = (
  request: IncomingMessage,
  response: ServerResponse,
  returnTo: string,
) => {
  response.writeHead(302, {
    location: `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`,
    "set-cookie": expiredCookie(sessionCookie),
  });
  response.end();
};

export const requireAuthenticatedUser = (
  request: IncomingMessage,
  response: ServerResponse,
  returnTo: string,
) => {
  const user = getSessionUser(request);
  if (user) {
    return user;
  }

  redirectToLogin(request, response, returnTo);
  return undefined;
};

export const requireAuthenticatedApiUser = (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const user = getSessionUser(request);
  if (user) {
    return user;
  }

  response.writeHead(401, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Discord login is required." }));
  return undefined;
};

export const beginDiscordLogin = (
  request: IncomingMessage,
  response: ServerResponse,
  settings: DiscordSettings,
  returnTo: string,
) => {
  const config = authConfig(settings);
  if (!config.clientId || !config.clientSecret) {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("Discord login is not configured yet.");
    return;
  }

  const state = randomBytes(24).toString("hex");
  oauthStates.set(state, {
    returnTo: safeReturnTo(returnTo),
    expiresAt: Date.now() + oauthStateMaxAgeSeconds * 1000,
  });

  const redirectUri = `${getRequestOrigin(request)}/auth/discord/callback`;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify guilds",
    state,
  });

  response.writeHead(302, {
    location: `https://discord.com/oauth2/authorize?${params.toString()}`,
    "set-cookie": cookie(request, stateCookie, state, oauthStateMaxAgeSeconds),
  });
  response.end();
};

export const completeDiscordLogin = async (
  request: IncomingMessage,
  response: ServerResponse,
  settings: DiscordSettings,
  url: URL,
) => {
  const config = authConfig(settings);
  const expectedState = parseCookieHeader(request.headers.cookie).get(stateCookie);
  const actualState = url.searchParams.get("state");
  const stateEntry = actualState ? oauthStates.get(actualState) : undefined;

  if (!config.clientId || !config.clientSecret) {
    throw new Error("Discord login is not configured yet.");
  }

  if (!expectedState || !actualState || expectedState !== actualState || !stateEntry) {
    throw new Error("Discord login expired. Please try again.");
  }

  oauthStates.delete(actualState);
  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("Discord did not return an authorization code.");
  }

  const redirectUri = `${getRequestOrigin(request)}/auth/discord/callback`;
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error("Discord rejected the login callback. Check the OAuth redirect URL.");
  }

  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) {
    throw new Error("Discord did not return an access token.");
  }

  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });

  if (!userResponse.ok) {
    throw new Error("Could not load your Discord profile.");
  }

  const discordUser = (await userResponse.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };

  const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });

  if (!guildsResponse.ok) {
    throw new Error("Could not load your Discord servers.");
  }

  const discordGuilds = (await guildsResponse.json()) as Array<{
    id: string;
    name: string;
    owner?: boolean;
    permissions?: string;
  }>;

  const sessionId = randomBytes(32).toString("hex");
  sessions.set(sessionId, {
    user: {
      id: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.global_name ?? undefined,
      avatar: discordUser.avatar ?? undefined,
      guilds: discordGuilds,
    },
    expiresAt: Date.now() + sessionMaxAgeSeconds * 1000,
  });

  response.writeHead(302, {
    location: stateEntry.returnTo,
    "set-cookie": [
      cookie(request, sessionCookie, sessionId, sessionMaxAgeSeconds),
      expiredCookie(stateCookie),
    ],
  });
  response.end();
};

export const logout = (response: ServerResponse) => {
  response.writeHead(302, {
    location: "/login",
    "set-cookie": expiredCookie(sessionCookie),
  });
  response.end();
};

export const renderLoginPage = (
  settings: DiscordSettings,
  user: AuthenticatedUser | undefined,
  returnTo: string,
) => {
  const configured = isLoginConfigured(settings);
  const destination = safeReturnTo(returnTo);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Discord Login</title>
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
        place-items: center;
        padding: 32px 16px;
      }
      main {
        width: min(460px, 100%);
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
      p {
        color: #475569;
        line-height: 1.5;
      }
      .button {
        display: inline-block;
        margin-top: 12px;
        border-radius: 6px;
        padding: 12px 16px;
        color: #ffffff;
        background: #5865f2;
        font-weight: 700;
        text-decoration: none;
      }
      .secondary {
        background: #475569;
      }
      .notice {
        padding: 12px;
        border-radius: 6px;
        background: #fef3c7;
        color: #92400e;
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
      <h1>Discord Login</h1>
      ${
        user
          ? `<p>You are logged in as ${escapeHtml(user.globalName ?? user.username)}.</p><a class="button" href="${escapeHtml(destination)}">Continue</a> <a class="button secondary" href="/logout">Log out</a>`
          : configured
            ? `<p>Use Discord to access the Star Citizen event tools.</p><a class="button" href="/auth/discord?returnTo=${encodeURIComponent(destination)}">Continue with Discord</a>`
            : `<p class="notice">Discord login is not configured yet. Add an Application ID and Client Secret on the Super Admin page from an allowed local or Tailscale host.</p><p><code>/super-admin</code> is available only for initial setup until an admin Discord user ID is saved.</p>`
      }
    </main>
  </body>
</html>`;
};
