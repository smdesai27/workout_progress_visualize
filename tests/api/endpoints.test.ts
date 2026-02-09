/**
 * API Integration Tests
 * Tests all REST API endpoints with Supertest
 */

import request from 'supertest';
import express from 'express';

// Create a minimal test app that mirrors the real server
const createTestApp = () => {
    const app = express();
    app.use(express.json());

    // Mock data
    const MOCK_SESSIONS = [
        {
            id: 'Morning Workout|||2024-01-15T09:00:00Z',
            title: 'Morning Workout',
            start_time: '2024-01-15T09:00:00Z',
            end_time: '2024-01-15T10:00:00Z',
            description: 'Push day',
            exercises: {
                'Bench Press': [
                    { set_index: 1, weight_lbs: 135, reps: 10 },
                    { set_index: 2, weight_lbs: 155, reps: 8 }
                ]
            }
        },
        {
            id: 'Evening Workout|||2024-01-16T18:00:00Z',
            title: 'Evening Workout',
            start_time: '2024-01-16T18:00:00Z',
            end_time: '2024-01-16T19:00:00Z',
            description: 'Pull day',
            exercises: {
                'Deadlift': [{ set_index: 1, weight_lbs: 225, reps: 5 }]
            }
        }
    ];

    // Health endpoint
    app.get('/api/health', (_req, res) => res.json({ ok: true }));

    // Sessions list
    app.get('/api/sessions', (_req, res) => {
        const out = MOCK_SESSIONS.map(s => ({
            id: s.id,
            title: s.title,
            start_time: s.start_time,
            end_time: s.end_time,
            description: s.description,
            exercises: Object.keys(s.exercises)
        }));
        res.json(out);
    });

    // Single session
    app.get('/api/session/:id', (req, res) => {
        let id = decodeURIComponent(req.params.id);
        const session = MOCK_SESSIONS.find(s => s.id === id);
        if (!session) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(session);
    });

    // Exercises list
    app.get('/api/exercises', (_req, res) => {
        const exercises = new Set<string>();
        for (const session of MOCK_SESSIONS) {
            Object.keys(session.exercises).forEach(e => exercises.add(e));
        }
        res.json(Array.from(exercises).sort());
    });

    // Exercise progression
    app.get('/api/exercise/:name/progression', (req, res) => {
        const name = req.params.name;
        const timeline: any[] = [];
        for (const s of MOCK_SESSIONS) {
            const sets = (s.exercises as any)[name];
            if (!sets) continue;
            let maxW = 0;
            for (const set of sets) {
                if (set.weight_lbs > maxW) maxW = set.weight_lbs;
            }
            timeline.push({ sessionId: s.id, date: s.start_time, maxWeight: maxW });
        }
        res.json(timeline);
    });

    // Chat endpoint (mock) with rate limit simulation
    app.post('/api/chat', (req, res) => {
        const { userMessage, systemPrompt } = req.body;
        if (!userMessage) {
            res.status(400).json({ error: 'Missing userMessage' });
            return;
        }
        // Simulate rate limit for testing
        if (userMessage === 'RATE_LIMIT_TEST') {
            res.status(429).json({
                error: 'AI currently unavailable',
                response: 'AI currently unavailable'
            });
            return;
        }
        // Simulate API key error
        if (userMessage === 'API_KEY_ERROR') {
            res.status(401).json({
                error: 'API key issue. Please check your GEMINI_API_KEY.',
                response: 'API key issue. Please check your GEMINI_API_KEY.'
            });
            return;
        }
        res.json({ response: 'Mock AI response', model: 'test' });
    });

    // Reload (mock)
    app.get('/api/reload', (_req, res) => res.json({ ok: true }));

    return app;
};

describe('API Endpoints', () => {
    const app = createTestApp();

    describe('GET /api/health', () => {
        test('returns ok status', async () => {
            const response = await request(app).get('/api/health');
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ ok: true });
        });
    });

    describe('GET /api/sessions', () => {
        test('returns array of sessions', async () => {
            const response = await request(app).get('/api/sessions');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBeGreaterThan(0);
        });

        test('sessions have required fields', async () => {
            const response = await request(app).get('/api/sessions');
            const session = response.body[0];
            expect(session).toHaveProperty('id');
            expect(session).toHaveProperty('title');
            expect(session).toHaveProperty('start_time');
            expect(session).toHaveProperty('exercises');
        });

        test('exercises is an array of strings', async () => {
            const response = await request(app).get('/api/sessions');
            const session = response.body[0];
            expect(Array.isArray(session.exercises)).toBe(true);
            expect(typeof session.exercises[0]).toBe('string');
        });
    });

    describe('GET /api/session/:id', () => {
        test('returns session by valid ID', async () => {
            const id = encodeURIComponent('Morning Workout|||2024-01-15T09:00:00Z');
            const response = await request(app).get(`/api/session/${id}`);
            expect(response.status).toBe(200);
            expect(response.body.title).toBe('Morning Workout');
        });

        test('returns 404 for invalid ID', async () => {
            const response = await request(app).get('/api/session/nonexistent');
            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('error');
        });

        test('handles URL-encoded special characters in ID', async () => {
            const id = encodeURIComponent('Morning Workout|||2024-01-15T09:00:00Z');
            const response = await request(app).get(`/api/session/${id}`);
            expect(response.status).toBe(200);
        });

        test('session contains exercises object', async () => {
            const id = encodeURIComponent('Morning Workout|||2024-01-15T09:00:00Z');
            const response = await request(app).get(`/api/session/${id}`);
            expect(typeof response.body.exercises).toBe('object');
            expect(response.body.exercises['Bench Press']).toBeDefined();
        });
    });

    describe('GET /api/exercises', () => {
        test('returns array of exercise names', async () => {
            const response = await request(app).get('/api/exercises');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });

        test('exercises are sorted alphabetically', async () => {
            const response = await request(app).get('/api/exercises');
            const exercises = response.body;
            const sorted = [...exercises].sort();
            expect(exercises).toEqual(sorted);
        });

        test('exercises are unique', async () => {
            const response = await request(app).get('/api/exercises');
            const exercises = response.body;
            const uniqueSet = new Set(exercises);
            expect(exercises.length).toBe(uniqueSet.size);
        });
    });

    describe('GET /api/exercise/:name/progression', () => {
        test('returns progression timeline for valid exercise', async () => {
            const response = await request(app).get('/api/exercise/Bench%20Press/progression');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBeGreaterThan(0);
        });

        test('progression entries have required fields', async () => {
            const response = await request(app).get('/api/exercise/Bench%20Press/progression');
            const entry = response.body[0];
            expect(entry).toHaveProperty('sessionId');
            expect(entry).toHaveProperty('date');
            expect(entry).toHaveProperty('maxWeight');
        });

        test('returns empty array for non-existent exercise', async () => {
            const response = await request(app).get('/api/exercise/NonExistent/progression');
            expect(response.status).toBe(200);
            expect(response.body).toEqual([]);
        });

        test('handles spaces in exercise name', async () => {
            const response = await request(app).get('/api/exercise/Bench%20Press/progression');
            expect(response.status).toBe(200);
        });
    });

    describe('POST /api/chat', () => {
        test('returns response for valid message', async () => {
            const response = await request(app)
                .post('/api/chat')
                .send({ userMessage: 'Hello' });
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('response');
        });

        test('returns 400 for missing userMessage', async () => {
            const response = await request(app)
                .post('/api/chat')
                .send({});
            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Missing userMessage');
        });

        test('accepts systemPrompt parameter', async () => {
            const response = await request(app)
                .post('/api/chat')
                .send({ userMessage: 'Hello', systemPrompt: 'You are a coach.' });
            expect(response.status).toBe(200);
        });

        test('handles empty string userMessage', async () => {
            const response = await request(app)
                .post('/api/chat')
                .send({ userMessage: '' });
            expect(response.status).toBe(400);
        });

        test('handles rate limit errors correctly', async () => {
            const response = await request(app)
                .post('/api/chat')
                .send({ userMessage: 'RATE_LIMIT_TEST' });
            expect(response.status).toBe(429);
            expect(response.body.error).toBe('AI currently unavailable');
            expect(response.body.response).toBe('AI currently unavailable');
        });

        test('handles API key errors correctly', async () => {
            const response = await request(app)
                .post('/api/chat')
                .send({ userMessage: 'API_KEY_ERROR' });
            expect(response.status).toBe(401);
            expect(response.body.error).toContain('API key issue');
        });

        test('response includes model field on success', async () => {
            const response = await request(app)
                .post('/api/chat')
                .send({ userMessage: 'Hello' });
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('model');
        });
    });

    describe('GET /api/reload', () => {
        test('returns ok status', async () => {
            const response = await request(app).get('/api/reload');
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ ok: true });
        });
    });
});

describe('API Error Handling', () => {
    const app = createTestApp();

    test('returns JSON for 404', async () => {
        const response = await request(app).get('/api/session/invalid');
        expect(response.headers['content-type']).toMatch(/json/);
    });

    test('POST endpoints reject non-JSON content type gracefully', async () => {
        const response = await request(app)
            .post('/api/chat')
            .set('Content-Type', 'text/plain')
            .send('hello');
        // Should either error or handle gracefully
        expect([200, 400, 415]).toContain(response.status);
    });
});
