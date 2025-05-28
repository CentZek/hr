/*
  # Add cascade delete to processed data tables

  1. Changes
    - Add ON DELETE CASCADE to foreign key constraints to ensure that when a processed_excel_files record is deleted,
      related processed_employee_data records are automatically deleted.
    - This prevents foreign key constraint violations when manipulating data.

  2. Benefits
    - Prevents foreign key constraint violations
    - Ensures data consistency
    - Simplifies reset functionality
*/

-- First, drop the existing constraint
ALTER TABLE IF EXISTS public.processed_employee_data
DROP CONSTRAINT IF EXISTS processed_employee_data_file_id_fkey;

-- Then, add it back with ON DELETE CASCADE
ALTER TABLE IF EXISTS public.processed_employee_data
ADD CONSTRAINT processed_employee_data_file_id_fkey 
FOREIGN KEY (file_id) 
REFERENCES processed_excel_files(id) 
ON DELETE CASCADE;

-- Also ensure that the processed_daily_records table has the correct cascade behavior
ALTER TABLE IF EXISTS public.processed_daily_records
DROP CONSTRAINT IF EXISTS processed_daily_records_employee_id_fkey;

ALTER TABLE IF EXISTS public.processed_daily_records
ADD CONSTRAINT processed_daily_records_employee_id_fkey 
FOREIGN KEY (employee_id) 
REFERENCES processed_employee_data(id) 
ON DELETE CASCADE;