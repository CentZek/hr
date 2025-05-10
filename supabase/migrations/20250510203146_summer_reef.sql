/*
  # Fix Display Times for Approved Hours View
  
  1. Changes
    - Ensure standard display times are used for all shift types
    - Fix missing display times in both check-in and check-out records
    - Update existing records to show correct times in Approved Hours view
    
  2. Data Integrity
    - Set standard display times based on shift type (05:00-14:00 for morning, etc.)
    - Ensure both check-in and check-out records have proper display values
    - Create trigger to standardize all future manual entries
*/

-- Add any missing display values to existing records
UPDATE time_records
SET 
  display_check_in = 
    CASE 
      WHEN shift_type = 'morning' THEN '05:00'
      WHEN shift_type = 'evening' THEN '13:00' 
      WHEN shift_type = 'night' THEN '21:00'
      WHEN shift_type = 'canteen' AND extract(hour from timestamp) = 7 THEN '07:00'
      WHEN shift_type = 'canteen' THEN '08:00'
      ELSE display_check_in
    END,
  display_check_out = 
    CASE 
      WHEN shift_type = 'morning' THEN '14:00'
      WHEN shift_type = 'evening' THEN '22:00'
      WHEN shift_type = 'night' THEN '06:00'
      WHEN shift_type = 'canteen' AND extract(hour from timestamp) = 7 THEN '16:00'
      WHEN shift_type = 'canteen' THEN '17:00'
      ELSE display_check_out
    END
WHERE 
  (display_check_in IS NULL OR display_check_in = 'Missing' OR display_check_out IS NULL OR display_check_out = 'Missing')
  AND status IN ('check_in', 'check_out')
  AND is_manual_entry = true;

-- Update existing manual records for specific shift types
WITH paired_records AS (
  SELECT 
    c_in.id AS check_in_id,
    c_out.id AS check_out_id,
    c_in.employee_id,
    c_in.shift_type
  FROM 
    time_records c_in
    JOIN time_records c_out 
      ON c_in.employee_id = c_out.employee_id 
      AND c_in.status = 'check_in' 
      AND c_out.status = 'check_out'
      AND (
        -- Same day records
        (c_in.timestamp::date = c_out.timestamp::date) OR
        -- OR night shift records with early morning checkout on next day
        (c_in.shift_type = 'night' 
         AND c_out.timestamp::date = c_in.timestamp::date + interval '1 day'
         AND extract(hour from c_out.timestamp) < 12)
      )
    WHERE
      (c_in.is_manual_entry = true OR c_out.is_manual_entry = true)
)
UPDATE time_records t
SET 
  display_check_in = 
    CASE 
      WHEN pr.shift_type = 'morning' THEN '05:00'
      WHEN pr.shift_type = 'evening' THEN '13:00' 
      WHEN pr.shift_type = 'night' THEN '21:00'
      WHEN pr.shift_type = 'canteen' AND extract(hour from t.timestamp) = 7 THEN '07:00'
      WHEN pr.shift_type = 'canteen' THEN '08:00'
      ELSE t.display_check_in
    END,
  display_check_out = 
    CASE 
      WHEN pr.shift_type = 'morning' THEN '14:00'
      WHEN pr.shift_type = 'evening' THEN '22:00'
      WHEN pr.shift_type = 'night' THEN '06:00'
      WHEN pr.shift_type = 'canteen' AND extract(hour from t.timestamp) = 7 THEN '16:00'
      WHEN pr.shift_type = 'canteen' THEN '17:00'
      ELSE t.display_check_out
    END
FROM paired_records pr
WHERE t.id IN (pr.check_in_id, pr.check_out_id);

-- Create or replace function to standardize manual shift times
CREATE OR REPLACE FUNCTION standardize_manual_shift_times()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process manual entries
  IF NEW.is_manual_entry = true OR NEW.notes LIKE '%Employee submitted%' THEN
    -- Set standard display times based on shift type
    IF NEW.shift_type IS NOT NULL THEN
      -- For check-in records, set both display_check_in and display_check_out
      -- This ensures both values are available in the database
      NEW.display_check_in := 
        CASE 
          WHEN NEW.shift_type = 'morning' THEN '05:00'
          WHEN NEW.shift_type = 'evening' THEN '13:00'
          WHEN NEW.shift_type = 'night' THEN '21:00'
          WHEN NEW.shift_type = 'canteen' AND extract(hour from NEW.timestamp) = 7 THEN '07:00'
          WHEN NEW.shift_type = 'canteen' THEN '08:00'
          ELSE to_char(NEW.timestamp, 'HH24:MI')
        END;
        
      NEW.display_check_out := 
        CASE 
          WHEN NEW.shift_type = 'morning' THEN '14:00'
          WHEN NEW.shift_type = 'evening' THEN '22:00'
          WHEN NEW.shift_type = 'night' THEN '06:00'
          WHEN NEW.shift_type = 'canteen' AND extract(hour from NEW.timestamp) = 7 THEN '16:00'
          WHEN NEW.shift_type = 'canteen' THEN '17:00'
          ELSE to_char(NEW.timestamp, 'HH24:MI')
        END;
    END IF;
    
    -- Working week start for consistent grouping across days
    IF NEW.shift_type = 'night' AND NEW.status = 'check_out' AND extract(hour from NEW.timestamp) < 12 THEN
      NEW.working_week_start := (NEW.timestamp::date - interval '1 day')::date;
    ELSE
      NEW.working_week_start := NEW.timestamp::date;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Make sure the trigger exists
DROP TRIGGER IF EXISTS trg_standardize_manual_shift_times ON time_records;
CREATE TRIGGER trg_standardize_manual_shift_times
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION standardize_manual_shift_times();