# Workout Visualizer

Minimal repo to visualize workouts from `workout_data.csv`.

Quick start (macOS / zsh):

1. Install dependencies

```bash
npm install
```

2. Run in dev mode (auto-restarts server on changes)

```bash
npm run dev
```

3. Open http://localhost:3000 in your browser.

Notes:
- Backend: TypeScript Express server at `src/server.ts` — it reads `workout_data.csv` and exposes APIs under `/api` and serves static files in `/public`.
- Frontend: simple React app (served from `public/index.html`) using Chart.js. For dev convenience the frontend uses React and Babel from CDNs (no build step).
- API endpoints:
  - `GET /api/exercises` — list of exercise names
  - `GET /api/exercise/:name/progression` — progression timeline (max weight and total reps per session)
  - `GET /api/sessions` — sessions index
  - `GET /api/session/:id` — full session detail
  - `GET /api/reload` — reload CSV into memory
