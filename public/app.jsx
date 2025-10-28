const { useState, useEffect, useRef } = React;

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
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (usingUploadedData && uploadedSessions) {
      // derive exercises and sessions from uploaded data
      const exSet = new Set();
      for (const s of uploadedSessions) for (const k of Object.keys(s.exercises)) exSet.add(k);
  setExercises(Array.from(exSet).sort((a,b)=>a.localeCompare(b)));
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
      for (const [k,v] of s.exercises) exs[k] = v;
      return { ...s, exercises: exs };
    });
    sessions.sort((a,b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    return sessions;
  }

  function epley_formula(weight,reps){ return weight * (1 + (reps/30)); }
  function brzycki_formula(weight,reps){ return weight/(1.0278 - (0.0278*reps)); }

  function computeExerciseProgression(sessions, exerciseName){
    const timeline = [];
    for (const s of sessions) {
      const sets = s.exercises[exerciseName];
      if (!sets) continue;
      let maxW = null; let epley = null; let brzycki = null; let totalSets = 0;
      for (const set of sets) {
        if (typeof set.weight_lbs === 'number') {
          if (maxW===null || set.weight_lbs>maxW) maxW = set.weight_lbs;
          const e = set.reps ? epley_formula(set.weight_lbs,set.reps) : null;
          const b = set.reps ? brzycki_formula(set.weight_lbs,set.reps) : null;
          if (e!=null && (epley==null || e>epley)) epley = e;
          if (b!=null && (brzycki==null || b>brzycki)) brzycki = b;
        }
        if (typeof set.reps === 'number') totalSets += 1;
      }
      timeline.push({ sessionId: s.id, date: s.start_time, maxWeight: maxW, epley, brzycki, totalSets });
    }
    timeline.sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime());
    return timeline;
  }

  function handleUploadFile(file) {
    if (!file) return;
    Papa.parse(file, { header: true, skipEmptyLines: true, transform: v => (v===null || v===undefined) ? '' : v, complete: (res) => {
      const rows = res.data;
      setUploadedRows(rows);
      const sess = buildSessionsFromRows(rows);
      setUploadedSessions(sess);
      setUsingUploadedData(true);
      setSelected(null);
      setTimeline([]);
      setSessionDetail(null);
    }, error: (err) => { console.error('CSV parse error', err); alert('CSV parse error: '+err.message); } });
  }

  function clearUploadedData(){ setUploadedRows(null); setUploadedSessions(null); setUsingUploadedData(false); setExercises([]); setSessions([]); setSelected(null); setTimeline([]); }

  return (
    <div className="container">
      <div className="header">
        <div className="logo">Progression Visualizer</div>
        <div className="meta">Export workout CSV from hevy and visualize your workouts and progression --- contact: sd22projects@gmail.com</div>
      </div>

      <div className="card">
        <div className="controls">
          <div className="control-item" style={{width:240}}>
            <label className="meta">Exercise</label>
            <select value={selected||''} onChange={e=>setSelected(e.target.value)}>
              <option value="">-- choose exercise --</option>
              {exercises.map((ex)=> (
                <option key={ex} value={ex}>{ex}</option>
              ))}
            </select>
          </div>
          <div className="control-item sessions-control">
            <label className="meta">Sessions</label>
            <select onChange={e=>loadSession(e.target.value)}>
              <option value="">-- choose session (view sets) --</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.start_time} — {s.title} ({s.exercises.length} exercises)</option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <div className="left">
            <div className="card chart-wrap">
              <h3 style={{marginTop:0}}>{selected||'Select an exercise'}</h3>
              <ProgressChart data={timeline} />
            </div>

            {sessionDetail && (
              <div className="card" style={{marginTop:12}}>
                <h4>Session: {sessionDetail.title} — {sessionDetail.start_time}</h4>
                <div className="meta">Exercises: {Object.keys(sessionDetail.exercises).length}</div>
                <div style={{marginTop:8}}>
                  {Object.entries(sessionDetail.exercises).map(([name, sets]) => (
                    <div key={name} style={{marginBottom:8}}>
                      <strong>{name}</strong>
                      <div className="meta">Sets: {sets.length}</div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:6}}>
                        {sets.map((s, i) => (
                          <div key={i} style={{padding:6,background:'rgba(255,255,255,0.02)',borderRadius:6}}>
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
              <div className="exercise-list">
                {exercises.map(ex => (
                  <div key={ex} className="exercise-item" onClick={() => setSelected(ex)}>
                    <div>{ex}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{marginTop:12}}>
              <h4>Quick actions</h4>
              <div style={{display:'flex',flexDirection:'column',gap:12,alignItems:'center'}}>
                <div style={{display:'flex',gap:8,justifyContent:'center',width:'100%'}}>
                  <button
                    style={{width:140,padding:'8px 12px'}}
                    onClick={()=>fetchJson('/api/reload').then(()=>{alert('reloaded'); location.reload();})}
                  >Reload CSV</button>
                  <button
                    style={{width:140,padding:'8px 12px'}}
                    onClick={usingUploadedData ? clearUploadedData : ()=>fileInputRef.current && fileInputRef.current.click()}
                  >{usingUploadedData ? 'Clear uploaded' : 'Upload CSV'}</button>
                </div>

                <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{display:'none'}} onChange={e=>{const f = e.target.files && e.target.files[0]; if(f) handleUploadFile(f);}} />

                {usingUploadedData && (
                  <div className="meta" style={{marginTop:6}}>Using uploaded data</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressChart({data}){
  const canvasRef = useRef(null);
  useEffect(()=>{
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    // prepare datasets
  const labels = data.map(d => new Date(d.date).toLocaleDateString());
  const weights = data.map(d => (d.maxWeight != null ? d.maxWeight : null));
  // Use the server's property names (epley, brzycki) and coerce missing values to null
  const epley_1rm = data.map(d => (d.epley != null ? d.epley : null));
  const brzycki_1rm = data.map(d => (d.brzycki != null ? d.brzycki : null));
  const totalSets = data.map(d => (d.totalSets != null ? d.totalSets : null));

  // Compute a shared numeric range (min/max/step) for both Y axes so they
  // start at the same number and use the same scale. This makes the left and
  // right axes line up visually even if units differ.
  const allVals = [];
  for (const v of weights) if (v != null && !Number.isNaN(v)) allVals.push(Number(v));
  for (const v of epley_1rm) if (v != null && !Number.isNaN(v)) allVals.push(Number(v));
  for (const v of brzycki_1rm) if (v != null && !Number.isNaN(v)) allVals.push(Number(v));
  for (const v of totalSets) if (v != null && !Number.isNaN(v)) allVals.push(Number(v));

  let sharedMin = 0, sharedMax = 1;
  if (allVals.length > 0) {
    sharedMin = Math.min(...allVals);
    sharedMax = Math.max(...allVals);
    if (sharedMin === sharedMax) {
      // Expand a bit so chart has range
      sharedMin = Math.floor(sharedMin - 1);
      sharedMax = Math.ceil(sharedMax + 1);
    }
    const pad = (sharedMax - sharedMin) * 0.05;
    sharedMin = Math.floor((sharedMin - pad) * 10) / 10;
    sharedMax = Math.ceil((sharedMax + pad) * 10) / 10;
  }

  // Nice step size: pick a round number for ~5 ticks
  function niceStep(range) {
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
  const stepSize = niceStep(sharedMax - sharedMin);

    // destroy previous chart on same canvas
    if (canvasRef.current._chart) canvasRef.current._chart.destroy();

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Max weight (lbs)', data: weights, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.12)', tension: 0.2, spanGaps:true, pointRadius:3, borderWidth:2, fill:false },
          { label: 'Total sets', data: totalSets, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.08)', tension: 0.2, yAxisID: 'y2', pointRadius:3, borderWidth:2, fill:false },
          { label: 'Epley 1RM', data: epley_1rm, borderColor: '#9f24d8ff', backgroundColor: 'rgba(96,165,250,0.08)', tension: 0.2, yAxisID: 'y2', pointRadius:3, borderWidth:2, fill:false },
          { label: 'Brzycki 1RM', data: brzycki_1rm, borderColor: '#d33434ff', backgroundColor: 'rgba(96,165,250,0.08)', tension: 0.2, yAxisID: 'y2', pointRadius:3, borderWidth:2, fill:false }
        ]
      },
      options: {
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins: {
          legend: { labels: { boxWidth:12 } }
        },
        scales:{
          x: { ticks: { autoSkip: true, maxRotation: 0 } },
          y: {
            beginAtZero:false,
            position:'left',
            min: sharedMin,
            max: sharedMax,
            ticks: {
              stepSize: stepSize,
              callback: function(value){
                if (Number.isInteger(value)) return value;
                return Math.round(value * 10) / 10;
              }
            }
          },
          y2: {
            beginAtZero:false,
            position:'right',
            grid:{display:false},
            min: sharedMin,
            max: sharedMax,
            ticks: {
              stepSize: stepSize,
              callback: function(value){
                if (Number.isInteger(value)) return value;
                return Math.round(value * 10) / 10;
              }
            }
          }
        }
      }
    });
    canvasRef.current._chart = chart;
    return ()=>chart.destroy();
  }, [data]);
  return <canvas ref={canvasRef} style={{width:'100%',height:'100%'}} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
