/*
  # Fix Manual & Employee-Submitted Records Display
  
  1. Changes:
    - Fix "Missing" check-in/check-out times in Approved Hours view
    - Fix Unknown shift types for manual and employee-submitted records
    - Ensure proper time display for all shift types
    - Fix records that have inverted check-in/check-out displays
    
  2. Issue Resolution:
    - Standardizes all manual entry times to proper shift time formats
    - Ensures both check-in and check-out displays are present
    - Correctly identifies shift types based on timestamp
    - Fixes issues with "Missing" values displayed in the UI
*/

-- Update all manual and employee-submitted records with missing display values
UPDATE time_records
SET 
  display_check_in = 
    CASE 
      WHEN shift_type = 'morning' THEN '05:00'
      WHEN shift_type = 'evening' THEN '13:00' 
      WHEN shift_type = 'night' THEN '21:00'
      WHEN shift_type = 'canteen' AND extract(hour from timestamp) = 7 THEN '07:00'
      WHEN shift_type = 'canteen' THEN '08:00'
      ELSE '08:00' -- Default if shift_type is unknown
    END,
  display_check_out = 
    CASE 
      WHEN shift_type = 'morning' THEN '14:00'
      WHEN shift_type = 'evening' THEN '22:00'
      WHEN shift_type = 'night' THEN '06:00'
      WHEN shift_type = 'canteen' AND extract(hour from timestamp) = 7 THEN '16:00'
      WHEN shift_type = 'canteen' THEN '17:00'
      ELSE '17:00' -- Default if shift_type is unknown
    END,
  -- Fix unknown shift types
  shift_type = 
    CASE
      WHEN shift_type IS NULL OR shift_type = 'unknown' THEN
        CASE 
          WHEN extract(hour from timestamp) >= 5 AND extract(hour from timestamp) < 12 
               AND extract(hour from timestamp) NOT IN (7, 8) THEN 'morning'
          WHEN extract(hour from timestamp) >= 12 AND extract(hour from timestamp) < 20 THEN 'evening'
          WHEN extract(hour from timestamp) >= 20 OR extract(hour from timestamp) < 5 THEN 'night'
          WHEN extract(hour from timestamp) = 7 OR extract(hour from timestamp) = 8 THEN 'canteen'
          ELSE 'morning' -- Default to morning if can't determine
        END
      ELSE shift_type
    END
WHERE 
  (is_manual_entry = true OR notes LIKE '%Employee submitted%' OR notes LIKE '%Manual entry%')
  AND (
    display_check_in IS NULL OR 
    display_check_in = 'Missing' OR
    display_check_out IS NULL OR 
    display_check_out = 'Missing' OR
    shift_type IS NULL OR 
    shift_type = 'unknown'
  );

-- Fix cross-paired records (when check-in/check-out displays are swapped)
WITH inverted_displays AS (
  SELECT id
  FROM time_records
  WHERE 
    status = 'check_in' AND
    display_check_in = 'Missing' AND
    display_check_out IS NOT NULL AND
    display_check_out != 'Missing'
)
UPDATE time_records
SET
  display_check_in = display_check_out,
  display_check_out = 'Missing'
WHERE id IN (SELECT id FROM inverted_displays);

-- Create or replace the trigger function to ensure new entries have proper values
CREATE OR REPLACE FUNCTION standardize_manual_shift_times()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process manual entries
  IF NEW.is_manual_entry = true OR NEW.notes LIKE '%Employee submitted%' OR NEW.notes LIKE '%Manual entry%' THEN
    -- Ensure shift_type is set
    IF NEW.shift_type IS NULL OR NEW.shift_type = 'unknown' THEN
      NEW.shift_type := 
        CASE 
          WHEN extract(hour from NEW.timestamp) >= 5 AND extract(hour from NEW.timestamp) < 12 
               AND extract(hour from NEW.timestamp) NOT IN (7, 8) THEN 'morning'
          WHEN extract(hour from NEW.timestamp) >= 12 AND extract(hour from NEW.timestamp) < 20 THEN 'evening'
          WHEN extract(hour from NEW.timestamp) >= 20 OR extract(hour from NEW.timestamp) < 5 THEN 'night'
          WHEN extract(hour from NEW.timestamp) = 7 OR extract(hour from NEW.timestamp) = 8 THEN 'canteen'
          ELSE 'morning' -- Default to morning if can't determine
        END;
    END IF;
    
    -- Set standard display times based on shift type
    NEW.display_check_in := 
      CASE 
        WHEN NEW.shift_type = 'morning' THEN '05:00'
        WHEN NEW.shift_type = 'evening' THEN '13:00'
        WHEN NEW.shift_type = 'night' THEN '21:00'
        WHEN NEW.shift_type = 'canteen' AND extract(hour from NEW.timestamp) = 7 THEN '07:00'
        WHEN NEW.shift_type = 'canteen' THEN '08:00'
        ELSE '08:00' -- Default if shift_type is still unknown
      END;
    
    NEW.display_check_out := 
      CASE 
        WHEN NEW.shift_type = 'morning' THEN '14:00'
        WHEN NEW.shift_type = 'evening' THEN '22:00'
        WHEN NEW.shift_type = 'night' THEN '06:00'
        WHEN NEW.shift_type = 'canteen' AND extract(hour from NEW.timestamp) = 7 THEN '16:00'
        WHEN NEW.shift_type = 'canteen' THEN '17:00'
        ELSE '17:00' -- Default if shift_type is still unknown
      END;
    
    -- Set working week start for proper grouping
    NEW.working_week_start := 
      CASE 
        WHEN NEW.shift_type = 'night' AND NEW.status = 'check_out' 
             AND extract(hour from NEW.timestamp) < 12 THEN
          (NEW.timestamp::date - interval '1 day')::date
        ELSE 
          NEW.timestamp::date
      END;
    
    -- Ensure hours value is set
    IF NEW.exact_hours IS NULL THEN
      NEW.exact_hours := 9.00;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Make sure our trigger exists
DROP TRIGGER IF EXISTS trg_standardize_manual_shift_times ON time_records;
CREATE TRIGGER trg_standardize_manual_shift_times
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION standardize_manual_shift_times();

-- Fix for paired check-in/check-out records to ensure both have proper display values
WITH paired_records AS (
  SELECT 
    c_in.id AS check_in_id,
    c_out.id AS check_out_id,
    c_in.employee_id,
    c_in.shift_type,
    CASE 
      WHEN c_in.shift_type = 'morning' THEN '05:00'
      WHEN c_in.shift_type = 'evening' THEN '13:00' 
      WHEN c_in.shift_type = 'night' THEN '21:00'
      WHEN c_in.shift_type = 'canteen' AND extract(hour from c_in.timestamp) = 7 THEN '07:00'
      WHEN c_in.shift_type = 'canteen' THEN '08:00'
      ELSE '08:00'
    END AS std_check_in,
    CASE 
      WHEN c_in.shift_type = 'morning' THEN '14:00'
      WHEN c_in.shift_type = 'evening' THEN '22:00'
      WHEN c_in.shift_type = 'night' THEN '06:00'
      WHEN c_in.shift_type = 'canteen' AND extract(hour from c_in.timestamp) = 7 THEN '16:00'
      WHEN c_in.shift_type = 'canteen' THEN '17:00'
      ELSE '17:00'
    END AS std_check_out
  FROM 
    time_records c_in
    JOIN time_records c_out 
      ON c_in.employee_id = c_out.employee_id 
      AND c_in.status = 'check_in' 
      AND c_out.status = 'check_out'
      AND (
        -- Same day records
        c_in.timestamp::date = c_out.timestamp::date OR
        -- Or night shift spilling into next day
        (c_in.shift_type = 'night' 
         AND c_out.timestamp::date = c_in.timestamp::date + interval '1 day'
         AND extract(hour from c_out.timestamp) < 12)
      )
  WHERE 
    c_in.is_manual_entry = true OR 
    c_out.is_manual_entry = true OR
    c_in.notes LIKE '%Employee submitted%' OR 
    c_out.notes LIKE '%Employee submitted%'
)
UPDATE time_records t
SET 
  display_check_in = pr.std_check_in,
  display_check_out = pr.std_check_out
FROM paired_records pr
WHERE t.id IN (pr.check_in_id, pr.check_out_id);

-- Fix display value cross-contamination (check_in having check_out values or vice versa)
UPDATE time_records 
SET 
  display_check_in = 
    CASE 
      WHEN status = 'check_in' AND display_check_in LIKE '%:%' THEN display_check_in
      WHEN shift_type = 'morning' THEN '05:00'
      WHEN shift_type = 'evening' THEN '13:00' 
      WHEN shift_type = 'night' THEN '21:00'
      WHEN shift_type = 'canteen' AND extract(hour from timestamp) = 7 THEN '07:00'
      WHEN shift_type = 'canteen' THEN '08:00'
      ELSE '08:00'
    END,
  display_check_out = 
    CASE 
      WHEN status = 'check_out' AND display_check_out LIKE '%:%' THEN display_check_out
      WHEN shift_type = 'morning' THEN '14:00'
      WHEN shift_type = 'evening' THEN '22:00'
      WHEN shift_type = 'night' THEN '06:00'
      WHEN shift_type = 'canteen' AND extract(hour from timestamp) = 7 THEN '16:00'
      WHEN shift_type = 'canteen' THEN '17:00'
      ELSE '17:00'
    END
WHERE 
  (is_manual_entry = true OR notes LIKE '%Employee submitted%' OR notes LIKE '%Manual entry%')
  AND ((status = 'check_in' AND display_check_in NOT LIKE '%:%') OR
       (status = 'check_out' AND display_check_out NOT LIKE '%:%'));

-- Create additional index for improved performance
CREATE INDEX IF NOT EXISTS idx_time_records_display
ON time_records(display_check_in, display_check_out);