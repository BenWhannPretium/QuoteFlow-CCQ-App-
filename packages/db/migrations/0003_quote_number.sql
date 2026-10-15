-- B-03: CCQ quote numbers, CCQ-YYYY-NNNNN, one gap-free sequence per calendar year (US Central).
-- Concurrency: the counter row is locked with SELECT ... FOR UPDATE, so parallel callers queue
-- and each gets the next value. A rolled-back caller's number is reused (no gaps).
-- SECURITY DEFINER: ccq_app may call it but has no direct access to quote_number_counter.
CREATE OR REPLACE FUNCTION next_quote_number(p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_year integer := extract(year FROM p_at AT TIME ZONE 'America/Chicago')::integer;
  v_next integer;
BEGIN
  INSERT INTO quote_number_counter (id, year, last_value)
  VALUES (gen_random_uuid(), v_year, 0)
  ON CONFLICT (year) DO NOTHING;

  SELECT last_value + 1 INTO v_next
  FROM quote_number_counter
  WHERE year = v_year
  FOR UPDATE;

  IF v_next > 99999 THEN
    RAISE EXCEPTION 'quote number sequence exhausted for %', v_year USING ERRCODE = 'numeric_value_out_of_range';
  END IF;

  UPDATE quote_number_counter SET last_value = v_next, updated_at = now() WHERE year = v_year;

  RETURN 'CCQ-' || v_year::text || '-' || lpad(v_next::text, 5, '0');
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION next_quote_number(timestamptz) FROM PUBLIC;
