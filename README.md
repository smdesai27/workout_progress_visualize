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
  - `GET /api/exercises` — list of exercise names
  - `GET /api/exercise/:name/progression` — progression timeline (max weight and total reps per session)
  - `GET /api/sessions` — sessions index
  - `GET /api/session/:id` — full session detail
  - `GET /api/reload` — reload CSV into memory

Firebase Hosting + Functions (frontend + backend)

This repo now includes a Firebase Functions backend and Firebase Hosting configuration so you can deploy both the frontend (static `public/`) and the Express API (`/api/*`) to Firebase.

Important: Cloud Functions deploys only files inside the `functions/` directory. To have the same CSV data available to the deployed API, copy your `workout_data.csv` into the `functions/` folder before deploying:

```bash
cp workout_data.csv functions/workout_data.csv
```

Then deploy:

1. Install Firebase CLI and log in:

```bash
npm install -g firebase-tools
firebase login
```

2. From the repo root, install functions dependencies and build functions:

```bash
cd functions
npm install
npm run build
cd ..
```

3. Initialize or select Firebase project (if not done):

```bash
firebase init hosting functions
# when prompted, choose the existing project or create a new one; for functions choose TypeScript
```

4. Deploy hosting + functions:

```bash
firebase deploy --only hosting,functions
```

Notes and next steps:
- The Firebase Functions code lives under `functions/src/index.ts` and exposes the Express app as a function named `api`. `firebase.json` rewrites `/api/**` to that function and serves `public/` for static frontend files.
- If you prefer to store the CSV in Cloud Storage and read it at runtime, I can adapt the functions code to read from a storage bucket instead of bundling the CSV.
- I can also add a deploy script to the root `package.json` to automate building functions and deploying.

If you want me to perform the deploy from here (I can run the build and firebase deploy commands), tell me which Firebase project ID to use (or add it to `.firebaserc`) and I will run the commands and report back.
