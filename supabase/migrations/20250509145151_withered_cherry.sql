/*
  # Fix Shift Time Display Consistency
  
  1. Changes:
    - Fix inconsistency between saved and displayed shift times
    - Ensure manually submitted shifts show standard times based on shift type
    - Properly preserve check-in and check-out display values
    
  2. Data Integrity:
    - Update existing records to use standardized shift times
    - Create trigger to enforce standard shift times on future inserts
    - Maintain consistency between Face ID Data and Approved Hours views
*/

-- Create helper function to get standard shift times
CREATE OR REPLACE FUNCTION get_standard_shift_times(shift_type text)
RETURNS TABLE(start_time text, end_time text) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN shift_type = 'morning' THEN '05:00'
      WHEN shift_type = 'evening' THEN '13:00'
      WHEN shift_type = 'night' THEN '21:00'
      WHEN shift_type = 'canteen' AND extract(hour from current_timestamp) = 7 THEN '07:00'
      WHEN shift_type = 'canteen' THEN '08:00'
      ELSE '08:00'
    END AS start_time,
    CASE
      WHEN shift_type = 'morning' THEN '14:00'
      WHEN shift_type = 'evening' THEN '22:00'
      WHEN shift_type = 'night' THEN '06:00'
      WHEN shift_type = 'canteen' AND extract(hour from current_timestamp) = 7 THEN '16:00'
      WHEN shift_type = 'canteen' THEN '17:00'
      ELSE '17:00'
    END AS end_time;
END;
$$ LANGUAGE plpgsql;

-- Fix display values for existing manually entered records
DO $$
DECLARE
  fixed_count integer := 0;
BEGIN
  -- First fix morning shift records
  WITH standard_times AS (
    SELECT '05:00' as start_time, '14:00' as end_time
  )
  UPDATE time_records t
  SET 
    display_check_in = CASE WHEN t.status = 'check_in' THEN st.start_time ELSE t.display_check_in END,
    display_check_out = CASE WHEN t.status = 'check_out' THEN st.end_time ELSE t.display_check_out END
  FROM standard_times st
  WHERE 
    t.shift_type = 'morning' 
    AND t.is_manual_entry = true 
    AND (
      (t.status = 'check_in' AND t.display_check_in IS DISTINCT FROM st.start_time) OR
      (t.status = 'check_out' AND t.display_check_out IS DISTINCT FROM st.end_time)
    );

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % morning shift manual records', fixed_count;
  
  -- Fix evening shift records
  WITH standard_times AS (
    SELECT '13:00' as start_time, '22:00' as end_time
  )
  UPDATE time_records t
  SET 
    display_check_in = CASE WHEN t.status = 'check_in' THEN st.start_time ELSE t.display_check_in END,
    display_check_out = CASE WHEN t.status = 'check_out' THEN st.end_time ELSE t.display_check_out END
  FROM standard_times st
  WHERE 
    t.shift_type = 'evening' 
    AND t.is_manual_entry = true 
    AND (
      (t.status = 'check_in' AND t.display_check_in IS DISTINCT FROM st.start_time) OR
      (t.status = 'check_out' AND t.display_check_out IS DISTINCT FROM st.end_time)
    );

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % evening shift manual records', fixed_count;
  
  -- Fix night shift records
  WITH standard_times AS (
    SELECT '21:00' as start_time, '06:00' as end_time
  )
  UPDATE time_records t
  SET 
    display_check_in = CASE WHEN t.status = 'check_in' THEN st.start_time ELSE t.display_check_in END,
    display_check_out = CASE WHEN t.status = 'check_out' THEN st.end_time ELSE t.display_check_out END
  FROM standard_times st
  WHERE 
    t.shift_type = 'night' 
    AND t.is_manual_entry = true 
    AND (
      (t.status = 'check_in' AND t.display_check_in IS DISTINCT FROM st.start_time) OR
      (t.status = 'check_out' AND t.display_check_out IS DISTINCT FROM st.end_time)
    );

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % night shift manual records', fixed_count;
  
  -- Fix canteen shift records
  WITH standard_times AS (
    SELECT '07:00' as start_time, '16:00' as end_time
  )
  UPDATE time_records t
  SET 
    display_check_in = CASE WHEN t.status = 'check_in' THEN st.start_time ELSE t.display_check_in END,
    display_check_out = CASE WHEN t.status = 'check_out' THEN st.end_time ELSE t.display_check_out END
  FROM standard_times st
  WHERE 
    t.shift_type = 'canteen' 
    AND t.is_manual_entry = true 
    AND extract(hour from t.timestamp) = 7
    AND (
      (t.status = 'check_in' AND t.display_check_in IS DISTINCT FROM st.start_time) OR
      (t.status = 'check_out' AND t.display_check_out IS DISTINCT FROM st.end_time)
    );

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % early canteen shift manual records', fixed_count;
  
  WITH standard_times AS (
    SELECT '08:00' as start_time, '17:00' as end_time
  )
  UPDATE time_records t
  SET 
    display_check_in = CASE WHEN t.status = 'check_in' THEN st.start_time ELSE t.display_check_in END,
    display_check_out = CASE WHEN t.status = 'check_out' THEN st.end_time ELSE t.display_check_out END
  FROM standard_times st
  WHERE 
    t.shift_type = 'canteen' 
    AND t.is_manual_entry = true 
    AND extract(hour from t.timestamp) = 8
    AND (
      (t.status = 'check_in' AND t.display_check_in IS DISTINCT FROM st.start_time) OR
      (t.status = 'check_out' AND t.display_check_out IS DISTINCT FROM st.end_time)
    );

  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % late canteen shift manual records', fixed_count;
END $$;

-- For check-in/check-out pairs, ensure both have the same display values 
DO $$
DECLARE
  fixed_count integer := 0;
BEGIN
  WITH paired_records AS (
    SELECT 
      c_in.id AS check_in_id,
      c_out.id AS check_out_id,
      c_in.display_check_in,
      c_out.display_check_out
    FROM 
      time_records c_in
      JOIN time_records c_out ON 
        c_in.employee_id = c_out.employee_id 
        AND c_in.timestamp::date = c_out.timestamp::date
        AND c_in.status = 'check_in' 
        AND c_out.status = 'check_out'
        AND c_in.shift_type = c_out.shift_type  -- Same shift type
        AND c_in.is_manual_entry = true  -- Only for manual entries
        AND c_out.is_manual_entry = true
    WHERE
      c_in.display_check_out IS DISTINCT FROM c_out.display_check_out
      OR c_out.display_check_in IS DISTINCT FROM c_in.display_check_in
  )
  UPDATE time_records t
  SET 
    display_check_in = pr.display_check_in,
    display_check_out = pr.display_check_out
  FROM paired_records pr
  WHERE (t.id = pr.check_in_id OR t.id = pr.check_out_id)
    AND (
      (t.id = pr.check_in_id AND t.display_check_out IS DISTINCT FROM pr.display_check_out) OR
      (t.id = pr.check_out_id AND t.display_check_in IS DISTINCT FROM pr.display_check_in)
    );
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % records with inconsistent display values between pairs', fixed_count;
END $$;

-- Create trigger function to standardize display values for manual entries
CREATE OR REPLACE FUNCTION standardize_manual_shift_times()
RETURNS TRIGGER AS $$
DECLARE
  std_times RECORD;
BEGIN
  -- Only process manual entries and employee-submitted shifts
  IF NEW.is_manual_entry = true AND NEW.shift_type IS NOT NULL THEN
    -- Get standard times based on shift type
    SELECT * INTO std_times FROM get_standard_shift_times(NEW.shift_type);
    
    -- Set display values based on status
    IF NEW.status = 'check_in' THEN
      NEW.display_check_in := std_times.start_time;
      NEW.display_check_out := std_times.end_time;
    ELSIF NEW.status = 'check_out' THEN
      NEW.display_check_in := std_times.start_time;
      NEW.display_check_out := std_times.end_time;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to standardize manual entry times
DROP TRIGGER IF EXISTS trg_standardize_manual_shift_times ON time_records;
CREATE TRIGGER trg_standardize_manual_shift_times
BEFORE INSERT ON time_records
FOR EACH ROW
WHEN (NEW.is_manual_entry = true)
EXECUTE FUNCTION standardize_manual_shift_times();