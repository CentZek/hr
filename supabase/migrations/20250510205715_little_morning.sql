/*
  # Fix night shift records

  1. Changes
    - Fix night shift check-out records by properly setting working_week_start to previous day
    - Update all manual and employee-submitted records to have correct working_week_start field
*/

-- Back-fill every manual/HR-approved check-out with the correct working_week_start
UPDATE time_records
SET working_week_start = (
  CASE
    WHEN shift_type = 'night'
      AND status = 'check_out'
      AND EXTRACT(hour FROM timestamp) < 12
    THEN (timestamp::date - INTERVAL '1 day')::date
    ELSE timestamp::date
  END
)
WHERE is_manual_entry = TRUE
  OR notes LIKE '%Employee submitted%';

-- Also fix records where working_week_start is NULL
UPDATE time_records
SET working_week_start = (
  CASE
    WHEN shift_type = 'night'
      AND status = 'check_out'
      AND EXTRACT(hour FROM timestamp) < 12
    THEN (timestamp::date - INTERVAL '1 day')::date
    ELSE timestamp::date
  END
)
WHERE working_week_start IS NULL;

-- Ensure all pairs of check-in and check-out for the same shift have the same working_week_start
WITH check_ins AS (
  SELECT 
    id, 
    employee_id, 
    working_week_start,
    shift_type
  FROM time_records
  WHERE status = 'check_in'
    AND working_week_start IS NOT NULL
)
UPDATE time_records t
SET working_week_start = ci.working_week_start
FROM check_ins ci
WHERE t.employee_id = ci.employee_id
  AND t.status = 'check_out'
  AND t.shift_type = ci.shift_type
  AND (
    -- Same day shift
    (t.timestamp::date = ci.working_week_start)
    -- Night shift where check-out is next day morning
    OR (
      ci.shift_type = 'night'
      AND t.timestamp::date = ci.working_week_start + interval '1 day'
      AND EXTRACT(hour FROM t.timestamp) < 12
    )
  )
  AND (t.working_week_start IS NULL OR t.working_week_start != ci.working_week_start);