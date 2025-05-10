/*
  # Fix Night Shift Display and Record Duplication Issues
  
  1. Changes:
    - Prevent duplicate display of night shift records in manual records view
    - Ensure night shifts properly span days in the Approved Hours view
    - Add unique constraints to prevent duplicate inserts
    
  2. Data Integrity:
    - Use working_week_start consistently for night shift grouping
    - Keep check-in and check-out paired correctly even across day boundaries
    - Add indexes to improve query performance
*/

-- First, fix any duplicated night shift records
WITH duplicate_pairs AS (
  SELECT 
    id,
    employee_id,
    status,
    timestamp,
    ROW_NUMBER() OVER (
      PARTITION BY employee_id, shift_type, working_week_start, status
      ORDER BY created_at DESC
    ) as row_num
  FROM time_records
  WHERE 
    shift_type = 'night'
    AND is_manual_entry = true
    AND working_week_start IS NOT NULL
)
DELETE FROM time_records
WHERE id IN (
  SELECT id FROM duplicate_pairs
  WHERE row_num > 1
);

-- Ensure working_week_start is always set for both check-in and check-out of night shifts
UPDATE time_records t1
SET working_week_start = (
  SELECT t2.working_week_start 
  FROM time_records t2
  WHERE 
    t2.employee_id = t1.employee_id
    AND t2.shift_type = 'night'
    AND t2.status = 'check_in'
    AND t2.timestamp::date = t1.timestamp::date - INTERVAL '1 day'
    AND t1.status = 'check_out'
    AND t1.shift_type = 'night'
    AND EXTRACT(HOUR FROM t1.timestamp) < 12
)
WHERE 
  t1.shift_type = 'night'
  AND t1.status = 'check_out'
  AND EXTRACT(HOUR FROM t1.timestamp) < 12
  AND t1.working_week_start IS NULL;

-- Set standard display values for night shifts
UPDATE time_records
SET 
  display_check_in = '21:00',
  display_check_out = '06:00'
WHERE 
  shift_type = 'night'
  AND (display_check_in IS NULL OR display_check_out IS NULL OR display_check_in != '21:00' OR display_check_out != '06:00')
  AND is_manual_entry = true;

-- Create a function to handle employee shift submissions properly
CREATE OR REPLACE FUNCTION handle_employee_shift()
RETURNS TRIGGER AS $$
DECLARE
  existing_record_id uuid;
BEGIN
  -- First check if we already have this combination (to prevent duplicates)
  SELECT id INTO existing_record_id
  FROM time_records
  WHERE 
    employee_id = NEW.employee_id
    AND shift_type = NEW.shift_type
    AND status = NEW.status
    AND DATE(timestamp) = DATE(NEW.timestamp);
    
  -- If record already exists, don't insert a duplicate
  IF existing_record_id IS NOT NULL THEN
    -- Update existing record instead
    UPDATE time_records
    SET 
      display_check_in = COALESCE(NEW.display_check_in, display_check_in),
      display_check_out = COALESCE(NEW.display_check_out, display_check_out)
    WHERE id = existing_record_id;
    
    -- Skip the insertion
    RETURN NULL;
  END IF;
  
  -- For night shifts, ensure both records use the same working_week_start
  IF NEW.shift_type = 'night' THEN
    -- For check-outs in early morning, set working_week_start to previous day
    IF NEW.status = 'check_out' AND EXTRACT(HOUR FROM NEW.timestamp) < 12 THEN
      NEW.working_week_start := (NEW.timestamp::date - INTERVAL '1 day')::date;
    ELSE
      -- For check-ins, set working_week_start to current day
      NEW.working_week_start := NEW.timestamp::date;
    END IF;
    
    -- Standard display times for night shifts
    NEW.display_check_in := '21:00';
    NEW.display_check_out := '06:00';
  ELSE
    -- For non-night shifts, working_week_start is the current day
    NEW.working_week_start := NEW.timestamp::date;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to handle employee shift submissions
DROP TRIGGER IF EXISTS trg_handle_employee_shift ON time_records;
CREATE TRIGGER trg_handle_employee_shift
BEFORE INSERT ON time_records
FOR EACH ROW
WHEN (NEW.is_manual_entry = true)
EXECUTE FUNCTION handle_employee_shift();

-- Add unique index to prevent duplicate manual records
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_records_unique_manual
ON time_records (employee_id, shift_type, status, working_week_start)
WHERE is_manual_entry = true;

-- Update existing check-out records to ensure they link with their check-ins
WITH paired_night_shifts AS (
  SELECT 
    c_in.id AS check_in_id,
    c_out.id AS check_out_id,
    c_in.employee_id,
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
UPDATE time_records t_out
SET 
  working_week_start = ns.check_in_date,
  display_check_in = '21:00',
  display_check_out = '06:00'
FROM paired_night_shifts ns
WHERE 
  t_out.id = ns.check_out_id
  AND (t_out.working_week_start IS NULL OR t_out.working_week_start != ns.check_in_date);

-- Create an index on working_week_start for better performance
CREATE INDEX IF NOT EXISTS idx_time_records_working_week_combined 
ON time_records(employee_id, working_week_start, shift_type, status);

-- Add the corrected_status field if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'time_records' AND column_name = 'corrected_status'
  ) THEN
    ALTER TABLE time_records ADD COLUMN corrected_status text;
  END IF;
END $$;