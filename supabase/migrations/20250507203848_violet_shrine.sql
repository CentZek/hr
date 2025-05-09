/*
  # Fix Morning Shift Type in Database Schema
  
  1. Changes
    - Fix the constraint on time_records.shift_type to properly include 'morning' as a valid shift type
    - Add specific checks for the constraint to ensure it's properly defined
    - Update comments and documentation on the table
    
  2. Data Integrity
    - Ensures all morning shift records can be properly saved to the database
    - Fixes issue where morning shift edits were not persisting hours changes
    - Maintains consistency between Face ID Data and Approved Hours views
*/

-- First check if the constraint exists and drop it
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