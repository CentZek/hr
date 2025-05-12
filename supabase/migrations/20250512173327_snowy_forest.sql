/*
  # Fix holidays table RLS policies

  1. Security
     - Create public access policies for holidays table
     - Allow all operations (SELECT, INSERT, UPDATE, DELETE)
     - Enable RLS to ensure policies take effect
*/

-- First drop any existing policies on the holidays table to start fresh
DROP POLICY IF EXISTS "Allow public select" ON holidays;
DROP POLICY IF EXISTS "Allow public insert" ON holidays;
DROP POLICY IF EXISTS "Allow public update" ON holidays;
DROP POLICY IF EXISTS "Allow public delete" ON holidays;

-- Make sure RLS is enabled
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

-- Create policies that allow public access for all operations
-- This will let anyone read, insert, update, or delete holidays
CREATE POLICY "Allow public select" 
ON holidays
FOR SELECT
TO public
USING (true);

CREATE POLICY "Allow public insert" 
ON holidays
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "Allow public update" 
ON holidays
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public delete" 
ON holidays
FOR DELETE
TO public
USING (true);