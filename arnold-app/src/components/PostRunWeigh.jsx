// PostRunWeigh — the post-run weigh-in capture for the activity card's Fuel & Fluids
// section. Logging your weight right after a run is what fills the hub's personal
// SWEAT-RATE model: the drop vs this morning's weight (+ any fluid you drank) over
// the run's duration is one sweat observation. It appends to the same weight log the
// rest of the app uses (with a time, so the hub classifies it as post-run), then
// shows your real sweat rate immediately as feedback. The hub's accumulate pass
// (accumulateBodyAndSweat) turns it into the learned model that the HubPanel /
// hydration tile read. Kept in its own file so the activity card only needs a
// one-line mount.

import { useState, useMemo } from 'react';
import { storage } from '../core/storage.js';
import { grossSweatRate } from '../core/hub/sweatModel.js';

export function PostRunWeigh({ fd, dateStr, onSaved }) {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState('');
  const [fluid, setFluid] = useState('');
  const [saved, setSaved] = useState(null);

  // This morning's (earliest) weigh-in today — the fasted reference the drop is vs.
  const morning = useMemo(() => {
    const log = storage.get('weight') || [];
    const today = log
      .filter(e => e && e.date === dateStr && Number.isFinite(Number(e.weightLbs ?? e.lbs ?? e.value)))
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    const m = today[0];
    return m ? Number(m.weightLbs ?? m.lbs ?? m.value) : null;
  }, [dateStr, saved]);

  const durationHr = Number(fd?.durationSecs) > 0 ? Number(fd.durationSecs) / 3600 : null;

  const save = () => {
    const lb = parseFloat(w);
    if (!(lb > 0)) return;
    const time = new Date().toTimeString().slice(0, 5); // HH:MM → hub reads it as post-run
    const log = storage.get('weight') || [];
    log.push({ date: dateStr, time, weightLbs: lb, source: 'post-run' });
    try { storage.set('weight', log, { skipValidation: true }); } catch {}
    let rate = null;
    if (morning != null && durationHr) {
      rate = grossSweatRate({ sweatNetLbs: morning - lb, fluidInL: parseFloat(fluid) || 0, durationHr });
    }
    setSaved({ rate, lb });
    setOpen(false);
    onSaved?.();
  };

  const linkBtn = {
    fontSize: 10, fontWeight: 600, color: '#60a5fa', background: 'rgba(96,165,250,0.08)',
    border: '1px solid rgba(96,165,250,0.15)', borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
  };
  const inp = {
    width: 64, background: 'var(--bg-elevated)', border: '0.5px solid var(--border-subtle)',
    borderRadius: 6, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 13,
    fontFamily: 'var(--font-mono)',
  };
  const lbl = { fontSize: 10, color: 'var(--text-secondary)' };

  if (saved) {
    return (
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
        Post-run weight logged ({saved.lb} lb).{' '}
        {saved.rate
          ? <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Your sweat rate ≈ {saved.rate} L/hr</span>
          : 'Log a morning weight too and the hub will learn your sweat rate.'}
      </div>
    );
  }

  if (!open) {
    return (
      <div style={{ marginTop: 8 }}>
        <button onClick={() => setOpen(true)} style={linkBtn}>+ Log post-run weight</button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" inputMode="decimal" step="0.1" placeholder="lb" value={w}
          onChange={e => setW(e.target.value)} style={inp} autoFocus />
        <span style={lbl}>post-run weight</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" inputMode="decimal" step="0.1" placeholder="0" value={fluid}
          onChange={e => setFluid(e.target.value)} style={{ ...inp, width: 52 }} />
        <span style={lbl}>L drunk (opt.)</span>
      </div>
      <button onClick={save} style={{ ...linkBtn, opacity: parseFloat(w) > 0 ? 1 : 0.5 }}>Save</button>
    </div>
  );
}

export default PostRunWeigh;
