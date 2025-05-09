/*
  # Night Shift Working Week Fix
  
  1. Changes:
    - Add working_week_start column to correctly group night shifts that cross days
    - Automatically set night shift check-outs to associate with their check-in date
    - Fix data for existing night shift records
    
  2. Data Integrity:
    - Night shift check-outs that happen in the early morning will be properly grouped
    - Consistent reporting between Face ID Data and Approved Hours views
    - Reliable queries for dates that properly handle cross-day shifts
*/

-- Ensure the working_week_start column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'time_records' AND column_name = 'working_week_start'
  ) THEN
    ALTER TABLE time_records ADD COLUMN working_week_start date;
  END IF;
END $$;

-- Create index for working_week_start for performance
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_time_records_working_week'
  ) THEN
    CREATE INDEX idx_time_records_working_week ON time_records(employee_id, working_week_start, shift_type);
  END IF;
END $$;

-- Create function to ensure night shift records are properly marked with working_week_start
CREATE OR REPLACE FUNCTION fix_night_shift_records()
RETURNS TRIGGER AS $$
BEGIN
  -- For night shift records, set the working_week_start
  IF NEW.shift_type = 'night' THEN
    -- For check-outs in early morning (next day), set working_week_start to previous day
    IF NEW.status = 'check_out' AND EXTRACT(HOUR FROM NEW.timestamp) < 12 THEN
      NEW.working_week_start := (NEW.timestamp::date - INTERVAL '1 day')::date;
    ELSE
      -- For check-ins, set working_week_start to current day
      NEW.working_week_start := NEW.timestamp::date;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to apply fixes before insert
DROP TRIGGER IF EXISTS tg_fix_night_shift_records ON time_records;
CREATE TRIGGER tg_fix_night_shift_records
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION fix_night_shift_records();

-- Update existing records to set working_week_start for night shift check-outs
UPDATE time_records
SET working_week_start = (timestamp::date - INTERVAL '1 day')::date
WHERE shift_type = 'night' 
  AND status = 'check_out' 
  AND EXTRACT(HOUR FROM timestamp) < 12
  AND (working_week_start IS NULL OR working_week_start = timestamp::date);

-- Fix display values between check-in and check-out pairs
WITH night_shift_pairs AS (
  SELECT 
    c_in.id AS check_in_id,
    c_out.id AS check_out_id,
    c_in.employee_id,
    c_in.timestamp AS check_in_timestamp,
    c_out.timestamp AS check_out_timestamp,
    c_in.display_check_in,
    c_out.display_check_out,
    c_in.timestamp::date AS check_in_date
  FROM 
    time_records c_in
    JOIN time_records c_out 
      ON c_in.employee_id = c_out.employee_id 
      AND c_in.status = 'check_in' 
      AND c_out.status = 'check_out'
      AND c_in.shift_type = 'night'
      AND c_out.shift_type = 'night'
      AND c_out.timestamp::date = (c_in.timestamp::date + INTERVAL '1 day')
      AND EXTRACT(HOUR FROM c_in.timestamp) >= 20
      AND EXTRACT(HOUR FROM c_out.timestamp) < 12
)
UPDATE time_records t
SET 
  -- Ensure both records display the same check-in/check-out times
  display_check_in = COALESCE(nsp.display_check_in, to_char(nsp.check_in_timestamp, 'HH24:MI')),
  display_check_out = COALESCE(nsp.display_check_out, to_char(nsp.check_out_timestamp, 'HH24:MI')),
  
  -- For check-outs, set working_week_start to check-in date
  working_week_start = CASE
    WHEN t.id = nsp.check_out_id THEN nsp.check_in_date
    ELSE t.working_week_start
  END
FROM night_shift_pairs nsp
WHERE t.id IN (nsp.check_in_id, nsp.check_out_id);