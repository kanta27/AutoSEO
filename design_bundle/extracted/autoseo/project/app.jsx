// Root — DesignCanvas with all hi-fi variants

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#FF5B2E",
  "heroA": "sleep",
  "surface": "warm",
  "density": "normal"
}/*EDITMODE-END*/;

function App() {
  const [state, setState] = React.useState(TWEAK_DEFAULTS);

  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', state.accent);
  }, [state.accent]);

  React.useEffect(() => {
    if (state.surface === 'cool') {
      document.documentElement.style.setProperty('--bg', '#F5F6F7');
      document.documentElement.style.setProperty('--bg-2', '#EBEDEF');
      document.documentElement.style.setProperty('--bg-3', '#E0E3E6');
    } else {
      document.documentElement.style.setProperty('--bg', '#FAF7F2');
      document.documentElement.style.setProperty('--bg-2', '#F1ECE2');
      document.documentElement.style.setProperty('--bg-3', '#E8E1D2');
    }
  }, [state.surface]);

  return (
    <React.Fragment>
      <DesignCanvas>
        <DCSection id="landing" title="Landing page" subtitle="Three directions — same system, different narrative">
          <DCArtboard id="landing-a" label="A · Rank while you sleep (agent activity)" width={1200} height={820}>
            <LandingA/>
          </DCArtboard>
          <DCArtboard id="landing-b" label="B · Be the answer in ChatGPT (GEO-first)" width={1200} height={820}>
            <LandingB/>
          </DCArtboard>
          <DCArtboard id="landing-c" label="C · SEO on autopilot (playful, proof-first)" width={1200} height={820}>
            <LandingC/>
          </DCArtboard>
        </DCSection>

        <DCSection id="objective" title="Onboarding · step 1" subtitle="Objective picker — shapes the agent's entire playbook">
          <DCArtboard id="onb-objective" label="Step 1 · What's your objective?" width={1200} height={820}>
            <OnbObjective/>
          </DCArtboard>
        </DCSection>

        <DCSection id="onboarding" title="Onboarding flow directions" subtitle="Same system — three interaction models">
          <DCArtboard id="onb-a" label="A · Guided wizard (5 steps · familiar)" width={1200} height={820}>
            <OnbWizard/>
          </DCArtboard>
          <DCArtboard id="onb-b" label="B · Magical (3 steps · delight)" width={1200} height={820}>
            <OnbMagical/>
          </DCArtboard>
          <DCArtboard id="onb-c" label="C · Conversational (chat with the agent)" width={1200} height={820}>
            <OnbChat/>
          </DCArtboard>
        </DCSection>

        <DCSection id="notes" title="Notes">
          <DCArtboard id="system" label="Design system — at a glance" width={600} height={820}>
            <DesignSystemCard/>
          </DCArtboard>
          <DCArtboard id="todo" label="What's next" width={600} height={820}>
            <TodoCard/>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <Tweaks state={state} setState={setState}/>
    </React.Fragment>
  );
}

function DesignSystemCard() {
  return (
    <div style={{ padding: 36, background:'var(--bg)', height:'100%', overflow:'hidden' }}>
      <div className="t-eyebrow">Design system</div>
      <h2 className="t-h2" style={{ margin:'8px 0 24px' }}>Warm, editorial, agentic.</h2>

      <div className="t-eyebrow" style={{ marginBottom: 8 }}>Type</div>
      <div style={{ fontFamily:'var(--font-serif)', fontSize: 42, lineHeight: 1, letterSpacing:'-0.02em' }}>Instrument Serif</div>
      <div className="t-body-sm">— display & headings</div>
      <div style={{ marginTop: 10, fontFamily:'var(--font-sans)', fontSize: 17, fontWeight: 500 }}>Geist Sans</div>
      <div className="t-body-sm">— body & UI</div>
      <div style={{ marginTop: 8, fontFamily:'var(--font-mono)', fontSize: 13 }}>Geist Mono</div>
      <div className="t-body-sm">— eyebrows, data, chrome</div>

      <div className="divider" style={{ margin:'24px 0' }}/>

      <div className="t-eyebrow" style={{ marginBottom: 10 }}>Palette</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap: 8 }}>
        {[
          {c:'#141210', n:'Ink'},
          {c:'#FAF7F2', n:'Paper'},
          {c:'#FF5B2E', n:'Accent'},
          {c:'#D4F26A', n:'Lime'},
          {c:'#F8CF3E', n:'Gold'},
          {c:'#BDE0FF', n:'Sky'},
          {c:'#FFC9BE', n:'Rose'},
          {c:'#B8E8C9', n:'Mint'},
          {c:'#D6C8FF', n:'Violet'},
          {c:'#F1ECE2', n:'Sand'},
        ].map(s => (
          <div key={s.n}>
            <div style={{ height: 42, borderRadius: 8, background: s.c, border:'1px solid var(--line)' }}/>
            <div className="t-caption" style={{ fontSize: 10, marginTop: 4 }}>{s.n}</div>
          </div>
        ))}
      </div>

      <div className="divider" style={{ margin:'24px 0' }}/>

      <div className="t-eyebrow" style={{ marginBottom: 10 }}>Components</div>
      <div style={{ display:'flex', gap: 8, marginBottom: 10, flexWrap:'wrap' }}>
        <button className="btn accent">Primary</button>
        <button className="btn primary">Dark</button>
        <button className="btn">Default</button>
        <button className="btn sm">Small</button>
      </div>
      <div style={{ display:'flex', gap: 6, flexWrap:'wrap' }}>
        <span className="chip accent">Accent chip</span>
        <span className="chip lime">Lime chip</span>
        <span className="chip">Neutral</span>
        <span className="chip mono">mono · tag</span>
      </div>
    </div>
  );
}

function TodoCard() {
  const items = [
    { done: true,  t: 'Hi-fi design system (type, color, components)' },
    { done: true,  t: '3 landing page directions' },
    { done: true,  t: 'Objective picker (step 1)' },
    { done: true,  t: '3 onboarding flow directions' },
    { done: false, t: 'Remaining onboarding steps (site, plan, launch)' },
    { done: false, t: 'Dashboard (agent at work)' },
    { done: false, t: 'CMS / GSC integrations connect step' },
    { done: false, t: 'Pricing page' },
    { done: false, t: 'Mobile responsive variants' },
    { done: false, t: 'Auth (sign up / log in)' },
    { done: false, t: 'Empty states (pre-data)' },
  ];
  return (
    <div style={{ padding: 36, background:'var(--card)', height:'100%', overflow:'hidden' }}>
      <div className="t-eyebrow">Roadmap</div>
      <h2 className="t-h2" style={{ margin:'8px 0 20px' }}>What's next</h2>
      {items.map((x, i) => (
        <div key={i} style={{
          display:'flex', alignItems:'center', gap: 10,
          padding:'10px 0',
          borderBottom: i < items.length - 1 ? '1px solid var(--line)' : 'none',
        }}>
          <span style={{
            width: 18, height: 18, borderRadius:'50%',
            background: x.done ? 'var(--ink)' : 'transparent',
            border: x.done ? 'none' : '1.5px solid var(--line-2)',
            color:'#fff', fontSize: 10, fontWeight: 700,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>{x.done ? '✓' : ''}</span>
          <span style={{
            fontSize: 14,
            color: x.done ? 'var(--ink-3)' : 'var(--ink)',
            textDecoration: x.done ? 'line-through' : 'none',
          }}>{x.t}</span>
        </div>
      ))}
      <div style={{ marginTop: 24, padding: 16, background:'var(--accent-soft)', borderRadius: 12 }}>
        <div className="t-caption" style={{ color: 'var(--warn)' }}>NEXT UP</div>
        <div style={{ fontSize: 15, marginTop: 4, color:'var(--ink)' }}>
          Say the word and I'll design the dashboard — the "agent at work" view where everything pays off.
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
