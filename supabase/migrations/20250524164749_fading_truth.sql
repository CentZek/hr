/*
  # Create tables for storing processed Excel data
  
  1. New Tables
    - `processed_excel_files` - Stores metadata about uploaded Excel files
    - `processed_employee_data` - Stores processed employee records
    - `processed_daily_records` - Stores daily records for each employee
    
  2. Data Integrity
    - Foreign key relationships maintain data consistency
    - Cascade delete ensures related records are removed when a file is deleted
    - Indexes improve query performance
*/

-- Table to store metadata about uploaded Excel files
CREATE TABLE IF NOT EXISTS processed_excel_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  uploaded_by text,
  uploaded_at timestamptz DEFAULT now(),
  total_employees integer DEFAULT 0,
  total_days integer DEFAULT 0,
  is_active boolean DEFAULT true
);

-- Table to store processed employee records
CREATE TABLE IF NOT EXISTS processed_employee_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES processed_excel_files(id) ON DELETE CASCADE,
  employee_number text NOT NULL,
  name text NOT NULL,
  department text,
  total_days integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Table to store daily records for each employee
CREATE TABLE IF NOT EXISTS processed_daily_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES processed_employee_data(id) ON DELETE CASCADE,
  date text NOT NULL,
  first_check_in timestamptz,
  last_check_out timestamptz,
  hours_worked numeric(10,2) DEFAULT 0,
  approved boolean DEFAULT false,
  shift_type text,
  notes text,
  missing_check_in boolean DEFAULT false,
  missing_check_out boolean DEFAULT false,
  is_late boolean DEFAULT false,
  early_leave boolean DEFAULT false,
  excessive_overtime boolean DEFAULT false,
  penalty_minutes integer DEFAULT 0,
  corrected_records boolean DEFAULT false,
  display_check_in text,
  display_check_out text,
  working_week_start text,
  created_at timestamptz DEFAULT now(),
  
  -- Store raw time records as JSONB for flexibility
  all_time_records jsonb
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_processed_employee_data_file_id ON processed_employee_data(file_id);
CREATE INDEX IF NOT EXISTS idx_processed_daily_records_employee_id ON processed_daily_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_processed_daily_records_date ON processed_daily_records(date);
CREATE INDEX IF NOT EXISTS idx_processed_daily_records_approved ON processed_daily_records(approved);

-- Enable RLS
ALTER TABLE processed_excel_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_employee_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_daily_records ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Enable read for all users" ON processed_excel_files FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON processed_excel_files FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON processed_excel_files FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete for all users" ON processed_excel_files FOR DELETE USING (true);

CREATE POLICY "Enable read for all users" ON processed_employee_data FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON processed_employee_data FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON processed_employee_data FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete for all users" ON processed_employee_data FOR DELETE USING (true);

CREATE POLICY "Enable read for all users" ON processed_daily_records FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON processed_daily_records FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON processed_daily_records FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete for all users" ON processed_daily_records FOR DELETE USING (true);