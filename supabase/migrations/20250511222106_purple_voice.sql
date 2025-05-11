/*
  # Add Night Shift Support to Employee Shifts Table
  
  1. Changes:
    - Add working_week_start column to employee_shifts table
    - Create trigger to automatically set working_week_start for night shifts
    - Update existing night shift records to have correct working_week_start
    - Fix relationship between employee_shifts and time_records
    
  2. Issue Resolution:
    - Enables proper grouping of night shifts that span across days
    - Ensures consistent date representation between the tables
    - Fixes the issue where night shift check-in and check-out appear on different days
*/

-- Add working_week_start column to employee_shifts if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_shifts' AND column_name = 'working_week_start'
  ) THEN
    ALTER TABLE employee_shifts ADD COLUMN working_week_start DATE;
  END IF;
END $$;

-- Create function to set working_week_start for night shifts
CREATE OR REPLACE FUNCTION set_employee_shift_working_week()
RETURNS TRIGGER AS $$
BEGIN
  -- For night shifts, always use the date field as the working_week_start
  -- This ensures consistency when translated to time_records
  IF NEW.shift_type = 'night' THEN
    -- Always use the original date (shift start date)
    NEW.working_week_start := NEW.date;
  ELSE
    -- For other shifts, working_week_start is the same as date
    NEW.working_week_start := NEW.date;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to apply the function
DROP TRIGGER IF EXISTS trg_set_employee_shift_working_week ON employee_shifts;
CREATE TRIGGER trg_set_employee_shift_working_week
BEFORE INSERT OR UPDATE ON employee_shifts
FOR EACH ROW
EXECUTE FUNCTION set_employee_shift_working_week();

-- Update existing employee_shifts records to set working_week_start
UPDATE employee_shifts
SET working_week_start = date
WHERE working_week_start IS NULL;

-- Ensure consistent mapping between employee_shifts and time_records
CREATE OR REPLACE FUNCTION handle_employee_shift()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip for non-manual entries
  IF NEW.is_manual_entry != TRUE THEN
    RETURN NEW;
  END IF;
  
  -- For night shifts from employee submissions
  IF NEW.shift_type = 'night' THEN
    -- Always use the original working_week_start from the shift
    -- For check-outs (early morning), this ensures they're grouped with their check-in
    NEW.working_week_start := 
      CASE 
        -- If notes indicate this came from an employee shift, try to extract the original date
        WHEN NEW.notes LIKE '%Employee submitted shift%' THEN
          -- Extract date part if available
          COALESCE(
            -- Try to get date from working_week_start
            NEW.working_week_start,
            -- Or use the date from the timestamp, adjusted for night shifts
            CASE 
              WHEN NEW.status = 'check_out' AND EXTRACT(HOUR FROM NEW.timestamp) < 12 THEN
                (NEW.timestamp::date - INTERVAL '1 day')::date
              ELSE 
                NEW.timestamp::date 
            END
          )
        ELSE
          -- Use standard night shift logic
          CASE 
            WHEN NEW.status = 'check_out' AND EXTRACT(HOUR FROM NEW.timestamp) < 12 THEN
              (NEW.timestamp::date - INTERVAL '1 day')::date
            ELSE 
              NEW.timestamp::date
          END
      END;
      
    -- Set standardized display values for night shifts
    NEW.display_check_in := '21:00';
    NEW.display_check_out := '06:00';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix the unique constraint on time_records for manual entries
DROP INDEX IF EXISTS idx_time_records_unique_manual;

-- Create a more flexible unique constraint that allows both check-in and check-out for the same shift
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_records_unique_manual_fixed 
ON time_records (employee_id, shift_type, status, working_week_start)
WHERE is_manual_entry = true;

-- Add index for improved performance
CREATE INDEX IF NOT EXISTS idx_employee_shifts_working_week
ON employee_shifts(employee_id, working_week_start, shift_type);

-- Fix display values for existing time records from employee shifts
UPDATE time_records t
SET 
  display_check_in = '21:00',
  display_check_out = '06:00'
FROM employee_shifts es
WHERE 
  t.employee_id = es.employee_id
  AND t.is_manual_entry = true
  AND t.shift_type = 'night'
  AND t.notes LIKE '%Employee submitted shift%'
  AND (t.display_check_in IS NULL OR t.display_check_out IS NULL
       OR t.display_check_in = 'Missing' OR t.display_check_out = 'Missing'
       OR t.display_check_in != '21:00' OR t.display_check_out != '06:00');