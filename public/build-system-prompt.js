/**
 * Build System Prompt for AI Coach
 * Enhanced for Gemini API - provides rich context for detailed, personalized coaching
 */

/**
 * Build a comprehensive system prompt for the AI coach
 * @param {Object} analysisData - Object containing workout analysis
 * @returns {string} Formatted system prompt
 */
function buildSystemPrompt(analysisData) {
    const {
        trainingAge = 'intermediate',
        trainingMonths = 0,
        prs = [],
        trends = { improving: [], stalling: [], declining: [] },
        muscleBalance = {},
        recentActivity = {},
        volumeStats = {},
        frequencyData = {},
        exerciseHistory = []
    } = analysisData || {};

    // Format PRs with more detail (top 8) - use pre-calculated estimated 1RM
    const prDetails = prs.slice(0, 8)
        .map(p => `• ${p.exercise}: ${p.weight}lb × ${p.reps} reps (est. 1RM: ${p.estimated1RM || Math.round(p.weight * (1 + (p.reps || 1) / 30))}lb)`)
        .join('\n') || 'No PRs recorded yet';

    // Trend analysis with detail
    const improvingList = trends.improving?.slice(0, 5)
        .map(t => `• ${t.exercise}: +${t.percentChange?.toFixed(1) || '?'}% over ${t.weeks || '?'} weeks`)
        .join('\n') || 'None identified';

    const stallingList = trends.stalling?.slice(0, 5)
        .map(t => `• ${t.exercise}: stalled for ${t.weeks || '?'} weeks at ${t.currentMax || '?'}lb`)
        .join('\n') || 'None identified';

    const decliningList = trends.declining?.slice(0, 3)
        .map(t => `• ${t.exercise}: -${Math.abs(t.percentChange || 0).toFixed(1)}%`)
        .join('\n') || 'None identified';

    // Muscle balance analysis
    const muscleEntries = Object.entries(muscleBalance)
        .sort((a, b) => b[1] - a[1]);

    const dominantMuscles = muscleEntries.slice(0, 3)
        .map(([m, v]) => `${m} (${v.toFixed(1)}%)`)
        .join(', ') || 'balanced';

    const neglectedMuscles = muscleEntries.slice(-3)
        .filter(([, v]) => v < 10)
        .map(([m, v]) => `${m} (${v.toFixed(1)}%)`)
        .join(', ') || 'none significantly neglected';

    // Volume statistics
    const avgVolumePerSession = volumeStats.avgVolumePerSession?.toFixed(0) || 'unknown';
    const avgSetsPerSession = volumeStats.avgSetsPerSession?.toFixed(1) || 'unknown';

    // Training frequency
    const workoutsPerWeek = recentActivity.workoutsPerWeek?.toFixed(1) || '3';
    const consistencyScore = frequencyData.consistencyPercent?.toFixed(0) || 'unknown';

    // Recent exercise focus
    const recentExercises = exerciseHistory.slice(0, 10)
        .map(e => e.exercise)
        .join(', ') || 'varied';

    // Build comprehensive prompt
    return `You are an expert strength and conditioning coach with deep knowledge of exercise science, periodization, and data analysis. You have access to this user's complete workout history and analytics.

═══════════════════════════════════════════════════════════════
                        ATHLETE PROFILE
═══════════════════════════════════════════════════════════════

TRAINING EXPERIENCE:
• Level: ${trainingAge.toUpperCase()} (${trainingMonths || recentActivity.months || 0} months of tracked training)
• Current frequency: ${workoutsPerWeek} workouts/week
• Consistency: ${consistencyScore}%
• Avg volume/session: ${avgVolumePerSession} lbs total
• Avg sets/session: ${avgSetsPerSession}

═══════════════════════════════════════════════════════════════
                      PERSONAL RECORDS
═══════════════════════════════════════════════════════════════
${prDetails}

═══════════════════════════════════════════════════════════════
                      PROGRESS ANALYSIS
═══════════════════════════════════════════════════════════════

📈 IMPROVING (making gains):
${improvingList}

⏸️ PLATEAUED (stalled progress):
${stallingList}

📉 DECLINING (needs attention):
${decliningList}

═══════════════════════════════════════════════════════════════
                     MUSCLE BALANCE
═══════════════════════════════════════════════════════════════
• Most trained: ${dominantMuscles}
• Undertrained: ${neglectedMuscles}

Recent exercise focus: ${recentExercises}

═══════════════════════════════════════════════════════════════
                    COACHING GUIDELINES
═══════════════════════════════════════════════════════════════

When responding to this athlete:

1. PROGRAMMING ADVICE:
   - Reference their specific data when recommending changes
   - Suggest evidence-based periodization strategies
   - Consider their training level when prescribing volume/intensity
   - For plateaus, recommend deload weeks, variation, or intensity techniques

2. DATA ANALYSIS:
   - Interpret trends and patterns in their training
   - Identify potential overtraining or undertraining signals
   - Calculate and explain relevant metrics (volume, frequency, intensity)
   - Compare their progress to typical rates for their level

3. EXERCISE RECOMMENDATIONS:
   - Consider their current muscle balance
   - Suggest exercises that target undertrained areas
   - Provide specific sets, reps, and weight progressions
   - Include alternatives for variety

4. COMMUNICATION STYLE:
   - Be encouraging but honest about areas needing improvement
   - Explain the "why" behind recommendations
   - Be specific with numbers when possible
   - Keep responses focused and actionable

5. SAFETY FIRST:
   - For injury/pain questions: recommend professional medical evaluation
   - Never push through pain-related issues
   - Emphasize proper form and gradual progression

Respond to the athlete's question with personalized, data-driven advice.`;
}

/**
 * Compute comprehensive analysis data for system prompt
 * @param {Array} sessions - Workout sessions
 * @param {Object} muscleMapping - Exercise to muscle group mapping
 * @returns {Object} Analysis data for system prompt
 */
function computeAnalysisForPrompt(sessions, muscleMapping) {
    if (!sessions || sessions.length === 0) {
        return {
            trainingAge: 'beginner',
            trainingMonths: 0,
            prs: [],
            trends: { improving: [], stalling: [], declining: [] },
            muscleBalance: {},
            recentActivity: { workoutsPerWeek: 0, months: 0 },
            volumeStats: {},
            frequencyData: {},
            exerciseHistory: []
        };
    }

    // Get training age
    const trainingAgeInfo = window.DanfoAnalytics?.inferTrainingAge(sessions) || {
        classification: 'intermediate',
        months: 0,
        workoutsPerWeek: 3
    };

    // Get PRs with reps included
    const prs = window.DanfoAnalytics?.getPersonalRecords(sessions) || [];

    // Get trends with more detail
    const trends = window.DanfoAnalytics?.analyzeTrainingTrends(sessions) || {
        improving: [],
        stalling: [],
        declining: []
    };

    // Calculate volume statistics
    let totalVolume = 0;
    let totalSets = 0;
    let sessionCount = 0;

    for (const session of sessions) {
        sessionCount++;
        for (const sets of Object.values(session.exercises || {})) {
            const setsArray = Array.isArray(sets) ? sets : [];
            for (const set of setsArray) {
                if (set && typeof set.weight_lbs === 'number' && typeof set.reps === 'number') {
                    totalVolume += set.weight_lbs * set.reps;
                    totalSets++;
                }
            }
        }
    }

    const volumeStats = {
        totalVolume,
        totalSets,
        avgVolumePerSession: sessionCount > 0 ? totalVolume / sessionCount : 0,
        avgSetsPerSession: sessionCount > 0 ? totalSets / sessionCount : 0
    };

    // Calculate training frequency/consistency
    const sortedSessions = [...sessions].sort((a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    let frequencyData = { consistencyPercent: 0 };
    if (sortedSessions.length >= 2) {
        const firstDate = new Date(sortedSessions[0].start_time);
        const lastDate = new Date(sortedSessions[sortedSessions.length - 1].start_time);
        const weeksSpan = (lastDate.getTime() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
        const expectedWorkouts = weeksSpan * 3; // assume 3x/week as baseline
        frequencyData.consistencyPercent = expectedWorkouts > 0
            ? Math.min(100, (sessions.length / expectedWorkouts) * 100)
            : 100;
    }

    // Get recent exercise history
    const recentSessions = sessions.slice(0, 5);
    const exerciseHistory = [];
    const seenExercises = new Set();

    for (const session of recentSessions) {
        for (const exercise of Object.keys(session.exercises || {})) {
            if (!seenExercises.has(exercise)) {
                seenExercises.add(exercise);
                exerciseHistory.push({ exercise, date: session.start_time });
            }
        }
    }

    // Calculate muscle balance if mapping available
    let muscleBalance = {};
    if (muscleMapping && muscleMapping.exercises) {
        const radarGroups = muscleMapping.radarGroups || [];
        const volumes = {};
        radarGroups.forEach(m => volumes[m] = 0);

        for (const session of sessions) {
            for (const [exerciseName, sets] of Object.entries(session.exercises || {})) {
                const mapping = muscleMapping.exercises[exerciseName];
                if (!mapping) continue;

                let exerciseVolume = 0;
                const setsArray = Array.isArray(sets) ? sets : [];
                for (const set of setsArray) {
                    if (set && typeof set.weight_lbs === 'number' && typeof set.reps === 'number') {
                        exerciseVolume += set.weight_lbs * set.reps;
                    }
                }

                (mapping.primary || []).forEach(muscle => {
                    const targetMuscle = muscleMapping.muscleAliases?.[muscle] || muscle;
                    if (volumes[targetMuscle] !== undefined) {
                        volumes[targetMuscle] += exerciseVolume;
                    }
                });

                (mapping.secondary || []).forEach(muscle => {
                    const targetMuscle = muscleMapping.muscleAliases?.[muscle] || muscle;
                    if (volumes[targetMuscle] !== undefined) {
                        volumes[targetMuscle] += exerciseVolume * 0.4;
                    }
                });
            }
        }

        // Normalize to percentages
        const total = Object.values(volumes).reduce((a, b) => a + b, 0) || 1;
        for (const muscle of Object.keys(volumes)) {
            muscleBalance[muscle] = (volumes[muscle] / total) * 100;
        }
    }

    return {
        trainingAge: trainingAgeInfo.classification,
        trainingMonths: trainingAgeInfo.months,
        prs,
        trends,
        muscleBalance,
        recentActivity: {
            workoutsPerWeek: trainingAgeInfo.workoutsPerWeek,
            months: trainingAgeInfo.months
        },
        volumeStats,
        frequencyData,
        exerciseHistory
    };
}

// Export for use in app.jsx
window.AICoachUtils = {
    buildSystemPrompt,
    computeAnalysisForPrompt
};
