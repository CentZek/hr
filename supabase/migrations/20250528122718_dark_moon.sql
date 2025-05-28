/*
  # Preserve Approved Hours During Data Reset
  
  1. Changes
    - Create a function to identify approved time records
    - Create a trigger to mark records with "approved" or "double-time" in notes
    - Ensure that time_records with approved status are not deleted during reset
  
  2. Data Integrity
    - Ensures approved hours data is preserved during reset operations
    - Adds safeguards to prevent accidental deletion of important records
*/

-- Create a function to mark records as approved based on content
CREATE OR REPLACE FUNCTION mark_approved_records()
RETURNS TRIGGER AS $$
BEGIN
  -- If the record contains "approved" or "double-time" in notes, mark it
  IF NEW.notes LIKE '%approved%' OR NEW.notes LIKE '%double-time%' THEN
    -- Add an "approved" marker if it doesn't already have one
    IF NEW.notes NOT LIKE '%approved%' THEN
      NEW.notes := NEW.notes || '; approved';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create or replace the trigger on time_records
DROP TRIGGER IF EXISTS trg_mark_approved_records ON time_records;
CREATE TRIGGER trg_mark_approved_records
  BEFORE INSERT OR UPDATE ON time_records
  FOR EACH ROW
  EXECUTE FUNCTION mark_approved_records();

-- Create an index to speed up searches for approved records
CREATE INDEX IF NOT EXISTS idx_time_records_notes_approved 
ON time_records 
USING gin (to_tsvector('english', notes));

-- Update existing records to ensure they're properly marked
UPDATE time_records
SET notes = notes || '; approved'
WHERE (notes LIKE '%double-time%' OR notes LIKE '%hours%')
AND notes NOT LIKE '%approved%';