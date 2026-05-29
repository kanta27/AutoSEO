-- Blog agent — switch from weekly (168h) to daily (24h) cadence.
-- The Blog agent is now world-aware (news, competitor signals, industry
-- trends) per the signal-tools.ts introduction, so a daily run reliably
-- produces a fresh, timely article rather than rehashing the same evergreen
-- topic week after week.
--
-- Safe to re-run. The scheduler honours `schedule_hours` per agent — no
-- code change needed here.

update agents
  set schedule_hours = 24
  where key = 'blog';
