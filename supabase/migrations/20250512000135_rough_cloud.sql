/*
  # Fix night shift checkout timestamps

  1. Changes
    - Creates a function to fix night shift checkout timestamps
    - Adds a trigger to automatically fix timestamps on insert or update
    - Updates existing records with incorrect night shift checkout times
  2. Security
    - No security changes
*/

-- Create or replace function to fix night shift timestamps
CREATE OR REPLACE FUNCTION fix_night_shift_timestamps() 
RETURNS TRIGGER AS $$
DECLARE
  checkout_date DATE;
  next_day_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Only process night shift check-out records
  IF NEW.status = 'check_out' AND NEW.shift_type = 'night' THEN
    -- Extract the hour from timestamp
    IF EXTRACT(HOUR FROM NEW.timestamp) = 21 THEN
      -- Get the date part of the timestamp
      checkout_date := NEW.timestamp::date;
      
      -- Create new timestamp with next day at 6:00
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
SET 
  timestamp = (timestamp::date + INTERVAL '1 day' + INTERVAL '6 hours')::TIMESTAMP WITH TIME ZONE,
  display_check_out = '06:00'
WHERE 
  status = 'check_out' 
  AND shift_type = 'night'
  AND EXTRACT(HOUR FROM timestamp) = 21
  AND EXTRACT(MINUTE FROM timestamp) = 0;