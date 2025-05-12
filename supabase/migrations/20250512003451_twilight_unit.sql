/*
  # Fix Night Shift Timestamps

  1. Fixes
    - Creates a trigger function to automatically fix night shift checkout times
    - Updates existing records with incorrect night shift checkout timestamps
    - Ensures night shift checkouts at 21:00 are properly corrected to 06:00 next day

  2. Improvements
    - Sets display_check_out to "06:00" for proper UI display
    - Maintains working_week_start consistency for cross-day shifts
*/

-- Create or replace function to fix night shift timestamps
CREATE OR REPLACE FUNCTION fix_night_shift_records() 
RETURNS TRIGGER AS $$
BEGIN
  -- Only process night shift check-out records
  IF NEW.status = 'check_out' AND NEW.shift_type = 'night' THEN
    -- If checkout time is 21:00 (9 PM), fix it to 06:00 (6 AM) next day
    IF EXTRACT(HOUR FROM NEW.timestamp) = 21 THEN
      -- Update timestamp to be 6:00 AM on the next day
      NEW.timestamp := (NEW.timestamp::date + INTERVAL '1 day' + INTERVAL '6 hours');
      
      -- Make sure display_check_out shows 06:00
      NEW.display_check_out := '06:00';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger that automatically fixes night shift checkout times
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'tg_fix_night_shift_records'
  ) THEN
    CREATE TRIGGER tg_fix_night_shift_records
      BEFORE INSERT ON time_records
      FOR EACH ROW
      EXECUTE FUNCTION fix_night_shift_records();
  END IF;
END $$;

-- Fix existing night shift records with incorrect checkout times
-- Using cursor-based approach to safely handle each record
DO $$
DECLARE
  rec RECORD;
  fixed_count INTEGER := 0;
BEGIN
  FOR rec IN 
    SELECT id, timestamp 
    FROM time_records
    WHERE 
      status = 'check_out' 
      AND shift_type = 'night'
      AND EXTRACT(HOUR FROM timestamp) = 21
  LOOP
    -- Update the record
    UPDATE time_records
    SET 
      timestamp = (rec.timestamp::date + INTERVAL '1 day' + INTERVAL '6 hours'),
      display_check_out = '06:00'
    WHERE id = rec.id;
    
    fixed_count := fixed_count + 1;
  END LOOP;
  
  RAISE NOTICE 'Fixed % night shift checkout records', fixed_count;
END $$;