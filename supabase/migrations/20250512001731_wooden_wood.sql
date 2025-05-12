/*
  # Fix night shift timestamps

  1. Database Changes
     - Create a function to fix night shift checkout timestamps
     - Create a trigger to apply the function automatically
     - Fix existing night shift records with wrong timestamps
  
  2. Details
     - Automatically converts 21:00 (9 PM) checkouts for night shifts to 06:00 (6 AM) the next day
     - Sets display_check_out to "06:00" for consistent UI display
     - Updates existing data that needs fixing
*/

-- Create or replace function to fix night shift timestamps
CREATE OR REPLACE FUNCTION fix_night_shift_records() 
RETURNS TRIGGER AS $$
DECLARE
  checkout_date DATE;
  next_day_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Only process night shift check-out records
  IF NEW.status = 'check_out' AND NEW.shift_type = 'night' THEN
    -- If checkout time is 21:00 (9 PM), fix it to 06:00 (6 AM) next day
    IF EXTRACT(HOUR FROM NEW.timestamp) = 21 THEN
      -- Get the date part
      checkout_date := NEW.timestamp::date;
      
      -- Create next day 6 AM timestamp
      next_day_timestamp := (checkout_date + INTERVAL '1 day' + INTERVAL '6 hours');
      
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
    WHERE tgname = 'tg_fix_night_shift_records'
  ) THEN
    CREATE TRIGGER tg_fix_night_shift_records
      BEFORE INSERT ON time_records
      FOR EACH ROW
      EXECUTE FUNCTION fix_night_shift_records();
  END IF;
END $$;

-- Update existing night shift records with incorrect checkout times
-- Uses a safe approach with a DO block to handle errors
DO $$
DECLARE
  rec RECORD;
  updated_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
  FOR rec IN 
    SELECT id, timestamp 
    FROM time_records
    WHERE 
      status = 'check_out' 
      AND shift_type = 'night'
      AND EXTRACT(HOUR FROM timestamp) = 21
      AND EXTRACT(MINUTE FROM timestamp) = 0
  LOOP
    -- Calculate the corrected timestamp
    updated_timestamp := (rec.timestamp::date + INTERVAL '1 day' + INTERVAL '6 hours');
    
    -- Update the record
    UPDATE time_records
    SET 
      timestamp = updated_timestamp,
      display_check_out = '06:00'
    WHERE id = rec.id;
    
    RAISE NOTICE 'Updated record %: changed timestamp from % to %', 
      rec.id, rec.timestamp, updated_timestamp;
  END LOOP;
END $$;