// Tweaks panel — hi-fi

function Tweaks({ state, setState }) {
  const [on, setOn] = React.useState(false);

  React.useEffect(() => {
    const h = (e) => {
      if (!e.data || !e.data.type) return;
      if (e.data.type === '__activate_edit_mode') setOn(true);
      if (e.data.type === '__deactivate_edit_mode') setOn(false);
    };
    window.addEventListener('message', h);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', h);
  }, []);

  const persist = (patch) => {
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: patch }, '*');
  };
  const update = (patch) => {
    setState(s => ({ ...s, ...patch }));
    persist(patch);
  };

  if (!on) return null;

  const accents = [
    { n: 'sunrise', c: '#FF5B2E' },
    { n: 'ember',   c: '#E03B12' },
    { n: 'lime',    c: '#7CB518' },
    { n: 'sky',     c: '#2F80ED' },
    { n: 'violet',  c: '#7C5CFF' },
    { n: 'ink',     c: '#141210' },
  ];

  return (
    <div className="tweaks-panel">
      <h3>Tweaks</h3>

      <label>Accent</label>
      <div className="swatches">
        {accents.map(a => (
          <button
            key={a.n}
            className={'sw ' + (state.accent === a.c ? 'active' : '')}
            style={{ background: a.c }}
            onClick={() => update({ accent: a.c })}
            title={a.n}
          />
        ))}
      </div>

      <label>Surface</label>
      <select value={state.surface} onChange={e => update({ surface: e.target.value })}>
        <option value="warm">Warm (sand / ivory)</option>
        <option value="cool">Cool (neutral gray)</option>
      </select>

      <label>Hero headline · Variant A</label>
      <select value={state.heroA} onChange={e => update({ heroA: e.target.value })}>
        <option value="sleep">Rank while you sleep.</option>
        <option value="team">Your SEO team, as an agent.</option>
        <option value="ship">Ship 100 articles this month.</option>
      </select>
    </div>
  );
}

window.Tweaks = Tweaks;
