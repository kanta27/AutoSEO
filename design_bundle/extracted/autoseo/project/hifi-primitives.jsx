// High-fidelity primitives for AutoSEO.live

// ────────────────────────────────────────────────────────
// Logo mark
// ────────────────────────────────────────────────────────
const Logo = ({ size = 22, color = 'var(--ink)' }) => (
  <div style={{ display:'inline-flex', alignItems:'center', gap: 8 }}>
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2"/>
      <path d="M7 14 Q 12 6 17 14" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <circle cx="12" cy="14" r="1.8" fill={color}/>
    </svg>
    <span style={{
      fontFamily: 'var(--font-serif)',
      fontSize: size * 0.95,
      letterSpacing: '-0.01em',
      color,
    }}>
      AutoSEO<span style={{ color: 'var(--accent)' }}>.</span>live
    </span>
  </div>
);

// ────────────────────────────────────────────────────────
// Browser chrome — clean, minimal
// ────────────────────────────────────────────────────────
const Browser = ({ url = 'autoseo.live', children, style, dark = false }) => (
  <div style={{
    border: '1px solid var(--line-2)',
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: 'var(--shadow-3)',
    display: 'flex', flexDirection: 'column',
    background: dark ? '#141210' : 'var(--bg)',
    ...style
  }}>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px',
      background: dark ? '#1d1a17' : '#F1ECE2',
      borderBottom: `1px solid ${dark ? 'rgba(255,255,255,.08)' : 'var(--line)'}`,
    }}>
      <div style={{ display:'flex', gap: 6 }}>
        {['#FF5F57','#FEBC2E','#28C840'].map(c => (
          <div key={c} style={{ width: 11, height: 11, borderRadius:'50%', background: c }}/>
        ))}
      </div>
      <div style={{
        flex: 1, height: 24,
        borderRadius: 6,
        background: dark ? 'rgba(255,255,255,.05)' : 'var(--card)',
        border: `1px solid ${dark ? 'rgba(255,255,255,.08)' : 'var(--line)'}`,
        display:'flex', alignItems:'center', padding: '0 10px', gap: 6,
        fontFamily: 'var(--font-mono)', fontSize: 11, color: dark ? 'rgba(255,255,255,.6)' : 'var(--ink-3)'
      }}>
        <span style={{ fontSize: 10 }}>🔒</span>{url}
      </div>
    </div>
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>{children}</div>
  </div>
);

// ────────────────────────────────────────────────────────
// Nav — consistent across landing variants
// ────────────────────────────────────────────────────────
const Nav = ({ variant = 'light', links = ['Product', 'GEO', 'Pricing', 'Customers', 'Changelog'], cta = 'Start free', secondary = 'Log in' }) => {
  const dark = variant === 'dark';
  return (
    <div style={{
      display:'flex', alignItems:'center',
      padding:'18px 40px',
      borderBottom: `1px solid ${dark ? 'rgba(255,255,255,.08)' : 'var(--line)'}`,
      color: dark ? '#fff' : 'var(--ink)',
      background: dark ? 'transparent' : 'transparent',
    }}>
      <Logo color={dark ? '#fff' : 'var(--ink)'}/>
      <div style={{ flex: 1, display:'flex', justifyContent:'center', gap: 28 }}>
        {links.map(l => (
          <span key={l} style={{
            fontSize: 14, fontWeight: 500, letterSpacing: '-0.005em',
            color: dark ? 'rgba(255,255,255,.78)' : 'var(--ink-2)',
            cursor: 'pointer'
          }}>{l}</span>
        ))}
      </div>
      <div style={{ display:'flex', gap: 10, alignItems:'center' }}>
        <button className="btn ghost sm" style={{ color: dark ? '#fff' : 'var(--ink)' }}>{secondary}</button>
        <button className="btn accent sm">{cta} <span style={{ fontSize: 11 }}>→</span></button>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────
// Live chart (for metric cards)
// ────────────────────────────────────────────────────────
const Sparkline = ({ w = 160, h = 40, color = 'var(--ok)', up = true, fill = true }) => {
  const pts = up
    ? [[0,30],[20,28],[40,24],[60,22],[80,15],[100,12],[120,8],[140,10],[160,4]]
    : [[0,10],[20,14],[40,12],[60,18],[80,22],[100,20],[120,26],[140,24],[160,30]];
  const d = pts.map((p,i) => `${i===0?'M':'L'} ${p[0]} ${p[1]}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display:'block' }}>
      {fill && <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={color} opacity="0.12"/>}
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="3" fill={color}/>
    </svg>
  );
};

// ────────────────────────────────────────────────────────
// Avatar stack
// ────────────────────────────────────────────────────────
const Avatar = ({ size = 28, bg, initial, style }) => (
  <div style={{
    width: size, height: size, borderRadius: '50%',
    background: bg || '#E8E1D2',
    border: '2px solid var(--bg)',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontFamily: 'var(--font-sans)', fontSize: size*0.38, fontWeight: 600, color: 'var(--ink)',
    ...style
  }}>{initial}</div>
);

const AvatarStack = ({ items }) => (
  <div style={{ display:'flex' }}>
    {items.map((a, i) => (
      <Avatar key={i} size={30} bg={a.bg} initial={a.initial} style={{ marginLeft: i === 0 ? 0 : -9 }}/>
    ))}
  </div>
);

// ────────────────────────────────────────────────────────
// Step indicator (consistent w/ hi-fi)
// ────────────────────────────────────────────────────────
const Steps = ({ n, current, labels }) => (
  <div style={{ display:'flex', alignItems:'center', gap: 0 }}>
    {Array.from({ length: n }).map((_, i) => (
      <React.Fragment key={i}>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 6 }}>
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: i < current ? 'var(--ink)' : (i === current ? 'var(--accent)' : 'transparent'),
            border: i === current ? 'none' : (i < current ? 'none' : '1.5px solid var(--line-2)'),
            color: i === current ? '#fff' : (i < current ? '#fff' : 'var(--ink-3)'),
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize: 11, fontWeight: 600,
          }}>{i < current ? '✓' : i + 1}</div>
          {labels && labels[i] && (
            <div style={{
              fontSize: 11, fontWeight: 500,
              color: i === current ? 'var(--ink)' : 'var(--ink-3)',
              fontFamily: 'var(--font-mono)', letterSpacing: '0.02em',
            }}>{labels[i]}</div>
          )}
        </div>
        {i < n - 1 && (
          <div style={{
            width: labels ? 48 : 36, height: 1.5,
            background: i < current ? 'var(--ink)' : 'var(--line-2)',
            margin: labels ? '0 2px 18px' : '0 6px',
          }}/>
        )}
      </React.Fragment>
    ))}
  </div>
);

// ────────────────────────────────────────────────────────
// Metric / KPI tile
// ────────────────────────────────────────────────────────
const Metric = ({ label, value, delta, up = true, style }) => (
  <div style={style}>
    <div className="t-caption" style={{ fontFamily:'var(--font-mono)', letterSpacing: '0.08em', textTransform:'uppercase', fontSize: 10 }}>{label}</div>
    <div style={{ display:'flex', alignItems:'baseline', gap: 6, marginTop: 4 }}>
      <span style={{ fontFamily:'var(--font-serif)', fontSize: 32, letterSpacing: '-0.02em' }}>{value}</span>
      {delta && (
        <span style={{ fontSize: 12, color: up ? 'var(--ok)' : 'var(--warn)', fontWeight: 600 }}>
          {up ? '↑' : '↓'} {delta}
        </span>
      )}
    </div>
  </div>
);

// ────────────────────────────────────────────────────────
// Generic section tag
// ────────────────────────────────────────────────────────
const Section = ({ children, style }) => (
  <div style={{ padding: '64px 40px', ...style }}>{children}</div>
);

Object.assign(window, { Logo, Browser, Nav, Sparkline, Avatar, AvatarStack, Steps, Metric, Section });
