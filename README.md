# Lucky Guess — Backend

Multiplayer number-guessing game backend by **Contoura Labs**.
Built with **Node.js + Express + Socket.IO + Supabase (PostgreSQL)**.

This backend is the API + real-time server for the
[Lucky Guess React Native app](https://github.com/A-Subhan/LuckyGuess).

---

## What's New in v2.0.0

This is a complete rewrite of the original backend to match the
frontend's API contract. Highlights:

- **Route paths aligned with the frontend** — Lucky Guess routes
  are now mounted at root (`/guest`, `/auth/me`, `/user/profile`,
  `/leaderboard`, etc.) instead of under `/api/lucky-guess`.
- **Flat response shapes** — controllers no longer wrap responses
  in `{ success, data }`. Auth returns `{ user, token }`, the
  history endpoint returns `{ matches: [...] }`, etc.
- **Single Socket.IO namespace** — handlers run on the default
  namespace `/` (where the frontend connects), not on
  `/lucky-guess`.
- **JWT-authenticated sockets** — every socket connection is
  verified via the `auth: { token }` handshake. The server uses
  `socket.userId` from the JWT — it never trusts client-supplied
  userIds in JOIN_QUEUE payloads.
- **Game-logic bug fixes**:
  - Draw detection now uses `room.max_attempts` (was hardcoded to 10).
  - Opponent disconnect now calls `forfeitGame()` so the remaining
    player gets ELO + coins + stats + achievements.
  - `forfeitGame()` passes `winnerAttempts = 0` so forfeit wins
    can't accidentally unlock the `lucky_guess` achievement.
  - Both players receive `guess_result` with correct
    `opponentAttempts` values.
- **Lenient env loading** — missing Supabase credentials no longer
  crash the server. Supabase-dependent routes return a clear 503
  instead.
- **Removed legacy `server/` folder** — the dead code that
  expected `EXPO_PUBLIC_*` env vars is gone.

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# edit .env with your Supabase + JWT values
```

Required for full functionality:

| Variable                   | Purpose                                     |
| -------------------------- | ------------------------------------------- |
| `SUPABASE_URL`             | Supabase project URL                        |
| `SUPABASE_ANON_KEY`        | Supabase anon public key                    |
| `SUPABASE_SERVICE_ROLE_KEY`| Supabase service role key (server-only!)    |
| `JWT_SECRET`               | Secret used to sign game JWTs               |
| `GOOGLE_CLIENT_ID`         | (Optional) Google OAuth client ID           |

### 3. Set up the database

Run the SQL in [`Config/supabase-schema.sql`](./Config/supabase-schema.sql)
in your Supabase SQL editor. This creates the `users`, `matches`,
`rooms`, `achievements`, and `user_achievements` tables with RLS
policies and the seed trigger for new-user achievements.

### 4. Run

```bash
npm run dev   # development (with nodemon)
# or
npm start     # production
```

The server starts on `http://localhost:3001` (or the `PORT` env var).
Check `http://localhost:3001/health` to confirm.

---

## API Reference

All routes are mounted at root. Auth uses `Authorization: Bearer <jwt>`.

### Auth

| Method | Path                    | Auth | Response                          |
| ------ | ----------------------- | ---- | --------------------------------- |
| POST   | `/guest`                | none | `{ user, token }`                 |
| POST   | `/auth/google/callback` | none | `{ user, token }`                 |
| GET    | `/auth/me`              | yes  | `User`                            |
| POST   | `/auth/logout`          | yes  | `{ message }`                     |

### User

| Method | Path                   | Auth | Response                                              |
| ------ | ---------------------- | ---- | ----------------------------------------------------- |
| GET    | `/user/profile`        | yes  | `{ ...User, achievements, match_history }`            |
| GET    | `/user/stats`          | yes  | `{ ...stats, win_rate }`                              |
| GET    | `/user/history?page=1` | yes  | `{ matches: [...], pagination: {...} }`               |
| GET    | `/user/achievements`   | yes  | `{ achievements: [...] }`                             |

### Leaderboard

| Method | Path              | Auth     | Response                                                |
| ------ | ----------------- | -------- | ------------------------------------------------------- |
| GET    | `/leaderboard`    | optional | `{ leaderboard: [...], currentUserRank }`               |

### Health

| Method | Path       | Auth | Response                              |
| ------ | ---------- | ---- | ------------------------------------- |
| GET    | `/health`  | none | `{ status, time, service, version }`  |
| GET    | `/`        | none | API info / endpoint map               |

---

## Socket.IO Events

The server runs Socket.IO on the default namespace `/`.
Connections must authenticate via the `auth: { token }`
handshake field using the JWT issued by `/guest` or
`/auth/google/callback`.

### Client → Server

| Event          | Payload                                  |
| -------------- | ---------------------------------------- |
| `join_queue`   | `{ userId, userName, elo }` (userId is overridden by JWT) |
| `leave_queue`  | `{}`                                     |
| `submit_guess` | `{ roomId, guess: number }`              |
| `forfeit`      | `{ roomId }`                             |

### Server → Client

| Event                   | Payload                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `queue_joined`          | `{ message }`                                                            |
| `match_found`           | `{ room: Room, opponentName: string }`                                   |
| `guess_result`          | `{ result: 'higher'\|'lower'\|'correct', attemptsLeft, opponentAttempts }` |
| `game_over`             | `{ winner, coins, eloChange, matchId }`                                  |
| `opponent_disconnected` | `{ message, coins }`                                                     |
| `error`                 | `{ message }`                                                            |

---

## Game Modes

- **Single Player** — fully offline, runs on the device.
- **Local Multiplayer** — pass-and-play, fully offline.
- **Online Multiplayer** — requires this backend. Real-time
  matchmaking, both players guess the same secret number,
  first to guess correctly wins. ELO + coins + achievements
  update after every game.

---

## Deployment (Render / Railway)

1. Push this repo to GitHub.
2. Create a new Web Service pointing at the repo.
3. Set the build command to `npm install` and the start command
   to `npm start`.
4. Add the environment variables from `.env.example`.
5. Deploy. The platform's health check should hit `/health`.

---

## Project Structure

```
backend/
├── app.js                       # Express + Socket.IO entry point
├── package.json
├── .env.example
├── shared/
│   └── constants.js             # Game configs, achievements, socket events
├── Config/
│   ├── SETUP.md
│   └── supabase-schema.sql      # Run this in Supabase SQL editor
└── src/
    ├── config/
    │   ├── env.js               # Lenient env loader
    │   └── database.js          # Supabase admin + anon clients
    ├── middleware/auth.js       # REST + Socket.IO JWT auth
    ├── routes/
    │   ├── authRoutes.js
    │   ├── userRoutes.js
    │   └── leaderboardRoutes.js
    ├── controllers/
    │   ├── authController.js
    │   ├── userController.js
    │   └── leaderboardController.js
    ├── services/
    │   ├── matchmaking.js       # FIFO queue
    │   ├── gameService.js       # Room create / guess / endGame / forfeit
    │   ├── eloService.js        # ELO calculation
    │   ├── coinService.js       # Award / deduct coins
    │   └── achievementService.js
    └── socket/
        ├── index.js             # Wires JWT auth + handlers
        └── handlers.js          # All socket event handlers
```

---

Built with ❤️ by Contoura Labs.
