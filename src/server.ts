// Clean server implementation
type RawRow = {
  title: string;
  start_time: string;
  end_time: string;
  description: string;
  exercise_title: string;
  superset_id: string;
  exercise_notes: string;
  set_index: string;
  set_type: string;
  weight_lbs: string;
  reps: string;
  distance_miles: string;
  duration_seconds: string;
  rpe: string;
};

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const CSV_PATH = path.resolve(__dirname, '..', 'workout_data.csv');

function buildSessions(rows: RawRow[]) {
  const map = new Map<string, any>();
  for (const r of rows) {
    const key = `${r.title}|||${r.start_time}`;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        title: r.title,
        start_time: r.start_time,
        end_time: r.end_time,
        description: r.description,
        exercises: new Map<string, any>()
      });
    }
    const session = map.get(key);
    const ex = r.exercise_title || '(unknown)';
    if (!session.exercises.has(ex)) {
      session.exercises.set(ex, []);
    }
    session.exercises.get(ex).push({
      set_index: Number(r.set_index),
      weight_lbs: r.weight_lbs ? Number(r.weight_lbs) : null,
      reps: r.reps ? Number(r.reps) : null,
      distance_miles: r.distance_miles ? Number(r.distance_miles) : null,
      duration_seconds: r.duration_seconds ? Number(r.duration_seconds) : null,
      rpe: r.rpe ? Number(r.rpe) : null,
      exercise_notes: r.exercise_notes || ''
    });
  }
  const sessions = Array.from(map.values()).map((s: any) => {
    const exs: any = {};
    for (const [k, v] of s.exercises) exs[k] = v;
    return { ...s, exercises: exs };
  });
  sessions.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  return sessions;
}

function computeExerciseProgression(sessions: any[], exerciseName: string) {
  const timeline: { sessionId: string; date: string; maxWeight: number | null; epley: number | null; brzycki: number | null; totalSets: number }[] = [];
  for (const s of sessions) {
    const sets = s.exercises[exerciseName];
    if (!sets) continue;
    let maxW: number | null = null;
    let epley_1rm: number | null = null;
    let brzycki_1rm: number | null = null;
    let totalSets = 0;
    for (const set of sets) {
      if (typeof set.weight_lbs === 'number') {
        if (maxW === null || set.weight_lbs > maxW) maxW = set.weight_lbs;
        const e = epley_formula(set.weight_lbs, set.reps);
        const b = brzycki_formula(set.weight_lbs, set.reps);
        if (epley_1rm == null || e > epley_1rm) epley_1rm = e;
        if (brzycki_1rm == null || b > brzycki_1rm) brzycki_1rm = b;
      }
      if (typeof set.reps === 'number') totalSets += 1;
    }
    timeline.push({ sessionId: s.id, date: s.start_time, maxWeight: maxW, epley: epley_1rm, brzycki: brzycki_1rm, totalSets });
  }
  timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return timeline;
}

function epley_formula(weight: number, reps: number) {
  return weight * (1 + reps / 30);
}

function brzycki_formula(weight: number, reps: number) {
  return weight / (1.0278 - 0.0278 * reps);
}

let RAW_ROWS: RawRow[] = [];
let SESSIONS: any[] = [];

function loadData() {
  try {
    const csvData = fs.readFileSync(CSV_PATH, 'utf-8');
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    });
    RAW_ROWS = records.map((r: any) => ({
      title: r.title ?? r['"title"'] ?? '',
      start_time: r.start_time ?? r['"start_time"'] ?? '',
      end_time: r.end_time ?? r['"end_time"'] ?? '',
      description: r.description ?? r['"description"'] ?? '',
      exercise_title: r.exercise_title ?? r['"exercise_title"'] ?? '',
      superset_id: r.superset_id ?? r['"superset_id"'] ?? '',
      exercise_notes: r.exercise_notes ?? r['"exercise_notes"'] ?? '',
      set_index: r.set_index ?? r['"set_index"'] ?? '',
      set_type: r.set_type ?? r['"set_type"'] ?? '',
      weight_lbs: r.weight_lbs ?? r['"weight_lbs"'] ?? '',
      reps: r.reps ?? r['"reps"'] ?? '',
      distance_miles: r.distance_miles ?? r['"distance_miles"'] ?? '',
      duration_seconds: r.duration_seconds ?? r['"duration_seconds"'] ?? '',
      rpe: r.rpe ?? r['"rpe"'] ?? ''
    } as RawRow));
    SESSIONS = buildSessions(RAW_ROWS);
    console.log(`Loaded ${RAW_ROWS.length} rows, ${SESSIONS.length} sessions`);
  } catch (err) {
    console.error('Failed to load CSV:', err);
    RAW_ROWS = [];
    SESSIONS = [];
  }
}

loadData();

const app = express();
app.use(cors());
app.use(express.static(path.resolve(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/sessions', (_req, res) => {
  const out = SESSIONS.map(s => ({ id: s.id, title: s.title, start_time: s.start_time, end_time: s.end_time, description: s.description, exercises: Object.keys(s.exercises) }));
  res.json(out);
});

app.get('/api/session/:id', (req, res) => {
  const id = req.params.id;
  const s = SESSIONS.find(x => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

app.get('/api/exercises', (_req, res) => {
  const set = new Set<string>();
  for (const r of RAW_ROWS) {
    set.add(r.exercise_title || '(unknown)');
  }
  const arr = Array.from(set).sort((a, b) => a.localeCompare(b));
  res.json(arr);
});

app.get('/api/exercise/:name/progression', (req, res) => {
  const name = req.params.name;
  const timeline = computeExerciseProgression(SESSIONS, name);
  res.json(timeline);
});

app.get('/api/reload', (_req, res) => {
  loadData();
  res.json({ ok: true });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
