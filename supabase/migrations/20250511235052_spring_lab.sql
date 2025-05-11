/*
  # Fix Night Shift Timestamps

  1. Changes
     - Creates a function to automatically fix night shift checkout times
     - Adds a trigger to apply this fix to all new records
     - Updates existing night shift records with incorrect checkout times

  2. Problem Resolution
     - Ensures night shift checkout times are properly set to 06:00 (next day)
     - Fixes inconsistency between employee-submitted and HR-entered shifts
*/

-- Create or replace function to fix night shift timestamps
CREATE OR REPLACE FUNCTION fix_night_shift_timestamps() 
RETURNS TRIGGER AS $$
DECLARE
  checkout_date DATE;
  checkout_hour INTEGER;
  next_day_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Only process night shift check-out records
  IF NEW.status = 'check_out' AND NEW.shift_type = 'night' THEN
    -- Extract the hour from timestamp
    checkout_hour := EXTRACT(HOUR FROM NEW.timestamp);
    
    -- If checkout time is 21:00 (9 PM), fix it to 06:00 (6 AM) next day
    IF checkout_hour = 21 THEN
      -- Get the date part of the timestamp
      checkout_date := NEW.timestamp::date;
      
      -- Create the next day timestamp properly
      next_day_timestamp := (checkout_date + INTERVAL '1 day' + INTERVAL '6 hours')::TIMESTAMP WITH TIME ZONE;
      
      -- Set the corrected timestamp
      NEW.timestamp := next_day_timestamp;
      
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
    WHERE tgname = 'trg_fix_night_shift_timestamps'
  ) THEN
    CREATE TRIGGER trg_fix_night_shift_timestamps
      BEFORE INSERT OR UPDATE ON time_records
      FOR EACH ROW
      EXECUTE FUNCTION fix_night_shift_timestamps();
  END IF;
END $$;

-- Update existing night shift records with incorrect checkout times
UPDATE time_records
SET timestamp = (timestamp::date + INTERVAL '1 day' + INTERVAL '6 hours')::TIMESTAMP WITH TIME ZONE,
    display_check_out = '06:00'
WHERE status = 'check_out' 
  AND shift_type = 'night'
  AND EXTRACT(HOUR FROM timestamp) = 21
  AND EXTRACT(MINUTE FROM timestamp) = 0;