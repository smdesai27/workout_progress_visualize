/**
 * Fuzz Tests
 * Property-based testing using fast-check for random input generation
 */

import fc from 'fast-check';
import request from 'supertest';
import express from 'express';

// Create test app
const createFuzzTestApp = () => {
    const app = express();
    app.use(express.json({ limit: '100kb' }));

    // Epley formula
    const epley = (weight: number, reps: number) => weight * (1 + reps / 30);

    // Brzycki formula
    const brzycki = (weight: number, reps: number) => weight / (1.0278 - 0.0278 * reps);

    app.get('/api/health', (_req, res) => res.json({ ok: true }));

    app.get('/api/session/:id', (req, res) => {
        const id = req.params.id;
        if (!id) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json({ id, title: 'Test' });
    });

    app.get('/api/exercise/:name/progression', (req, res) => {
        res.json([]);
    });

    app.post('/api/chat', (req, res) => {
        const { userMessage } = req.body;
        if (!userMessage || typeof userMessage !== 'string') {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }
        res.json({ response: 'OK', model: 'test' });
    });

    app.post('/api/calculate1rm', (req, res) => {
        const { weight, reps } = req.body;
        if (typeof weight !== 'number' || typeof reps !== 'number') {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }
        res.json({
            epley: epley(weight, reps),
            brzycki: brzycki(weight, reps)
        });
    });

    return app;
};

describe('Fuzz Tests - 1RM Formulas', () => {
    // Epley formula: 1RM = weight × (1 + reps/30)
    const epley = (weight: number, reps: number) => weight * (1 + reps / 30);

    // Brzycki formula: 1RM = weight / (1.0278 - 0.0278 × reps)
    const brzycki = (weight: number, reps: number) => weight / (1.0278 - 0.0278 * reps);

    test('Epley formula always returns higher value than input weight for reps > 0', () => {
        fc.assert(
            fc.property(
                fc.float({ min: 1, max: 1000, noNaN: true }),
                fc.integer({ min: 1, max: 30 }),
                (weight, reps) => {
                    const result = epley(weight, reps);
                    return result >= weight;
                }
            ),
            { numRuns: 1000 }
        );
    });

    test('Epley formula returns exact weight for 0 reps', () => {
        fc.assert(
            fc.property(
                fc.float({ min: 1, max: 1000, noNaN: true }),
                (weight) => {
                    const result = epley(weight, 0);
                    return Math.abs(result - weight) < 0.001;
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Epley formula is monotonically increasing with reps', () => {
        fc.assert(
            fc.property(
                fc.float({ min: 1, max: 1000, noNaN: true }),
                fc.integer({ min: 1, max: 29 }),
                (weight, reps) => {
                    const result1 = epley(weight, reps);
                    const result2 = epley(weight, reps + 1);
                    return result2 > result1;
                }
            ),
            { numRuns: 500 }
        );
    });

    test('Brzycki formula returns positive values for valid inputs (reps < 37)', () => {
        fc.assert(
            fc.property(
                fc.float({ min: 1, max: 1000, noNaN: true }),
                fc.integer({ min: 1, max: 36 }),
                (weight, reps) => {
                    const result = brzycki(weight, reps);
                    return result > 0 && isFinite(result);
                }
            ),
            { numRuns: 1000 }
        );
    });

    test('Both formulas produce similar results for moderate reps (1-10)', () => {
        fc.assert(
            fc.property(
                fc.float({ min: 50, max: 500, noNaN: true }),
                fc.integer({ min: 1, max: 10 }),
                (weight, reps) => {
                    const epleyResult = epley(weight, reps);
                    const brzyckiResult = brzycki(weight, reps);
                    const diff = Math.abs(epleyResult - brzyckiResult);
                    const maxDiff = weight * 0.1; // Within 10%
                    return diff < maxDiff;
                }
            ),
            { numRuns: 500 }
        );
    });

    test('Formulas scale linearly with weight', () => {
        fc.assert(
            fc.property(
                fc.float({ min: 10, max: 100, noNaN: true }),
                fc.integer({ min: 1, max: 20 }),
                fc.float({ min: 1.5, max: 3, noNaN: true }),
                (weight, reps, multiplier) => {
                    const result1 = epley(weight, reps);
                    const result2 = epley(weight * multiplier, reps);
                    const ratio = result2 / result1;
                    return Math.abs(ratio - multiplier) < 0.001;
                }
            ),
            { numRuns: 500 }
        );
    });
});

describe('Fuzz Tests - API Endpoints', () => {
    const app = createFuzzTestApp();

    test('Session endpoint handles random session IDs', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 0, maxLength: 1000 }),
                async (id) => {
                    const response = await request(app).get(`/api/session/${encodeURIComponent(id)}`);
                    return [200, 404, 400].includes(response.status);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Exercise progression endpoint handles random exercise names', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 500 }),
                async (name) => {
                    const response = await request(app).get(`/api/exercise/${encodeURIComponent(name)}/progression`);
                    return [200, 404].includes(response.status);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Chat endpoint handles random string messages', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 5000 }),
                async (message) => {
                    const response = await request(app)
                        .post('/api/chat')
                        .send({ userMessage: message });
                    return [200, 400, 413].includes(response.status);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Chat endpoint handles random unicode strings', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 1000 }),
                async (message) => {
                    const response = await request(app)
                        .post('/api/chat')
                        .send({ userMessage: message });
                    return [200, 400].includes(response.status);
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('Fuzz Tests - Data Transformation', () => {
    // Simulate buildSessions
    function buildSessions(rows: any[]) {
        const map = new Map<string, any>();
        for (const r of rows) {
            if (!r.title || !r.start_time) continue;
            const key = `${r.title}|||${r.start_time}`;
            if (!map.has(key)) {
                map.set(key, {
                    id: key,
                    title: r.title,
                    start_time: r.start_time,
                    exercises: new Map<string, any>()
                });
            }
            const session = map.get(key);
            const ex = r.exercise_title || '(unknown)';
            if (!session.exercises.has(ex)) {
                session.exercises.set(ex, []);
            }
            session.exercises.get(ex).push({
                weight_lbs: typeof r.weight_lbs === 'number' ? r.weight_lbs : null,
                reps: typeof r.reps === 'number' ? r.reps : null
            });
        }
        return Array.from(map.values()).map((s: any) => {
            const exs: any = {};
            for (const [k, v] of s.exercises) exs[k] = v;
            return { ...s, exercises: exs };
        });
    }

    // Arbitrary for workout row
    const workoutRowArb = fc.record({
        title: fc.string({ minLength: 1, maxLength: 100 }),
        start_time: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
        exercise_title: fc.string({ minLength: 0, maxLength: 100 }),
        weight_lbs: fc.oneof(fc.float({ min: 0, max: 1000, noNaN: true }), fc.constant(null)),
        reps: fc.oneof(fc.integer({ min: 0, max: 100 }), fc.constant(null)),
        set_index: fc.integer({ min: 1, max: 10 })
    });

    test('buildSessions never crashes on random input', () => {
        fc.assert(
            fc.property(
                fc.array(workoutRowArb, { minLength: 0, maxLength: 100 }),
                (rows) => {
                    const result = buildSessions(rows);
                    return Array.isArray(result);
                }
            ),
            { numRuns: 500 }
        );
    });

    test('buildSessions groups same session correctly', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 50 }),
                fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
                fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
                (title, date, exercises) => {
                    const dateStr = date.toISOString();
                    const rows = exercises.map((ex, i) => ({
                        title,
                        start_time: dateStr,
                        exercise_title: ex,
                        weight_lbs: 100 + i * 10,
                        reps: 10,
                        set_index: i + 1
                    }));
                    const sessions = buildSessions(rows);
                    return sessions.length === 1;
                }
            ),
            { numRuns: 200 }
        );
    });

    test('buildSessions preserves total number of sets', () => {
        fc.assert(
            fc.property(
                fc.array(workoutRowArb, { minLength: 1, maxLength: 50 }),
                (rows) => {
                    const validRows = rows.filter(r => r.title && r.start_time);
                    const sessions = buildSessions(validRows);
                    const totalSetsAfter = sessions.reduce((sum, s) => {
                        return sum + Object.values(s.exercises).reduce((exSum: number, sets: any) => exSum + sets.length, 0);
                    }, 0);
                    return totalSetsAfter === validRows.length;
                }
            ),
            { numRuns: 200 }
        );
    });
});

describe('Fuzz Tests - Edge Cases', () => {
    const epley = (weight: number, reps: number) => weight * (1 + reps / 30);

    test('Handles extreme weight values', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                fc.integer({ min: 0, max: 50 }),
                (weight, reps) => {
                    const result = epley(weight, reps);
                    return isFinite(result) && result >= 0;
                }
            ),
            { numRuns: 500 }
        );
    });

    test('Handles near-zero weights', () => {
        fc.assert(
            fc.property(
                fc.float({ min: Math.fround(0.01), max: 1, noNaN: true }),
                fc.integer({ min: 1, max: 30 }),
                (weight, reps) => {
                    const result = epley(weight, reps);
                    return result > 0 && isFinite(result);
                }
            ),
            { numRuns: 100 }
        );
    });
});
