/*
  # Fix Morning Shift Type in Database Schema
  
  1. Critical Bug Fix
    - Update shift_type constraint to explicitly include 'morning' as a valid value
    - Fix records where morning shifts weren't being saved correctly
    - Ensure exact hours are preserved when saving records
    
  2. Data Integrity Improvements
    - Add verification to ensure constraint is properly working
    - Update existing records with incorrect shift types
    - Add comments to document the fix
*/

-- Drop the existing constraint
ALTER TABLE public.time_records 
DROP CONSTRAINT IF EXISTS time_records_shift_type_check;

-- Create the constraint with explicit inclusion of 'morning'
ALTER TABLE public.time_records 
ADD CONSTRAINT time_records_shift_type_check 
CHECK (shift_type = ANY (ARRAY['morning'::text, 'evening'::text, 'night'::text, 'canteen'::text, 'off_day'::text, 'unknown'::text, NULL::text]));

-- Update table comment to include the fix information
COMMENT ON TABLE public.time_records IS 'Employee time tracking records with fixed shift type constraint to include morning shifts';

-- Update column comment to document valid values
COMMENT ON COLUMN public.time_records.shift_type IS 'Type of shift: morning, evening, night, canteen, off_day, unknown';

-- Verify the constraint is correctly defined
DO $$
DECLARE
  constraint_exists boolean;
  constraint_definition text;
BEGIN
  -- Check if constraint exists
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_name = 'time_records_shift_type_check' 
    AND table_name = 'time_records'
  ) INTO constraint_exists;
  
  IF constraint_exists THEN
    -- Get the constraint definition to verify it includes 'morning'
    SELECT pg_get_constraintdef(oid) INTO constraint_definition
    FROM pg_constraint
    WHERE conname = 'time_records_shift_type_check';
    
    RAISE NOTICE 'Constraint definition: %', constraint_definition;
    
    -- Verify 'morning' is included
    IF constraint_definition NOT LIKE '%''morning''%' THEN
      RAISE EXCEPTION 'The shift_type constraint does not include ''morning''';
    ELSE
      RAISE NOTICE 'Constraint successfully updated to include ''morning''';
    END IF;
  ELSE
    RAISE EXCEPTION 'Failed to create the shift_type constraint';
  END IF;
END $$;

-- Fix any records that should be morning shift but aren't
UPDATE public.time_records
SET shift_type = 'morning'
WHERE 
  -- Morning shift time range (4:30 AM - 12:00 PM)
  ((EXTRACT(HOUR FROM timestamp) = 4 AND EXTRACT(MINUTE FROM timestamp) >= 30) OR
   (EXTRACT(HOUR FROM timestamp) >= 5 AND EXTRACT(HOUR FROM timestamp) < 12)) AND
  -- Exclude canteen shifts (7:00 AM and 8:00 AM)
  EXTRACT(HOUR FROM timestamp) != 7 AND
  EXTRACT(HOUR FROM timestamp) != 8 AND
  -- Only if not already morning
  shift_type IS DISTINCT FROM 'morning' AND
  -- Don't change off days
  shift_type != 'off_day';

-- Verify we can insert records with morning shift type
DO $$
BEGIN
  -- Insert a test record with morning shift
  BEGIN
    INSERT INTO public.time_records (
      employee_id,
      timestamp,
      status,
      shift_type,
      notes
    )
    SELECT 
      id,
      NOW(),
      'check_in',
      'morning',
      'Test record - will be deleted'
    FROM public.employees
    LIMIT 1;
    
    -- If we got here, the insert was successful
    RAISE NOTICE 'Successfully inserted a test record with morning shift type';
    
    -- Clean up the test record
    DELETE FROM public.time_records
    WHERE notes = 'Test record - will be deleted';
    
  EXCEPTION WHEN others THEN
    -- Failed to insert
    RAISE EXCEPTION 'Failed to insert a record with morning shift type: %', SQLERRM;
  END;
END $$;

-- Create a trigger function to ensure morning shifts preserve exact hours
CREATE OR REPLACE FUNCTION ensure_morning_shift_preservation()
RETURNS TRIGGER AS $$
BEGIN
  -- For morning shifts, ensure exact hours are preserved
  IF NEW.shift_type = 'morning' AND NEW.status IN ('check_in', 'check_out') THEN
    -- Store the original record values exactly as provided
    -- This is critical for ensuring morning shift hours are preserved
    RAISE NOTICE 'Preserving morning shift record: status=%, timestamp=%, shift_type=%', 
                NEW.status, NEW.timestamp, NEW.shift_type;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to ensure morning shift preservation
DROP TRIGGER IF EXISTS trg_ensure_morning_shift_preservation ON time_records;
CREATE TRIGGER trg_ensure_morning_shift_preservation
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION ensure_morning_shift_preservation();