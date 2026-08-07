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
/event create name preset loot_timelimit starts_at description logo_url report_channel custom_slots
/event list
/event end event_id
```

Loot commands:

```text
/loot add event_id items
/loot show event_id
/loot draw event_id
```

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

Set `DISCORD_BOT_TOKEN`, `APPLICATION_ID`, `DISCORD_CLIENT_SECRET`, and `ADMIN_DISCORD_USER_IDS` in `.env`. Add this redirect URL in the Discord Developer Portal under OAuth2:

```text
http://localhost:3000/auth/discord/callback
```

7. Open the System Admin page:

```text
http://localhost:3000/system-admin
```

System Admin requires Discord login, and the logged-in Discord user ID must match `ADMIN_DISCORD_USER_IDS`.

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

Then open the private System Admin page:

```text
http://localhost:3000/system-admin
```

The bot service pushes the current `0.0.1` database schema on startup, launches the web app at `/app`, launches the server admin page at `/admin`, launches the owner-only System Admin page at `/system-admin`, and starts the Discord bot from environment credentials. Server settings are stored in a Docker volume named `settings-data`.

All app pages and API routes require Discord login. `/system-admin` also requires the logged-in Discord user ID to match `ADMIN_DISCORD_USER_IDS` from the environment file.

## Raspberry Pi And Tailscale

For the planned Pi deployment:

```env
ADMIN_ALLOWED_HOSTS=localhost,127.0.0.1,::1
```

The app redirects `/` to `/app`. The System Admin page at `/system-admin` is blocked unless the logged-in Discord user is a configured System Admin.

Recommended exposure:

```text
Public:   /app, /slash-commands, and /admin
Private:  /system-admin over Tailscale
```

With Tailscale, the private admin URL should be:

```text
http://localhost:3000/system-admin
```

## PhpStorm

Open this folder directly in PhpStorm:

```text
star-citizen-discord-bot
```

PhpStorm should detect the Node.js project, TypeScript config, Prisma schema, and Docker Compose file automatically. The `.idea` folder is intentionally ignored so editor settings stay local.

## Notes for the Next Build Pass

- Update `/event create` so it always posts the event in the event channel configured for that server on the website, even when the command is used elsewhere. After creation, send the invoking user an ephemeral response (or DM fallback) identifying and linking to the configured event channel.
- Add admin permission checks if event creation should be limited to officers.
- Add a command to reopen events or edit slot counts.
- Add richer loot rules if future rules should weight winners, exclude prior winners, or require approval.
- Add tests around slot-capacity races and loot winner selection once the deployment flow is settled.
