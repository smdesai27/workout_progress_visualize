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

  useEffect(() => {
    fetchJson('/api/exercises').then(setExercises).catch(console.error);
    fetchJson('/api/sessions').then(setSessions).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selected) return;
    fetchJson(`/api/exercise/${encodeURIComponent(selected)}/progression`).then(setTimeline).catch(console.error);
  }, [selected]);

  function loadSession(id) {
    fetchJson(`/api/session/${encodeURIComponent(id)}`).then(s => setSessionDetail(s)).catch(console.error);
  }

  return (
    <div className="container">
      <div className="header">
        <div className="logo">Progression Visualizer</div>
        <div className="meta">Visualize each workout and progression</div>
      </div>

      <div className="card">
        <div className="controls">
          <div>
            <label className="meta">Exercise</label><br/>
            <select value={selected||''} onChange={e=>setSelected(e.target.value)}>
              <option value="">-- choose exercise --</option>
              {exercises.map((ex)=> (
                <option key={ex} value={ex}>{ex}</option>
              ))}
            </select>
          </div>
          <div style={{flex:1}}>
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
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>fetchJson('/api/reload').then(()=>{alert('reloaded'); location.reload();})}>Reload CSV</button>
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

    // destroy previous chart on same canvas
    if (canvasRef.current._chart) canvasRef.current._chart.destroy();

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Max weight (lbs)', data: weights, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.12)', tension: 0.2, spanGaps:true, pointRadius:3, borderWidth:2, fill:false },
          { label: 'Total sets', data: totalSets, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.08)', tension: 0.2, yAxisID: 'y2', pointRadius:3, borderWidth:2, fill:false },
          { label: 'Epley 1RM', data: epley_1rm, borderColor: '#3024d8ff', backgroundColor: 'rgba(96,165,250,0.08)', tension: 0.2, yAxisID: 'y2', pointRadius:3, borderWidth:2, fill:false },
          { label: 'Brzycki 1RM', data: brzycki_1rm, borderColor: '#3471d3ff', backgroundColor: 'rgba(96,165,250,0.08)', tension: 0.2, yAxisID: 'y2', pointRadius:3, borderWidth:2, fill:false }
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
            beginAtZero:true,
            position:'left',
            ticks: {
              callback: function(value){
                if (Number.isInteger(value)) return value;
                return Math.round(value * 10) / 10;
              }
            }
          },
          y2: {
            beginAtZero:true,
            position:'right',
            grid:{display:false},
            ticks: {
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
