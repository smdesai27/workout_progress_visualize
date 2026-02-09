const { useState, useEffect, useRef, useMemo } = React;

function fetchJson(url) {
  return fetch(url).then(r => {
    if (!r.ok) throw new Error('Network error');
    return r.json();
  });
}

function App() {
  const [exercises, setExercises] = useState([]);
  const [selected, setSelected] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [uploadedRows, setUploadedRows] = useState(null);
  const [uploadedSessions, setUploadedSessions] = useState(null);
  const [usingUploadedData, setUsingUploadedData] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const fileInputRef = useRef(null);

  // Analytics state
  const [trainingAgeOverride, setTrainingAgeOverride] = useState('auto'); // 'auto' | 'novice' | 'intermediate' | 'advanced'
  const [showPrediction, setShowPrediction] = useState(false);
  const [activeView, setActiveView] = useState('progression'); // 'progression' | 'radar'
  const [radarTimeWindow, setRadarTimeWindow] = useState('all'); // '3months' | '1year' | 'all'
  const [muscleMapping, setMuscleMapping] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Compute training age analysis
  const trainingAgeInfo = useMemo(() => {
    const sessionsToAnalyze = usingUploadedData ? uploadedSessions : sessions;
    if (!sessionsToAnalyze || sessionsToAnalyze.length === 0) {
      return { classification: 'novice', months: 0, confidence: 'low', workoutsPerWeek: 0 };
    }
    if (window.DanfoAnalytics) {
      return window.DanfoAnalytics.inferTrainingAge(sessionsToAnalyze);
    }
    return { classification: 'novice', months: 0, confidence: 'low', workoutsPerWeek: 0 };
  }, [sessions, uploadedSessions, usingUploadedData]);

  // Effective training age (respects override)
  const effectiveTrainingAge = trainingAgeOverride === 'auto'
    ? trainingAgeInfo.classification
    : trainingAgeOverride;

  // Compute progression prediction for selected exercise
  const predictionData = useMemo(() => {
    if (!showPrediction || !timeline || timeline.length < 3 || !window.DanfoAnalytics) {
      return null;
    }

    const regressionData = window.DanfoAnalytics.prepareRegressionData(timeline);
    if (regressionData.length < 3) return null;

    const model = window.DanfoAnalytics.computeLogRegression(regressionData);
    if (!model || model.rSquared < 0.1) return null; // Too poor fit

    const currentWeek = Math.max(...regressionData.map(d => d.week));
    const predictions = window.DanfoAnalytics.predictFuture1RM(model, currentWeek, 12, effectiveTrainingAge);

    return { model, predictions, regressionData };
  }, [timeline, showPrediction, effectiveTrainingAge]);

  // Load muscle mapping on mount
  useEffect(() => {
    fetch('/muscle-mapping.json')
      .then(r => r.json())
      .then(setMuscleMapping)
      .catch(console.warn);
  }, []);

  useEffect(() => {
    if (usingUploadedData && uploadedSessions) {
      // derive exercises and sessions from uploaded data
      const exSet = new Set();
      for (const s of uploadedSessions) for (const k of Object.keys(s.exercises)) exSet.add(k);
      setExercises(Array.from(exSet).sort((a, b) => a.localeCompare(b)));
      // sessions list should mirror server shape (exercises as array of names)
      setSessions(uploadedSessions.map(s => ({ id: s.id, title: s.title, start_time: s.start_time, end_time: s.end_time, description: s.description, exercises: Object.keys(s.exercises) })));
      return;
    }
    fetchJson('/api/exercises').then(setExercises).catch(console.error);
    fetchJson('/api/sessions').then(setSessions).catch(console.error);
  }, [usingUploadedData, uploadedSessions]);

  useEffect(() => {
    if (!selected) return;
    if (usingUploadedData && uploadedSessions) {
      const t = computeExerciseProgression(uploadedSessions, selected);
      setTimeline(t);
      return;
    }
    fetchJson(`/api/exercise/${encodeURIComponent(selected)}/progression`).then(setTimeline).catch(console.error);
  }, [selected, usingUploadedData, uploadedSessions]);

  function loadSession(id) {
    if (usingUploadedData && uploadedSessions) {
      const s = uploadedSessions.find(x => x.id === id);
      setSessionDetail(s || null);
      return;
    }
    fetchJson(`/api/session/${encodeURIComponent(id)}`).then(s => setSessionDetail(s)).catch(console.error);
  }

  // Client-side CSV processing helpers
  function buildSessionsFromRows(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.title || ''}|||${r.start_time || ''}`;
      if (!map.has(key)) {
        map.set(key, { id: key, title: r.title || '', start_time: r.start_time || '', end_time: r.end_time || '', description: r.description || '', exercises: new Map() });
      }
      const session = map.get(key);
      const ex = r.exercise_title || '(unknown)';
      if (!session.exercises.has(ex)) session.exercises.set(ex, []);
      const weightKg = r.weight_kg ? Number(r.weight_kg) : null;
      const weightLbs = r.weight_lbs ? Number(r.weight_lbs) : null;
      const finalWeightLbs = weightLbs !== null ? weightLbs : (weightKg !== null ? weightKg * 2.20462262185 : null);
      session.exercises.get(ex).push({
        set_index: r.set_index ? Number(r.set_index) : null,
        weight_lbs: finalWeightLbs,
        reps: r.reps ? Number(r.reps) : null,
        distance_miles: r.distance_miles ? Number(r.distance_miles) : null,
        duration_seconds: r.duration_seconds ? Number(r.duration_seconds) : null,
        rpe: r.rpe ? Number(r.rpe) : null,
        exercise_notes: r.exercise_notes || ''
      });
    }
    const sessions = Array.from(map.values()).map(s => {
      const exs = {};
      for (const [k, v] of s.exercises) exs[k] = v;
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
      if (!sets) continue;
      let maxW = null; let epley = null; let brzycki = null; let totalSets = 0;
      for (const set of sets) {
        if (typeof set.weight_lbs === 'number') {
          if (maxW === null || set.weight_lbs > maxW) maxW = set.weight_lbs;
          const e = set.reps ? epley_formula(set.weight_lbs, set.reps) : null;
          const b = set.reps ? brzycki_formula(set.weight_lbs, set.reps) : null;
          if (e != null && (epley == null || e > epley)) epley = e;
          if (b != null && (brzycki == null || b > brzycki)) brzycki = b;
        }
        if (typeof set.reps === 'number') totalSets += 1;
      }
      timeline.push({ sessionId: s.id, date: s.start_time, maxWeight: maxW, epley, brzycki, totalSets });
    }
    timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return timeline;
  }

  function handleUploadFile(file) {
    if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: true, transform: v => (v === null || v === undefined) ? '' : v, complete: (res) => {
        const rows = res.data;
        setUploadedRows(rows);
        const sess = buildSessionsFromRows(rows);
        setUploadedSessions(sess);
        setUsingUploadedData(true);
        setSelected(null);
        setTimeline([]);
        setSessionDetail(null);
      }, error: (err) => { console.error('CSV parse error', err); alert('CSV parse error: ' + err.message); }
    });
  }

  function clearUploadedData() { setUploadedRows(null); setUploadedSessions(null); setUsingUploadedData(false); setExercises([]); setSessions([]); setSelected(null); setTimeline([]); }

  return (
    <div className="container">
      <div className="header">
        <div className="logo">Progression Visualizer</div>
        <div className="meta">Export workout CSV from hevy and visualize your workouts and progression --- contact: sd22projects@gmail.com</div>
      </div>

      <div className="card">
        <div className="controls">
          <div className="control-item" style={{ width: 240 }}>
            <label className="meta">Exercise</label>
            <select value={selected || ''} onChange={e => setSelected(e.target.value)}>
              <option value="">-- choose exercise --</option>
              {exercises.map((ex) => (
                <option key={ex} value={ex}>{ex}</option>
              ))}
            </select>
          </div>
          <div className="control-item sessions-control">
            <label className="meta">Sessions</label>
            <select onChange={e => loadSession(e.target.value)}>
              <option value="">-- choose session (view sets) --</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.start_time} — {s.title} ({s.exercises.length} exercises)</option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <div className="left">
            {/* View Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                className={activeView === 'progression' ? 'active-tab' : ''}
                onClick={() => setActiveView('progression')}
                style={{
                  padding: '8px 16px',
                  background: activeView === 'progression' ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                  border: 'none',
                  borderRadius: 6,
                  color: 'var(--text)',
                  cursor: 'pointer'
                }}
              >
                📈 Progression
              </button>
              <button
                className={activeView === 'radar' ? 'active-tab' : ''}
                onClick={() => setActiveView('radar')}
                style={{
                  padding: '8px 16px',
                  background: activeView === 'radar' ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                  border: 'none',
                  borderRadius: 6,
                  color: 'var(--text)',
                  cursor: 'pointer'
                }}
              >
                🎯 Muscle Balance
              </button>
            </div>

            {activeView === 'progression' && (
              <>
                <div className="card chart-wrap">
                  {/* Analytics Controls */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <h3 style={{ margin: 0 }}>{selected || 'Select an exercise'}</h3>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      {/* Training Age Selector */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="meta" style={{ fontSize: 11 }}>Training Level:</span>
                        <select
                          value={trainingAgeOverride}
                          onChange={e => setTrainingAgeOverride(e.target.value)}
                          style={{ padding: '4px 8px', fontSize: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'var(--text)' }}
                        >
                          <option value="auto">Auto ({trainingAgeInfo.classification})</option>
                          <option value="novice">Novice</option>
                          <option value="intermediate">Intermediate</option>
                          <option value="advanced">Advanced</option>
                        </select>
                      </div>

                      {/* Prediction Toggle */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={showPrediction}
                          onChange={e => setShowPrediction(e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span>Show Prediction</span>
                      </label>
                    </div>
                  </div>

                  {/* Training Age Info */}
                  {trainingAgeInfo.months > 0 && (
                    <div className="meta" style={{ fontSize: 11, marginBottom: 8 }}>
                      {trainingAgeInfo.months.toFixed(1)} months of data • {trainingAgeInfo.workoutsPerWeek.toFixed(1)} sessions/week • {trainingAgeInfo.totalSessions || 0} total sessions
                    </div>
                  )}

                  <ProgressChart data={timeline} predictionData={predictionData} />

                  {/* Prediction Info */}
                  {showPrediction && predictionData && (
                    <div style={{ marginTop: 12, padding: 10, background: 'rgba(139,92,246,0.1)', borderRadius: 8, fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span>🔮</span>
                        <strong>12-Week Prediction</strong>
                        <span className="meta">(R² = {(predictionData.model.rSquared * 100).toFixed(0)}% fit)</span>
                      </div>
                      <div className="meta">
                        Based on logarithmic decay model for {effectiveTrainingAge} trainees.
                        Predicted 1RM in 12 weeks: <strong>{predictionData.predictions[predictionData.predictions.length - 1]?.predicted} lbs</strong>
                        {' ('}±{Math.round(predictionData.model.standardError * 2)}{' lbs)'}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeView === 'radar' && (
              <div className="card chart-wrap">
                {/* Time Window Filter */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>Muscle Group Distribution</h3>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['3months', '1year', 'all'].map(tw => (
                      <button
                        key={tw}
                        onClick={() => setRadarTimeWindow(tw)}
                        style={{
                          padding: '4px 10px',
                          fontSize: 11,
                          background: radarTimeWindow === tw ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                          border: 'none',
                          borderRadius: 4,
                          color: 'var(--text)',
                          cursor: 'pointer'
                        }}
                      >
                        {tw === '3months' ? '3 Months' : tw === '1year' ? '1 Year' : 'All Time'}
                      </button>
                    ))}
                  </div>
                </div>

                <MuscleRadarChart
                  sessions={usingUploadedData ? uploadedSessions : sessions}
                  muscleMapping={muscleMapping}
                  timeWindow={radarTimeWindow}
                />
              </div>
            )}

            {sessionDetail && (
              <div className="card" style={{ marginTop: 12 }}>
                <h4>Session: {sessionDetail.title} — {sessionDetail.start_time}</h4>
                <div className="meta">Exercises: {Object.keys(sessionDetail.exercises).length}</div>
                <div style={{ marginTop: 8 }}>
                  {Object.entries(sessionDetail.exercises).map(([name, sets]) => (
                    <div key={name} style={{ marginBottom: 8 }}>
                      <strong>{name}</strong>
                      <div className="meta">Sets: {sets.length}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                        {sets.map((s, i) => (
                          <div key={i} style={{ padding: 6, background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
                            <div className="meta">Set {s.set_index}</div>
                            <div>W: {s.weight_lbs != null ? s.weight_lbs : '-'} | R: {s.reps != null ? s.reps : '-'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="right">
            <div className="card">
              <h4>Exercises</h4>
              <input
                type="text"
                placeholder="Search exercises..."
                value={exerciseSearch}
                onChange={e => setExerciseSearch(e.target.value)}
                className="exercise-search"
                style={{ marginBottom: 12, width: '100%' }}
              />
              <div className="exercise-list">
                {exercises
                  .filter(ex => ex.toLowerCase().includes(exerciseSearch.toLowerCase()))
                  .map(ex => (
                    <div
                      key={ex}
                      className={`exercise-item ${selected === ex ? 'selected' : ''}`}
                      onClick={() => setSelected(ex)}
                    >
                      <div>{ex}</div>
                    </div>
                  ))}
                {exercises.filter(ex => ex.toLowerCase().includes(exerciseSearch.toLowerCase())).length === 0 && (
                  <div className="meta" style={{ padding: 8, textAlign: 'center' }}>No exercises found</div>
                )}
              </div>
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <h4>Quick actions</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', width: '100%' }}>
                  <button
                    style={{ width: 140, padding: '8px 12px' }}
                    onClick={() => fetchJson('/api/reload').then(() => { alert('reloaded'); location.reload(); })}
                  >Reload CSV</button>
                  <button
                    style={{ width: 140, padding: '8px 12px' }}
                    onClick={usingUploadedData ? clearUploadedData : () => fileInputRef.current && fileInputRef.current.click()}
                  >{usingUploadedData ? 'Clear uploaded' : 'Upload CSV'}</button>
                </div>

                <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files && e.target.files[0]; if (f) handleUploadFile(f); }} />

                {usingUploadedData && (
                  <div className="meta" style={{ marginTop: 6 }}>Using uploaded data</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating AI Coach Button */}
      <button
        className="ai-coach-fab"
        onClick={() => setIsChatOpen(true)}
        title="Open AI Coach"
      >
        🤖
      </button>

      {/* AI Coach Chat Drawer */}
      <ChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        sessions={usingUploadedData ? uploadedSessions : sessions}
        muscleMapping={muscleMapping}
      />
    </div>
  );
}

// Muscle Radar Chart Component
function MuscleRadarChart({ sessions, muscleMapping, timeWindow }) {
  const canvasRef = useRef(null);

  // Calculate muscle volume data
  const muscleVolumeData = useMemo(() => {
    if (!sessions || sessions.length === 0 || !muscleMapping) {
      return null;
    }

    // Filter sessions by time window
    const now = new Date();
    const filteredSessions = sessions.filter(s => {
      if (timeWindow === 'all') return true;

      const sessionDate = window.DanfoAnalytics?.parseWorkoutDate(s.start_time);
      if (!sessionDate) return true;

      const monthsAgo = (now - sessionDate) / (30.44 * 24 * 60 * 60 * 1000);

      if (timeWindow === '3months') return monthsAgo <= 3;
      if (timeWindow === '1year') return monthsAgo <= 12;
      return true;
    });

    // Initialize muscle volumes
    const radarGroups = muscleMapping.radarGroups || [];
    const muscleVolumes = {};
    radarGroups.forEach(m => muscleVolumes[m] = 0);

    // Calculate volume per muscle group
    for (const session of filteredSessions) {
      for (const [exerciseName, sets] of Object.entries(session.exercises || {})) {
        const mapping = muscleMapping.exercises[exerciseName];
        if (!mapping) continue;

        // Calculate total volume for this exercise (weight × reps × sets)
        let exerciseVolume = 0;
        for (const set of sets) {
          if (typeof set.weight_lbs === 'number' && typeof set.reps === 'number') {
            exerciseVolume += set.weight_lbs * set.reps;
          }
        }

        // Distribute volume to muscle groups
        (mapping.primary || []).forEach(muscle => {
          const targetMuscle = muscleMapping.muscleAliases?.[muscle] || muscle;
          if (muscleVolumes[targetMuscle] !== undefined) {
            muscleVolumes[targetMuscle] += exerciseVolume * 1.0; // Primary: 100%
          }
        });

        (mapping.secondary || []).forEach(muscle => {
          const targetMuscle = muscleMapping.muscleAliases?.[muscle] || muscle;
          if (muscleVolumes[targetMuscle] !== undefined) {
            muscleVolumes[targetMuscle] += exerciseVolume * 0.4; // Secondary: 40%
          }
        });
      }
    }

    // Normalize to percentages
    const totalVolume = Object.values(muscleVolumes).reduce((a, b) => a + b, 0) || 1;
    const normalized = {};
    for (const [muscle, volume] of Object.entries(muscleVolumes)) {
      normalized[muscle] = (volume / totalVolume) * 100;
    }

    return { volumes: muscleVolumes, normalized, radarGroups, sessionCount: filteredSessions.length };
  }, [sessions, muscleMapping, timeWindow]);

  useEffect(() => {
    if (!canvasRef.current || !muscleVolumeData) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Destroy previous chart
    if (canvasRef.current._chart) canvasRef.current._chart.destroy();

    const { normalized, radarGroups } = muscleVolumeData;
    const values = radarGroups.map(m => normalized[m] || 0);

    // Calculate balance score (how evenly distributed)
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + Math.pow(v - avg, 2), 0) / values.length;
    const balanceScore = Math.max(0, 100 - Math.sqrt(variance) * 5);

    const chart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: radarGroups,
        datasets: [{
          label: 'Volume Distribution (%)',
          data: values,
          backgroundColor: 'rgba(139, 92, 246, 0.2)',
          borderColor: '#8B5CF6',
          borderWidth: 2,
          pointBackgroundColor: values.map(v => {
            // Color code: red for underdeveloped, green for balanced
            if (v < avg * 0.5) return '#EF4444'; // Red - underdeveloped
            if (v > avg * 1.5) return '#F59E0B'; // Yellow - overdeveloped
            return '#10B981'; // Green - balanced
          }),
          pointBorderColor: '#fff',
          pointRadius: 5,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#e6eef8',
            bodyColor: '#e6eef8',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
            callbacks: {
              label: function (context) {
                const muscle = context.label;
                const pct = context.raw.toFixed(1);
                const rawVolume = muscleVolumeData.volumes[muscle];
                return `${pct}% (${Math.round(rawVolume / 1000)}k lbs total)`;
              }
            }
          }
        },
        scales: {
          r: {
            angleLines: {
              color: 'rgba(255,255,255,0.1)'
            },
            grid: {
              color: 'rgba(255,255,255,0.1)'
            },
            pointLabels: {
              color: 'rgba(230,238,248,0.9)',
              font: {
                size: 11
              }
            },
            ticks: {
              display: false,
              stepSize: 5
            },
            suggestedMin: 0,
            suggestedMax: Math.max(...values) * 1.1
          }
        }
      }
    });

    canvasRef.current._chart = chart;
    return () => chart.destroy();
  }, [muscleVolumeData]);

  if (!muscleMapping) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200 }}>
        <div className="meta">Loading muscle mapping...</div>
      </div>
    );
  }

  if (!muscleVolumeData || muscleVolumeData.sessionCount === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200 }}>
        <span style={{ fontSize: 32 }}>🎯</span>
        <div className="meta" style={{ marginTop: 8 }}>No workout data in this time window</div>
      </div>
    );
  }

  // Find imbalances
  const { normalized, radarGroups } = muscleVolumeData;
  const avg = Object.values(normalized).reduce((a, b) => a + b, 0) / Object.values(normalized).length;
  const underworked = radarGroups.filter(m => normalized[m] < avg * 0.6);
  const overworked = radarGroups.filter(m => normalized[m] > avg * 1.4);

  return (
    <div>
      <div style={{ height: 300 }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      </div>

      <div className="meta" style={{ marginTop: 12, fontSize: 11, textAlign: 'center' }}>
        Based on {muscleVolumeData.sessionCount} sessions
      </div>

      {(underworked.length > 0 || overworked.length > 0) && (
        <div style={{ marginTop: 12, padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 12 }}>
          {underworked.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: '#EF4444' }}>⚠️ Underworked:</span>{' '}
              <span className="meta">{underworked.join(', ')}</span>
            </div>
          )}
          {overworked.length > 0 && (
            <div>
              <span style={{ color: '#F59E0B' }}>📈 High volume:</span>{' '}
              <span className="meta">{overworked.join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// AI Coach Chat Drawer Component - Uses Server-Side Gemini API
function ChatDrawer({ isOpen, onClose, sessions, muscleMapping }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [modelStatus, setModelStatus] = useState('ready'); // Always ready with server API
  const [statusMessage, setStatusMessage] = useState('');
  const messagesEndRef = useRef(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      // Build system prompt with current analysis
      const currentSessions = sessions || [];
      const analysisData = window.AICoachUtils?.computeAnalysisForPrompt(currentSessions, muscleMapping) || {};
      const systemPrompt = window.AICoachUtils?.buildSystemPrompt(analysisData) || 'You are a helpful fitness coach.';

      // Call server API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt, userMessage })
      });

      // Check if response is OK before parsing JSON
      if (!response.ok) {
        // Try to parse error response
        let errorMessage = 'Failed to get response. Please try again.';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.response || errorMessage;
        } catch (e) {
          // If error response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMessage}` }]);
        return;
      }

      const data = await response.json();

      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}` }]);
      } else if (data.response) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'No response received from AI.' }]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to get response. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="chat-drawer-overlay" onClick={onClose}>
      <div className="chat-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🤖</span>
            <span style={{ fontWeight: 600 }}>AI Coach</span>
            <span className="status-badge status-ready">Gemini</span>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Chat messages */}
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="welcome-message">
              <div style={{ fontSize: 32, marginBottom: 12 }}>👋</div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Welcome to AI Coach!</div>
              <div className="meta">
                Powered by Gemini. Ask me anything about your workout
                progress, muscle imbalances, or programming suggestions.
              </div>
              <div className="suggestion-chips">
                <button onClick={() => setInputValue('How can I break through my bench press plateau?')}>
                  Break bench plateau
                </button>
                <button onClick={() => setInputValue('What muscle groups should I focus on more?')}>
                  Muscle balance
                </button>
                <button onClick={() => setInputValue('Give me a weekly split suggestion')}>
                  Weekly split
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <div className="message-content">{msg.content}</div>
            </div>
          ))}

          {isLoading && (
            <div className="message assistant loading-message-bubble">
              <div className="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="chat-input-area">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your AI coach..."
            disabled={isLoading}
            rows={2}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}


function ProgressChart({ data, predictionData }) {
  const canvasRef = useRef(null);

  // Empty state - render first before useEffect
  const hasData = data && data.length > 0;

  useEffect(() => {
    // Guard: don't try to render chart if no canvas or no data
    if (!canvasRef.current || !hasData) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Prepare datasets
    const labels = data.map(d => new Date(d.date).toLocaleDateString());
    const weights = data.map(d => (d.maxWeight != null ? d.maxWeight : null));
    const epley_1rm = data.map(d => (d.epley != null ? d.epley : null));
    const brzycki_1rm = data.map(d => (d.brzycki != null ? d.brzycki : null));
    const totalSets = data.map(d => (d.totalSets != null ? d.totalSets : null));

    // Add prediction labels and data if available
    let allLabels = [...labels];
    let predictionValues = [];
    let predictionUpperBound = [];
    let predictionLowerBound = [];

    if (predictionData && predictionData.predictions && predictionData.predictions.length > 0) {
      // Add future date labels
      const lastDate = new Date(data[data.length - 1].date);
      predictionData.predictions.forEach((p, i) => {
        const futureDate = new Date(lastDate);
        futureDate.setDate(futureDate.getDate() + (i + 1) * 7); // Weekly predictions
        allLabels.push(futureDate.toLocaleDateString());
      });

      // Pad historical data with nulls for prediction datasets
      const historicalPadding = new Array(labels.length).fill(null);

      // Connect prediction to last actual data point
      const lastEpley = data[data.length - 1].epley || data[data.length - 1].maxWeight;
      predictionValues = [...historicalPadding.slice(0, -1), lastEpley, ...predictionData.predictions.map(p => p.predicted)];
      predictionUpperBound = [...historicalPadding.slice(0, -1), lastEpley, ...predictionData.predictions.map(p => p.upper)];
      predictionLowerBound = [...historicalPadding.slice(0, -1), lastEpley, ...predictionData.predictions.map(p => p.lower)];
    }

    // Helper: compute nice axis range (min, max, stepSize) for an array of values
    function computeAxisRange(values, forceMinZero = false) {
      const validVals = values.filter(v => v != null && !Number.isNaN(v)).map(Number);
      if (validVals.length === 0) return { min: 0, max: 10, stepSize: 2 };

      let minVal = Math.min(...validVals);
      let maxVal = Math.max(...validVals);

      // Enforce non-negative minimum
      if (forceMinZero || minVal < 0) minVal = 0;

      // Add padding (10% above)
      const range = maxVal - minVal || 1;
      const padding = range * 0.1;
      maxVal = maxVal + padding;

      // Round min down and max up to nice numbers
      function niceNumber(val, roundDown) {
        if (val === 0) return 0;
        const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(val))));
        const normalized = val / magnitude;
        let nice;
        if (roundDown) {
          if (normalized <= 1) nice = 1;
          else if (normalized <= 2) nice = 2;
          else if (normalized <= 5) nice = 5;
          else nice = 10;
          return Math.floor(val / (nice * magnitude / 10)) * (nice * magnitude / 10);
        } else {
          if (normalized <= 1) nice = 1;
          else if (normalized <= 2) nice = 2;
          else if (normalized <= 5) nice = 5;
          else nice = 10;
          return Math.ceil(val / (nice * magnitude / 10)) * (nice * magnitude / 10);
        }
      }

      // Simpler rounding: round to nearest 5 or 10
      minVal = Math.floor(minVal / 5) * 5;
      maxVal = Math.ceil(maxVal / 5) * 5;
      if (minVal < 0) minVal = 0;

      // Compute nice step size for ~5 ticks
      function niceStep(range) {
        if (range <= 0) return 1;
        const raw = range / 5;
        const pow = Math.pow(10, Math.floor(Math.log10(raw)));
        const norm = raw / pow;
        let nice;
        if (norm < 1.5) nice = 1;
        else if (norm < 3) nice = 2;
        else if (norm < 7) nice = 5;
        else nice = 10;
        return nice * pow;
      }

      const stepSize = niceStep(maxVal - minVal);

      return { min: minVal, max: maxVal, stepSize };
    }

    // Compute separate ranges for weight metrics (y - left axis) and sets (y2 - right axis)
    const weightValues = [...weights, ...epley_1rm, ...brzycki_1rm];
    const setsValues = totalSets;

    const weightRange = computeAxisRange(weightValues, false);
    const setsRange = computeAxisRange(setsValues, true);

    // Destroy previous chart on same canvas
    if (canvasRef.current._chart) canvasRef.current._chart.destroy();

    // Pad historical datasets if predictions are shown
    const hasPredictions = predictionValues.length > 0;
    const paddedWeights = hasPredictions ? [...weights, ...new Array(predictionData.predictions.length).fill(null)] : weights;
    const paddedEpley = hasPredictions ? [...epley_1rm, ...new Array(predictionData.predictions.length).fill(null)] : epley_1rm;
    const paddedBrzycki = hasPredictions ? [...brzycki_1rm, ...new Array(predictionData.predictions.length).fill(null)] : brzycki_1rm;
    const paddedSets = hasPredictions ? [...totalSets, ...new Array(predictionData.predictions.length).fill(null)] : totalSets;

    // Build datasets array
    const datasets = [
      {
        label: 'Max Weight (lbs)',
        data: paddedWeights,
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59,130,246,0.15)',
        tension: 0.3,
        spanGaps: true,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
        fill: false,
        yAxisID: 'y'
      },
      {
        label: 'Total Sets',
        data: paddedSets,
        borderColor: '#10B981',
        backgroundColor: 'rgba(16,185,129,0.15)',
        tension: 0.3,
        spanGaps: true,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
        fill: false,
        yAxisID: 'y2'
      },
      {
        label: 'Epley 1RM',
        data: paddedEpley,
        borderColor: '#F59E0B',
        backgroundColor: 'rgba(245,158,11,0.15)',
        tension: 0.3,
        spanGaps: true,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
        fill: false,
        yAxisID: 'y'
      },
      {
        label: 'Brzycki 1RM',
        data: paddedBrzycki,
        borderColor: '#EF4444',
        backgroundColor: 'rgba(239,68,68,0.15)',
        tension: 0.3,
        spanGaps: true,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
        fill: false,
        yAxisID: 'y',
        hidden: true  // Hidden by default since it overlaps with Epley
      }
    ];

    // Add prediction datasets if available
    if (hasPredictions) {
      datasets.push({
        label: 'Predicted 1RM',
        data: predictionValues,
        borderColor: '#8B5CF6',
        backgroundColor: 'rgba(139,92,246,0.1)',
        tension: 0.3,
        spanGaps: true,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        borderDash: [6, 4],
        fill: false,
        yAxisID: 'y'
      });

      // Confidence band (upper bound)
      datasets.push({
        label: 'Prediction Range',
        data: predictionUpperBound,
        borderColor: 'rgba(139,92,246,0.3)',
        backgroundColor: 'rgba(139,92,246,0.08)',
        tension: 0.3,
        spanGaps: true,
        pointRadius: 0,
        borderWidth: 1,
        borderDash: [3, 3],
        fill: '+1', // Fill to next dataset
        yAxisID: 'y'
      });

      // Confidence band (lower bound)
      datasets.push({
        label: 'Prediction Lower',
        data: predictionLowerBound,
        borderColor: 'rgba(139,92,246,0.3)',
        backgroundColor: 'transparent',
        tension: 0.3,
        spanGaps: true,
        pointRadius: 0,
        borderWidth: 1,
        borderDash: [3, 3],
        fill: false,
        yAxisID: 'y',
        hidden: false
      });
    }

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: allLabels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              boxWidth: 14,
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            },
            onClick: function (e, legendItem, legend) {
              // Toggle dataset visibility when clicking legend
              const index = legendItem.datasetIndex;
              const ci = legend.chart;
              const meta = ci.getDatasetMeta(index);
              meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
              ci.update();
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#e6eef8',
            bodyColor: '#e6eef8',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
            callbacks: {
              label: function (context) {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                if (context.parsed.y !== null) {
                  label += Math.round(context.parsed.y * 10) / 10;
                  if (context.dataset.yAxisID === 'y') label += ' lbs';
                }
                return label;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              autoSkip: true,
              maxRotation: 45,
              color: 'rgba(230,238,248,0.7)'
            },
            grid: {
              color: 'rgba(255,255,255,0.05)'
            }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            min: weightRange.min,
            max: weightRange.max,
            title: {
              display: true,
              text: 'Weight (lbs)',
              color: 'rgba(230,238,248,0.7)'
            },
            ticks: {
              stepSize: weightRange.stepSize,
              color: 'rgba(230,238,248,0.7)',
              callback: function (value) {
                return Math.round(value);
              }
            },
            grid: {
              color: 'rgba(255,255,255,0.05)'
            }
          },
          y2: {
            type: 'linear',
            display: true,
            position: 'right',
            min: setsRange.min,
            max: setsRange.max,
            title: {
              display: true,
              text: 'Sets',
              color: 'rgba(230,238,248,0.7)'
            },
            ticks: {
              stepSize: setsRange.stepSize,
              color: 'rgba(230,238,248,0.7)',
              callback: function (value) {
                return Math.round(value);
              }
            },
            grid: {
              display: false
            }
          }
        }
      }
    });
    canvasRef.current._chart = chart;
    return () => chart.destroy();
  }, [data, hasData, predictionData]);

  // Empty state - rendered when no data
  if (!hasData) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: '200px',
        color: 'rgba(230,238,248,0.5)'
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7 16l4-4 4 4 5-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p style={{ marginTop: 12, fontSize: 14 }}>Select an exercise to view progression</p>
      </div>
    );
  }

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
