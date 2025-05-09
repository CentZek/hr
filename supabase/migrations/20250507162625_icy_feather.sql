/*
  # Fix Data Preservation Between Face ID Data and Approved Hours
  
  1. Changes:
    - Ensure exact data preservation when saving records to database
    - Fix shift type consistency between check-in and check-out records
    - Preserve display formats exactly as shown in Face ID Data
    
  2. Data Integrity:
    - Use exact 24-hour format (HH:MM) consistently across all display formats
    - Maintain relationship between check-in and check-out pairs
    - Prevent data loss or transformation during approval process
*/

-- Create function to preserve exact display format and shift type
CREATE OR REPLACE FUNCTION preserve_exact_times()
RETURNS TRIGGER AS $$
DECLARE
  original_timestamp timestamptz := NEW.timestamp;
  formatted_time text := to_char(NEW.timestamp, 'HH24:MI');  -- Use 24-hour format
BEGIN
  -- For check-in and check-out records
  IF NEW.status IN ('check_in', 'check_out') THEN
    -- Override the given display values with preserved formats
    IF NEW.status = 'check_in' THEN
      -- Format check-in display value in 24-hour format
      NEW.display_check_in := formatted_time;
    ELSIF NEW.status = 'check_out' THEN
      -- Format check-out display value in 24-hour format
      NEW.display_check_out := formatted_time;
    END IF;
    
    -- Check for paired record (to maintain consistency)
    IF NEW.status = 'check_in' THEN
      -- Look for check-out
      DECLARE
        paired_record record;
      BEGIN
        SELECT id, timestamp, display_check_out 
        INTO paired_record
        FROM time_records
        WHERE employee_id = NEW.employee_id
          AND timestamp::date = NEW.timestamp::date
          AND status = 'check_out'
        LIMIT 1;
        
        IF paired_record.id IS NOT NULL THEN
          -- Use check-out's display value or format its timestamp
          NEW.display_check_out := COALESCE(
            paired_record.display_check_out, 
            to_char(paired_record.timestamp, 'HH24:MI')
          );
          
          -- Also update the check-out record to maintain consistency
          UPDATE time_records
          SET 
            display_check_in = formatted_time,
            shift_type = NEW.shift_type  -- CRITICAL: Maintain shift type consistency
          WHERE id = paired_record.id;
        ELSE
          NEW.display_check_out := 'Missing';
        END IF;
      END;
    ELSIF NEW.status = 'check_out' THEN
      -- Look for check-in
      DECLARE
        paired_record record;
      BEGIN
        SELECT id, timestamp, display_check_in, shift_type
        INTO paired_record
        FROM time_records
        WHERE employee_id = NEW.employee_id
          AND timestamp::date = NEW.timestamp::date
          AND status = 'check_in'
        LIMIT 1;
        
        IF paired_record.id IS NOT NULL THEN
          -- Use check-in's display value or format its timestamp
          NEW.display_check_in := COALESCE(
            paired_record.display_check_in, 
            to_char(paired_record.timestamp, 'HH24:MI')
          );
          
          -- CRITICAL: Use check-in's shift type for consistency
          IF paired_record.shift_type IS NOT NULL THEN
            NEW.shift_type := paired_record.shift_type;
          END IF;
          
          -- Update the check-in record to maintain consistency
          UPDATE time_records
          SET display_check_out = formatted_time
          WHERE id = paired_record.id;
        ELSE
          NEW.display_check_in := 'Missing';
        END IF;
      END;
    END IF;
  ELSIF NEW.status = 'off_day' THEN
    -- For off days, use standard formatted display
    NEW.display_check_in := 'OFF-DAY';
    NEW.display_check_out := 'OFF-DAY';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to preserve exact times
DROP TRIGGER IF EXISTS trg_preserve_exact_times ON time_records;
CREATE TRIGGER trg_preserve_exact_times
BEFORE INSERT ON time_records
FOR EACH ROW
EXECUTE FUNCTION preserve_exact_times();

-- Fix existing records
DO $$
DECLARE
  fixed_count integer := 0;
  total_fixed integer := 0;
BEGIN
  -- Fix records with display format inconsistencies - standardize to 24-hour format
  UPDATE time_records
  SET 
    display_check_in = CASE
      WHEN status = 'check_in' AND display_check_in IS NOT NULL 
           AND display_check_in NOT LIKE 'OFF-DAY' 
           AND display_check_in NOT LIKE 'Missing'
      THEN to_char(timestamp, 'HH24:MI')
      ELSE display_check_in
    END,
    display_check_out = CASE
      WHEN status = 'check_out' AND display_check_out IS NOT NULL 
           AND display_check_out NOT LIKE 'OFF-DAY' 
           AND display_check_out NOT LIKE 'Missing'
      THEN to_char(timestamp, 'HH24:MI')
      ELSE display_check_out
    END
  WHERE 
    (status = 'check_in' AND display_check_in IS NOT NULL AND display_check_in NOT LIKE 'OFF-DAY' AND display_check_in NOT LIKE 'Missing') OR
    (status = 'check_out' AND display_check_out IS NOT NULL AND display_check_out NOT LIKE 'OFF-DAY' AND display_check_out NOT LIKE 'Missing');
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Standardized % records to 24-hour format', fixed_count;
  total_fixed := total_fixed + fixed_count;
  
  -- Fix shift type consistency - check-out should have same shift type as check-in
  WITH paired_records AS (
    SELECT 
      c_in.id AS check_in_id,
      c_out.id AS check_out_id,
      c_in.display_check_in,
      c_out.display_check_out,
      c_in.shift_type AS check_in_shift_type,
      c_out.shift_type AS check_out_shift_type
    FROM 
      time_records c_in
      JOIN time_records c_out ON 
        c_in.employee_id = c_out.employee_id 
        AND c_in.timestamp::date = c_out.timestamp::date
        AND c_in.status = 'check_in' 
        AND c_out.status = 'check_out'
    WHERE 
      c_in.shift_type != c_out.shift_type
      OR c_out.shift_type IS NULL
  )
  UPDATE time_records t
  SET 
    shift_type = pr.check_in_shift_type,
    display_check_in = pr.display_check_in
  FROM paired_records pr
  WHERE t.id = pr.check_out_id
    AND (t.shift_type != pr.check_in_shift_type OR t.shift_type IS NULL);
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % records with shift type consistency issues', fixed_count;
  total_fixed := total_fixed + fixed_count;
  
  -- Fix display value pairings
  -- Update check-in records to include proper check-out display
  WITH paired_records AS (
    SELECT 
      c_in.id AS check_in_id,
      c_out.id AS check_out_id,
      c_out.display_check_out
    FROM 
      time_records c_in
      JOIN time_records c_out ON 
        c_in.employee_id = c_out.employee_id 
        AND c_in.timestamp::date = c_out.timestamp::date
        AND c_in.status = 'check_in' 
        AND c_out.status = 'check_out'
    WHERE 
      (c_in.display_check_out IS NULL OR c_in.display_check_out = 'Missing')
      AND c_out.display_check_out IS NOT NULL
      AND c_out.display_check_out != 'Missing'
  )
  UPDATE time_records t
  SET display_check_out = pr.display_check_out
  FROM paired_records pr
  WHERE t.id = pr.check_in_id;
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Updated % check-in records with proper check-out display', fixed_count;
  total_fixed := total_fixed + fixed_count;
  
  -- Update check-out records to include proper check-in display
  WITH paired_records AS (
    SELECT 
      c_in.id AS check_in_id,
      c_out.id AS check_out_id,
      c_in.display_check_in
    FROM 
      time_records c_in
      JOIN time_records c_out ON 
        c_in.employee_id = c_out.employee_id 
        AND c_in.timestamp::date = c_out.timestamp::date
        AND c_in.status = 'check_in' 
        AND c_out.status = 'check_out'
    WHERE 
      (c_out.display_check_in IS NULL OR c_out.display_check_in = 'Missing')
      AND c_in.display_check_in IS NOT NULL
      AND c_in.display_check_in != 'Missing'
  )
  UPDATE time_records t
  SET display_check_in = pr.display_check_in
  FROM paired_records pr
  WHERE t.id = pr.check_out_id;
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Updated % check-out records with proper check-in display', fixed_count;
  total_fixed := total_fixed + fixed_count;
  
  -- Special handling for canteen shifts - ensure display values are preserved
  UPDATE time_records
  SET display_check_in = CASE 
      WHEN display_check_in = '08:00:00 AM' THEN '08:00'
      WHEN display_check_in = '07:00:00 AM' THEN '07:00'
      ELSE display_check_in
    END,
    display_check_out = CASE
      WHEN display_check_out = '05:00:00 PM' THEN '17:00'
      WHEN display_check_out = '04:00:00 PM' THEN '16:00'
      ELSE display_check_out
    END
  WHERE shift_type = 'canteen' AND (
    display_check_in LIKE '%AM' OR
    display_check_out LIKE '%PM'
  );
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Standardized % canteen shift records', fixed_count;
  total_fixed := total_fixed + fixed_count;
  
  RAISE NOTICE 'Total fixes applied: %', total_fixed;
END $$;