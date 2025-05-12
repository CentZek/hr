/*
  # Fix Approved Hours Display for Employee-Submitted Shifts
  
  1. Changes:
    - Fix issue where employee-submitted shifts have missing checkout displays in Approved Hours
    - Ensure consistent display of time records across all system views
    - Standardize handling of night shifts that cross day boundaries
    
  2. Data Integrity:
    - Preserve both check-in and check-out display values when saving records
    - Create combined working week index for more efficient querying
    - Ensure employee-submitted shift times are preserved accurately
*/

-- Create more efficient combined index for employee week queries
CREATE INDEX IF NOT EXISTS idx_time_records_working_week_combined 
ON time_records(employee_id, working_week_start, shift_type, status);

-- Fix display values for employee-submitted shifts
DO $$
DECLARE
  fixed_count integer := 0;
BEGIN
  -- Fix display values for paired check-in/check-out records
  WITH paired_records AS (
    SELECT 
      c_in.id AS check_in_id,
      c_out.id AS check_out_id,
      -- Use standard display values based on shift type
      CASE 
        WHEN c_in.shift_type = 'morning' THEN '05:00'
        WHEN c_in.shift_type = 'evening' THEN '13:00'
        WHEN c_in.shift_type = 'night' THEN '21:00'
        WHEN c_in.shift_type = 'canteen' AND extract(hour from c_in.timestamp) = 7 THEN '07:00'
        WHEN c_in.shift_type = 'canteen' THEN '08:00'
        ELSE to_char(c_in.timestamp, 'HH24:MI')
      END AS std_check_in,
      CASE 
        WHEN c_in.shift_type = 'morning' THEN '14:00'
        WHEN c_in.shift_type = 'evening' THEN '22:00'
        WHEN c_in.shift_type = 'night' THEN '06:00'
        WHEN c_in.shift_type = 'canteen' AND extract(hour from c_in.timestamp) = 7 THEN '16:00'
        WHEN c_in.shift_type = 'canteen' THEN '17:00'
        ELSE to_char(c_out.timestamp, 'HH24:MI')
      END AS std_check_out
    FROM 
      time_records c_in
      JOIN time_records c_out ON 
        c_in.employee_id = c_out.employee_id 
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
      c_in.notes LIKE '%Employee submitted%' OR
      c_out.notes LIKE '%Employee submitted%' OR
      c_in.is_manual_entry = true OR
      c_out.is_manual_entry = true
  )
  UPDATE time_records t
  SET 
    display_check_in = pr.std_check_in,
    display_check_out = pr.std_check_out
  FROM paired_records pr
  WHERE t.id IN (pr.check_in_id, pr.check_out_id)
    AND (
      t.display_check_in IS NULL OR 
      t.display_check_out IS NULL OR
      t.display_check_in = 'Missing' OR
      t.display_check_out = 'Missing'
    );

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % employee-submitted shift records with missing display values', fixed_count;
  
  -- Specifically fix evening shifts where check-out time might be missing
  UPDATE time_records
  SET display_check_out = '22:00'
  WHERE 
    shift_type = 'evening' AND
    (display_check_out IS NULL OR display_check_out = 'Missing') AND
    (notes LIKE '%Employee submitted%' OR is_manual_entry = true);
    
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % evening shift records with missing check-out display values', fixed_count;
  
  -- Specifically fix morning shifts where check-out time might be missing
  UPDATE time_records
  SET display_check_out = '14:00'
  WHERE 
    shift_type = 'morning' AND
    (display_check_out IS NULL OR display_check_out = 'Missing') AND
    (notes LIKE '%Employee submitted%' OR is_manual_entry = true);
    
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % morning shift records with missing check-out display values', fixed_count;
  
  -- Specifically fix night shifts where check-out time might be missing
  UPDATE time_records
  SET display_check_out = '06:00'
  WHERE 
    shift_type = 'night' AND
    (display_check_out IS NULL OR display_check_out = 'Missing') AND
    (notes LIKE '%Employee submitted%' OR is_manual_entry = true);
    
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % night shift records with missing check-out display values', fixed_count;
  
  -- Specifically fix check-in records with missing check-in values
  UPDATE time_records
  SET display_check_in = 
    CASE 
      WHEN shift_type = 'morning' THEN '05:00'
      WHEN shift_type = 'evening' THEN '13:00'
      WHEN shift_type = 'night' THEN '21:00'
      WHEN shift_type = 'canteen' AND extract(hour from timestamp) = 7 THEN '07:00'
      WHEN shift_type = 'canteen' THEN '08:00'
      ELSE to_char(timestamp, 'HH24:MI')
    END
  WHERE 
    status = 'check_in' AND
    (display_check_in IS NULL OR display_check_in = 'Missing') AND
    (notes LIKE '%Employee submitted%' OR is_manual_entry = true);
    
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % check-in records with missing check-in display values', fixed_count;
END $$;

-- Create new standardized trigger function to handle employee shift submissions
CREATE OR REPLACE FUNCTION standardize_manual_shift_times()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process manual entries
  IF NEW.is_manual_entry = true AND NEW.shift_type IS NOT NULL THEN
    -- Set standard display times based on shift type
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

-- Create trigger for standardizing manual shift times
DROP TRIGGER IF EXISTS trg_standardize_manual_shift_times ON time_records;
CREATE TRIGGER trg_standardize_manual_shift_times
BEFORE INSERT ON time_records
FOR EACH ROW
WHEN (NEW.is_manual_entry = true)
EXECUTE FUNCTION standardize_manual_shift_times();