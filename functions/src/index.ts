import * as functions from 'firebase-functions';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

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

const app = express();
app.use(cors());

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
    if (!session.exercises.has(ex)) session.exercises.set(ex, []);
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

function epley_formula(weight: number, reps:number){ return weight * (1 + (reps/30)); }
function brzycki_formula(weight: number, reps:number){ return weight/(1.0278 - (0.0278*reps)); }

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
        if (epley_1rm == null || epley_formula(set.weight_lbs,set.reps) > epley_1rm) epley_1rm = epley_formula(set.weight_lbs,set.reps);
        if (brzycki_1rm == null || brzycki_formula(set.weight_lbs,set.reps) > brzycki_1rm) brzycki_1rm = brzycki_formula(set.weight_lbs,set.reps);
      }
      if (typeof set.reps === 'number') totalSets += 1;
    }
    timeline.push({sessionId: s.id, date: s.start_time, maxWeight: maxW, epley: epley_1rm, brzycki: brzycki_1rm, totalSets: totalSets});
  }
  timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return timeline;
}

let RAW_ROWS: RawRow[] = [];
let SESSIONS: any[] = [];

function loadData() {
  try {
    const csvFull = fs.readFileSync(CSV_PATH, 'utf-8');
    const records = parse(csvFull, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
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
    console.error('Failed to load CSV in functions:', err);
    RAW_ROWS = [];
    SESSIONS = [];
  }
}

loadData();

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/sessions', (_req, res) => {
  const out = SESSIONS.map(s => ({ id: s.id, title: s.title, start_time: s.start_time, end_time: s.end_time, description: s.description, exercises: Object.keys(s.exercises) }));
  res.json(out);
});

app.get('/api/session/:id', (req, res) => {
  // Accept both path param and query param as callers may vary.
  // Be robust to URL-encoded ids (e.g. "%7C%7C%7C" for "|||").
  const raw = (req.params.id ?? req.query.id ?? '') as string;
  let id = raw;
  try {
    // If raw is percent-encoded, decode it. If it's already decoded, this is a no-op.
    id = decodeURIComponent(raw);
  } catch (err) {
    // keep raw if decode fails
    id = raw;
  }

  // Try direct match first, then compare encoded forms in case the server/router
  // left the param percent-encoded.
  let s = SESSIONS.find(x => x.id === id);
  if (!s) {
    const encoded = encodeURIComponent(id);
    s = SESSIONS.find(x => encodeURIComponent(x.id) === encoded || x.id === raw);
  }

  if (!s) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(s);
});

app.get('/api/exercises', (_req, res) => {
  const set = new Set<string>();
  for (const r of RAW_ROWS) set.add(r.exercise_title || '(unknown)');
  const arr = Array.from(set).sort((a,b)=>a.localeCompare(b));
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

export const api = functions.https.onRequest(app);
