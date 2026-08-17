# Star Citizen Discord Bot

A TypeScript, Angular Ionic, and Discord bot project for Star Citizen event signups and participant-only loot rolls.

## What It Does

- Provides an Ionic web app for creating and viewing events.
- Supports optional event logos and event descriptions.
- Creates event signup boards with slash commands.
- Lets members join crew slots with Discord buttons.
- Tracks attendance by event and posts a close report.
- Creates loot roll boards after an event.
- Shows event members on the loot panel and highlights members who have bid at least once.
- Allows loot items to be managed from the event detail loot modal.
- Blocks loot bids from users who did not participate in the linked event.
- Draws loot winners automatically after 24 or 48 hours, or manually with a slash command.

## Tech Stack

- TypeScript
- Angular
- Ionic
- Node.js
- discord.js
- PostgreSQL
- Prisma
- Docker Compose using `compose.yml`

No Python, no visual bot builder, and no legacy `docker-compose` setup are used.

## Commands

Register slash commands:

```bash
npm run commands:deploy
```

Event commands:

```text
/mc event create name preset loot_timelimit starts_at description logo_url report_channel custom_slots
/mc event list
/mc event end event_id
```

Loot commands:

```text
/mc loot add event_id items
/mc loot show event_id
/mc loot draw event_id
```

Simple `/mc loot add` entries remain comma-separated, for example `FS-9 LMG, Heavy Armor`. Complex entries use semicolon-separated rows with pipe-separated fields:

```text
category|name|quantity|quality|unit
resource|Quantanium|10|85|boxes
weapon|FS-9 LMG|2
```

Supported categories are `resource`, `weapon`, `armor`, `component`, `consumable`, and `other`. Award behavior always comes from the event settings chosen by the event creator.

For custom event slots, use this format:

```text
Fighter:3:Air wing; Gunner:4:Capital ships; Medic:1:Ground team
```

## Local Development

1. Copy `.env.example` to `.env`.
2. Install dependencies:

```bash
npm install
```

3. Start PostgreSQL:

```bash
docker compose up postgres
```

4. Push the current Prisma schema:

```bash
npm run db:push
```

5. Start the bot and setup page:

```bash
npm run dev
```

6. Create your local environment file:

```bash
cp .env.example .env
```

Set `DISCORD_BOT_TOKEN`, `APPLICATION_ID`, `DISCORD_CLIENT_SECRET`, and `ADMIN_DISCORD_USER_IDS` in `.env`. Register the local OAuth2 callback URL described below in the Discord Developer Portal:

```text
http://localhost:3000/auth/discord/callback
```

In the Discord Developer Portal, open the application used by this environment and complete the bot configuration:

1. Open **Bot**.
2. Under **Privileged Gateway Intents**, enable **Server Members Intent**.
3. Save the change.

Muster Command requests the Discord `Guilds` and `GuildMembers` gateway intents. If **Server Members Intent** is disabled, Discord rejects the connection with `Used disallowed intents`, and the bot process restarts.

### OAuth2 Callback URLs

Muster Command uses Discord OAuth2 to sign users into the website. When a user signs in, Muster Command sends them to Discord with the `identify` and `guilds` scopes. Discord then returns the user to this route:

```text
/auth/discord/callback
```

Register a complete callback URL for every address from which users will access an environment:

```text
Local development: http://localhost:3000/auth/discord/callback
Production:        https://muster.example.com/auth/discord/callback
```

To register a callback:

1. Open the application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Open **OAuth2**.
3. Under **Redirects**, select **Add Redirect**.
4. Enter the complete callback URL, including its scheme, hostname, optional port, and `/auth/discord/callback` path.
5. Select **Save Changes**.

The registered URL must exactly match the URL used by the browser. HTTP and HTTPS, different hostnames, different ports, and a missing callback path are treated as different URLs. Register separate entries when local, test, and production environments use different public addresses. Do not add query parameters or a trailing slash.

Muster Command derives the callback URL from the incoming request. When it runs behind a reverse proxy, configure the proxy to preserve the public host and send the correct `X-Forwarded-Host` and `X-Forwarded-Proto` headers. Production deployments should use HTTPS. If Discord reports an invalid redirect or Muster Command reports that Discord rejected the login callback, compare the callback shown on the login page with the Redirect entry in the Developer Portal.

7. Open the System Admin page:

```text
http://localhost:3000/system-admin
```

System Admin requires Discord login, and the logged-in Discord user ID must match `ADMIN_DISCORD_USER_IDS`.

On first setup, confirm and save the detected public website URL on the System Admin page. The bot uses this saved address to link restricted slash-command users to the corresponding website page.

8. Open the web app:

```text
http://localhost:3000/app
```

The web app currently supports event creation, event details, event-logo display, description display, event signups, and integrated loot handling from the event detail page.

## Self-Hosted Deployment

Start the stack:

```bash
docker compose up --build -d
```

For named environments, use the ignored files next to `compose.yml`:

```bash
docker compose --env-file .env.dev up --build -d
docker compose --env-file .env.prod up --build -d
```

After changing Discord credentials or privileged intents, recreate or restart the bot service and check its logs:

```bash
docker compose up --build -d
docker compose restart bot
docker compose logs --tail=50 bot
```

A successful deployment reports `Logged in as <bot name>` in the bot logs. If the logs report `Used disallowed intents`, enable **Server Members Intent** for that bot in the Discord Developer Portal, save the setting, and restart the `bot` service again.

Then open the private System Admin page:

```text
http://localhost:3000/system-admin
```

The bot service pushes the current `1.0.0` database schema on startup, launches the web app at `/app`, launches the server admin page at `/admin`, launches the owner-only System Admin page at `/system-admin`, and starts the Discord bot from environment credentials. Server settings are stored in a Docker volume named `settings-data`.

All app pages and API routes require Discord login. `/system-admin` also requires the logged-in Discord user ID to match `ADMIN_DISCORD_USER_IDS` from the environment file.

## Notes for the Next Build Pass

- In dedicated-channel mode, event and loot output can be routed to separate Discord channels to keep event discussion cleaner. In thread mode, each event uses its own thread and the configured cleanup period controls removal after the loot draw.
- Update `/mc event create` so it always posts the event in the event channel configured for that server on the website, even when the command is used elsewhere. After creation, send the invoking user an ephemeral response (or DM fallback) identifying and linking to the configured event channel.
- Add admin permission checks if event creation should be limited to officers.
- Add a command to reopen events or edit slot counts.
- Add richer loot rules if future rules should weight winners, exclude prior winners, or require approval.
- Add tests around slot-capacity races and loot winner selection once the deployment flow is settled.
