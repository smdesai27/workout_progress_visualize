"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
const functions = __importStar(require("firebase-functions"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const sync_1 = require("csv-parse/sync");
const generative_ai_1 = require("@google/generative-ai");
// Security: HTML entity escaping to prevent XSS
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
// Validate and sanitize session ID format
function sanitizeSessionId(id) {
    if (/<[^>]*>/g.test(id)) {
        return null;
    }
    return id;
}
// Initialize Gemini AI (use environment variable for API key)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
let genAI = null;
if (GEMINI_API_KEY) {
    genAI = new generative_ai_1.GoogleGenerativeAI(GEMINI_API_KEY);
}
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10kb' })); // DoS protection
const CSV_PATH = path_1.default.resolve(__dirname, '..', 'workout_data.csv');
function buildSessions(rows) {
    const map = new Map();
    for (const r of rows) {
        const key = `${r.title}|||${r.start_time}`;
        if (!map.has(key)) {
            map.set(key, {
                id: key,
                title: r.title,
                start_time: r.start_time,
                end_time: r.end_time,
                description: r.description,
                exercises: new Map()
            });
        }
        const session = map.get(key);
        const ex = r.exercise_title || '(unknown)';
        if (!session.exercises.has(ex))
            session.exercises.set(ex, []);
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
    const sessions = Array.from(map.values()).map((s) => {
        const exs = {};
        for (const [k, v] of s.exercises)
            exs[k] = v;
        return { ...s, exercises: exs };
    });
    sessions.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    return sessions;
}
function epley_formula(weight, reps) { return weight * (1 + (reps / 30)); }
function brzycki_formula(weight, reps) { return weight / (1.0278 - (0.0278 * reps)); }
function computeExerciseProgression(sessions, exerciseName) {
    const timeline = [];
    for (const s of sessions) {
        const sets = s.exercises[exerciseName];
        if (!sets)
            continue;
        let maxW = null;
        let epley_1rm = null;
        let brzycki_1rm = null;
        let totalSets = 0;
        for (const set of sets) {
            if (typeof set.weight_lbs === 'number') {
                if (maxW === null || set.weight_lbs > maxW)
                    maxW = set.weight_lbs;
                if (epley_1rm == null || epley_formula(set.weight_lbs, set.reps) > epley_1rm)
                    epley_1rm = epley_formula(set.weight_lbs, set.reps);
                if (brzycki_1rm == null || brzycki_formula(set.weight_lbs, set.reps) > brzycki_1rm)
                    brzycki_1rm = brzycki_formula(set.weight_lbs, set.reps);
            }
            if (typeof set.reps === 'number')
                totalSets += 1;
        }
        timeline.push({ sessionId: s.id, date: s.start_time, maxWeight: maxW, epley: epley_1rm, brzycki: brzycki_1rm, totalSets: totalSets });
    }
    timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return timeline;
}
let RAW_ROWS = [];
let SESSIONS = [];
function loadData() {
    try {
        const csvFull = fs_1.default.readFileSync(CSV_PATH, 'utf-8');
        const records = (0, sync_1.parse)(csvFull, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
        RAW_ROWS = records.map((r) => ({
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
        }));
        SESSIONS = buildSessions(RAW_ROWS);
        console.log(`Loaded ${RAW_ROWS.length} rows, ${SESSIONS.length} sessions`);
    }
    catch (err) {
        console.error('Failed to load CSV in functions:', err);
        RAW_ROWS = [];
        SESSIONS = [];
    }
}
// Lazy loading middleware
let dataLoaded = false;
function ensureDataLoaded() {
    if (dataLoaded)
        return;
    loadData();
    dataLoaded = true;
}
// Ensure data is loaded for every request
app.use((req, res, next) => {
    ensureDataLoaded();
    next();
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/sessions', (_req, res) => {
    const out = SESSIONS.map(s => ({ id: s.id, title: s.title, start_time: s.start_time, end_time: s.end_time, description: s.description, exercises: Object.keys(s.exercises) }));
    res.json(out);
});
app.get('/api/session/:id', (req, res) => {
    // Accept both path param and query param as callers may vary.
    // Be robust to URL-encoded ids (e.g. "%7C%7C%7C" for "|||").
    const raw = (req.params.id ?? req.query.id ?? '');
    let id = raw;
    try {
        // If raw is percent-encoded, decode it. If it's already decoded, this is a no-op.
        id = decodeURIComponent(raw);
    }
    catch (err) {
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
    const set = new Set();
    for (const r of RAW_ROWS)
        set.add(r.exercise_title || '(unknown)');
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
// AI Chat endpoint with Gemini API
app.post('/api/chat', async (req, res) => {
    try {
        const { userMessage, systemPrompt } = req.body;
        if (!userMessage || typeof userMessage !== 'string') {
            res.status(400).json({ error: 'Missing or invalid userMessage' });
            return;
        }
        if (!genAI) {
            res.status(503).json({
                error: 'AI service temporarily unavailable',
                response: 'The AI Coach is currently unavailable. Please check that the API key is configured.'
            });
            return;
        }
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const fullPrompt = systemPrompt
            ? `${systemPrompt}\n\nUser: ${userMessage}`
            : userMessage;
        // Retry logic for rate limits
        let attempts = 0;
        const maxAttempts = 3;
        let lastError = null;
        while (attempts < maxAttempts) {
            try {
                const result = await model.generateContent(fullPrompt);
                const response = result.response;
                const text = response.text();
                res.json({ response: text });
                return;
            }
            catch (err) {
                lastError = err;
                if (err?.status === 429) {
                    attempts++;
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
                        continue;
                    }
                }
                break;
            }
        }
        // Handle final error
        console.error('Gemini API error:', lastError);
        if (lastError?.status === 429) {
            res.status(429).json({
                error: 'Rate limit exceeded',
                response: 'The AI is taking a short break. Please try again in a minute.'
            });
        }
        else {
            res.status(500).json({
                error: 'AI service error',
                response: 'I encountered an issue. Please try again.'
            });
        }
    }
    catch (err) {
        console.error('Chat endpoint error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.api = functions.https.onRequest(app);
//# sourceMappingURL=index.js.map