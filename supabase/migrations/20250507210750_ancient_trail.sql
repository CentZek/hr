/*
  # Fix Morning Shift Hours Calculation
  
  1. Critical Bug Fix
    - Ensure check-out records include all required fields from check-in
    - Fix missing is_late and deduction_minutes fields in check-out records
    - Ensure morning shift hours are properly calculated in the database
  
  2. Data Integrity Improvements
    - Trigger to ensure consistent field values between check-in and check-out
    - Automatically fix existing records with missing fields
    - Add validation to prevent future issues
*/

-- Create function to enforce field consistency between check-in and check-out
CREATE OR REPLACE FUNCTION fix_night_shift_records()
RETURNS TRIGGER AS $$
BEGIN
  -- Apply business rules to fix data
  IF NEW.status IN ('check_in', 'check_out') THEN
    -- Ensure is_late is never NULL for any record
    IF NEW.is_late IS NULL THEN
      NEW.is_late := FALSE;
    END IF;
    
    -- Ensure deduction_minutes is never NULL
    IF NEW.deduction_minutes IS NULL THEN
      NEW.deduction_minutes := 0;
    END IF;
    
    -- Ensure exact_hours is copied from check-in to check-out for the same shift
    IF NEW.status = 'check_out' THEN
      -- Look for matching check-in
      DECLARE
        matching_check_in record;
      BEGIN
        -- Find check-in from same employee on same day
        SELECT * INTO matching_check_in
        FROM time_records
        WHERE employee_id = NEW.employee_id
          AND status = 'check_in'
          AND timestamp::date = NEW.timestamp::date
        ORDER BY timestamp ASC
        LIMIT 1;
        
        -- Copy fields from check-in if found
        IF matching_check_in.id IS NOT NULL THEN
          -- Copy exact_hours to ensure consistency
          IF matching_check_in.exact_hours IS NOT NULL THEN
            NEW.exact_hours := matching_check_in.exact_hours;
          END IF;
          
          -- Copy deduction_minutes to ensure penalties are applied consistently
          IF matching_check_in.deduction_minutes IS NOT NULL THEN
            NEW.deduction_minutes := matching_check_in.deduction_minutes;
          END IF;
          
          -- Copy is_late to ensure status flags are consistent
          IF matching_check_in.is_late IS NOT NULL THEN
            NEW.is_late := matching_check_in.is_late;
          END IF;
          
          -- Copy shift_type to ensure consistency
          IF matching_check_in.shift_type IS NOT NULL THEN
            NEW.shift_type := matching_check_in.shift_type;
          END IF;
        END IF;
      END;
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

-- Create function to ensure morning shift consistency
CREATE OR REPLACE FUNCTION ensure_morning_shift_consistency()
RETURNS TRIGGER AS $$
DECLARE
  is_morning_time boolean;
BEGIN
  -- Check if this is in the morning shift time range (5:00 AM - 12:00 PM)
  is_morning_time := (EXTRACT(HOUR FROM NEW.timestamp) >= 5 AND 
                     EXTRACT(HOUR FROM NEW.timestamp) < 12 AND
                     EXTRACT(HOUR FROM NEW.timestamp) != 7 AND
                     EXTRACT(HOUR FROM NEW.timestamp) != 8);
  
  -- Apply rules for morning shift times
  IF is_morning_time AND NEW.shift_type IS NULL THEN
    NEW.shift_type := 'morning';
    RAISE NOTICE 'Set shift_type to morning based on timestamp %', NEW.timestamp;
  END IF;
  
  -- Ensure deduction_minutes and is_late are not NULL
  IF NEW.deduction_minutes IS NULL THEN
    NEW.deduction_minutes := 0;
  END IF;
  
  IF NEW.is_late IS NULL THEN
    NEW.is_late := FALSE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for ensuring morning shift consistency
DROP TRIGGER IF EXISTS trg_ensure_morning_shift_consistency ON time_records;
CREATE TRIGGER trg_ensure_morning_shift_consistency
BEFORE INSERT OR UPDATE ON time_records
FOR EACH ROW
EXECUTE FUNCTION ensure_morning_shift_consistency();

-- Update existing records to fix missing fields
DO $$
DECLARE
  fixed_count integer := 0;
BEGIN
  -- Fix check-out records missing is_late and deduction_minutes
  WITH check_in_data AS (
    SELECT 
      employee_id, 
      timestamp::date as record_date, 
      is_late, 
      deduction_minutes,
      shift_type,
      exact_hours
    FROM time_records
    WHERE status = 'check_in'
  )
  UPDATE time_records t
  SET 
    is_late = COALESCE(t.is_late, c.is_late, FALSE),
    deduction_minutes = COALESCE(t.deduction_minutes, c.deduction_minutes, 0),
    shift_type = COALESCE(t.shift_type, c.shift_type),
    exact_hours = COALESCE(t.exact_hours, c.exact_hours)
  FROM check_in_data c
  WHERE 
    t.employee_id = c.employee_id AND
    t.timestamp::date = c.record_date AND
    t.status = 'check_out' AND
    (t.is_late IS NULL OR t.deduction_minutes IS NULL);

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % check-out records with missing fields', fixed_count;
  
  -- Fix any morning shift records with wrong shift type
  UPDATE time_records
  SET shift_type = 'morning'
  WHERE 
    ((EXTRACT(HOUR FROM timestamp) = 4 AND EXTRACT(MINUTE FROM timestamp) >= 30) OR
     (EXTRACT(HOUR FROM timestamp) >= 5 AND EXTRACT(HOUR FROM timestamp) < 12)) AND
    EXTRACT(HOUR FROM timestamp) != 7 AND
    EXTRACT(HOUR FROM timestamp) != 8 AND
    shift_type IS DISTINCT FROM 'morning' AND
    shift_type != 'off_day' AND 
    status IN ('check_in', 'check_out');

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % records with incorrect morning shift type', fixed_count;
  
  -- Set NULL is_late to FALSE and NULL deduction_minutes to 0
  UPDATE time_records
  SET 
    is_late = FALSE,
    deduction_minutes = 0
  WHERE 
    is_late IS NULL OR
    deduction_minutes IS NULL;

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % records with NULL is_late or deduction_minutes', fixed_count;
END $$;