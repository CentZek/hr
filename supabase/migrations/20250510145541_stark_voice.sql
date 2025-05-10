/*
  # Fix Night Shift Display and Duplicate Records
  
  1. Changes:
    - Fix duplicate manual entries for night shifts
    - Ensure consistent display of night shift records
    - Properly group night shifts that span across days
    - Fix day association for checkout times on the next day
    
  2. Data Integrity:
    - Add unique constraint to prevent duplicate manual entries
    - Clean up existing duplicate records
    - Standardize night shift display values (21:00-06:00)
*/

-- First, fix any duplicated night shift records
WITH duplicate_pairs AS (
  SELECT 
    id,
    employee_id,
    status,
    timestamp,
    ROW_NUMBER() OVER (
      PARTITION BY employee_id, shift_type, DATE(timestamp), status
      ORDER BY created_at DESC
    ) as row_num
  FROM time_records
  WHERE 
    shift_type = 'night'
    AND is_manual_entry = true
)
DELETE FROM time_records
WHERE id IN (
  SELECT id FROM duplicate_pairs
  WHERE row_num > 1
);

-- Ensure working_week_start is always set for both check-in and check-out of night shifts
UPDATE time_records t1
SET working_week_start = 
  CASE 
    WHEN t1.shift_type = 'night' AND t1.status = 'check_out' AND EXTRACT(HOUR FROM t1.timestamp) < 12 THEN
      (t1.timestamp::date - INTERVAL '1 day')::date
    ELSE
      t1.timestamp::date
  END
WHERE t1.working_week_start IS NULL OR (
  t1.shift_type = 'night' AND 
  t1.status = 'check_out' AND 
  EXTRACT(HOUR FROM t1.timestamp) < 12 AND
  t1.working_week_start != (t1.timestamp::date - INTERVAL '1 day')::date
);

-- Set standard display values for night shifts
UPDATE time_records
SET 
  display_check_in = CASE WHEN display_check_in IS NULL OR display_check_in NOT IN ('Missing', 'OFF-DAY') THEN '21:00' ELSE display_check_in END,
  display_check_out = CASE WHEN display_check_out IS NULL OR display_check_out NOT IN ('Missing', 'OFF-DAY') THEN '06:00' ELSE display_check_out END
WHERE 
  shift_type = 'night'
  AND is_manual_entry = true;

-- Update each night shift check-out to link to its check-in
WITH night_shift_pairs AS (
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
      AND EXTRACT(HOUR FROM c_out.timestamp) < 12
)
UPDATE time_records t_out
SET 
  working_week_start = ns.check_in_date,
  display_check_in = '21:00',
  display_check_out = '06:00'
FROM night_shift_pairs ns
WHERE 
  t_out.id = ns.check_out_id;

-- Ensure check-in records have their check-out display values
WITH night_shift_pairs AS (
  SELECT 
    c_in.id AS check_in_id,
    c_out.id AS check_out_id
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
UPDATE time_records t_in
SET 
  display_check_out = '06:00'
FROM night_shift_pairs ns
WHERE 
  t_in.id = ns.check_in_id
  AND (t_in.display_check_out IS NULL OR t_in.display_check_out = 'Missing');

-- Create a unique constraint to prevent duplicate manual entries
DO $$
BEGIN
  -- Check if the index already exists
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_time_records_unique_manual') THEN
    CREATE UNIQUE INDEX idx_time_records_unique_manual
    ON time_records (employee_id, shift_type, status, working_week_start)
    WHERE is_manual_entry = true;
  END IF;
END $$;

-- Create a function to handle employee-submitted shifts properly
CREATE OR REPLACE FUNCTION handle_employee_shift()
RETURNS TRIGGER AS $$
BEGIN
  -- For night shifts, ensure working_week_start is set properly
  IF NEW.shift_type = 'night' THEN
    -- Check-ins will have working_week_start as the current date
    IF NEW.status = 'check_in' THEN
      NEW.working_week_start := DATE(NEW.timestamp);
    -- For check-outs in early morning, working_week_start should be previous day
    ELSIF NEW.status = 'check_out' AND EXTRACT(HOUR FROM NEW.timestamp) < 12 THEN
      NEW.working_week_start := (DATE(NEW.timestamp) - INTERVAL '1 day')::date;
    ELSE
      NEW.working_week_start := DATE(NEW.timestamp);
    END IF;
    
    -- Set standard display values for night shifts
    NEW.display_check_in := '21:00';
    NEW.display_check_out := '06:00';
  ELSE
    -- For other shift types, working_week_start is the date of the timestamp
    NEW.working_week_start := DATE(NEW.timestamp);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to apply function to manual entries
DROP TRIGGER IF EXISTS trg_handle_employee_shift ON time_records;
CREATE TRIGGER trg_handle_employee_shift
BEFORE INSERT ON time_records
FOR EACH ROW
WHEN (NEW.is_manual_entry = true)
EXECUTE FUNCTION handle_employee_shift();