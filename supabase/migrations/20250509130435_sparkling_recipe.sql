/*
  # Fix Night Shift Record Grouping and Display
  
  1. Changes:
    - Add working_week_start column to consistently group night shift records
    - Implement trigger to automatically populate working_week_start value
    - Fix display values for night shift check-in/check-out pairs
    - Update existing records to ensure all night shift pairs are properly linked
    
  2. Problem Solved:
    - Fixes "Missing" check-out issue in Approved Hours view
    - Ensures night shift check-outs (early morning) link to previous day's check-in
    - Properly preserves display times between database and UI
*/

-- Ensure the working_week_start column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'time_records' AND column_name = 'working_week_start'
  ) THEN
    ALTER TABLE time_records ADD COLUMN working_week_start date;
    
    -- Create index for working_week_start for performance
    CREATE INDEX idx_time_records_working_week ON time_records(employee_id, working_week_start, shift_type);
  END IF;
END $$;

-- Make sure we have a trigger function to set working_week_start
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
  ELSE
    -- For non-night shifts, working_week_start is always the current day
    NEW.working_week_start := NEW.timestamp::date;
  END IF;
  
  -- Ensure exact_hours is never NULL for either record
  IF NEW.status IN ('check_in', 'check_out') AND NEW.exact_hours IS NULL THEN
    -- Look for matching record to get exact_hours
    IF NEW.status = 'check_in' THEN
      DECLARE
        matching_check_out RECORD;
      BEGIN
        SELECT * INTO matching_check_out
        FROM time_records
        WHERE employee_id = NEW.employee_id
          AND status = 'check_out'
          AND timestamp::date = NEW.timestamp::date
          AND shift_type = NEW.shift_type
          AND exact_hours IS NOT NULL
        LIMIT 1;
        
        IF matching_check_out.id IS NOT NULL THEN
          NEW.exact_hours := matching_check_out.exact_hours;
        END IF;
      END;
    ELSIF NEW.status = 'check_out' THEN
      DECLARE
        matching_check_in RECORD;
      BEGIN
        SELECT * INTO matching_check_in
        FROM time_records
        WHERE employee_id = NEW.employee_id
          AND status = 'check_in'
          AND timestamp::date = 
            CASE 
              WHEN NEW.shift_type = 'night' AND EXTRACT(HOUR FROM NEW.timestamp) < 12 THEN
                (NEW.timestamp::date - INTERVAL '1 day')::date
              ELSE 
                NEW.timestamp::date
            END
          AND shift_type = NEW.shift_type
          AND exact_hours IS NOT NULL
        LIMIT 1;
        
        IF matching_check_in.id IS NOT NULL THEN
          NEW.exact_hours := matching_check_in.exact_hours;
        END IF;
      END;
    END IF;
  END IF;
  
  -- Set default values to prevent NULL entries
  NEW.is_late := COALESCE(NEW.is_late, FALSE);
  NEW.early_leave := COALESCE(NEW.early_leave, FALSE);
  NEW.deduction_minutes := COALESCE(NEW.deduction_minutes, 0);
  
  -- Format timestamps for display if missing
  IF NEW.display_check_in IS NULL AND NEW.status = 'check_in' THEN
    NEW.display_check_in := to_char(NEW.timestamp, 'HH24:MI');
  END IF;
  
  IF NEW.display_check_out IS NULL AND NEW.status = 'check_out' THEN
    NEW.display_check_out := to_char(NEW.timestamp, 'HH24:MI');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS tg_fix_night_shift_records ON time_records;
CREATE TRIGGER tg_fix_night_shift_records
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION fix_night_shift_records();

-- Update existing records with proper working_week_start for night shifts
UPDATE time_records
SET working_week_start = 
  CASE 
    WHEN shift_type = 'night' AND status = 'check_out' AND EXTRACT(HOUR FROM timestamp) < 12 THEN
      (timestamp::date - INTERVAL '1 day')::date
    ELSE
      timestamp::date
  END
WHERE working_week_start IS NULL OR (
  shift_type = 'night' 
  AND status = 'check_out' 
  AND EXTRACT(HOUR FROM timestamp) < 12
  AND working_week_start = timestamp::date
);

-- Fix display values for night shifts
DO $$
DECLARE
  fixed_count integer := 0;
BEGIN
  -- Identify check-in/check-out pairs for night shifts
  WITH night_shift_pairs AS (
    SELECT 
      c_in.id AS check_in_id,
      c_out.id AS check_out_id,
      c_in.timestamp AS check_in_timestamp,
      c_out.timestamp AS check_out_timestamp,
      c_in.display_check_in,
      c_out.display_check_out
    FROM 
      time_records c_in
      JOIN time_records c_out 
        ON c_in.employee_id = c_out.employee_id 
        AND c_in.status = 'check_in' 
        AND c_out.status = 'check_out'
        AND c_in.shift_type = 'night'
        AND c_out.shift_type = 'night'
        AND (
          -- Either working_week_start matches
          (c_in.working_week_start = c_out.working_week_start)
          -- OR check-out is early morning of next day
          OR (c_out.timestamp::date = (c_in.timestamp::date + INTERVAL '1 day')
              AND EXTRACT(HOUR FROM c_out.timestamp) < 12)
        )
  )
  -- Update both records to have consistent display values
  UPDATE time_records t
  SET 
    display_check_in = 
      COALESCE(
        CASE WHEN nsp.display_check_in = 'Missing' THEN to_char(nsp.check_in_timestamp, 'HH24:MI') 
        ELSE nsp.display_check_in END,
        t.display_check_in,
        to_char(CASE WHEN t.status = 'check_in' THEN t.timestamp ELSE nsp.check_in_timestamp END, 'HH24:MI')
      ),
    display_check_out = 
      COALESCE(
        CASE WHEN nsp.display_check_out = 'Missing' THEN to_char(nsp.check_out_timestamp, 'HH24:MI') 
        ELSE nsp.display_check_out END,
        t.display_check_out,
        to_char(CASE WHEN t.status = 'check_out' THEN t.timestamp ELSE nsp.check_out_timestamp END, 'HH24:MI')
      )
  FROM night_shift_pairs nsp
  WHERE 
    t.id IN (nsp.check_in_id, nsp.check_out_id)
    AND (t.display_check_in = 'Missing' OR t.display_check_out = 'Missing');

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % night shift records with missing display values', fixed_count;
END $$;

-- Fix exact_hours consistency between check-in and check-out pairs
WITH paired_records AS (
  SELECT 
    c_in.id AS check_in_id,
    c_out.id AS check_out_id,
    GREATEST(c_in.exact_hours, c_out.exact_hours) AS max_hours
  FROM 
    time_records c_in
    JOIN time_records c_out 
      ON c_in.employee_id = c_out.employee_id 
      AND c_in.status = 'check_in' 
      AND c_out.status = 'check_out'
      AND (
        -- Same day records (most shifts)
        (c_in.timestamp::date = c_out.timestamp::date)
        -- OR night shift spans days
        OR (c_in.shift_type = 'night' 
            AND c_out.timestamp::date = (c_in.timestamp::date + INTERVAL '1 day')
            AND EXTRACT(HOUR FROM c_out.timestamp) < 12)
      )
  WHERE 
    c_in.exact_hours IS NOT NULL 
    AND c_out.exact_hours IS NOT NULL
    AND c_in.exact_hours != c_out.exact_hours
)
UPDATE time_records t
SET exact_hours = pr.max_hours
FROM paired_records pr
WHERE t.id IN (pr.check_in_id, pr.check_out_id);

-- Apply working_week_start consistently to all relevant record types
DO $$
DECLARE
  fixed_count integer := 0;
BEGIN
  -- Update working_week_start for night shift check-ins to ensure they're linked to their check-outs
  UPDATE time_records t_in
  SET working_week_start = t_in.timestamp::date
  FROM time_records t_out
  WHERE 
    t_in.employee_id = t_out.employee_id
    AND t_in.status = 'check_in'
    AND t_out.status = 'check_out'
    AND t_in.shift_type = 'night'
    AND t_out.shift_type = 'night'
    AND t_out.timestamp::date = (t_in.timestamp::date + INTERVAL '1 day')
    AND EXTRACT(HOUR FROM t_out.timestamp) < 12
    AND (t_in.working_week_start IS NULL OR t_in.working_week_start != t_in.timestamp::date);
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % night shift check-in working_week_start values', fixed_count;
  
  -- Update working_week_start for night shift check-outs to link to their check-ins
  UPDATE time_records t_out
  SET working_week_start = t_in.timestamp::date
  FROM time_records t_in
  WHERE 
    t_out.employee_id = t_in.employee_id
    AND t_out.status = 'check_out'
    AND t_in.status = 'check_in'
    AND t_out.shift_type = 'night'
    AND t_in.shift_type = 'night'
    AND t_out.timestamp::date = (t_in.timestamp::date + INTERVAL '1 day')
    AND EXTRACT(HOUR FROM t_out.timestamp) < 12
    AND (t_out.working_week_start IS NULL OR t_out.working_week_start != t_in.timestamp::date);
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % night shift check-out working_week_start values', fixed_count;
END $$;

-- Final verification step
DO $$
DECLARE
  unpaired_night_checkouts integer;
BEGIN
  -- Check if any night shift checkouts don't have matching check-ins
  SELECT COUNT(*) INTO unpaired_night_checkouts
  FROM time_records t_out
  WHERE 
    t_out.shift_type = 'night'
    AND t_out.status = 'check_out'
    AND EXTRACT(HOUR FROM t_out.timestamp) < 12
    AND NOT EXISTS (
      SELECT 1 FROM time_records t_in
      WHERE 
        t_in.employee_id = t_out.employee_id
        AND t_in.status = 'check_in'
        AND t_in.shift_type = 'night'
        AND t_in.working_week_start = t_out.working_week_start
    );
    
  IF unpaired_night_checkouts > 0 THEN
    RAISE NOTICE 'Warning: Found % night shift check-outs without matching check-ins', unpaired_night_checkouts;
  ELSE
    RAISE NOTICE 'All night shift check-outs have matching check-ins';
  END IF;
END $$;