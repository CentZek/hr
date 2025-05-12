/*
  # Fix Night Shift Manual Entry Display and Grouping
  
  1. Changes:
    - Fix display values for night shifts to correctly show in Approved Hours view
    - Ensure check-in and check-out records are paired correctly
    - Standardize display format for all shift types (05:00/14:00 for morning, etc.)
    
  2. Data Integrity:
    - Use working_week_start for consistent grouping of records
    - Ensure check-in/check-out pairs have matching display values
    - Fix timezone issues by standardizing display values
*/

-- Create a combined index for more efficient queries
CREATE INDEX IF NOT EXISTS idx_time_records_working_week_combined 
ON time_records(employee_id, working_week_start, shift_type, status);

-- Fix all manual and employee-submitted records with missing or incorrect display values
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
  -- Set working_week_start for consistent grouping
  working_week_start = 
    CASE
      -- For night shift checkouts in early morning, use previous day
      WHEN shift_type = 'night' AND status = 'check_out' AND extract(hour from timestamp) < 12 THEN
        (timestamp::date - interval '1 day')::date
      ELSE
        timestamp::date
    END
WHERE 
  (is_manual_entry = true OR notes LIKE '%Employee submitted%' OR notes LIKE '%Manual entry%')
  AND (
    display_check_in IS NULL OR 
    display_check_out IS NULL OR
    display_check_in = 'Missing' OR
    display_check_out = 'Missing' OR
    working_week_start IS NULL
  );

-- For each manual check-in record, ensure there's a matching check-out record with correct display values
WITH manual_check_ins AS (
  SELECT 
    id, 
    employee_id, 
    timestamp::date as record_date,
    shift_type,
    display_check_in,
    display_check_out,
    working_week_start,
    extract(hour from timestamp) as hour
  FROM time_records
  WHERE 
    status = 'check_in' 
    AND (is_manual_entry = true OR notes LIKE '%Employee submitted%')
),
manual_check_outs AS (
  SELECT 
    id, 
    employee_id, 
    timestamp::date as record_date,
    shift_type,
    display_check_in,
    display_check_out,
    working_week_start,
    extract(hour from timestamp) as hour
  FROM time_records
  WHERE 
    status = 'check_out' 
    AND (is_manual_entry = true OR notes LIKE '%Employee submitted%')
)
UPDATE time_records t_out
SET 
  display_check_in = t_in.display_check_in,
  -- Ensure both records show both timestamps
  working_week_start = t_in.working_week_start
FROM manual_check_ins t_in
WHERE 
  t_out.employee_id = t_in.employee_id
  AND t_out.status = 'check_out'
  AND (t_out.is_manual_entry = true OR t_out.notes LIKE '%Employee submitted%')
  AND (
    -- Same day records
    (t_out.timestamp::date = t_in.record_date)
    OR
    -- Night shift records where check-out is next day morning
    (t_in.shift_type = 'night' 
     AND t_out.timestamp::date = t_in.record_date + interval '1 day'
     AND extract(hour from t_out.timestamp) < 12)
  )
  AND (t_out.display_check_in IS NULL OR t_out.display_check_in = 'Missing');

-- For each manual check-out record, ensure there's a matching check-in record with correct display values
WITH manual_check_outs AS (
  SELECT 
    id, 
    employee_id, 
    timestamp::date as record_date,
    shift_type,
    display_check_in,
    display_check_out,
    working_week_start,
    extract(hour from timestamp) as hour
  FROM time_records
  WHERE 
    status = 'check_out' 
    AND (is_manual_entry = true OR notes LIKE '%Employee submitted%')
),
manual_check_ins AS (
  SELECT 
    id, 
    employee_id, 
    timestamp::date as record_date,
    shift_type,
    display_check_in,
    display_check_out,
    working_week_start,
    extract(hour from timestamp) as hour
  FROM time_records
  WHERE 
    status = 'check_in' 
    AND (is_manual_entry = true OR notes LIKE '%Employee submitted%')
)
UPDATE time_records t_in
SET 
  display_check_out = t_out.display_check_out
FROM manual_check_outs t_out
WHERE 
  t_in.employee_id = t_out.employee_id
  AND t_in.status = 'check_in'
  AND (t_in.is_manual_entry = true OR t_in.notes LIKE '%Employee submitted%')
  AND (
    -- Same day records
    (t_in.timestamp::date = t_out.record_date)
    OR
    -- Night shift records where check-out is next day morning
    (t_in.shift_type = 'night' 
     AND t_out.record_date = t_in.timestamp::date + interval '1 day'
     AND t_out.hour < 12) -- FIXED: Using hour from the CTE instead of extracting from timestamp
  )
  AND (t_in.display_check_out IS NULL OR t_in.display_check_out = 'Missing');

-- Fix any remaining manual night shift checkouts with working_week_start issues
UPDATE time_records
SET working_week_start = (timestamp::date - interval '1 day')::date
WHERE 
  shift_type = 'night'
  AND status = 'check_out'
  AND extract(hour from timestamp) < 12
  AND (is_manual_entry = true OR notes LIKE '%Employee submitted%')
  AND (working_week_start IS NULL OR working_week_start = timestamp::date);

-- Create more efficient display index
CREATE INDEX IF NOT EXISTS idx_time_records_display
ON time_records(display_check_in, display_check_out);

-- Standardize trigger function for future manual entries
CREATE OR REPLACE FUNCTION standardize_manual_shift_times()
RETURNS TRIGGER AS $$
BEGIN
  -- For manual time entries, set display values based on shift type
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

    -- Set standard display values for check-in and check-out
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

-- Create trigger to standardize manual entry times
DROP TRIGGER IF EXISTS trg_standardize_manual_shift_times ON time_records;
CREATE TRIGGER trg_standardize_manual_shift_times
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION standardize_manual_shift_times();