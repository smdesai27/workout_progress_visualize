/**
 * AI Chat Fuzz Tests
 * Property-based testing for AI chat endpoint with random inputs
 */

import fc from 'fast-check';
import request from 'supertest';
import express from 'express';

// Create test app for fuzzing
const createAIChatFuzzApp = () => {
    const app = express();
    app.use(express.json({ limit: '10kb' }));

    app.post('/api/chat', (req, res) => {
        const { userMessage, systemPrompt } = req.body;

        // Validation
        if (!userMessage || typeof userMessage !== 'string') {
            res.status(400).json({ error: 'Missing or invalid userMessage' });
            return;
        }

        // Length check
        if (userMessage.length > 10000) {
            res.status(413).json({ error: 'Message too long' });
            return;
        }

        // Simulate rate limit (randomly)
        if (Math.random() < 0.1) {
            res.status(429).json({
                error: 'AI currently unavailable',
                response: 'AI currently unavailable'
            });
            return;
        }

        // Simulate other errors
        if (Math.random() < 0.05) {
            res.status(500).json({
                error: 'AI generation failed. Please try again.',
                response: 'AI generation failed. Please try again.'
            });
            return;
        }

        // Success
        res.json({
            response: 'Mock AI response',
            model: 'test-model'
        });
    });

    return app;
};

describe('AI Chat Fuzz Tests', () => {
    const app = createAIChatFuzzApp();

    describe('Input Validation Fuzzing', () => {
        test('handles random string inputs', () => {
            return fc.assert(
                fc.asyncProperty(
                    fc.string({ maxLength: 1000 }),
                    async (randomString) => {
                        const response = await request(app)
                            .post('/api/chat')
                            .send({ userMessage: randomString });
                        
                        expect([200, 400, 413, 429, 500]).toContain(response.status);
                        expect(response.body).toBeDefined();
                    }
                ),
                { numRuns: 50 }
            );
        });

        test('handles unicode and special characters', () => {
            return fc.assert(
                fc.asyncProperty(
                    fc.fullUnicodeString({ maxLength: 500 }),
                    async (unicodeString) => {
                        const response = await request(app)
                            .post('/api/chat')
                            .send({ userMessage: unicodeString });
                        
                        expect([200, 400, 413, 429, 500]).toContain(response.status);
                    }
                ),
                { numRuns: 30 }
            );
        });

        test('handles various system prompt formats', () => {
            return fc.assert(
                fc.asyncProperty(
                    fc.string({ maxLength: 500 }),
                    fc.string({ maxLength: 500 }),
                    async (userMsg, systemPrompt) => {
                        const response = await request(app)
                            .post('/api/chat')
                            .send({ 
                                userMessage: userMsg,
                                systemPrompt: systemPrompt 
                            });
                        
                        expect([200, 400, 413, 429, 500]).toContain(response.status);
                    }
                ),
                { numRuns: 30 }
            );
        });
    });

    describe('Edge Cases', () => {
        test('handles empty string', async () => {
            const response = await request(app)
                .post('/api/chat')
                .send({ userMessage: '' });
            
            // Empty string should be rejected or handled
            expect([200, 400]).toContain(response.status);
        });

        test('handles very long strings', () => {
            return fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 10000, maxLength: 20000 }),
                    async (longString) => {
                        const response = await request(app)
                            .post('/api/chat')
                            .send({ userMessage: longString });
                        
                        // Should reject or truncate
                        expect([400, 413]).toContain(response.status);
                    }
                ),
                { numRuns: 10 }
            );
        });

        test('handles newlines and control characters', () => {
            return fc.assert(
                fc.asyncProperty(
                    fc.string({ maxLength: 500 }).map(s => s + '\n\r\t\0'),
                    async (stringWithControls) => {
                        const response = await request(app)
                            .post('/api/chat')
                            .send({ userMessage: stringWithControls });
                        
                        expect([200, 400, 413, 429, 500]).toContain(response.status);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    describe('Type Fuzzing', () => {
        test('rejects non-string userMessage types', () => {
            return fc.assert(
                fc.asyncProperty(
                    fc.oneof(
                        fc.integer(),
                        fc.float(),
                        fc.boolean(),
                        fc.constant(null),
                        fc.constant(undefined),
                        fc.array(fc.string()),
                        fc.object()
                    ),
                    async (invalidValue) => {
                        const response = await request(app)
                            .post('/api/chat')
                            .send({ userMessage: invalidValue });
                        
                        expect(response.status).toBe(400);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    describe('Response Format Fuzzing', () => {
        test('all responses have expected structure', () => {
            return fc.assert(
                fc.asyncProperty(
                    fc.string({ maxLength: 100 }),
                    async (userMessage) => {
                        const response = await request(app)
                            .post('/api/chat')
                            .send({ userMessage });
                        
                        if (response.status === 200) {
                            expect(response.body).toHaveProperty('response');
                            expect(response.body).toHaveProperty('model');
                        } else if (response.status === 429) {
                            expect(response.body).toHaveProperty('error');
                            expect(response.body.error).toBe('AI currently unavailable');
                        } else if (response.status >= 400) {
                            expect(response.body).toHaveProperty('error');
                        }
                    }
                ),
                { numRuns: 30 }
            );
        });
    });
});
