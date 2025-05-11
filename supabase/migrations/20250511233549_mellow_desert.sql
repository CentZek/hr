/*
  # Fix night shift display inconsistency

  1. Updates
    - Makes sure the working_week_start column exists on employee_shifts table
    - Ensures trigger function properly sets working_week_start value
    - Updates existing records to have appropriate working_week_start values
    
  2. Security
    - No changes to security policies
*/

-- Check if working_week_start column already exists before adding it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_shifts' 
    AND column_name = 'working_week_start'
  ) THEN
    ALTER TABLE employee_shifts ADD COLUMN working_week_start DATE;
  END IF;
END $$;

-- Create or replace trigger function to set working_week_start
CREATE OR REPLACE FUNCTION set_employee_shift_working_week() 
RETURNS TRIGGER AS $$
BEGIN
  -- For all shifts, use the shift date as working_week_start
  -- This ensures consistent grouping for night shifts
  NEW.working_week_start := NEW.date;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_employee_shift_working_week'
  ) THEN
    CREATE TRIGGER trg_set_employee_shift_working_week
      BEFORE INSERT OR UPDATE ON employee_shifts
      FOR EACH ROW
      EXECUTE FUNCTION set_employee_shift_working_week();
  END IF;
END $$;

-- Update existing records that have null working_week_start
UPDATE employee_shifts
SET working_week_start = date
WHERE working_week_start IS NULL;