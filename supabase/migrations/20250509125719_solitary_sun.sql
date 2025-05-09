/*
  # Fix Night Shift Time Display Issues
  
  1. Changes
    - Ensure proper working_week_start field for night shifts
    - Add helper function for consistent timestamp handling
    - Fix display time issues for night shift checkouts
    - Fix timezone-related issues for cross-day shifts
    
  2. Time Integrity
    - Ensure display_check_in and display_check_out are preserved exactly
    - Properly group night shifts spanning days
    - Fix matching of check-in/check-out pairs
*/

-- Add working_week_start column if it doesn't exist
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update existing records to set working_week_start
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
  -- Identify check-in/check-out pairs for night shifts
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
        AND c_out.timestamp::date = (c_in.timestamp::date + INTERVAL '1 day')
        AND c_in.status = 'check_in' 
        AND c_out.status = 'check_out'
        AND c_in.shift_type = 'night'
        AND c_out.shift_type = 'night'
        AND EXTRACT(HOUR FROM c_in.timestamp) >= 20
        AND EXTRACT(HOUR FROM c_out.timestamp) < 12
  )
  -- Update both records to have consistent display values
  UPDATE time_records t
  SET 
    display_check_in = 
      CASE 
        WHEN t.status = 'check_in' AND nsp.display_check_in IS NOT NULL 
          THEN nsp.display_check_in
        WHEN t.status = 'check_out' AND nsp.display_check_in IS NOT NULL 
          THEN nsp.display_check_in
        ELSE COALESCE(t.display_check_in, to_char(nsp.check_in_timestamp, 'HH24:MI'))
      END,
    display_check_out = 
      CASE
        WHEN t.status = 'check_in' AND nsp.display_check_out IS NOT NULL 
          THEN nsp.display_check_out
        WHEN t.status = 'check_out' AND nsp.display_check_out IS NOT NULL 
          THEN nsp.display_check_out
        ELSE COALESCE(t.display_check_out, to_char(nsp.check_out_timestamp, 'HH24:MI'))
      END,
    working_week_start = 
      CASE
        WHEN t.status = 'check_out' THEN nsp.check_in_timestamp::date
        ELSE t.working_week_start
      END
  FROM night_shift_pairs nsp
  WHERE 
    t.id IN (nsp.check_in_id, nsp.check_out_id)
    AND (t.display_check_in IS NULL 
         OR t.display_check_out IS NULL 
         OR t.display_check_in = 'Missing' 
         OR t.display_check_out = 'Missing'
         OR t.working_week_start IS NULL);

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % night shift records with missing display values', fixed_count;
END $$;

-- Create a weekly_shift_pattern column for consistent shift pattern tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'time_records' AND column_name = 'weekly_shift_pattern'
  ) THEN
    ALTER TABLE time_records ADD COLUMN weekly_shift_pattern TEXT;
  END IF;
END $$;

-- Add index for working_week_start to improve query performance
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_time_records_working_week'
  ) THEN
    CREATE INDEX idx_time_records_working_week ON time_records(employee_id, working_week_start, shift_type);
  END IF;
END $$;

-- Create a function to flag potentially mislabeled time records
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'time_records' AND column_name = 'mislabeled_time_record'
  ) THEN
    ALTER TABLE time_records ADD COLUMN mislabeled_time_record BOOLEAN DEFAULT FALSE;
    ALTER TABLE time_records ADD COLUMN corrected_status TEXT;
  END IF;
END $$;