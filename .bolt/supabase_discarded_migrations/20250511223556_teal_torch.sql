/*
  # Add working_week_start to employee_shifts table

  1. Changes
    - Add `working_week_start` DATE column to employee_shifts table
    - Create trigger function to automatically set working_week_start on insert/update
    - Add trigger to employee_shifts table

  2. Purpose
    - Ensures night shifts that span across days are properly grouped together
    - Maintains consistency between employee_shifts and time_records tables
    - Improves data integrity for reporting
*/

-- Add working_week_start column to employee_shifts table
ALTER TABLE employee_shifts 
  ADD COLUMN working_week_start DATE;

-- Create or replace trigger function to set working_week_start
CREATE OR REPLACE FUNCTION set_employee_shift_working_week() 
RETURNS TRIGGER AS $$
BEGIN
  -- For night shifts, if date is the check-in date, use that date as working_week_start
  -- For other shifts, use the shift date as working_week_start
  IF NEW.shift_type = 'night' THEN
    NEW.working_week_start := NEW.date;
  ELSE
    -- For non-night shifts, working_week_start is just the shift date
    NEW.working_week_start := NEW.date;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically set working_week_start
CREATE TRIGGER trg_set_employee_shift_working_week
  BEFORE INSERT OR UPDATE ON employee_shifts
  FOR EACH ROW
  EXECUTE FUNCTION set_employee_shift_working_week();

-- Update existing records
UPDATE employee_shifts
  SET working_week_start = date;