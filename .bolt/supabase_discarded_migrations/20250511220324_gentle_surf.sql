/*
  # Fix Duplicate Records for Manual and Employee Shift Entries
  
  1. Changes
    - Modify unique constraint to prevent errors when approving shifts
    - Add conflict handling options for manual entries
    - Update existing records to ensure proper constraint compliance
    
  2. Data Integrity
    - Ensure employees can have both check-in and check-out records properly paired
    - Prevent duplicate constraint violations while maintaining data accuracy
    - Preserve display values across approvals
*/

-- First, drop the existing unique constraint that's causing problems
DROP INDEX IF EXISTS idx_time_records_unique_manual;

-- Create a more flexible unique constraint that allows both check-in and check-out for the same shift
CREATE UNIQUE INDEX idx_time_records_unique_manual_fixed 
ON time_records (employee_id, shift_type, status, working_week_start)
WHERE is_manual_entry = true;

-- Update any duplicate records
WITH duplicate_records AS (
  SELECT 
    id,
    employee_id,
    shift_type,
    status,
    working_week_start,
    ROW_NUMBER() OVER (
      PARTITION BY employee_id, shift_type, status, working_week_start 
      WHERE is_manual_entry = true
      ORDER BY timestamp DESC
    ) as row_num
  FROM time_records
  WHERE is_manual_entry = true
)
DELETE FROM time_records
WHERE id IN (
  SELECT id FROM duplicate_records 
  WHERE row_num > 1
);

-- Create a function to handle conflicts when inserting manual time records
CREATE OR REPLACE FUNCTION handle_manual_record_conflict()
RETURNS TRIGGER AS $$
BEGIN
  -- If there's a conflict, update the existing record
  IF TG_OP = 'INSERT' AND NEW.is_manual_entry = true THEN
    -- Check if a record already exists with the same key values
    DECLARE
      existing_id uuid;
    BEGIN
      SELECT id INTO existing_id
      FROM time_records
      WHERE 
        employee_id = NEW.employee_id
        AND shift_type = NEW.shift_type
        AND status = NEW.status
        AND working_week_start = NEW.working_week_start
        AND is_manual_entry = true;
        
      IF existing_id IS NOT NULL THEN
        -- Update the existing record instead of inserting a new one
        UPDATE time_records
        SET 
          timestamp = NEW.timestamp,
          notes = COALESCE(NEW.notes, notes),
          display_check_in = COALESCE(NEW.display_check_in, display_check_in),
          display_check_out = COALESCE(NEW.display_check_out, display_check_out),
          exact_hours = COALESCE(NEW.exact_hours, exact_hours),
          updated_at = NOW()
        WHERE id = existing_id;
        
        -- Skip the actual insert
        RETURN NULL;
      END IF;
    END;
  END IF;
  
  -- For direct insert or no existing record
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger for the conflict handling function
DROP TRIGGER IF EXISTS trg_handle_manual_record_conflict ON time_records;
CREATE TRIGGER trg_handle_manual_record_conflict
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION handle_manual_record_conflict();

-- Add comments for better understanding
COMMENT ON INDEX idx_time_records_unique_manual_fixed IS 
  'Ensures each employee can only have one record per shift type, status, and working week';

COMMENT ON FUNCTION handle_manual_record_conflict() IS
  'Handles conflicts when inserting manual time records by updating existing records instead of failing';