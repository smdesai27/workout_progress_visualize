/**
 * Workout Visualizer Browser Test Suite
 * Updated for Gemini API integration
 * Run in browser console: TestSuite.runAll()
 */

const TestSuite = {
    passed: 0,
    failed: 0,
    results: [],

    assert(condition, testName, message = '') {
        if (condition) {
            this.passed++;
            this.results.push({ status: 'PASS', name: testName, message });
            console.log(`✅ PASS: ${testName}`);
        } else {
            this.failed++;
            this.results.push({ status: 'FAIL', name: testName, message });
            console.error(`❌ FAIL: ${testName}${message ? ' - ' + message : ''}`);
        }
    },

    async runAll() {
        console.log('🧪 Starting Workout Visualizer Test Suite...\n');
        this.passed = 0;
        this.failed = 0;
        this.results = [];

        this.testDependencies();
        this.testDanfoAnalytics();
        this.testAICoachUtils();
        await this.testMuscleMapping();
        await this.testAPIEndpoints();
        await this.testGeminiIntegration();

        console.log(`\n${'='.repeat(50)}`);
        console.log(`Test Results: ${this.passed} passed, ${this.failed} failed`);
        console.log(`${'='.repeat(50)}`);

        return { passed: this.passed, failed: this.failed, results: this.results };
    },

    testDependencies() {
        console.log('\n📦 Testing Dependencies...');
        this.assert(typeof React !== 'undefined', 'React loaded');
        this.assert(typeof ReactDOM !== 'undefined', 'ReactDOM loaded');
        this.assert(typeof Chart !== 'undefined', 'Chart.js loaded');
        this.assert(typeof Papa !== 'undefined', 'PapaParse loaded');
        this.assert(typeof dfd !== 'undefined', 'Danfo.js loaded');
    },

    testDanfoAnalytics() {
        console.log('\n📊 Testing Danfo Analytics...');

        const DA = window.DanfoAnalytics;
        this.assert(DA !== undefined, 'DanfoAnalytics exposed globally');
        if (!DA) return;

        this.assert(typeof DA.parseWorkoutDate === 'function', 'parseWorkoutDate exists');
        this.assert(typeof DA.inferTrainingAge === 'function', 'inferTrainingAge exists');
        this.assert(typeof DA.computeLogRegression === 'function', 'computeLogRegression exists');
        this.assert(typeof DA.predictFuture1RM === 'function', 'predictFuture1RM exists');
        this.assert(typeof DA.getPersonalRecords === 'function', 'getPersonalRecords exists');
        this.assert(typeof DA.analyzeTrainingTrends === 'function', 'analyzeTrainingTrends exists');

        // Test parseWorkoutDate
        const date = DA.parseWorkoutDate('2024-01-15');
        this.assert(date instanceof Date, 'parseWorkoutDate returns Date');

        // Test inferTrainingAge
        const mockSessions = [
            { start_time: '2024-01-01T10:00:00Z', exercises: {} },
            { start_time: '2024-01-08T10:00:00Z', exercises: {} }
        ];
        const ageInfo = DA.inferTrainingAge(mockSessions);
        this.assert(typeof ageInfo.classification === 'string', 'inferTrainingAge returns classification');
        this.assert(['novice', 'intermediate', 'advanced'].includes(ageInfo.classification), 'Valid classification');

        // Test computeLogRegression
        const mockData = [
            { week: 1, oneRM: 100 },
            { week: 4, oneRM: 105 },
            { week: 8, oneRM: 108 }
        ];
        const model = DA.computeLogRegression(mockData);
        this.assert(model !== null, 'computeLogRegression returns model');
        this.assert(typeof model?.rSquared === 'number', 'Model has R-squared');
    },

    testAICoachUtils() {
        console.log('\n🤖 Testing AI Coach Utilities...');

        const AIUtils = window.AICoachUtils;
        this.assert(AIUtils !== undefined, 'AICoachUtils exposed globally');
        if (!AIUtils) return;

        this.assert(typeof AIUtils.buildSystemPrompt === 'function', 'buildSystemPrompt exists');
        this.assert(typeof AIUtils.computeAnalysisForPrompt === 'function', 'computeAnalysisForPrompt exists');

        // Test buildSystemPrompt
        const prompt = AIUtils.buildSystemPrompt({
            trainingAge: 'intermediate',
            prs: [{ exercise: 'Bench Press', weight: 225, reps: 5 }],
            trends: { improving: [], stalling: [], declining: [] },
            muscleBalance: { Chest: 25, Back: 20 },
            recentActivity: { workoutsPerWeek: 4, months: 9 }
        });
        this.assert(typeof prompt === 'string', 'buildSystemPrompt returns string');
        this.assert(prompt.includes('intermediate'), 'Prompt includes training age');
        this.assert(prompt.length > 100, 'Prompt has substantial content');

        // Test computeAnalysisForPrompt
        const analysis = AIUtils.computeAnalysisForPrompt([], null);
        this.assert(typeof analysis === 'object', 'computeAnalysisForPrompt returns object');
    },

    async testMuscleMapping() {
        console.log('\n💪 Testing Muscle Mapping...');

        try {
            const response = await fetch('/muscle-mapping.json');
            this.assert(response.ok, 'muscle-mapping.json loads');

            const mapping = await response.json();
            this.assert(typeof mapping.exercises === 'object', 'Mapping has exercises');
            this.assert(Array.isArray(mapping.radarGroups), 'Mapping has radarGroups');

            const benchPress = mapping.exercises['Bench Press (Barbell)'];
            this.assert(benchPress !== undefined, 'Bench Press exists');
            if (benchPress) {
                this.assert(benchPress.primary.includes('Chest'), 'Bench Press targets chest');
            }
        } catch (error) {
            this.assert(false, 'Muscle mapping load', error.message);
        }
    },

    async testAPIEndpoints() {
        console.log('\n🌐 Testing API Endpoints...');

        try {
            // Health check
            const health = await fetch('/api/health');
            this.assert(health.ok, '/api/health responds');
            const healthData = await health.json();
            this.assert(healthData.ok === true, '/api/health returns ok');

            // Sessions list
            const sessions = await fetch('/api/sessions');
            this.assert(sessions.ok, '/api/sessions responds');
            const sessionsData = await sessions.json();
            this.assert(Array.isArray(sessionsData), '/api/sessions returns array');

            // Exercises list
            const exercises = await fetch('/api/exercises');
            this.assert(exercises.ok, '/api/exercises responds');
            const exercisesData = await exercises.json();
            this.assert(Array.isArray(exercisesData), '/api/exercises returns array');

            // Exercise progression
            if (exercisesData.length > 0) {
                const firstExercise = encodeURIComponent(exercisesData[0]);
                const progression = await fetch(`/api/exercise/${firstExercise}/progression`);
                this.assert(progression.ok, '/api/exercise/:name/progression responds');
            }
        } catch (error) {
            this.assert(false, 'API endpoints', error.message);
        }
    },

    async testGeminiIntegration() {
        console.log('\n🤖 Testing Gemini AI Integration...');

        try {
            // Test chat endpoint
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userMessage: 'Hello',
                    systemPrompt: 'You are a fitness coach.'
                })
            });
            this.assert(response.ok || response.status === 500, '/api/chat endpoint exists');

            const data = await response.json();
            this.assert(data.response !== undefined || data.error !== undefined, '/api/chat returns response or error');

            // Validate response structure
            if (data.response) {
                this.assert(typeof data.response === 'string', 'Response is string');
                this.assert(data.model !== undefined, 'Response includes model info');
            }

            // Test missing userMessage
            const badResponse = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            this.assert(badResponse.status === 400, '/api/chat rejects missing userMessage');

        } catch (error) {
            this.assert(false, 'Gemini integration', error.message);
        }
    }
};

window.TestSuite = TestSuite;
console.log('🧪 Test Suite loaded! Run TestSuite.runAll() to execute tests.');
