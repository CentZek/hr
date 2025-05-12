/*
  # Fix night shift timestamp handling

  1. Database Triggers
    - Add trigger to enforce correct working_week_start for night shift check-outs
    - Ensures all night shift records are properly grouped by shift date

  2. Data Fixes
    - Back-fill existing night shift check-out records with correct working_week_start
    - Ensure consistent grouping across all components
*/

-- Create trigger function to enforce correct working_week_start for night shifts
CREATE OR REPLACE FUNCTION fix_night_shift_records()
RETURNS TRIGGER AS $$
BEGIN
  -- For night shift check-outs before noon, set working_week_start to previous day
  IF NEW.shift_type = 'night' 
     AND NEW.status = 'check_out' 
     AND EXTRACT(hour FROM NEW.timestamp) < 12
  THEN
    NEW.working_week_start := (NEW.timestamp::date - INTERVAL '1 day')::date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to handle night shift records
DROP TRIGGER IF EXISTS tg_fix_night_shift_records ON time_records;
CREATE TRIGGER tg_fix_night_shift_records
  BEFORE INSERT ON time_records
  FOR EACH ROW
  EXECUTE FUNCTION fix_night_shift_records();

-- Back-fill existing night shift check-out records with correct working_week_start
UPDATE time_records
SET working_week_start = (timestamp::date - INTERVAL '1 day')::date
WHERE shift_type = 'night'
  AND status = 'check_out'
  AND EXTRACT(hour FROM timestamp) < 12
  AND (working_week_start IS NULL OR working_week_start <> (timestamp::date - INTERVAL '1 day')::date);

-- Ensure all night shift pairs have matching working_week_start values
WITH check_ins AS (
  SELECT 
    employee_id, 
    timestamp::date as check_in_date,
    working_week_start
  FROM time_records
  WHERE status = 'check_in'
    AND shift_type = 'night'
    AND working_week_start IS NOT NULL
)
UPDATE time_records t
SET working_week_start = c.working_week_start
FROM check_ins c
WHERE t.employee_id = c.employee_id
  AND t.status = 'check_out'
  AND t.shift_type = 'night'
  AND EXTRACT(hour FROM t.timestamp) < 12
  AND t.timestamp::date = c.check_in_date + interval '1 day'
  AND (t.working_week_start IS NULL OR t.working_week_start <> c.working_week_start);

-- Create index to improve record grouping performance
CREATE INDEX IF NOT EXISTS idx_time_records_working_week_combined 
ON time_records(employee_id, working_week_start, shift_type, status);