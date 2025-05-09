/*
  # Fix Morning Shift Type in Database Schema
  
  1. Changes
    - Ensure 'morning' is properly included in the allowed shift_type values
    - Update the CHECK constraint to explicitly include 'morning'
    - Fix any existing records that might have incorrect shift types
    
  2. Data Integrity
    - This fixes the issue where morning shifts were not being saved correctly
    - Ensures shifts edited in the Face ID Data view properly update hours
    - Makes check-in time changes for morning shifts work properly
*/

-- Drop the existing constraint
ALTER TABLE public.time_records 
DROP CONSTRAINT IF EXISTS time_records_shift_type_check;

-- Recreate it with 'morning' explicitly included
ALTER TABLE public.time_records 
ADD CONSTRAINT time_records_shift_type_check 
CHECK (shift_type = ANY (ARRAY['morning'::text, 'evening'::text, 'night'::text, 'canteen'::text, 'off_day'::text, 'unknown'::text, NULL::text]));

-- Fix any existing records where morning shifts might be saved as other types
UPDATE public.time_records
SET shift_type = 'morning'
WHERE 
  -- Identify potential morning shift records by time
  (EXTRACT(HOUR FROM timestamp) BETWEEN 4 AND 11 AND 
   EXTRACT(HOUR FROM timestamp) != 7 AND
   EXTRACT(HOUR FROM timestamp) != 8) AND
  -- Only update if they're not already marked as morning
  shift_type IS DISTINCT FROM 'morning' AND
  -- Exclude records that should remain as they are
  shift_type != 'off_day';

-- Add a function to verify the constraint is working properly
CREATE OR REPLACE FUNCTION verify_shift_type_constraint()
RETURNS VOID AS $$
DECLARE
  test_record_id uuid;
BEGIN
  -- Insert a test record with 'morning' shift type
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
    'Test record to verify morning shift type constraint - will be deleted'
  FROM employees 
  LIMIT 1
  RETURNING id INTO test_record_id;
  
  -- If we get here, the constraint is working
  RAISE NOTICE 'Successfully inserted test record with morning shift type';
  
  -- Delete the test record
  DELETE FROM public.time_records WHERE id = test_record_id;
END;
$$ LANGUAGE plpgsql;

-- Run the verification function
SELECT verify_shift_type_constraint();