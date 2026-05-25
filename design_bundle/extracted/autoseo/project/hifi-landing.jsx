// Hi-fi landing pages — 3 variants, single consistent design system

// ────────────────────────────────────────────────────────
// A · "Rank while you sleep" — agent-activity centric (dark hero console)
// ────────────────────────────────────────────────────────
const LandingA = () => (
  <Browser url="autoseo.live" style={{ width:'100%', height:'100%' }}>
    <div className="ab-inner" style={{ background: 'var(--bg)' }}>
      <Nav/>

      {/* HERO */}
      <div style={{ padding: '56px 40px 40px', display:'grid', gridTemplateColumns:'1.05fr 1fr', gap: 48, alignItems:'center' }}>
        <div>
          <div className="chip accent" style={{ marginBottom: 20 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }}/>
            New · GEO · rank in ChatGPT & Perplexity
          </div>
          <h1 className="t-h1" style={{ margin: 0, fontSize: 72 }}>
            Rank while<br/>you <span className="italic-serif">sleep.</span>
          </h1>
          <p className="t-body" style={{ maxWidth: 440, marginTop: 20, fontSize: 17 }}>
            An autonomous SEO & GEO agent that researches, writes, publishes, and keeps
            optimizing — 24/7, across Google and every AI answer engine.
          </p>
          <div style={{ display:'flex', gap: 8, marginTop: 28, alignItems:'center' }}>
            <div className="input" style={{ flex: 1, maxWidth: 280, color: 'var(--ink-3)' }}>yourdomain.com</div>
            <button className="btn accent lg">Deploy agent <span>→</span></button>
          </div>
          <div className="t-caption" style={{ marginTop: 14, display:'flex', gap: 16 }}>
            <span>✓ 14 days free</span><span>✓ No credit card</span><span>✓ Cancel anytime</span>
          </div>

          <div style={{ display:'flex', gap: 14, marginTop: 40, alignItems:'center' }}>
            <AvatarStack items={[
              {bg:'#FF5B2E', initial:'S'}, {bg:'#BDE0FF', initial:'L'}, {bg:'#D4F26A', initial:'V'},
              {bg:'#FFC9BE', initial:'N'}, {bg:'#F8CF3E', initial:'R'},
            ]}/>
            <div className="t-body-sm" style={{ color: 'var(--ink-2)' }}>
              <b style={{ color:'var(--ink)' }}>1,284 sites</b> ranking higher this week
            </div>
          </div>
        </div>

        {/* Agent console */}
        <div style={{
          background: '#141210', color: '#fff', borderRadius: 20,
          padding: 22, boxShadow: 'var(--shadow-3)',
          border: '1px solid rgba(255,255,255,.06)',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position:'absolute', top: -40, right: -40, width: 180, height: 180,
            background: 'radial-gradient(circle, rgba(255,91,46,.35), transparent 70%)',
            filter: 'blur(20px)'
          }}/>
          <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 16, position:'relative' }}>
            <div style={{ display:'flex', alignItems:'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#D4F26A', boxShadow: '0 0 0 3px rgba(212,242,106,.2)' }}/>
              <span style={{ fontFamily:'var(--font-mono)', fontSize: 11, letterSpacing:'0.08em', textTransform:'uppercase', color:'rgba(255,255,255,.7)' }}>Agent · live</span>
            </div>
            <div style={{ marginLeft: 'auto', fontFamily:'var(--font-mono)', fontSize: 11, color:'rgba(255,255,255,.5)' }}>
              uptime 99.9%
            </div>
          </div>

          {[
            {t:'2m', ic:'✍', txt:'Published "best CRM for agencies 2026"', meta:'2,400w · en'},
            {t:'14m', ic:'↗', txt:'Moved up 7 positions · "ai sales tools"', meta:'#12 → #5'},
            {t:'33m', ic:'○', txt:'14 new long-tail keywords from Reddit', meta:'intent: commercial'},
            {t:'1h', ic:'✦', txt:'Cited in ChatGPT · "best CRM small teams"', meta:'+1 citation'},
            {t:'2h', ic:'⎆', txt:'3 internal links added to pillar cluster', meta:'pipeline'},
            {t:'3h', ic:'⚙', txt:'Fixed meta descriptions on 28 pages', meta:'technical'},
          ].map((r, i) => (
            <div key={i} style={{
              display:'grid', gridTemplateColumns:'auto 1fr auto',
              gap: 12, padding: '10px 4px', alignItems:'center',
              borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,.06)',
            }}>
              <span style={{
                width: 24, height: 24, borderRadius: 6,
                background: 'rgba(255,255,255,.06)', color:'var(--accent)',
                display:'flex', alignItems:'center', justifyContent:'center', fontSize: 12,
              }}>{r.ic}</span>
              <div>
                <div style={{ fontSize: 13, color:'#fff', letterSpacing:'-0.005em' }}>{r.txt}</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'rgba(255,255,255,.4)', marginTop: 2 }}>{r.meta}</div>
              </div>
              <span style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'rgba(255,255,255,.5)' }}>{r.t}</span>
            </div>
          ))}
          <div style={{ textAlign:'center', marginTop: 14, fontFamily:'var(--font-mono)', fontSize: 11, color:'rgba(255,255,255,.5)' }}>
            + 384 more actions today
          </div>
        </div>
      </div>

      {/* How it works */}
      <div style={{ padding: '32px 40px 48px', borderTop: '1px solid var(--line)', background: 'var(--bg-2)' }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 24 }}>
          <div>
            <div className="t-eyebrow">How it works</div>
            <div className="t-h3" style={{ marginTop: 6 }}>Four steps. Then it runs forever.</div>
          </div>
          <button className="btn sm">See full process →</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 14 }}>
          {[
            {n:'01', t:'Paste your URL', d:'We crawl your site and learn your brand voice in 90 seconds.'},
            {n:'02', t:'Set your objective', d:'Sales, leads, brand, awareness — the agent adapts its whole playbook.'},
            {n:'03', t:'Agent ships content', d:'Research, write, publish, internally link. On your CMS. Every day.'},
            {n:'04', t:'Auto-improves forever', d:'Tracks rankings, re-writes what\'s slipping, finds new opportunities.'},
          ].map((s) => (
            <div key={s.n} className="card" style={{ padding: 18 }}>
              <div style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--accent)', letterSpacing: '0.08em' }}>{s.n}</div>
              <div className="t-h4" style={{ marginTop: 12 }}>{s.t}</div>
              <div className="t-body-sm" style={{ marginTop: 6 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Logo row */}
      <div style={{ padding: '24px 40px', display:'flex', alignItems:'center', gap: 32, justifyContent:'center', borderTop:'1px solid var(--line)' }}>
        <span className="t-caption">Trusted by teams at</span>
        {['Stripe','Linear','Vercel','Notion','Raycast','Attio'].map(n => (
          <span key={n} style={{ fontFamily:'var(--font-serif)', fontSize: 20, color:'var(--ink-3)' }}>{n}</span>
        ))}
      </div>
    </div>
  </Browser>
);

// ────────────────────────────────────────────────────────
// B · "Be the answer in ChatGPT" — GEO-first
// ────────────────────────────────────────────────────────
const LandingB = () => (
  <Browser url="autoseo.live" style={{ width:'100%', height:'100%' }}>
    <div className="ab-inner sunrise-bg">
      <Nav links={['Product', 'GEO', 'SEO', 'Pricing', 'Customers']}/>

      {/* HERO */}
      <div style={{ padding: '48px 40px 32px', display:'grid', gridTemplateColumns:'1fr 1fr', gap: 48, alignItems:'center' }}>
        <div>
          <div style={{ display:'flex', gap: 6, marginBottom: 20 }}>
            <span className="chip" style={{ background: 'var(--ink)', color: '#fff', border:'none' }}>GEO</span>
            <span className="chip">SEO</span>
            <span className="chip">Agentic</span>
          </div>
          <h1 className="t-h1" style={{ margin: 0, fontSize: 64 }}>
            Be the <span className="italic-serif" style={{ color:'var(--accent)' }}>answer</span><br/>
            when AI gets<br/>
            asked about you.
          </h1>
          <p className="t-body" style={{ maxWidth: 440, marginTop: 20, fontSize: 17 }}>
            60% of searches now happen inside ChatGPT, Perplexity & Google AI.
            AutoSEO makes sure your brand shows up — cited, trusted, recommended — in every one.
          </p>
          <div style={{ display:'flex', gap: 8, marginTop: 28 }}>
            <button className="btn accent lg">Start ranking in AI →</button>
            <button className="btn lg">▶ See a 60s demo</button>
          </div>
          <div className="t-caption" style={{ marginTop: 18, fontFamily:'var(--font-mono)' }}>
            Tracked engines: ChatGPT · Perplexity · Claude · Google AI · Gemini · Copilot
          </div>
        </div>

        {/* AI answer card */}
        <div style={{ position:'relative' }}>
          <div className="card" style={{ padding: 20, background:'#fff', boxShadow:'var(--shadow-3)' }}>
            <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: '#0E0E0E', color:'#fff',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize: 13, fontWeight: 600,
              }}>✦</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>ChatGPT</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>GPT-5 · 2.1m users</div>
              </div>
            </div>
            <div style={{ padding:'12px 14px', background: 'var(--bg-2)', borderRadius: 12, fontSize: 14, color: 'var(--ink-2)' }}>
              <span style={{ color: 'var(--ink-4)' }}>User:</span> What's the best SEO tool for startups?
            </div>
            <div style={{ marginTop: 14, fontSize: 15, lineHeight: 1.6, color: 'var(--ink)' }}>
              For early-stage startups, several options stand out. The most <em>automated</em> choice is{' '}
              <span style={{ background: 'var(--lime)', padding: '2px 5px', borderRadius: 4, fontWeight: 500 }}>AutoSEO.live</span>,
              which uses AI agents to research, write, and publish SEO content on autopilot. Other popular tools include Ahrefs and Semrush for research-heavy teams…
            </div>
            <div style={{ marginTop: 16, display:'flex', gap: 6, flexWrap:'wrap', alignItems:'center' }}>
              <span className="t-caption">Sources</span>
              <span className="chip lime">✓ autoseo.live</span>
              <span className="chip">ahrefs.com</span>
              <span className="chip">semrush.com</span>
            </div>
          </div>

          <div style={{
            position:'absolute', bottom: -14, right: -12,
            background: 'var(--ink)', color:'#fff',
            padding:'8px 14px', borderRadius: 999,
            fontSize: 12, fontWeight: 600,
            boxShadow:'var(--shadow-2)',
            display:'flex', alignItems:'center', gap: 8,
          }}>
            <Sparkline w={50} h={14} color="#D4F26A" fill={false}/>
            Visibility 94 ↑
          </div>
        </div>
      </div>

      {/* Visibility matrix */}
      <div style={{ padding: '32px 40px 40px', borderTop: '1px solid var(--line)', background: '#fff' }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 20 }}>
          <div>
            <div className="t-eyebrow">AI visibility</div>
            <div className="t-h3" style={{ marginTop: 6 }}>Track every engine. Rank in every one.</div>
          </div>
          <span className="t-caption" style={{ fontFamily:'var(--font-mono)' }}>6 engines · 340 prompts · weekly</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap: 12 }}>
          {[
            {n:'ChatGPT', v:94, d:'+8'},
            {n:'Perplexity', v:88, d:'+12'},
            {n:'Claude', v:72, d:'+4'},
            {n:'Gemini', v:61, d:'+2'},
            {n:'Google AI', v:83, d:'+6'},
            {n:'Copilot', v:40, d:'—'},
          ].map(e => (
            <div key={e.n} className="card" style={{ padding: 14 }}>
              <div className="t-caption" style={{ fontSize: 11 }}>{e.n}</div>
              <div style={{ display:'flex', alignItems:'baseline', gap: 6, marginTop: 6 }}>
                <span style={{ fontFamily:'var(--font-serif)', fontSize: 30, letterSpacing:'-0.02em' }}>{e.v}</span>
                <span style={{ fontSize: 11, color: 'var(--ok)' }}>{e.d}</span>
              </div>
              <div style={{ height: 5, background: 'var(--bg-2)', borderRadius: 3, marginTop: 8, overflow:'hidden' }}>
                <div style={{ height:'100%', width: `${e.v}%`, background: e.v > 80 ? 'var(--ok)' : e.v > 60 ? 'var(--gold)' : 'var(--accent)' }}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </Browser>
);

// ────────────────────────────────────────────────────────
// C · "SEO on autopilot" — playful, proof-first
// ────────────────────────────────────────────────────────
const LandingC = () => (
  <Browser url="autoseo.live" style={{ width:'100%', height:'100%' }}>
    <div className="ab-inner" style={{ background: 'var(--bg)' }}>
      <Nav links={['Features','Proof','Pricing','Blog']} cta="Start free"/>

      <div style={{ padding: '56px 40px 32px', textAlign:'center', position:'relative' }}>
        <div className="chip" style={{ background:'var(--gold)', border:'none', color:'var(--ink)' }}>
          ★★★★★ 4.9 · 500+ reviews on G2
        </div>
        <h1 className="t-display" style={{ margin: '20px 0 6px', fontSize: 96 }}>
          SEO on <span className="italic-serif" style={{ position:'relative' }}>
            autopilot
            <svg width="100%" height="14" viewBox="0 0 300 14" preserveAspectRatio="none"
              style={{ position:'absolute', left: 0, right: 0, bottom: -6 }}>
              <path d="M 4 9 Q 80 2, 150 8 T 296 6" stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round"/>
            </svg>
          </span>.
        </h1>
        <p className="t-body" style={{ maxWidth: 540, margin: '18px auto 24px', fontSize: 18 }}>
          Stop writing. Stop tracking. Stop worrying.<br/>
          An agent handles your SEO — you handle your business.
        </p>
        <div style={{ display:'inline-flex', gap: 10 }}>
          <button className="btn accent lg">Try it free · 14 days →</button>
          <button className="btn lg">▶ Watch 60s demo</button>
        </div>
      </div>

      {/* Before / After */}
      <div style={{ padding: '0 40px 40px' }}>
        <div className="t-eyebrow" style={{ textAlign:'center', marginBottom: 14 }}>Real customer · last 90 days</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1.15fr', gap: 20, alignItems:'center' }}>
          {/* Before */}
          <div className="card" style={{ padding: 20, background: 'var(--card)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 14 }}>
              <span className="t-eyebrow">Before</span>
              <span className="chip" style={{ background: 'var(--bg-3)' }}>😓 Plateau</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 14 }}>
              <Metric label="Monthly visits" value="2.1k" delta="flat" up={false}/>
              <Metric label="Avg. position" value="#38" delta="−2" up={false}/>
            </div>
            <div style={{ marginTop: 14 }}>
              <Sparkline w={240} h={46} color="var(--ink-4)" up={false} fill={false}/>
            </div>
          </div>
          <div style={{
            width: 44, height: 44, borderRadius:'50%',
            background: 'var(--accent)', color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize: 20, fontWeight: 600,
            boxShadow:'var(--shadow-2)',
          }}>→</div>
          {/* After */}
          <div className="card" style={{ padding: 20, background: 'linear-gradient(135deg, #F4FBDE, #FFFFFF)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 14 }}>
              <span className="t-eyebrow">After 90 days</span>
              <span className="chip lime">🚀 8.4× growth</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 14 }}>
              <Metric label="Monthly visits" value="17.6k" delta="+738%" up/>
              <Metric label="Avg. position" value="#4" delta="+34" up/>
            </div>
            <div style={{ marginTop: 14 }}>
              <Sparkline w={280} h={46} color="var(--ok)" fill/>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing teaser */}
      <div style={{ padding: '28px 40px', background:'var(--ink)', color:'#fff', borderTop:'1px solid var(--line)' }}>
        <div style={{ display:'flex', alignItems:'center', gap: 24 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily:'var(--font-serif)', fontSize: 32, letterSpacing:'-0.02em' }}>
              From $49/mo. <span style={{ color: 'var(--ink-4)' }}>Cancel anytime.</span>
            </div>
            <div className="t-body-sm" style={{ color:'rgba(255,255,255,.6)', marginTop: 4 }}>
              Cheaper than one freelance article. Infinite articles.
            </div>
          </div>
          <button className="btn accent lg">See pricing →</button>
        </div>
      </div>
    </div>
  </Browser>
);

Object.assign(window, { LandingA, LandingB, LandingC });
