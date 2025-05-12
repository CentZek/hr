/*
  # Fix Manual Entry and Employee Submitted Shift Display Issues
  
  1. Changes:
    - Fix missing display values for check-in and check-out times
    - Standardize display times for each shift type across all records
    - Fix timezone issues with manual entries and employee-submitted shifts
    - Ensure consistent grouping of shifts in the Approved Hours view
    
  2. Data Integrity:
    - Use standard display format for each shift type (e.g., 05:00/14:00 for morning)
    - Fix working_week_start for proper grouping of night shifts 
    - Prevent entries from disappearing in the Approved Hours view
*/

-- Update all manual entry records to have consistent display values
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
  is_manual_entry = true
  AND (
    (status = 'check_in' AND (display_check_in IS NULL OR display_check_in = 'Missing')) OR
    (status = 'check_out' AND (display_check_out IS NULL OR display_check_out = 'Missing')) OR
    (notes LIKE '%Employee submitted%' OR notes LIKE '%Manual entry%')
  );

-- Ensure both check-in and check-out display times are set for each record
WITH paired_records AS (
  SELECT 
    c_in.id AS check_in_id,
    c_out.id AS check_out_id,
    c_in.display_check_in,
    c_out.display_check_out,
    c_in.timestamp::date AS check_in_date
  FROM 
    time_records c_in
    JOIN time_records c_out 
      ON c_in.employee_id = c_out.employee_id 
      AND c_in.status = 'check_in' 
      AND c_out.status = 'check_out'
      AND c_in.shift_type = c_out.shift_type
      AND (
        c_in.timestamp::date = c_out.timestamp::date OR
        (c_in.shift_type = 'night' AND 
         c_out.timestamp::date = (c_in.timestamp::date + INTERVAL '1 day') AND
         EXTRACT(HOUR FROM c_out.timestamp) < 12)
      )
    WHERE
      (c_in.is_manual_entry = true OR c_out.is_manual_entry = true) OR
      (c_in.notes LIKE '%Employee submitted%' OR c_out.notes LIKE '%Employee submitted%') OR
      (c_in.notes LIKE '%Manual entry%' OR c_out.notes LIKE '%Manual entry%')
)
UPDATE time_records t
SET 
  display_check_in = pr.display_check_in,
  display_check_out = pr.display_check_out,
  working_week_start = 
    CASE 
      WHEN t.shift_type = 'night' AND t.status = 'check_out' AND
           EXTRACT(HOUR FROM t.timestamp) < 12
      THEN pr.check_in_date
      ELSE t.working_week_start
    END
FROM paired_records pr
WHERE 
  (t.id = pr.check_in_id OR t.id = pr.check_out_id);

-- Create a combined index to improve performance of shift record lookups
CREATE INDEX IF NOT EXISTS idx_time_records_employee_shift_time 
ON time_records(employee_id, shift_type, timestamp)
WHERE (shift_type = 'night');

-- Ensure standardized manual entry times are used for all future entries
CREATE OR REPLACE FUNCTION standardize_manual_shift_times()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process manual entries
  IF NEW.is_manual_entry = true THEN
    -- Set standard display values based on shift type
    IF NEW.shift_type IS NOT NULL THEN
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
    
    -- Set working_week_start for cross-day shifts (night shifts with early morning checkout)
    NEW.working_week_start := 
      CASE 
        WHEN NEW.shift_type = 'night' AND NEW.status = 'check_out' AND 
             extract(hour from NEW.timestamp) < 12
        THEN (NEW.timestamp::date - interval '1 day')::date
        ELSE NEW.timestamp::date
      END;
    
    -- Ensure exact_hours defaults to standard 9.00 hours for manual entries
    IF NEW.exact_hours IS NULL THEN
      NEW.exact_hours := 9.00;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for the standardize function
DROP TRIGGER IF EXISTS trg_standardize_manual_shift_times ON time_records;
CREATE TRIGGER trg_standardize_manual_shift_times
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION standardize_manual_shift_times();