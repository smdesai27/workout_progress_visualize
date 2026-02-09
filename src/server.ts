// Load environment variables from .env file (must be first!)
import 'dotenv/config';

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
  weight_lbs?: string;
  weight_kg?: string;
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
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini AI (use environment variable for API key)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
let genAI: GoogleGenerativeAI | null = null;
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

// Security: HTML entity escaping to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Validate and sanitize session ID format
function sanitizeSessionId(id: string): string | null {
  // Session IDs should be alphanumeric with common separators
  // Reject if contains HTML-like content
  if (/<[^>]*>/g.test(id)) {
    return null; // Reject HTML tags
  }
  return id;
}


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
    const weightKg = r.weight_kg ? Number(r.weight_kg) : null;
    const weightLbs = r.weight_lbs ? Number(r.weight_lbs) : null;
    const finalWeightLbs = weightLbs !== null ? weightLbs : (weightKg !== null ? weightKg * 2.20462262185 : null);
    session.exercises.get(ex).push({
      set_index: Number(r.set_index),
      weight_lbs: finalWeightLbs,
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
app.use(express.json({ limit: '10kb' })); // DoS protection: limit payload size
app.use(express.static(path.resolve(__dirname, '..', 'public')));

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
    id = decodeURIComponent(raw);
  } catch (err) {
    id = raw;
  }

  // Security: Reject IDs containing HTML tags (XSS prevention)
  const sanitizedId = sanitizeSessionId(id);
  if (sanitizedId === null) {
    res.status(400).json({ error: 'Invalid session ID format' });
    return;
  }

  let s = SESSIONS.find(x => x.id === sanitizedId);
  if (!s) {
    const encoded = encodeURIComponent(sanitizedId);
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

// AI Coach chat endpoint using Gemini
app.post('/api/chat', async (req, res) => {
  try {
    const { systemPrompt, userMessage } = req.body;

    if (!userMessage) {
      res.status(400).json({ error: 'Missing userMessage' });
      return;
    }

    if (!genAI) {
      // No API key - return helpful message
      res.json({
        response: 'AI Coach requires a Gemini API key. Please set GEMINI_API_KEY environment variable. Get free key at: https://ai.google.dev/',
        model: 'none'
      });
      return;
    }

    // Call ListModels API directly to see what's available
    let availableModels: string[] = [];
    try {
      const listResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
      if (listResponse.ok) {
        const listData = await listResponse.json();
        availableModels = (listData.models || []).map((m: any) => m.name || '').filter(Boolean);
      }
    } catch (listErr: any) {
      // If ListModels fails, we'll use fallback model names
    }

    // Find a model that supports generateContent
    let model: any = null;
    let modelName = '';
    
    // Try models from ListModels first, then fallback to common names
    const candidates = availableModels.length > 0 
      ? availableModels.filter((name: string) => name.includes('gemini'))
      : ['gemini-1.5-pro-latest', 'gemini-1.5-flash-latest', 'gemini-pro', 'gemini-1.5-pro', 'models/gemini-1.5-pro'];
    
    for (const candidate of candidates) {
      try {
        // Remove 'models/' prefix if present, SDK adds it
        const cleanName = candidate.replace(/^models\//, '');
        model = genAI.getGenerativeModel({ model: cleanName });
        modelName = cleanName;
        break;
      } catch (modelErr: any) {
        continue;
      }
    }

    if (!model) {
      throw new Error('No available Gemini models found. Please check your API key and model availability.');
    }

    // Combine system prompt and user message
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\nUser Question: ${userMessage}\n\nProvide a helpful, concise response (2-3 sentences):`
      : userMessage;

    // Retry logic for rate limits
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await model.generateContent(fullPrompt);
        const response = result.response.text();
        res.json({ response, model: modelName });
        return;
      } catch (err: any) {
        lastError = err;
        if (err.status === 429) {
          // Rate limited - wait and retry
          const waitTime = Math.min(2000 * Math.pow(2, attempt), 10000);
          console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw err; // Re-throw non-rate-limit errors
      }
    }

    // All retries exhausted
    throw lastError;

  } catch (error: any) {
    console.error('AI Chat error:', error);

    // User-friendly error messages
    let userMessage = 'AI generation failed. Please try again.';
    let statusCode = 500;
    if (error.status === 429) {
      userMessage = 'AI currently unavailable';
      statusCode = 429; // Keep 429 status for accurate rate limit detection
    } else if (error.status === 401 || error.status === 403) {
      userMessage = 'API key issue. Please check your GEMINI_API_KEY.';
    }

    res.status(statusCode).json({
      error: userMessage,
      response: userMessage, // Include response field for consistency
      details: error.message
    });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

