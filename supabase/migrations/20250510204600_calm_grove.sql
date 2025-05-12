/*
  # Fix Night Shift Display in Approved Hours View
  
  1. Changes:
    - Fix night shift records to correctly link check-in and check-out across days
    - Ensure consistent display values for all shift types
    - Create database triggers to standardize display values
    
  2. Data Integrity:
    - Update working_week_start to properly group night shifts
    - Set standard display times (05:00-14:00 for morning, 13:00-22:00 for evening, 21:00-06:00 for night)
    - Fix existing records with incorrect or missing display values
*/

-- Fix inconsistent display values for night shifts
UPDATE time_records
SET 
  display_check_in = '21:00',
  display_check_out = '06:00'
WHERE 
  shift_type = 'night'
  AND is_manual_entry = true
  AND (
    display_check_in IS NULL OR
    display_check_in = 'Missing' OR
    display_check_out IS NULL OR
    display_check_out = 'Missing' OR
    display_check_in != '21:00' OR
    display_check_out != '06:00'
  );

-- Link night shift check-outs to their check-in day using working_week_start
UPDATE time_records t_out
SET working_week_start = t_in.timestamp::date
FROM time_records t_in
WHERE 
  t_out.employee_id = t_in.employee_id
  AND t_in.status = 'check_in'
  AND t_out.status = 'check_out'
  AND t_in.shift_type = 'night'
  AND t_out.shift_type = 'night'
  AND t_out.timestamp::date = (t_in.timestamp::date + interval '1 day')
  AND extract(hour from t_out.timestamp) < 12
  AND (
    t_out.working_week_start IS NULL OR
    t_out.working_week_start != t_in.timestamp::date
  );

-- Fix missing display values for all shift types
UPDATE time_records
SET 
  display_check_in = 
    CASE 
      WHEN shift_type = 'morning' THEN '05:00'
      WHEN shift_type = 'evening' THEN '13:00' 
      WHEN shift_type = 'night' THEN '21:00'
      WHEN shift_type = 'canteen' AND extract(hour from timestamp) = 7 THEN '07:00'
      WHEN shift_type = 'canteen' THEN '08:00'
      ELSE display_check_in
    END,
  display_check_out = 
    CASE 
      WHEN shift_type = 'morning' THEN '14:00'
      WHEN shift_type = 'evening' THEN '22:00'
      WHEN shift_type = 'night' THEN '06:00'
      WHEN shift_type = 'canteen' AND extract(hour from timestamp) = 7 THEN '16:00'
      WHEN shift_type = 'canteen' THEN '17:00'
      ELSE display_check_out
    END
WHERE 
  (
    display_check_in IS NULL OR
    display_check_in = 'Missing' OR
    display_check_out IS NULL OR
    display_check_out = 'Missing'
  )
  AND status IN ('check_in', 'check_out');

-- Create or replace function to ensure consistent display values
CREATE OR REPLACE FUNCTION standardize_manual_shift_times()
RETURNS TRIGGER AS $$
BEGIN
  -- Set standard display values based on shift type
  IF NEW.shift_type IS NOT NULL THEN
    -- For check-in records, set both display_check_in and display_check_out
    NEW.display_check_in := 
      CASE 
        WHEN NEW.shift_type = 'morning' THEN '05:00'
        WHEN NEW.shift_type = 'evening' THEN '13:00'
        WHEN NEW.shift_type = 'night' THEN '21:00'
        WHEN NEW.shift_type = 'canteen' AND extract(hour from NEW.timestamp) = 7 THEN '07:00'
        WHEN NEW.shift_type = 'canteen' THEN '08:00'
        ELSE to_char(NEW.timestamp, 'HH24:MI')
      END;
      
    NEW.display_check_out := 
      CASE 
        WHEN NEW.shift_type = 'morning' THEN '14:00'
        WHEN NEW.shift_type = 'evening' THEN '22:00'
        WHEN NEW.shift_type = 'night' THEN '06:00'
        WHEN NEW.shift_type = 'canteen' AND extract(hour from NEW.timestamp) = 7 THEN '16:00'
        WHEN NEW.shift_type = 'canteen' THEN '17:00'
        ELSE to_char(NEW.timestamp, 'HH24:MI')
      END;
  END IF;
  
  -- Working week start for night shifts
  IF NEW.shift_type = 'night' THEN
    -- For night shift check-outs in early morning, set working_week_start to previous day
    IF NEW.status = 'check_out' AND extract(hour from NEW.timestamp) < 12 THEN
      NEW.working_week_start := (NEW.timestamp::date - interval '1 day')::date;
    ELSE
      -- For check-ins, set working_week_start to current day
      NEW.working_week_start := NEW.timestamp::date;
    END IF;
  ELSE
    -- For other shift types, working_week_start is the date of the timestamp
    NEW.working_week_start := NEW.timestamp::date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for standardizing manual shift times
DROP TRIGGER IF EXISTS trg_standardize_manual_shift_times ON time_records;
CREATE TRIGGER trg_standardize_manual_shift_times
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION standardize_manual_shift_times();

-- Make sure we have the proper indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_time_records_working_week_combined 
ON time_records(employee_id, working_week_start, shift_type, status);

-- Add any necessary column comments
COMMENT ON COLUMN time_records.display_check_in IS 'Display value for check-in time (e.g. "Missing")';
COMMENT ON COLUMN time_records.display_check_out IS 'Display value for check-out time (e.g. "Missing")';
COMMENT ON COLUMN time_records.working_week_start IS 'For night shifts, allows grouping check-out with previous day check-in';