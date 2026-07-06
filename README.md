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
- Allows loot items to be removed from the web loot panel when mistakes happen.
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

4. Run Prisma migrations:

```bash
npm run db:migrate
```

5. Start the bot and setup page:

```bash
npm run dev
```

6. Open the private admin page:

```text
http://localhost:3000/admin
```

Paste the Discord bot token, client ID, and server ID into the setup page. The page shows whether the bot is configured or not configured, and the saved token is not displayed again.

7. Open the web app:

```text
http://localhost:3000/app
```

The web app currently supports event creation, event details, event-logo display, description display, loot-panel links, loot item additions, loot item removal, and bidder highlighting for event members.

## Self-Hosted Deployment

Start the stack:

```bash
docker compose up --build -d
```

Then open the private admin page:

```text
http://localhost:3000/admin
```

The bot service runs database migrations on startup, launches the web app at `/app`, launches the public invite page at `/invite`, launches the private admin page at `/admin`, and starts the Discord bot after credentials are saved. Settings are stored in a Docker volume named `settings-data`.

## Raspberry Pi And Tailscale

For the planned Pi deployment:

```env
ADMIN_ALLOWED_HOSTS=localhost,127.0.0.1,::1,housetalonpinas.tailbb76d4.ts.net
```

The app redirects `/` to `/invite`. The admin page at `/admin` is blocked unless the request host is in `ADMIN_ALLOWED_HOSTS`.

Recommended exposure:

```text
Public:   /app, /invite, and /slash-commands
Private:  /admin over Tailscale
```

With Tailscale, the private admin URL should be:

```text
http://housetalonpinas.tailbb76d4.ts.net:3000/admin
```

## PhpStorm

Open this folder directly in PhpStorm:

```text
star-citizen-discord-bot
```

PhpStorm should detect the Node.js project, TypeScript config, Prisma schema, and Docker Compose file automatically. The `.idea` folder is intentionally ignored so editor settings stay local.

## Notes for the Next Build Pass

- Add admin permission checks if event creation should be limited to officers.
- Add a command to reopen events or edit slot counts.
- Add richer loot rules if future rules should weight winners, exclude prior winners, or require approval.
- Add tests around slot-capacity races and loot winner selection once the deployment flow is settled.
