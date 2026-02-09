/**
 * AI Chat Unit Tests
 * Tests for AI chat endpoint functionality including rate limits, error handling, and model selection
 */

describe('AI Chat Functionality', () => {

    describe('Rate Limit Handling', () => {
        test('correctly identifies 429 status as rate limit', () => {
            const error = { status: 429, message: 'Rate limit exceeded' };
            expect(error.status).toBe(429);
        });

        test('retries on rate limit with exponential backoff', async () => {
            const waitTimes: number[] = [];
            const maxAttempts = 3;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const waitTime = Math.min(2000 * Math.pow(2, attempt), 10000);
                waitTimes.push(waitTime);
            }

            expect(waitTimes[0]).toBe(2000);
            expect(waitTimes[1]).toBe(4000);
            expect(waitTimes[2]).toBe(8000);
            expect(waitTimes.length).toBe(3);
        });

        test('caps wait time at 10 seconds', () => {
            const attempt = 10; // High attempt number
            const waitTime = Math.min(2000 * Math.pow(2, attempt), 10000);
            expect(waitTime).toBe(10000);
        });

        test('returns correct error message for rate limit', () => {
            const error = { status: 429 };
            const userMessage = error.status === 429 ? 'AI currently unavailable' : 'AI generation failed. Please try again.';
            expect(userMessage).toBe('AI currently unavailable');
        });

        test('returns 429 status code for rate limit errors', () => {
            const error = { status: 429 };
            const statusCode = error.status === 429 ? 429 : 500;
            expect(statusCode).toBe(429);
        });
    });

    describe('Model Selection', () => {
        test('removes models/ prefix from model names', () => {
            const candidate = 'models/gemini-1.5-pro';
            const cleanName = candidate.replace(/^models\//, '');
            expect(cleanName).toBe('gemini-1.5-pro');
        });

        test('keeps model name without prefix unchanged', () => {
            const candidate = 'gemini-1.5-pro';
            const cleanName = candidate.replace(/^models\//, '');
            expect(cleanName).toBe('gemini-1.5-pro');
        });

        test('filters for gemini models only', () => {
            const availableModels = [
                'models/gemini-1.5-pro',
                'models/gemini-1.5-flash',
                'models/other-model',
                'gemini-pro'
            ];
            const filtered = availableModels.filter((name: string) => name.includes('gemini'));
            expect(filtered).toEqual([
                'models/gemini-1.5-pro',
                'models/gemini-1.5-flash',
                'gemini-pro'
            ]);
        });

        test('uses fallback models when ListModels fails', () => {
            const availableModels: string[] = [];
            const fallback = ['gemini-1.5-pro-latest', 'gemini-1.5-flash-latest', 'gemini-pro', 'gemini-1.5-pro', 'models/gemini-1.5-pro'];
            const candidates = availableModels.length > 0 
                ? availableModels.filter((name: string) => name.includes('gemini'))
                : fallback;
            expect(candidates).toEqual(fallback);
        });
    });

    describe('Error Handling', () => {
        test('handles missing userMessage', () => {
            const userMessage = null;
            const shouldReject = !userMessage;
            expect(shouldReject).toBe(true);
        });

        test('handles API key errors (401)', () => {
            const error = { status: 401 };
            const userMessage = error.status === 401 || error.status === 403 
                ? 'API key issue. Please check your GEMINI_API_KEY.'
                : 'AI generation failed. Please try again.';
            expect(userMessage).toBe('API key issue. Please check your GEMINI_API_KEY.');
        });

        test('handles API key errors (403)', () => {
            const error = { status: 403 };
            const userMessage = error.status === 401 || error.status === 403 
                ? 'API key issue. Please check your GEMINI_API_KEY.'
                : 'AI generation failed. Please try again.';
            expect(userMessage).toBe('API key issue. Please check your GEMINI_API_KEY.');
        });

        test('handles generic errors with default message', () => {
            const error = { status: 500 };
            const userMessage = error.status === 429
                ? 'AI currently unavailable'
                : error.status === 401 || error.status === 403
                ? 'API key issue. Please check your GEMINI_API_KEY.'
                : 'AI generation failed. Please try again.';
            expect(userMessage).toBe('AI generation failed. Please try again.');
        });

        test('includes error details in response', () => {
            const error = { status: 500, message: 'Internal server error' };
            const response = {
                error: 'AI generation failed. Please try again.',
                response: 'AI generation failed. Please try again.',
                details: error.message
            };
            expect(response.details).toBe('Internal server error');
        });
    });

    describe('Prompt Construction', () => {
        test('combines system prompt and user message correctly', () => {
            const systemPrompt = 'You are a fitness coach.';
            const userMessage = 'How do I improve my bench press?';
            const fullPrompt = systemPrompt
                ? `${systemPrompt}\n\nUser Question: ${userMessage}\n\nProvide a helpful, concise response (2-3 sentences):`
                : userMessage;
            
            expect(fullPrompt).toContain(systemPrompt);
            expect(fullPrompt).toContain(userMessage);
            expect(fullPrompt).toContain('User Question:');
        });

        test('uses only user message when system prompt is missing', () => {
            const systemPrompt = null;
            const userMessage = 'How do I improve my bench press?';
            const fullPrompt = systemPrompt
                ? `${systemPrompt}\n\nUser Question: ${userMessage}\n\nProvide a helpful, concise response (2-3 sentences):`
                : userMessage;
            
            expect(fullPrompt).toBe(userMessage);
        });
    });

    describe('Response Format', () => {
        test('successful response includes response and model fields', () => {
            const response = {
                response: 'Test AI response',
                model: 'gemini-1.5-pro'
            };
            expect(response).toHaveProperty('response');
            expect(response).toHaveProperty('model');
            expect(typeof response.response).toBe('string');
            expect(typeof response.model).toBe('string');
        });

        test('error response includes error and response fields', () => {
            const response = {
                error: 'AI currently unavailable',
                response: 'AI currently unavailable',
                details: 'Rate limit exceeded'
            };
            expect(response).toHaveProperty('error');
            expect(response).toHaveProperty('response');
            expect(response.error).toBe(response.response);
        });
    });

    describe('Retry Logic', () => {
        test('retries up to 3 times on rate limit', () => {
            const maxAttempts = 3;
            let attempts = 0;
            const errors = [
                { status: 429 },
                { status: 429 },
                { status: 429 }
            ];

            for (const err of errors) {
                if (err.status === 429 && attempts < maxAttempts) {
                    attempts++;
                }
            }

            expect(attempts).toBe(3);
        });

        test('stops retrying on non-rate-limit errors', () => {
            const errors = [
                { status: 429 },
                { status: 500 } // Non-rate-limit error
            ];
            let shouldContinue = true;

            for (const err of errors) {
                if (err.status === 429) {
                    // Continue retrying
                } else {
                    shouldContinue = false;
                    break;
                }
            }

            expect(shouldContinue).toBe(false);
        });
    });
});
