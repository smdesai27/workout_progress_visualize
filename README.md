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

The CSV is not included. Export your data from Hevy (Profile → Settings → Export Data) and save it as `workout_data.csv` in the repo root, or use the Upload CSV button in the app.

Notes:
  - `GET /api/exercises` — list of exercise names
  - `GET /api/exercise/:name/progression` — progression timeline (max weight and total reps per session)
  - `GET /api/sessions` — sessions index
  - `GET /api/session/:id` — full session detail
  - `GET /api/reload` — reload CSV into memory
