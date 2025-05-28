/*
  # Fix Foreign Key Constraint on processed_daily_records
  
  1. Changes
    - Drop and recreate the foreign key constraint on processed_daily_records
    - Fix cascading delete when an employee record is deleted
    - Enable RLS policies to allow proper access to all processed tables
  
  2. Security
    - Ensure proper access controls while fixing the constraint issue
*/

-- First, check if we need to drop and recreate the constraint
DO $$
BEGIN
  -- Drop the existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processed_daily_records_employee_id_fkey'
  ) THEN
    ALTER TABLE processed_daily_records
    DROP CONSTRAINT processed_daily_records_employee_id_fkey;
  END IF;
  
  -- Create the constraint with proper cascading
  ALTER TABLE processed_daily_records
  ADD CONSTRAINT processed_daily_records_employee_id_fkey
  FOREIGN KEY (employee_id)
  REFERENCES processed_employee_data(id)
  ON DELETE CASCADE;
  
  -- Make sure processed_employee_data has a proper constraint to processed_excel_files
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processed_employee_data_file_id_fkey'
  ) THEN
    ALTER TABLE processed_employee_data
    DROP CONSTRAINT processed_employee_data_file_id_fkey;
  END IF;
  
  ALTER TABLE processed_employee_data
  ADD CONSTRAINT processed_employee_data_file_id_fkey
  FOREIGN KEY (file_id)
  REFERENCES processed_excel_files(id)
  ON DELETE CASCADE;
  
  -- Ensure all tables have proper RLS policies
  -- For processed_excel_files
  DROP POLICY IF EXISTS "Allow full access for all users" ON processed_excel_files;
  CREATE POLICY "Allow full access for all users" 
  ON processed_excel_files
  FOR ALL 
  TO public
  USING (true) 
  WITH CHECK (true);
  
  -- For processed_employee_data
  DROP POLICY IF EXISTS "Allow full access for all users" ON processed_employee_data;
  CREATE POLICY "Allow full access for all users" 
  ON processed_employee_data
  FOR ALL 
  TO public
  USING (true) 
  WITH CHECK (true);
  
  -- For processed_daily_records
  DROP POLICY IF EXISTS "Allow full access for all users" ON processed_daily_records;
  CREATE POLICY "Allow full access for all users" 
  ON processed_daily_records
  FOR ALL 
  TO public
  USING (true) 
  WITH CHECK (true);
  
  -- Enable RLS on all tables
  ALTER TABLE processed_excel_files ENABLE ROW LEVEL SECURITY;
  ALTER TABLE processed_employee_data ENABLE ROW LEVEL SECURITY;
  ALTER TABLE processed_daily_records ENABLE ROW LEVEL SECURITY;
END $$;