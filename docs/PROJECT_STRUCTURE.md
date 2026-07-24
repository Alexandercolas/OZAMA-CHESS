# OZAMA CHESS - Project Structure

This document is the working map for the repository. Keep new code in the closest existing folder instead of creating parallel copies.

## Root

```text
server.js            Express app, Socket.IO multiplayer, chess room orchestration
package.json         Node scripts and dependencies
package-lock.json    Locked dependency versions
.env.example         Required environment variable template
README.md            Project overview and local/deploy instructions
```

`server.js` is still the main runtime file. Do not split it casually; extract only when a feature is stable and there is a clear boundary.

## Backend

```text
config/              Database connection and app configuration
middleware/          Auth and request guards
models/              Mongoose schemas
routes/              Express API routes
```

Current models:

```text
models/User.js       Accounts, profile, ELO, stats, friends, premium/admin flags
models/Match.js      Completed and active match history
models/Room.js       Online room persistence/rejoin support
models/Event.js      Admin-created platform events
```

Current routes:

```text
routes/auth.js       Register, login, password recovery/reset
routes/user.js       Profile, leaderboard, history, friends, avatar
routes/admin.js      Admin stats, users, premium, events
routes/events.js     Public events feed
```

## Frontend

```text
public/index.html        Landing page
public/login.html        Login, register, password recovery
public/lobby.html        Quick match, bot entry, rooms, challenges, online players
public/game.html         Chessboard UI, player panels, chat, overlays
public/profile.html      Profile, avatar, stats, history, friends
public/leaderboard.html  Hall of Fame ranking
public/admin.html        Protected admin panel
public/script.js         Active chess client/game logic
public/bot.js            Local bot logic
public/style.css         Active game/lobby shared styling
```

The active frontend is vanilla HTML/CSS/JS. Do not add a framework unless the project intentionally changes direction.

## Assets

```text
public/assets/brand/     OZAMA brand images and hero artwork
public/assets/sounds/    Sound files used by the game
public/assets/*.svg      Legacy/static chess piece assets
public/favicon.*         Browser/app icons
```

Brand assets currently in use:

```text
ozama-hero-brutal.jpg
ozama-king-seal.jpg
ozama-knight-icon.jpg
ozama-knight-icon.png
```

The large PNG is kept as a master/reference asset. Prefer optimized JPG/PNG variants in page backgrounds.

## Local-Only / Ignored

These may exist in the folder but should not be committed:

```text
.env
node_modules/
desktop.ini
public/css/
public/js/
public/Untitled-1.css
*.log
*.err.log
*.out.log
```

`public/css/`, `public/js/`, and `public/Untitled-1.css` are legacy/local copies. The deployed app uses the direct files under `public/`.

## Growth Rules

- Keep frontend vanilla unless explicitly changing the stack.
- Prefer small edits over full rewrites.
- Keep page-specific code close to its page until it is reused.
- Put reusable backend behavior in `routes/`, `models/`, `middleware/`, or `config/`.
- Put brand artwork in `public/assets/brand/`.
- Do not commit secrets, `.env`, logs, or generated local experiments.
- When adding a major feature, update this file and `README.md`.
