/*
  # Fix Off-Day Records in Database
  
  1. Changes:
    - Ensure off-day records have correct display values ('OFF-DAY')
    - Fix working_week_start for off-day records
    - Ensure shift_type is properly set to 'off_day'
    - Update exact_hours to be 0 for off-days
    
  2. Issue Resolution:
    - Off-day records will now correctly appear in the Approved Hours view
    - Fixes inconsistencies in how off-days are saved and displayed
    - Ensures that any client code changes for alphabetic sorting don't affect off-day handling
*/

-- Fix existing off-day records
UPDATE time_records
SET 
  display_check_in = 'OFF-DAY',
  display_check_out = 'OFF-DAY',
  shift_type = 'off_day',
  exact_hours = 0,
  working_week_start = COALESCE(working_week_start, timestamp::date)
WHERE 
  status = 'off_day' 
  AND (
    display_check_in IS NULL OR 
    display_check_out IS NULL OR 
    display_check_in != 'OFF-DAY' OR 
    display_check_out != 'OFF-DAY' OR
    working_week_start IS NULL OR
    exact_hours IS NULL OR
    exact_hours != 0 OR
    shift_type IS NULL OR
    shift_type != 'off_day'
  );

-- Create or replace function to ensure off-day records are properly formatted
CREATE OR REPLACE FUNCTION ensure_morning_shift_preservation()
RETURNS TRIGGER AS $$
BEGIN
  -- For off-day records, ensure display values and other fields are correct
  IF NEW.status = 'off_day' THEN
    NEW.display_check_in := 'OFF-DAY';
    NEW.display_check_out := 'OFF-DAY';
    NEW.shift_type := 'off_day';
    NEW.exact_hours := 0;
    NEW.working_week_start := COALESCE(NEW.working_week_start, NEW.timestamp::date);
    NEW.notes := COALESCE(NEW.notes, 'OFF-DAY');
  END IF;
  
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

-- Create or update triggers to handle off-day records properly
CREATE OR REPLACE FUNCTION standardize_manual_shift_times()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle off-day records specially
  IF NEW.status = 'off_day' THEN
    NEW.display_check_in := 'OFF-DAY';
    NEW.display_check_out := 'OFF-DAY';
    NEW.shift_type := 'off_day';
    NEW.exact_hours := 0;
    NEW.working_week_start := COALESCE(NEW.working_week_start, NEW.timestamp::date);
    RETURN NEW;
  END IF;
  
  -- Existing logic for other record types
  IF NEW.is_manual_entry = true OR NEW.notes LIKE '%Employee submitted%' OR NEW.notes LIKE '%Manual entry%' THEN
    -- Ensure shift_type is set correctly if missing
    IF NEW.shift_type IS NULL OR NEW.shift_type = 'unknown' THEN
      NEW.shift_type := 
        CASE 
          WHEN extract(hour from NEW.timestamp) >= 5 AND extract(hour from NEW.timestamp) < 12 
               AND extract(hour from NEW.timestamp) NOT IN (7, 8) THEN 'morning'
          WHEN extract(hour from NEW.timestamp) >= 12 AND extract(hour from NEW.timestamp) < 20 THEN 'evening'
          WHEN extract(hour from NEW.timestamp) >= 20 OR extract(hour from NEW.timestamp) < 5 THEN 'night'
          WHEN extract(hour from NEW.timestamp) = 7 OR extract(hour from NEW.timestamp) = 8 THEN 'canteen'
          ELSE 'morning'
        END;
    END IF;

    -- Set standard display values based on shift type
    NEW.display_check_in := 
      CASE 
        WHEN NEW.shift_type = 'morning' THEN '05:00'
        WHEN NEW.shift_type = 'evening' THEN '13:00'
        WHEN NEW.shift_type = 'night' THEN '21:00'
        WHEN NEW.shift_type = 'canteen' AND extract(hour from NEW.timestamp) = 7 THEN '07:00'
        WHEN NEW.shift_type = 'canteen' THEN '08:00'
        ELSE '08:00'
      END;

    NEW.display_check_out := 
      CASE 
        WHEN NEW.shift_type = 'morning' THEN '14:00'
        WHEN NEW.shift_type = 'evening' THEN '22:00'
        WHEN NEW.shift_type = 'night' THEN '06:00'
        WHEN NEW.shift_type = 'canteen' AND extract(hour from NEW.timestamp) = 7 THEN '16:00'
        WHEN NEW.shift_type = 'canteen' THEN '17:00'
        ELSE '17:00'
      END;
    
    -- Set working week start for consistent grouping
    NEW.working_week_start := 
      CASE
        -- For night shift check-outs in early morning, use previous day
        WHEN NEW.shift_type = 'night' AND NEW.status = 'check_out' 
             AND extract(hour from NEW.timestamp) < 12 THEN
          (NEW.timestamp::date - interval '1 day')::date
        ELSE
          NEW.timestamp::date
      END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix query to properly retrieve off-day records for Approved Hours view
CREATE OR REPLACE FUNCTION fix_night_working_week_start()
RETURNS TRIGGER AS $$
BEGIN
  -- For off-day records, ensure working_week_start is set correctly
  IF NEW.status = 'off_day' THEN
    NEW.working_week_start := COALESCE(NEW.working_week_start, NEW.timestamp::date);
    NEW.display_check_in := 'OFF-DAY';
    NEW.display_check_out := 'OFF-DAY';
    NEW.shift_type := 'off_day';
    NEW.exact_hours := 0;
    RETURN NEW;
  END IF;

  -- For night shift records, set working_week_start appropriately
  IF NEW.shift_type = 'night' AND NEW.status = 'check_out' AND EXTRACT(HOUR FROM NEW.timestamp) < 12 THEN
    NEW.working_week_start := (NEW.timestamp::date - INTERVAL '1 day')::date;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Verify that off-day records can be properly queried
DO $$
DECLARE
  off_day_count INTEGER;
BEGIN
  -- Count off-day records
  SELECT COUNT(*) INTO off_day_count
  FROM time_records
  WHERE status = 'off_day';
  
  RAISE NOTICE 'Found % off-day records in the database', off_day_count;
  
  -- Update any records that have 'OFF-DAY' in the notes but don't have off_day status
  UPDATE time_records
  SET 
    status = 'off_day',
    display_check_in = 'OFF-DAY',
    display_check_out = 'OFF-DAY',
    shift_type = 'off_day',
    exact_hours = 0
  WHERE 
    notes = 'OFF-DAY' 
    AND status != 'off_day';
    
  -- Check if approved off-days are properly recorded
  SELECT COUNT(*) INTO off_day_count
  FROM time_records
  WHERE status = 'off_day' AND notes LIKE '%approved%';
  
  RAISE NOTICE 'Found % approved off-day records in the database', off_day_count;
END $$;