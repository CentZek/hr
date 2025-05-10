/*
  # Fix Night Shift Grouping

  1. Changes
    - Adds a trigger function to automatically fix night shift check-out working_week_start values
    - Creates a trigger to apply this fix on insert or update
    - Updates existing records to ensure consistent grouping
    
  2. Fix
    - Ensures all night shift check-outs properly reference the previous day (when they checked in)
    - Prevents split records when viewing night shifts across day boundaries
*/

-- Create trigger function to fix working_week_start for night shifts
CREATE OR REPLACE FUNCTION fix_night_working_week_start()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shift_type = 'night'
  AND NEW.status = 'check_out'
  AND EXTRACT(hour FROM NEW.timestamp) < 12
  THEN
    NEW.working_week_start := (NEW.timestamp::date - INTERVAL '1 day')::date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to apply the fix on insert or update
DROP TRIGGER IF EXISTS trg_fix_night_start ON time_records;
CREATE TRIGGER trg_fix_night_start
BEFORE INSERT OR UPDATE ON time_records
FOR EACH ROW
EXECUTE FUNCTION fix_night_working_week_start();

-- Fix existing night shift check-out records
UPDATE time_records
SET working_week_start = (timestamp::date - INTERVAL '1 day')::date
WHERE shift_type = 'night'
AND status = 'check_out'
AND EXTRACT(hour FROM timestamp) < 12
AND (working_week_start IS NULL OR working_week_start <> (timestamp::date - INTERVAL '1 day')::date);