// Hi-fi onboarding — objective picker + 3 flow variants, unified design system

const OnbShell = ({ url = 'app.autoseo.live/onboarding', children }) => (
  <Browser url={url} style={{ width:'100%', height:'100%' }}>
    <div className="ab-inner" style={{ background:'var(--bg)' }}>{children}</div>
  </Browser>
);

const OnbHeader = ({ step, total = 5, labels }) => (
  <div style={{
    display:'flex', alignItems:'center',
    padding:'16px 32px',
    borderBottom: '1px solid var(--line)',
    background: 'var(--card)',
  }}>
    <Logo size={20}/>
    <div style={{ flex:1, display:'flex', justifyContent:'center' }}>
      <Steps n={total} current={step} labels={labels}/>
    </div>
    <div style={{ display:'flex', gap: 12, alignItems:'center' }}>
      <span className="t-caption">Autosaved</span>
      <button className="btn sm ghost">Save & exit</button>
    </div>
  </div>
);

const OnbFooter = ({ primary = 'Continue', secondary, hint }) => (
  <div style={{
    position: 'absolute', bottom: 0, left: 0, right: 0,
    display:'flex', justifyContent:'space-between', alignItems:'center',
    padding:'16px 32px',
    borderTop: '1px solid var(--line)',
    background: 'var(--card)',
  }}>
    <button className="btn sm">{secondary || '← Back'}</button>
    {hint && <div className="t-caption">{hint}</div>}
    <button className="btn accent">{primary} →</button>
  </div>
);

// ────────────────────────────────────────────────────────
// Objective picker — the strategic "why"
// ────────────────────────────────────────────────────────
const OBJECTIVES = [
  { id:'sales',     ic:'$', t:'Drive sales',        s:'Convert intent searches into signups & revenue.', kpi:'Signups from organic',      bg:'var(--mint)', accent:'#138A4A',
    plan:['Bottom-funnel keywords','Comparison & "alternative to" pages','Demo & pricing CTAs','Conversion tracking (GSC + Stripe)']},
  { id:'leads',     ic:'@', t:'Generate leads',     s:'Capture emails & book meetings from search.',     kpi:'MQLs · form submits',        bg:'var(--sky)',  accent:'#1E5FA0',
    plan:['Mid-funnel how-to content','Lead-magnet landing pages','Newsletter CTAs everywhere','Form conversion tracking']},
  { id:'brand',     ic:'★', t:'Build brand',        s:'Be the name people recognize in our category.',   kpi:'Branded search volume',      bg:'var(--gold)', accent:'#8A6B0E',
    plan:['Thought-leadership posts','Signature POVs & frameworks','GEO: be cited by ChatGPT & Perplexity','Co-citation tracking']},
  { id:'awareness', ic:'◎', t:'Grow awareness',     s:'Maximize eyeballs — top-of-funnel traffic.',      kpi:'Monthly organic sessions',   bg:'var(--rose)', accent:'#B03E1A',
    plan:['High-volume informational queries','Listicles & definitive guides','Internal linking to hubs','Broad keyword sweep']},
  { id:'hire',      ic:'◈', t:'Attract talent',     s:'Rank for careers, culture & engineering posts.',  kpi:'Applicants from organic',    bg:'var(--violet)', accent:'#5038A6',
    plan:['Engineering blog posts','Culture & values content','Rank for "working at X"','Careers-page SEO']},
  { id:'fund',      ic:'▲', t:'Investor signal',    s:'Look undeniable to the market & VCs.',            kpi:'Inbound · press & investors', bg:'var(--lime)', accent:'#4A6B0F',
    plan:['Market-defining content','Category-creation POVs','Proof-heavy case studies','PR-adjacent posts']},
];

const OnbObjective = () => {
  const sel = 'brand';
  const selObj = OBJECTIVES.find(o => o.id === sel);
  return (
    <OnbShell>
      <OnbHeader step={0} total={5} labels={['Objective','Site','Voice','Plan','Launch']}/>

      <div style={{ padding: '32px 40px 24px' }}>
        <div style={{ maxWidth: 620 }}>
          <div className="t-eyebrow">Step 1 · the strategic why</div>
          <h1 className="t-h2" style={{ margin: '10px 0 8px' }}>
            What's your <span className="italic-serif" style={{ color:'var(--accent)' }}>objective</span>?
          </h1>
          <p className="t-body" style={{ maxWidth: 580 }}>
            SEO & GEO are tactics, not goals. Pick the outcome you care about —
            the agent tunes its whole playbook (content mix, CTAs, metrics) around it.
          </p>
        </div>
      </div>

      {/* Grid */}
      <div style={{ padding:'0 40px', display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 14 }}>
        {OBJECTIVES.map(o => {
          const isSel = o.id === sel;
          return (
            <div key={o.id} className="card" style={{
              padding: 18,
              background: isSel ? o.bg : 'var(--card)',
              borderColor: isSel ? o.accent : 'var(--line)',
              borderWidth: isSel ? 1.5 : 1,
              boxShadow: isSel ? '0 8px 24px -8px rgba(0,0,0,.18)' : 'var(--shadow-1)',
              position:'relative', cursor:'pointer',
            }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: isSel ? 'rgba(255,255,255,.6)' : 'var(--bg-2)',
                  color: isSel ? o.accent : 'var(--ink)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontFamily:'var(--font-serif)', fontSize: 18,
                }}>{o.ic}</div>
                {isSel && (
                  <div style={{
                    width: 22, height: 22, borderRadius:'50%',
                    background:'var(--ink)', color:'#fff',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize: 11,
                  }}>✓</div>
                )}
              </div>
              <div className="t-h4" style={{ marginTop: 14 }}>{o.t}</div>
              <div className="t-body-sm" style={{ marginTop: 4, color: isSel ? 'rgba(20,18,16,.7)' : 'var(--ink-3)' }}>{o.s}</div>
              <div style={{
                marginTop: 14, paddingTop: 12,
                borderTop: `1px solid ${isSel ? 'rgba(20,18,16,.12)' : 'var(--line)'}`,
                fontFamily:'var(--font-mono)', fontSize: 11,
                color: isSel ? o.accent : 'var(--ink-3)',
                letterSpacing:'0.02em',
              }}>KPI → {o.kpi}</div>
            </div>
          );
        })}
      </div>

      {/* Adaptive plan preview */}
      <div style={{ padding:'20px 40px 0' }}>
        <div className="card" style={{ padding: 18, background: 'var(--card-2)' }}>
          <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 12 }}>
            <span className="chip accent">Agent</span>
            <span className="t-body-sm" style={{ color: 'var(--ink-2)' }}>
              Here's how I'll approach <b style={{ color: 'var(--ink)' }}>"{selObj.t.toLowerCase()}"</b> — auto-tuned based on your pick:
            </span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 12 }}>
            {selObj.plan.map((p, i) => (
              <div key={i} style={{
                display:'flex', alignItems:'flex-start', gap: 8,
                padding:'10px 12px',
                background:'var(--card)', borderRadius: 10,
                border:'1px solid var(--line)',
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius:'50%',
                  background:'var(--lime)', color:'#2a4513',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
                }}>✓</span>
                <span style={{ fontSize: 13, lineHeight: 1.4 }}>{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <OnbFooter primary="Continue to brand voice" hint="Tip: pick one. You can add secondary goals later."/>
    </OnbShell>
  );
};

// ────────────────────────────────────────────────────────
// A · Guided wizard (step 3: brand voice + preview)
// ────────────────────────────────────────────────────────
const OnbWizard = () => (
  <OnbShell>
    <OnbHeader step={2} total={5} labels={['Objective','Site','Voice','Plan','Launch']}/>

    <div style={{ padding: '28px 40px', display:'grid', gridTemplateColumns:'1fr 1.1fr', gap: 36 }}>
      <div>
        <div className="t-eyebrow">Step 3 of 5</div>
        <h1 className="t-h2" style={{ margin: '8px 0 6px' }}>Tune your brand voice</h1>
        <p className="t-body" style={{ maxWidth: 440 }}>The agent writes like you. We've drafted a voice profile from your site — tweak anything.</p>

        <div style={{ marginTop: 24 }}>
          <label className="t-eyebrow">Voice profile</label>
          <div className="card" style={{ padding: 14, marginTop: 8, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)', background:'var(--card)' }}>
            "Direct, a bit cheeky. We write for busy founders who've seen it all.
            No fluff, no superlatives. <span style={{ background:'var(--lime)', padding:'1px 4px', borderRadius: 3 }}>One strong opinion per post.</span>"
            <div style={{ marginTop: 10, display:'flex', gap: 6 }}>
              <span className="chip mono">tone: direct</span>
              <span className="chip mono">reading level: 8</span>
              <span className="chip mono">pov: we</span>
            </div>
          </div>
          <div className="t-caption" style={{ marginTop: 8, display:'flex', gap: 6, alignItems:'center' }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--accent)' }}/>
            Drafted from 12 pages of yoursite.com
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <label className="t-eyebrow">Target audience</label>
          <div style={{ display:'flex', gap: 6, flexWrap:'wrap', marginTop: 8 }}>
            <span className="chip" style={{ background:'var(--accent-soft)', color:'var(--warn)', border:'none' }}>Founders ✕</span>
            <span className="chip" style={{ background:'var(--accent-soft)', color:'var(--warn)', border:'none' }}>Growth leads ✕</span>
            <span className="chip" style={{ background:'var(--accent-soft)', color:'var(--warn)', border:'none' }}>Marketing ops ✕</span>
            <span className="chip" style={{ cursor:'pointer' }}>+ Add</span>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <label className="t-eyebrow">Competitors (optional)</label>
          <div style={{ display:'flex', gap: 6, marginTop: 8, flexWrap:'wrap' }}>
            <span className="chip">ahrefs.com ✕</span>
            <span className="chip">semrush.com ✕</span>
            <span className="chip">surferseo.com ✕</span>
            <span className="chip" style={{ cursor:'pointer' }}>+ Add</span>
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div>
        <div className="t-eyebrow" style={{ marginBottom: 8 }}>Live preview · sample post</div>
        <div className="card" style={{ padding: 22, background:'var(--card)' }}>
          <div className="t-mono" style={{ color: 'var(--ink-4)', fontSize: 11 }}>blog.yoursite.com · 4 min read</div>
          <div style={{ fontFamily:'var(--font-serif)', fontSize: 28, letterSpacing:'-0.02em', lineHeight: 1.1, marginTop: 8 }}>
            Why your CRM is probably lying to you
          </div>
          <div className="divider" style={{ margin:'14px 0' }}/>
          {[1, 0.92, 0.78, 1, 0.65].map((w, i) => (
            <div key={i} style={{ height: 6, width:`${w*100}%`, borderRadius: 3, background:'var(--bg-3)', marginBottom: 8 }}/>
          ))}
          <div style={{ display:'flex', gap: 6, marginTop: 14 }}>
            <span className="chip">CRM</span>
            <span className="chip">Sales ops</span>
          </div>
        </div>
        <div className="t-caption" style={{ marginTop: 10, color:'var(--accent)', display:'flex', alignItems:'center', gap: 6 }}>
          <span style={{
            display:'inline-block', width: 10, height: 10, borderRadius:'50%',
            background:'var(--accent)', animation: 'pulse 1.5s infinite',
          }}/>
          Regenerating preview as you type…
        </div>
      </div>
    </div>

    <OnbFooter primary="Continue to plan" hint="Takes ~4 minutes · no credit card yet"/>
  </OnbShell>
);

// ────────────────────────────────────────────────────────
// B · Magical (3 steps, "does this sound like you?")
// ────────────────────────────────────────────────────────
const OnbMagical = () => (
  <OnbShell>
    <OnbHeader step={1} total={3} labels={['Site','Confirm','Launch']}/>

    <div style={{ padding: '40px 40px 32px', textAlign:'center', position:'relative' }}>
      <div className="chip accent" style={{ marginBottom: 16 }}>
        <span style={{ width: 6, height: 6, borderRadius:'50%', background:'var(--accent)' }}/>
        Agent read 23 pages in 47s
      </div>
      <h1 className="t-h1" style={{ margin: '8px 0 10px', fontSize: 56 }}>
        Does this sound like <span className="italic-serif">you</span>?
      </h1>
      <p className="t-body" style={{ maxWidth: 500, margin: '0 auto', fontSize: 17 }}>
        We drafted your brand profile, topics, and publishing plan. Tweak anything — or hit accept and go.
      </p>
    </div>

    <div style={{ padding:'0 40px', display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 14 }}>
      <div className="card" style={{ padding: 20, background: 'var(--card)' }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background:'var(--bg-2)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-serif)', fontSize: 16 }}>★</span>
          <div className="t-eyebrow">Brand</div>
        </div>
        <div style={{ fontFamily:'var(--font-serif)', fontSize: 20, letterSpacing:'-0.015em', marginTop: 10, lineHeight: 1.2 }}>
          Acme — a dev-first CRM for technical founders.
        </div>
        <div className="t-body-sm" style={{ marginTop: 8 }}>Direct, no-fluff tone. One opinion per post.</div>
        <button className="btn sm" style={{ marginTop: 14 }}>Edit ✎</button>
      </div>

      <div className="card" style={{ padding: 20, background: 'linear-gradient(135deg, var(--gold), #FFE899)', border:'none' }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background:'rgba(255,255,255,.5)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-serif)', fontSize: 16 }}>◎</span>
          <div className="t-eyebrow">Topics · 47 clusters</div>
        </div>
        <div style={{ display:'flex', gap: 6, flexWrap:'wrap', marginTop: 14 }}>
          {['CRM for devs','Sales automation','Pipeline hygiene','Revenue ops','API-first CRM'].map(t => (
            <span key={t} className="chip" style={{ background:'rgba(255,255,255,.7)', border:'none' }}>{t}</span>
          ))}
          <span className="chip" style={{ background:'transparent', border:'1px dashed rgba(20,18,16,.3)' }}>+ 42 more</span>
        </div>
      </div>

      <div className="card" style={{ padding: 20, background: 'var(--card)' }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background:'var(--bg-2)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-serif)', fontSize: 16 }}>✍</span>
          <div className="t-eyebrow">Cadence</div>
        </div>
        <div style={{ fontFamily:'var(--font-serif)', fontSize: 28, letterSpacing:'-0.02em', marginTop: 10 }}>3 posts / week</div>
        <div className="t-body-sm" style={{ marginTop: 4 }}>+ weekly GEO refresh. Auto-publish to Webflow.</div>
        <div style={{ display:'flex', gap: 6, marginTop: 14 }}>
          <span className="chip mono">webflow</span>
          <span className="chip mono">GSC</span>
        </div>
      </div>
    </div>

    <div style={{ padding:'28px 40px 0', display:'flex', justifyContent:'center', gap: 10 }}>
      <button className="btn lg">✎ Edit details</button>
      <button className="btn accent lg">Looks right — deploy agent 🚀</button>
    </div>
    <div className="t-caption" style={{ textAlign:'center', marginTop: 10 }}>
      Agent starts working in ~10 seconds · first post in ~6 minutes
    </div>
  </OnbShell>
);

// ────────────────────────────────────────────────────────
// C · Conversational
// ────────────────────────────────────────────────────────
const OnbChat = () => (
  <OnbShell>
    {/* Custom header for chat */}
    <div style={{
      display:'flex', alignItems:'center', gap: 12,
      padding:'14px 32px',
      borderBottom:'1px solid var(--line)', background:'var(--card)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background:'var(--ink)', color:'#fff',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:'var(--font-serif)', fontSize: 18,
        position:'relative',
      }}>
        ✦
        <span style={{
          position:'absolute', bottom: -2, right: -2,
          width: 10, height: 10, borderRadius:'50%',
          background:'var(--ok)', border:'2px solid var(--card)',
        }}/>
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Your SEO agent</div>
        <div className="t-caption" style={{ fontFamily:'var(--font-mono)', color:'var(--ok)' }}>● online · learning about you</div>
      </div>
      <div style={{ marginLeft: 'auto', display:'flex', alignItems:'center', gap: 10 }}>
        <div style={{ display:'flex', gap: 4 }}>
          {[1,1,0,0].map((v, i) => (
            <div key={i} style={{ width: 22, height: 4, borderRadius: 2, background: v ? 'var(--ink)' : 'var(--line-2)' }}/>
          ))}
        </div>
        <span className="t-caption" style={{ fontFamily:'var(--font-mono)' }}>2 / 4</span>
      </div>
    </div>

    {/* Chat body */}
    <div style={{ padding:'24px 32px', display:'flex', flexDirection:'column', gap: 14 }}>
      {/* Bot */}
      <div style={{ display:'flex', gap: 10, maxWidth: '78%' }}>
        <Avatar size={30} bg="var(--ink)" initial="✦" style={{ color:'#fff' }}/>
        <div className="card" style={{ padding: '12px 14px', fontSize: 14, lineHeight: 1.55, color:'var(--ink-2)' }}>
          Hey 👋 I read <b style={{ color:'var(--ink)' }}>acme.com</b> — got a great feel for it. What are you trying to rank for? (Topics, not keywords — I'll figure those out.)
        </div>
      </div>

      {/* User */}
      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <div style={{
          padding:'12px 14px', background:'var(--accent)', color:'#fff',
          borderRadius:'18px 18px 6px 18px', maxWidth:'66%',
          fontSize: 14, lineHeight: 1.5,
        }}>
          CRM for technical founders. Sales automation. Pipeline stuff.
        </div>
      </div>

      {/* Bot with plan */}
      <div style={{ display:'flex', gap: 10, maxWidth: '84%' }}>
        <Avatar size={30} bg="var(--ink)" initial="✦" style={{ color:'#fff' }}/>
        <div style={{ flex: 1 }}>
          <div className="card" style={{ padding: '12px 14px', fontSize: 14, lineHeight: 1.55, color:'var(--ink-2)' }}>
            Got it. I pulled 47 topic clusters and checked where your competitors rank. Here's my first-month plan — want to tweak anything?
          </div>
          <div className="card" style={{ padding: 16, marginTop: 10, background:'var(--card-2)' }}>
            <div className="t-eyebrow" style={{ marginBottom: 10 }}>Month 1 · proposed plan</div>
            {[
              {t:'12 pillar posts',          s:'CRM, sales automation, pipeline',    n:'pillar'},
              {t:'24 supporting articles',   s:'Long-tail · Reddit-sourced',         n:'supporting'},
              {t:'GEO refresh weekly',       s:'Cited by ChatGPT & Perplexity',      n:'geo'},
              {t:'Auto-publish: Webflow',    s:'Via your connected account',         n:'distribution'},
            ].map((x, i, arr) => (
              <div key={i} style={{
                display:'grid', gridTemplateColumns:'auto 1fr auto',
                gap: 10, padding:'10px 0', alignItems:'center',
                borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
              }}>
                <span style={{
                  width: 20, height: 20, borderRadius:'50%',
                  background:'var(--lime)', color:'#2a4513',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize: 10, fontWeight: 700,
                }}>✓</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{x.t}</div>
                  <div className="t-caption">{x.s}</div>
                </div>
                <span className="chip sm" style={{ fontSize: 11, padding: '2px 8px' }}>edit</span>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap: 6, marginTop: 10, flexWrap:'wrap' }}>
            <button className="btn sm accent">👍 Looks great</button>
            <button className="btn sm">🐢 Slower pace</button>
            <button className="btn sm">🎯 Different topics</button>
            <button className="btn sm">🧠 More GEO</button>
          </div>
        </div>
      </div>

      {/* Typing */}
      <div style={{ display:'flex', gap: 10 }}>
        <Avatar size={30} bg="var(--ink)" initial="✦" style={{ color:'#fff' }}/>
        <div className="card" style={{ padding: '10px 14px', display:'flex', gap: 4 }}>
          {[0,1,2].map(i => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius:'50%', background:'var(--ink-3)',
              opacity: 0.3 + (i * 0.3),
            }}/>
          ))}
        </div>
      </div>
    </div>

    {/* Composer */}
    <div style={{
      position:'absolute', bottom: 0, left: 0, right: 0,
      padding:'14px 32px',
      borderTop:'1px solid var(--line)', background:'var(--card)',
      display:'flex', gap: 10, alignItems:'center',
    }}>
      <div className="input" style={{ flex: 1, color:'var(--ink-4)' }}>
        Type a reply, or pick a button above…
      </div>
      <button className="btn accent">Send ↵</button>
    </div>
  </OnbShell>
);

Object.assign(window, { OnbObjective, OnbWizard, OnbMagical, OnbChat });
