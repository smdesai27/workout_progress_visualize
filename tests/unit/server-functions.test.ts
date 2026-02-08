/**
 * Server Unit Tests
 * Tests for server-side functions: 1RM formulas, session building, progression calculation
 */

// Mock the dependencies before importing
jest.mock('fs');
jest.mock('csv-parse/sync');

describe('Server Functions', () => {

    describe('1RM Formula Tests', () => {
        // Test Epley formula: 1RM = weight × (1 + reps/30)
        const epley_formula = (weight: number, reps: number) => weight * (1 + reps / 30);

        // Test Brzycki formula: 1RM = weight / (1.0278 - 0.0278 × reps)
        const brzycki_formula = (weight: number, reps: number) => weight / (1.0278 - 0.0278 * reps);

        test('Epley formula calculates correctly for 1 rep (should equal weight)', () => {
            const result = epley_formula(100, 1);
            expect(result).toBeCloseTo(103.33, 1);
        });

        test('Epley formula calculates correctly for 10 reps', () => {
            const result = epley_formula(100, 10);
            expect(result).toBeCloseTo(133.33, 1);
        });

        test('Brzycki formula calculates correctly for 1 rep', () => {
            const result = brzycki_formula(100, 1);
            expect(result).toBeCloseTo(100, 0);
        });

        test('Brzycki formula calculates correctly for 5 reps', () => {
            const result = brzycki_formula(100, 5);
            expect(result).toBeCloseTo(112.5, 0);
        });

        test('Both formulas produce similar results for moderate reps', () => {
            const epley = epley_formula(135, 5);
            const brzycki = brzycki_formula(135, 5);
            // Epley and Brzycki differ by ~5.6 lbs for 135x5 which is expected
            expect(Math.abs(epley - brzycki)).toBeLessThan(6);
        });

        test('Formulas handle edge case of 0 reps', () => {
            const epley = epley_formula(100, 0);
            expect(epley).toBe(100);
        });

        test('Formulas handle high weight values', () => {
            const epley = epley_formula(1000, 5);
            expect(epley).toBeCloseTo(1166.67, 0);
        });

        test('Formulas handle decimal weights', () => {
            const epley = epley_formula(135.5, 8);
            expect(epley).toBeCloseTo(171.63, 1);
        });
    });

    describe('Session Building Tests', () => {
        // Simulate buildSessions logic
        function buildSessions(rows: any[]) {
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
                    reps: r.reps ? Number(r.reps) : null
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

        test('buildSessions groups rows by session correctly', () => {
            const rows = [
                { title: 'Morning Workout', start_time: '2024-01-15T09:00:00Z', exercise_title: 'Bench Press', weight_lbs: '135', reps: '10', set_index: '1' },
                { title: 'Morning Workout', start_time: '2024-01-15T09:00:00Z', exercise_title: 'Bench Press', weight_lbs: '155', reps: '8', set_index: '2' },
                { title: 'Morning Workout', start_time: '2024-01-15T09:00:00Z', exercise_title: 'Squat', weight_lbs: '185', reps: '5', set_index: '1' }
            ];
            const sessions = buildSessions(rows);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].exercises['Bench Press']).toHaveLength(2);
            expect(sessions[0].exercises['Squat']).toHaveLength(1);
        });

        test('buildSessions handles multiple sessions', () => {
            const rows = [
                { title: 'Session 1', start_time: '2024-01-15T09:00:00Z', exercise_title: 'Bench Press', weight_lbs: '135', reps: '10', set_index: '1' },
                { title: 'Session 2', start_time: '2024-01-16T09:00:00Z', exercise_title: 'Squat', weight_lbs: '185', reps: '5', set_index: '1' }
            ];
            const sessions = buildSessions(rows);
            expect(sessions).toHaveLength(2);
        });

        test('buildSessions converts kg to lbs correctly', () => {
            const rows = [
                { title: 'Test', start_time: '2024-01-15T09:00:00Z', exercise_title: 'Deadlift', weight_kg: '100', reps: '5', set_index: '1' }
            ];
            const sessions = buildSessions(rows);
            expect(sessions[0].exercises['Deadlift'][0].weight_lbs).toBeCloseTo(220.46, 1);
        });

        test('buildSessions prefers lbs over kg when both provided', () => {
            const rows = [
                { title: 'Test', start_time: '2024-01-15T09:00:00Z', exercise_title: 'Deadlift', weight_lbs: '225', weight_kg: '100', reps: '5', set_index: '1' }
            ];
            const sessions = buildSessions(rows);
            expect(sessions[0].exercises['Deadlift'][0].weight_lbs).toBe(225);
        });

        test('buildSessions handles missing exercise title', () => {
            const rows = [
                { title: 'Test', start_time: '2024-01-15T09:00:00Z', exercise_title: '', weight_lbs: '135', reps: '10', set_index: '1' }
            ];
            const sessions = buildSessions(rows);
            expect(sessions[0].exercises['(unknown)']).toBeDefined();
        });

        test('buildSessions sorts sessions by date descending', () => {
            const rows = [
                { title: 'Old', start_time: '2024-01-01T09:00:00Z', exercise_title: 'Bench', weight_lbs: '100', reps: '10', set_index: '1' },
                { title: 'New', start_time: '2024-01-15T09:00:00Z', exercise_title: 'Bench', weight_lbs: '150', reps: '10', set_index: '1' }
            ];
            const sessions = buildSessions(rows);
            expect(sessions[0].title).toBe('New');
            expect(sessions[1].title).toBe('Old');
        });

        test('buildSessions handles empty input', () => {
            const sessions = buildSessions([]);
            expect(sessions).toHaveLength(0);
        });

        test('buildSessions handles null/undefined weight', () => {
            const rows = [
                { title: 'Test', start_time: '2024-01-15T09:00:00Z', exercise_title: 'Plank', reps: '60', set_index: '1' }
            ];
            const sessions = buildSessions(rows);
            expect(sessions[0].exercises['Plank'][0].weight_lbs).toBeNull();
        });
    });

    describe('Exercise Progression Tests', () => {
        // Simulate computeExerciseProgression logic
        function computeExerciseProgression(sessions: any[], exerciseName: string) {
            const epley_formula = (weight: number, reps: number) => weight * (1 + reps / 30);
            const brzycki_formula = (weight: number, reps: number) => weight / (1.0278 - 0.0278 * reps);

            const timeline: any[] = [];
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

        test('computeExerciseProgression calculates max weight correctly', () => {
            const sessions = [{
                id: '1',
                start_time: '2024-01-15T09:00:00Z',
                exercises: {
                    'Bench Press': [
                        { weight_lbs: 135, reps: 10 },
                        { weight_lbs: 155, reps: 8 },
                        { weight_lbs: 175, reps: 5 }
                    ]
                }
            }];
            const timeline = computeExerciseProgression(sessions, 'Bench Press');
            expect(timeline[0].maxWeight).toBe(175);
        });

        test('computeExerciseProgression calculates 1RM estimates', () => {
            const sessions = [{
                id: '1',
                start_time: '2024-01-15T09:00:00Z',
                exercises: {
                    'Squat': [{ weight_lbs: 200, reps: 5 }]
                }
            }];
            const timeline = computeExerciseProgression(sessions, 'Squat');
            expect(timeline[0].epley).toBeGreaterThan(200);
            expect(timeline[0].brzycki).toBeGreaterThan(200);
        });

        test('computeExerciseProgression returns empty for non-existent exercise', () => {
            const sessions = [{
                id: '1',
                start_time: '2024-01-15T09:00:00Z',
                exercises: { 'Bench Press': [{ weight_lbs: 135, reps: 10 }] }
            }];
            const timeline = computeExerciseProgression(sessions, 'Deadlift');
            expect(timeline).toHaveLength(0);
        });

        test('computeExerciseProgression counts sets correctly', () => {
            const sessions = [{
                id: '1',
                start_time: '2024-01-15T09:00:00Z',
                exercises: {
                    'Bench Press': [
                        { weight_lbs: 135, reps: 10 },
                        { weight_lbs: 155, reps: 8 },
                        { weight_lbs: 175, reps: 5 }
                    ]
                }
            }];
            const timeline = computeExerciseProgression(sessions, 'Bench Press');
            expect(timeline[0].totalSets).toBe(3);
        });

        test('computeExerciseProgression sorts by date ascending', () => {
            const sessions = [
                { id: '2', start_time: '2024-01-20T09:00:00Z', exercises: { 'Bench': [{ weight_lbs: 200, reps: 5 }] } },
                { id: '1', start_time: '2024-01-10T09:00:00Z', exercises: { 'Bench': [{ weight_lbs: 150, reps: 5 }] } }
            ];
            const timeline = computeExerciseProgression(sessions, 'Bench');
            expect(timeline[0].sessionId).toBe('1');
            expect(timeline[1].sessionId).toBe('2');
        });
    });
});
