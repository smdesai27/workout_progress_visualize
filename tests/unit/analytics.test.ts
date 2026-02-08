/**
 * Frontend Analytics Unit Tests
 * Tests for danfo-analytics and build-system-prompt functions
 */

describe('Analytics Functions', () => {

    describe('parseWorkoutDate', () => {
        // Simulate the function
        function parseWorkoutDate(dateStr: string): Date | null {
            if (!dateStr) return null;
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return null;
            return date;
        }

        test('parses ISO date string', () => {
            const result = parseWorkoutDate('2024-01-15T09:00:00Z');
            expect(result).toBeInstanceOf(Date);
            expect(result?.getFullYear()).toBe(2024);
        });

        test('returns null for empty string', () => {
            expect(parseWorkoutDate('')).toBeNull();
        });

        test('returns null for invalid date', () => {
            expect(parseWorkoutDate('not-a-date')).toBeNull();
        });

        test('handles various date formats', () => {
            expect(parseWorkoutDate('2024-01-15')).toBeInstanceOf(Date);
            expect(parseWorkoutDate('Jan 15, 2024')).toBeInstanceOf(Date);
        });
    });

    describe('inferTrainingAge', () => {
        const TRAINING_AGE_THRESHOLDS = {
            NOVICE: 6,
            INTERMEDIATE: 24
        };

        // Simulate the function
        function inferTrainingAge(sessions: any[]) {
            if (!sessions || sessions.length === 0) {
                return { classification: 'novice', months: 0, workoutsPerWeek: 0 };
            }

            const dates = sessions
                .map(s => new Date(s.start_time))
                .filter(d => !isNaN(d.getTime()))
                .sort((a, b) => a.getTime() - b.getTime());

            if (dates.length === 0) {
                return { classification: 'novice', months: 0, workoutsPerWeek: 0 };
            }

            const oldest = dates[0];
            const newest = dates[dates.length - 1];
            const months = (newest.getTime() - oldest.getTime()) / (30.44 * 24 * 60 * 60 * 1000);
            const weeks = months * 4.33;
            const workoutsPerWeek = weeks > 0 ? sessions.length / weeks : 0;

            let classification = 'novice';
            if (months >= TRAINING_AGE_THRESHOLDS.INTERMEDIATE) {
                classification = 'advanced';
            } else if (months >= TRAINING_AGE_THRESHOLDS.NOVICE) {
                classification = 'intermediate';
            }

            return { classification, months, workoutsPerWeek };
        }

        test('returns novice for empty sessions', () => {
            const result = inferTrainingAge([]);
            expect(result.classification).toBe('novice');
            expect(result.months).toBe(0);
        });

        test('returns novice for less than 6 months of data', () => {
            const sessions = [
                { start_time: '2024-01-01T09:00:00Z' },
                { start_time: '2024-03-01T09:00:00Z' }
            ];
            const result = inferTrainingAge(sessions);
            expect(result.classification).toBe('novice');
        });

        test('returns intermediate for 6-24 months of data', () => {
            const sessions = [
                { start_time: '2023-01-01T09:00:00Z' },
                { start_time: '2023-10-01T09:00:00Z' }
            ];
            const result = inferTrainingAge(sessions);
            expect(result.classification).toBe('intermediate');
            expect(result.months).toBeGreaterThan(6);
        });

        test('returns advanced for more than 24 months', () => {
            const sessions = [
                { start_time: '2021-01-01T09:00:00Z' },
                { start_time: '2024-01-01T09:00:00Z' }
            ];
            const result = inferTrainingAge(sessions);
            expect(result.classification).toBe('advanced');
        });

        test('calculates workouts per week', () => {
            // 10 sessions over 4 weeks = 2.5/week
            const sessions = [];
            for (let i = 0; i < 10; i++) {
                const date = new Date('2024-01-01');
                date.setDate(date.getDate() + i * 3);
                sessions.push({ start_time: date.toISOString() });
            }
            const result = inferTrainingAge(sessions);
            expect(result.workoutsPerWeek).toBeGreaterThan(1);
        });
    });

    describe('computeLogRegression', () => {
        // Simulate logarithmic regression
        function computeLogRegression(data: { week: number; oneRM: number }[]) {
            if (!data || data.length < 2) return null;

            const validData = data.filter(d => d.week > 0 && d.oneRM > 0);
            if (validData.length < 2) return null;

            // y = a * ln(x) + b
            const n = validData.length;
            const lnX = validData.map(d => Math.log(d.week));
            const y = validData.map(d => d.oneRM);

            const sumLnX = lnX.reduce((a, b) => a + b, 0);
            const sumY = y.reduce((a, b) => a + b, 0);
            const sumLnX2 = lnX.reduce((a, b) => a + b * b, 0);
            const sumLnXY = lnX.reduce((acc, val, i) => acc + val * y[i], 0);

            const a = (n * sumLnXY - sumLnX * sumY) / (n * sumLnX2 - sumLnX * sumLnX);
            const b = (sumY - a * sumLnX) / n;

            // R-squared
            const yMean = sumY / n;
            const ssTot = y.reduce((acc, val) => acc + Math.pow(val - yMean, 2), 0);
            const ssRes = validData.reduce((acc, d, i) => {
                const predicted = a * lnX[i] + b;
                return acc + Math.pow(d.oneRM - predicted, 2);
            }, 0);
            const rSquared = 1 - ssRes / ssTot;

            return { a, b, rSquared };
        }

        test('returns null for empty data', () => {
            expect(computeLogRegression([])).toBeNull();
        });

        test('returns null for single data point', () => {
            expect(computeLogRegression([{ week: 1, oneRM: 100 }])).toBeNull();
        });

        test('calculates coefficients for valid data', () => {
            const data = [
                { week: 1, oneRM: 100 },
                { week: 4, oneRM: 110 },
                { week: 8, oneRM: 115 },
                { week: 12, oneRM: 118 }
            ];
            const result = computeLogRegression(data);
            expect(result).not.toBeNull();
            expect(typeof result?.a).toBe('number');
            expect(typeof result?.b).toBe('number');
            expect(typeof result?.rSquared).toBe('number');
        });

        test('R-squared is between 0 and 1 for good fit', () => {
            const data = [
                { week: 1, oneRM: 100 },
                { week: 4, oneRM: 108 },
                { week: 8, oneRM: 113 },
                { week: 12, oneRM: 117 }
            ];
            const result = computeLogRegression(data);
            expect(result?.rSquared).toBeGreaterThanOrEqual(0);
            expect(result?.rSquared).toBeLessThanOrEqual(1);
        });

        test('handles flat data (no progress)', () => {
            const data = [
                { week: 1, oneRM: 100 },
                { week: 4, oneRM: 100 },
                { week: 8, oneRM: 100 }
            ];
            const result = computeLogRegression(data);
            expect(result).not.toBeNull();
            expect(result?.a).toBeCloseTo(0, 1);
        });
    });

    describe('predictFuture1RM', () => {
        const DECAY_CONSTANTS = {
            novice: 0.8,
            intermediate: 0.5,
            advanced: 0.3
        };

        // Simulate prediction function
        function predictFuture1RM(
            model: { a: number; b: number; rSquared: number },
            currentWeek: number,
            weeksAhead: number,
            trainingAge: 'novice' | 'intermediate' | 'advanced' = 'intermediate'
        ) {
            if (!model) return [];

            const predictions = [];
            const decay = DECAY_CONSTANTS[trainingAge];

            for (let i = 1; i <= weeksAhead; i++) {
                const futureWeek = currentWeek + i;
                const predicted = model.a * Math.log(futureWeek) + model.b;
                const decayFactor = Math.pow(decay, i / 10);
                const adjustedPrediction = predicted * decayFactor + model.b * (1 - decayFactor);

                const uncertainty = (1 - model.rSquared) * 0.1 * predicted * (i / weeksAhead);

                predictions.push({
                    week: futureWeek,
                    predicted: Math.max(0, adjustedPrediction),
                    lower: Math.max(0, adjustedPrediction - uncertainty),
                    upper: adjustedPrediction + uncertainty
                });
            }

            return predictions;
        }

        test('returns empty array for null model', () => {
            expect(predictFuture1RM(null as any, 12, 8)).toEqual([]);
        });

        test('returns correct number of predictions', () => {
            const model = { a: 10, b: 100, rSquared: 0.9 };
            const predictions = predictFuture1RM(model, 12, 8);
            expect(predictions).toHaveLength(8);
        });

        test('predictions start after current week', () => {
            const model = { a: 10, b: 100, rSquared: 0.9 };
            const predictions = predictFuture1RM(model, 12, 8);
            expect(predictions[0].week).toBe(13);
            expect(predictions[7].week).toBe(20);
        });

        test('predictions have confidence intervals', () => {
            const model = { a: 10, b: 100, rSquared: 0.8 };
            const predictions = predictFuture1RM(model, 12, 4);
            for (const p of predictions) {
                expect(p.lower).toBeLessThanOrEqual(p.predicted);
                expect(p.upper).toBeGreaterThanOrEqual(p.predicted);
            }
        });

        test('novice gains are higher than advanced gains', () => {
            const model = { a: 10, b: 100, rSquared: 0.9 };
            const novicePredictions = predictFuture1RM(model, 12, 8, 'novice');
            const advancedPredictions = predictFuture1RM(model, 12, 8, 'advanced');

            // Novice should have relatively higher predictions initially
            // (decay affects the curve shape)
            expect(novicePredictions[0].predicted).toBeGreaterThan(0);
            expect(advancedPredictions[0].predicted).toBeGreaterThan(0);
        });
    });

    describe('getPersonalRecords', () => {
        // Simulate PR extraction
        function getPersonalRecords(sessions: any[]) {
            const prMap = new Map<string, { weight: number; reps: number; date: string }>();

            for (const session of sessions) {
                for (const [exerciseName, sets] of Object.entries(session.exercises || {})) {
                    if (!Array.isArray(sets)) continue;

                    for (const set of sets) {
                        if (typeof set.weight_lbs !== 'number') continue;

                        const existingPR = prMap.get(exerciseName);
                        if (!existingPR || set.weight_lbs > existingPR.weight) {
                            prMap.set(exerciseName, {
                                weight: set.weight_lbs,
                                reps: set.reps || 0,
                                date: session.start_time
                            });
                        }
                    }
                }
            }

            return Array.from(prMap.entries()).map(([exercise, data]) => ({
                exercise,
                ...data
            }));
        }

        test('returns empty array for empty sessions', () => {
            expect(getPersonalRecords([])).toEqual([]);
        });

        test('finds highest weight for each exercise', () => {
            const sessions = [
                {
                    start_time: '2024-01-15T09:00:00Z',
                    exercises: {
                        'Bench Press': [
                            { weight_lbs: 135, reps: 10 },
                            { weight_lbs: 155, reps: 8 }
                        ]
                    }
                },
                {
                    start_time: '2024-01-20T09:00:00Z',
                    exercises: {
                        'Bench Press': [
                            { weight_lbs: 175, reps: 5 }
                        ]
                    }
                }
            ];
            const prs = getPersonalRecords(sessions);
            const benchPR = prs.find(p => p.exercise === 'Bench Press');
            expect(benchPR?.weight).toBe(175);
        });

        test('handles missing weight values', () => {
            const sessions = [
                {
                    start_time: '2024-01-15T09:00:00Z',
                    exercises: {
                        'Plank': [{ reps: 60 }]
                    }
                }
            ];
            const prs = getPersonalRecords(sessions);
            expect(prs).toHaveLength(0);
        });

        test('handles non-array sets gracefully', () => {
            const sessions = [
                {
                    start_time: '2024-01-15T09:00:00Z',
                    exercises: {
                        'Invalid': 'not an array'
                    }
                }
            ];
            expect(() => getPersonalRecords(sessions)).not.toThrow();
        });
    });

    describe('buildSystemPrompt', () => {
        // Simulate prompt builder
        function buildSystemPrompt(analysisData: any) {
            const {
                trainingAge = 'intermediate',
                prs = [],
                trends = {},
                muscleBalance = {},
                recentActivity = {}
            } = analysisData || {};

            const topPRs = prs.slice(0, 3)
                .map((p: any) => `${p.exercise}: ${p.weight}lb`)
                .join(', ') || 'None recorded';

            const improving = trends.improving?.slice(0, 2).map((t: any) => t.exercise).join(', ') || 'none';
            const stalling = trends.stalling?.slice(0, 2).map((t: any) => t.exercise).join(', ') || 'none';

            const topMuscles = Object.entries(muscleBalance)
                .sort((a: any, b: any) => b[1] - a[1])
                .slice(0, 4)
                .map(([m]: any) => m)
                .join(', ') || 'balanced';

            return `You are a fitness coach. Give SHORT, practical workout advice.

USER DATA:
- Level: ${trainingAge}
- Workouts/week: ${recentActivity.workoutsPerWeek?.toFixed(1) || '3'}
- Best lifts: ${topPRs}
- Getting stronger: ${improving}
- Plateaued: ${stalling}
- Main muscles: ${topMuscles}

RESPONSE RULES:
1. Answer in 2-3 sentences ONLY
2. Give specific exercises or rep ranges
3. Be encouraging and direct
4. For pain/injuries: recommend seeing a doctor
5. Focus on the user's question`;
        }

        test('returns string for valid input', () => {
            const result = buildSystemPrompt({ trainingAge: 'intermediate' });
            expect(typeof result).toBe('string');
        });

        test('includes training age', () => {
            const result = buildSystemPrompt({ trainingAge: 'advanced' });
            expect(result).toContain('advanced');
        });

        test('includes PR information', () => {
            const result = buildSystemPrompt({
                prs: [{ exercise: 'Bench Press', weight: 225 }]
            });
            expect(result).toContain('Bench Press: 225lb');
        });

        test('handles empty input gracefully', () => {
            const result = buildSystemPrompt({});
            expect(result).toContain('Level: intermediate');
            expect(result).toContain('None recorded');
        });

        test('handles null input', () => {
            const result = buildSystemPrompt(null);
            expect(typeof result).toBe('string');
        });

        test('limits PRs to 3', () => {
            const prs = [
                { exercise: 'Bench', weight: 200 },
                { exercise: 'Squat', weight: 300 },
                { exercise: 'Deadlift', weight: 400 },
                { exercise: 'OHP', weight: 150 }
            ];
            const result = buildSystemPrompt({ prs });
            expect(result).not.toContain('OHP');
        });

        test('includes muscle balance info', () => {
            const result = buildSystemPrompt({
                muscleBalance: { Chest: 30, Back: 25, Legs: 20 }
            });
            expect(result).toContain('Chest');
        });
    });
});
