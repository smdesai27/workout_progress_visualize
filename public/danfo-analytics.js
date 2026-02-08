/**
 * Danfo.js Analytics Module
 * Handles data analysis, training age inference, and progression prediction
 */

// Training age classification thresholds (in months)
const TRAINING_AGE_THRESHOLDS = {
    NOVICE: 6,      // < 6 months
    INTERMEDIATE: 24 // 6-24 months, > 24 = advanced
};

// Decay constants for progression prediction (higher = faster gains)
const DECAY_CONSTANTS = {
    novice: 0.8,
    intermediate: 0.5,
    advanced: 0.3
};

/**
 * Convert workout rows to a Danfo DataFrame
 * @param {Array} rows - Array of workout row objects from CSV
 * @returns {dfd.DataFrame} Danfo DataFrame
 */
function parseCSVToDanfoFrame(rows) {
    if (!rows || rows.length === 0) return null;

    // Clean and transform the data
    const cleanedRows = rows.map(row => ({
        title: row.title || '',
        start_time: row.start_time || '',
        exercise_title: row.exercise_title || '',
        weight_lbs: parseFloat(row.weight_lbs) || 0,
        reps: parseInt(row.reps) || 0,
        set_index: parseInt(row.set_index) || 0
    }));

    return new dfd.DataFrame(cleanedRows);
}

/**
 * Parse date string in format "DD Mon YYYY, HH:MM" to Date object
 * @param {string} dateStr - Date string from CSV
 * @returns {Date|null} Parsed date or null
 */
function parseWorkoutDate(dateStr) {
    if (!dateStr) return null;

    // Handle format: "25 Oct 2025, 19:56"
    const months = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };

    const match = dateStr.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
    if (!match) return null;

    const [, day, monthStr, year] = match;
    const month = months[monthStr];
    if (month === undefined) return null;

    return new Date(parseInt(year), month, parseInt(day));
}

/**
 * Infer training age from workout data
 * @param {Array} sessions - Array of session objects
 * @returns {Object} Training age classification and metadata
 */
function inferTrainingAge(sessions) {
    if (!sessions || sessions.length === 0) {
        return {
            classification: 'novice',
            months: 0,
            confidence: 'low',
            workoutsPerWeek: 0,
            firstWorkout: null,
            lastWorkout: null
        };
    }

    // Extract all dates
    const dates = sessions
        .map(s => parseWorkoutDate(s.start_time))
        .filter(d => d !== null)
        .sort((a, b) => a - b);

    if (dates.length === 0) {
        return {
            classification: 'novice',
            months: 0,
            confidence: 'low',
            workoutsPerWeek: 0
        };
    }

    const firstWorkout = dates[0];
    const lastWorkout = dates[dates.length - 1];

    // Calculate training span in months
    const msPerMonth = 30.44 * 24 * 60 * 60 * 1000;
    const months = (lastWorkout - firstWorkout) / msPerMonth;

    // Calculate workout frequency
    const weeks = Math.max(1, (lastWorkout - firstWorkout) / (7 * 24 * 60 * 60 * 1000));
    const workoutsPerWeek = dates.length / weeks;

    // Classify based on data span (not actual training age, but data available)
    let classification;
    let confidence;

    if (months < TRAINING_AGE_THRESHOLDS.NOVICE) {
        classification = 'novice';
        confidence = months < 3 ? 'low' : 'medium';
    } else if (months < TRAINING_AGE_THRESHOLDS.INTERMEDIATE) {
        classification = 'intermediate';
        confidence = 'medium';
    } else {
        classification = 'advanced';
        confidence = 'high';
    }

    // Adjust based on workout consistency
    if (workoutsPerWeek < 2 && classification !== 'novice') {
        // Low frequency might indicate gaps in data
        confidence = 'low';
    }

    return {
        classification,
        months: Math.round(months * 10) / 10,
        confidence,
        workoutsPerWeek: Math.round(workoutsPerWeek * 10) / 10,
        firstWorkout,
        lastWorkout,
        totalSessions: dates.length
    };
}

/**
 * Compute logarithmic regression: y = a * ln(x) + b
 * Uses least squares on transformed data
 * @param {Array} data - Array of {week, value} objects
 * @returns {Object} Regression coefficients and stats
 */
function computeLogRegression(data) {
    if (!data || data.length < 2) {
        return null;
    }

    // Filter out invalid data points
    const validData = data.filter(d =>
        d.week > 0 &&
        d.value !== null &&
        d.value !== undefined &&
        !isNaN(d.value)
    );

    if (validData.length < 2) return null;

    const n = validData.length;

    // Transform x values: use ln(week)
    const lnX = validData.map(d => Math.log(d.week));
    const y = validData.map(d => d.value);

    // Calculate means
    const meanLnX = lnX.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    // Calculate regression coefficients
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
        numerator += (lnX[i] - meanLnX) * (y[i] - meanY);
        denominator += (lnX[i] - meanLnX) ** 2;
    }

    const a = denominator !== 0 ? numerator / denominator : 0; // slope
    const b = meanY - a * meanLnX; // intercept

    // Calculate R-squared
    let ssRes = 0;
    let ssTot = 0;

    for (let i = 0; i < n; i++) {
        const predicted = a * lnX[i] + b;
        ssRes += (y[i] - predicted) ** 2;
        ssTot += (y[i] - meanY) ** 2;
    }

    const rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;

    // Calculate standard error for prediction intervals
    const standardError = Math.sqrt(ssRes / Math.max(1, n - 2));

    return {
        a,
        b,
        rSquared,
        standardError,
        dataPoints: n
    };
}

/**
 * Predict future 1RM values using an improved model
 * 
 * Key improvements over pure logarithmic regression:
 * 1. Never predicts decreases (strength doesn't go backwards with consistent training)
 * 2. Uses asymptotic approach toward a ceiling based on training level
 * 3. Considers recent momentum (are they progressing faster/slower than expected?)
 * 4. Provides realistic confidence intervals
 * 
 * Based on research showing diminishing returns pattern:
 * - Novice: ~1-2.5% per week gains possible
 * - Intermediate: ~0.5-1% per week gains
 * - Advanced: ~0.1-0.5% per week gains
 * 
 * @param {Object} model - Regression model or recent data stats
 * @param {number} currentWeek - Current week number
 * @param {number} weeksAhead - How many weeks to predict
 * @param {string} trainingAge - 'novice', 'intermediate', or 'advanced'
 * @param {number} current1RM - Current estimated 1RM (most recent)
 * @returns {Array} Array of {week, predicted, lower, upper} objects
 */
function predictFuture1RM(model, currentWeek, weeksAhead, trainingAge = 'intermediate', current1RM = null) {
    if (!model && !current1RM) return [];

    // Weekly gain expectations by training level (percentage)
    const WEEKLY_GAIN_RATES = {
        novice: { base: 0.015, max: 0.025, variance: 0.008 },      // 1.5-2.5% per week
        intermediate: { base: 0.006, max: 0.012, variance: 0.004 }, // 0.6-1.2% per week
        advanced: { base: 0.002, max: 0.005, variance: 0.002 }      // 0.2-0.5% per week
    };

    // Theoretical ceiling multipliers (how much above current 1RM is theoretically achievable)
    const CEILING_MULTIPLIERS = {
        novice: 2.0,       // Novice can potentially double their lifts
        intermediate: 1.4, // Intermediate has 40% more potential
        advanced: 1.15     // Advanced has only 15% more potential
    };

    const rates = WEEKLY_GAIN_RATES[trainingAge] || WEEKLY_GAIN_RATES.intermediate;
    const ceilingMultiplier = CEILING_MULTIPLIERS[trainingAge] || CEILING_MULTIPLIERS.intermediate;

    // Determine starting point
    let startingValue = current1RM;
    if (!startingValue && model) {
        // Use the regression model's current prediction
        startingValue = model.a * Math.log(currentWeek) + model.b;
    }
    if (!startingValue || startingValue <= 0) return [];

    // Calculate the theoretical ceiling
    const ceiling = startingValue * ceilingMultiplier;

    // Determine momentum from regression if available
    let momentum = 1.0; // Neutral momentum
    if (model && model.a !== undefined) {
        // If slope is positive and R² is decent, they're progressing well
        if (model.a > 0 && model.rSquared > 0.5) {
            momentum = 1.2; // Boost predictions slightly
        } else if (model.a > 0) {
            momentum = 1.0; // Normal
        } else if (model.rSquared < 0.3) {
            // Inconsistent data, be conservative
            momentum = 0.8;
        } else {
            // Negative slope but decent R² - they might be in a deload or having issues
            // Still predict maintenance or slight increase
            momentum = 0.5;
        }
    }

    const predictions = [];
    let currentPrediction = startingValue;

    for (let i = 1; i <= weeksAhead; i++) {
        const futureWeek = currentWeek + i;

        // Calculate how close to ceiling we are (0 = at start, 1 = at ceiling)
        const progressToCeiling = Math.max(0, Math.min(1,
            (currentPrediction - startingValue) / (ceiling - startingValue)
        ));

        // Gain rate decreases as we approach ceiling (asymptotic)
        const diminishingFactor = 1 - Math.pow(progressToCeiling, 0.5);

        // Calculate weekly gain with all factors
        const weeklyGainRate = rates.base * momentum * diminishingFactor;

        // Apply gain (always positive or zero, never negative)
        const gain = currentPrediction * Math.max(0, weeklyGainRate);
        currentPrediction += gain;

        // Ensure we don't exceed ceiling
        currentPrediction = Math.min(currentPrediction, ceiling);

        // Calculate confidence interval
        // Wider interval as we go further into the future
        const baseVariance = rates.variance * currentPrediction * i;
        const lowerBound = currentPrediction - baseVariance;
        const upperBound = currentPrediction + (baseVariance * 1.5); // Upside has more potential

        predictions.push({
            week: futureWeek,
            predicted: Math.round(currentPrediction * 10) / 10,
            lower: Math.round(Math.max(startingValue, lowerBound) * 10) / 10, // Never below starting
            upper: Math.round(Math.min(ceiling, upperBound) * 10) / 10
        });
    }

    return predictions;
}

/**
 * Prepare exercise data for regression analysis
 * @param {Array} timeline - Exercise progression timeline
 * @returns {Array} Array of {week, value} for regression
 */
function prepareRegressionData(timeline) {
    if (!timeline || timeline.length === 0) return [];

    // Sort by date
    const sorted = [...timeline].sort((a, b) =>
        new Date(a.date) - new Date(b.date)
    );

    const firstDate = parseWorkoutDate(sorted[0].date);
    if (!firstDate) return [];

    return sorted.map(point => {
        const date = parseWorkoutDate(point.date);
        if (!date) return null;

        // Calculate week number from first workout
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const week = Math.max(1, Math.floor((date - firstDate) / msPerWeek) + 1);

        // Use Epley 1RM as the value
        const value = point.epley || point.maxWeight;

        return { week, value, date: point.date };
    }).filter(d => d !== null && d.value !== null);
}

/**
 * Analyze overall training trends
 * @param {Array} sessions - All workout sessions
 * @returns {Object} Trend analysis results
 */
function analyzeTrainingTrends(sessions) {
    if (!sessions || sessions.length === 0) {
        return { improving: [], stalling: [], declining: [] };
    }

    const exerciseData = new Map();

    // Group data by exercise
    for (const session of sessions) {
        for (const [exercise, sets] of Object.entries(session.exercises || {})) {
            if (!exerciseData.has(exercise)) {
                exerciseData.set(exercise, []);
            }

            // Ensure sets is an array
            const setsArray = Array.isArray(sets) ? sets : [];

            const validWeights = setsArray
                .filter(s => s && typeof s.weight_lbs === 'number')
                .map(s => s.weight_lbs);

            const maxWeight = validWeights.length > 0 ? Math.max(...validWeights) : 0;

            if (maxWeight > 0) {
                exerciseData.get(exercise).push({
                    date: session.start_time,
                    weight: maxWeight
                });
            }
        }
    }

    const improving = [];
    const stalling = [];
    const declining = [];

    // Analyze each exercise
    for (const [exercise, data] of exerciseData) {
        if (data.length < 4) continue; // Need enough data points

        // Sort by date
        data.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Compare recent (last 4 sessions) to previous (4 before that)
        const recent = data.slice(-4);
        const previous = data.slice(-8, -4);

        if (previous.length === 0) continue;

        const recentAvg = recent.reduce((a, b) => a + b.weight, 0) / recent.length;
        const previousAvg = previous.reduce((a, b) => a + b.weight, 0) / previous.length;

        const changePercent = ((recentAvg - previousAvg) / previousAvg) * 100;

        if (changePercent > 2) {
            improving.push({ exercise, change: Math.round(changePercent * 10) / 10 });
        } else if (changePercent < -2) {
            declining.push({ exercise, change: Math.round(changePercent * 10) / 10 });
        } else {
            // Check how long it's been stalling
            const lastChange = data.slice(-8).every(d =>
                Math.abs(d.weight - recentAvg) < recentAvg * 0.03
            );
            if (lastChange) {
                stalling.push({ exercise, weeks: 4 });
            }
        }
    }

    return {
        improving: improving.sort((a, b) => b.change - a.change).slice(0, 5),
        stalling: stalling.slice(0, 5),
        declining: declining.sort((a, b) => a.change - b.change).slice(0, 5)
    };
}

/**
 * Get personal records for major lifts
 * Tracks the SET with highest estimated 1RM (not just heaviest weight)
 * @param {Array} sessions - All workout sessions
 * @returns {Array} Array of PR objects with estimated 1RM
 */
function getPersonalRecords(sessions) {
    if (!sessions || sessions.length === 0) return [];

    // Epley formula: 1RM = weight × (1 + reps/30)
    const calculate1RM = (weight, reps) => {
        if (reps <= 0) return weight;
        if (reps === 1) return weight; // 1 rep = true 1RM
        return weight * (1 + reps / 30);
    };

    const prs = new Map();

    for (const session of sessions) {
        for (const [exercise, sets] of Object.entries(session.exercises || {})) {
            const setsArray = Array.isArray(sets) ? sets : [];

            for (const set of setsArray) {
                if (!set || typeof set.weight_lbs !== 'number' || set.weight_lbs <= 0) continue;

                const reps = typeof set.reps === 'number' && set.reps > 0 ? set.reps : 1;
                const estimated1RM = calculate1RM(set.weight_lbs, reps);

                const current = prs.get(exercise);
                // Compare by estimated 1RM, not just weight
                if (!current || estimated1RM > current.estimated1RM) {
                    prs.set(exercise, {
                        exercise,
                        weight: set.weight_lbs,
                        reps: reps,
                        estimated1RM: Math.round(estimated1RM * 10) / 10,
                        date: session.start_time
                    });
                }
            }
        }
    }

    // Sort by estimated 1RM and return top PRs
    return Array.from(prs.values())
        .filter(pr => pr.weight > 50) // Filter out light exercises
        .sort((a, b) => b.estimated1RM - a.estimated1RM)
        .slice(0, 10);
}

// Export for use in app.jsx
window.DanfoAnalytics = {
    parseCSVToDanfoFrame,
    parseWorkoutDate,
    inferTrainingAge,
    computeLogRegression,
    predictFuture1RM,
    prepareRegressionData,
    analyzeTrainingTrends,
    getPersonalRecords,
    TRAINING_AGE_THRESHOLDS,
    DECAY_CONSTANTS
};
