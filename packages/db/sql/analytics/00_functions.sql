-- B-17 operational analytics: shared helpers.
--
-- These files are the SINGLE definition of every operational metric. QuoteFlow's API reads the views
-- below; D&A reuses the same definitions at M6 (the Fabric mirror of this Postgres). They are
-- re-applied on every `pnpm db:migrate` (see src/migrate.ts), so editing a file is a deploy, not a
-- migration. Each view is `security_invoker`, so Postgres row-level security applies to whoever
-- queries it: the views never widen what a role may see.
--
-- Conventions
--   * Weeks start Monday, in US Central (Pretium HQ; CLAUDE.md "Time").
--   * Durations are seconds (float8). "active" time is wall-clock minus recorded customer holds
--     (CR-57); "elapsed" is wall-clock.
--   * Operational metrics from QuoteFlow; not yet D&A-certified.

-- Monday of the US Central week containing `ts`.
create or replace function analytics_week(ts timestamptz) returns date
language sql immutable parallel safe as
$$ select date_trunc('week', ts at time zone 'America/Chicago')::date $$;

-- Seconds a quote spent on recorded hold (quote_hold) inside [p_from, p_to]. A hold still open runs to p_to.
-- Hold intervals are one-at-a-time by construction (a held quote cannot be held again), so they are summed.
create or replace function analytics_held_seconds(p_quote uuid, p_from timestamptz, p_to timestamptz)
returns float8
language sql stable as
$$
  select coalesce(sum(greatest(
           extract(epoch from (least(coalesce(h.ended_at, p_to), p_to) - greatest(h.started_at, p_from))),
           0)), 0)::float8
  from quote_hold h
  where h.quote_id = p_quote and h.started_at < p_to and coalesce(h.ended_at, p_to) > p_from
$$;

comment on function analytics_week(timestamptz) is
  'Monday (US Central) of the week containing the timestamp. Used to bucket every weekly trend.';
comment on function analytics_held_seconds(uuid, timestamptz, timestamptz) is
  'Seconds the quote spent on recorded customer/internal hold (quote_hold) inside the window; an open hold runs to the window end. Cycle times subtract this (CR-57).';
