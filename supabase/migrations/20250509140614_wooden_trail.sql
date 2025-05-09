/*
  # Fix Night Shift Checkouts in the Approved Hours View
  
  1. Critical Bug Fix
    - Fix night shift check-outs not appearing in the Approved Hours view
    - Ensure proper date association for night shifts that cross day boundaries
    - Add working_week_start field to help with night shift reporting
    
  2. Data Updates
    - Update existing records to correctly set working_week_start
    - Fix display values between check-in and check-out pairs
    - Create database functions to handle new records correctly
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
  ELSE
    -- For non-night shifts, working_week_start is always the current day
    NEW.working_week_start := NEW.timestamp::date;
  END IF;

  -- Set default values for display fields if they're NULL
  IF NEW.display_check_in IS NULL AND NEW.status = 'check_in' THEN
    NEW.display_check_in := to_char(NEW.timestamp, 'HH24:MI');
  END IF;
  
  IF NEW.display_check_out IS NULL AND NEW.status = 'check_out' THEN
    NEW.display_check_out := to_char(NEW.timestamp, 'HH24:MI');
  END IF;
  
  -- Ensure is_late and deduction_minutes are never NULL
  NEW.is_late := COALESCE(NEW.is_late, FALSE);
  NEW.deduction_minutes := COALESCE(NEW.deduction_minutes, 0);
  NEW.early_leave := COALESCE(NEW.early_leave, FALSE);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to apply fixes before insert
DROP TRIGGER IF EXISTS tg_fix_night_shift_records ON time_records;
CREATE TRIGGER tg_fix_night_shift_records
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION fix_night_shift_records();

-- Update existing records to properly set working_week_start for night shifts
UPDATE time_records
SET working_week_start = 
  CASE 
    WHEN shift_type = 'night' AND status = 'check_out' AND EXTRACT(HOUR FROM timestamp) < 12 THEN
      (timestamp::date - INTERVAL '1 day')::date
    ELSE
      timestamp::date
  END
WHERE working_week_start IS NULL;

-- Fix display values for night shifts
DO $$
DECLARE
  fixed_count integer := 0;
BEGIN
  -- Update check-in records to include check-out display values
  WITH night_shift_pairs AS (
    SELECT 
      c_in.id AS check_in_id,
      c_out.id AS check_out_id,
      c_in.employee_id,
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
        AND c_out.timestamp::date = (c_in.timestamp::date + INTERVAL '1 day')
        AND EXTRACT(HOUR FROM c_out.timestamp) < 12
  )
  UPDATE time_records t
  SET 
    working_week_start = 
      CASE WHEN t.status = 'check_in' THEN t.timestamp::date
           WHEN t.status = 'check_out' THEN nsp.check_in_timestamp::date
      END,
      
    -- For check-ins, set display_check_out from matching check-out
    display_check_out = 
      CASE WHEN t.status = 'check_in' AND t.display_check_out IS NULL THEN 
        COALESCE(nsp.display_check_out, to_char(nsp.check_out_timestamp, 'HH24:MI'))
      ELSE t.display_check_out
      END,
      
    -- For check-outs, set display_check_in from matching check-in
    display_check_in = 
      CASE WHEN t.status = 'check_out' AND t.display_check_in IS NULL THEN 
        COALESCE(nsp.display_check_in, to_char(nsp.check_in_timestamp, 'HH24:MI'))
      ELSE t.display_check_in
      END
  FROM night_shift_pairs nsp
  WHERE t.id IN (nsp.check_in_id, nsp.check_out_id);
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % night shift display values', fixed_count;
END $$;

-- Create index for working_week_start to improve query performance
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_time_records_working_week'
  ) THEN
    CREATE INDEX idx_time_records_working_week ON time_records(employee_id, working_week_start, shift_type);
  END IF;
END $$;

-- Ensure exact_hours values are consistent between check-in and check-out pairs
DO $$
DECLARE
  fixed_count integer := 0;
BEGIN
  -- Update check-out records to match check-in exact_hours for night shifts
  WITH night_shift_pairs AS (
    SELECT 
      c_in.id AS check_in_id,
      c_out.id AS check_out_id,
      c_in.exact_hours AS check_in_hours,
      c_out.exact_hours AS check_out_hours
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
    WHERE 
      c_in.exact_hours IS NOT NULL 
      AND c_out.exact_hours IS NOT NULL
      AND c_in.exact_hours != c_out.exact_hours
  )
  UPDATE time_records t
  SET exact_hours = 
    CASE 
      WHEN nsp.check_in_hours IS NOT NULL AND nsp.check_out_hours IS NOT NULL 
      THEN GREATEST(nsp.check_in_hours, nsp.check_out_hours)
      WHEN nsp.check_in_hours IS NOT NULL THEN nsp.check_in_hours
      WHEN nsp.check_out_hours IS NOT NULL THEN nsp.check_out_hours
      ELSE t.exact_hours
    END
  FROM night_shift_pairs nsp
  WHERE t.id IN (nsp.check_in_id, nsp.check_out_id)
    AND (
      (t.id = nsp.check_in_id AND t.exact_hours != nsp.check_in_hours) OR
      (t.id = nsp.check_out_id AND t.exact_hours != nsp.check_out_hours)
    );
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % night shift records with inconsistent exact_hours', fixed_count;
END $$;

-- Final verification query to check for night shifts with missing check-outs
DO $$
DECLARE
  unpaired_night_checkouts integer;
  unpaired_night_checkins integer;
BEGIN
  -- Count night shift check-ins without matching check-outs
  SELECT COUNT(*) INTO unpaired_night_checkins
  FROM time_records t_in
  WHERE 
    t_in.shift_type = 'night'
    AND t_in.status = 'check_in'
    AND NOT EXISTS (
      SELECT 1 FROM time_records t_out
      WHERE 
        t_out.employee_id = t_in.employee_id
        AND t_out.status = 'check_out'
        AND t_out.shift_type = 'night'
        AND (
          t_out.working_week_start = t_in.working_week_start OR
          (t_out.timestamp::date = (t_in.timestamp::date + INTERVAL '1 day') AND EXTRACT(HOUR FROM t_out.timestamp) < 12)
        )
    );
    
  -- Count night shift check-outs without matching check-ins
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
        AND (
          t_in.working_week_start = t_out.working_week_start OR
          (t_in.timestamp::date = (t_out.timestamp::date - INTERVAL '1 day') AND EXTRACT(HOUR FROM t_in.timestamp) >= 20)
        )
    );

  RAISE NOTICE 'Unpaired night shift check-ins: %', unpaired_night_checkins;
  RAISE NOTICE 'Unpaired night shift check-outs: %', unpaired_night_checkouts;
END $$;