/*
  # Fix holidays table RLS policies

  1. Changes
    - Update RLS policies on the holidays table to ensure authenticated users can perform CRUD operations
    - Adds a policy for anonymous users to read holiday data
  
  2. Security
    - Ensures proper access control for the holidays table
    - Allows authenticated users to manage holidays
    - Allows public (anonymous) access for reading holidays
*/

-- First drop existing policies to recreate them
DROP POLICY IF EXISTS "Allow authenticated users to delete holiday data" ON holidays;
DROP POLICY IF EXISTS "Allow authenticated users to insert holiday data" ON holidays;
DROP POLICY IF EXISTS "Allow authenticated users to read holiday data" ON holidays;
DROP POLICY IF EXISTS "Allow authenticated users to update holiday data" ON holidays;

-- Recreate policies with proper permissions
-- Policy for authenticated users to insert holidays
CREATE POLICY "Allow authenticated users to insert holiday data"
ON holidays
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy for authenticated users to select holidays
CREATE POLICY "Allow authenticated users to read holiday data"
ON holidays
FOR SELECT
TO authenticated
USING (true);

-- Policy for authenticated users to update holidays
CREATE POLICY "Allow authenticated users to update holiday data"
ON holidays
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Policy for authenticated users to delete holidays
CREATE POLICY "Allow authenticated users to delete holiday data"
ON holidays
FOR DELETE
TO authenticated
USING (true);

-- Create a policy for public/anonymous users to read holidays
CREATE POLICY "Allow public to read holiday data"
ON holidays
FOR SELECT
TO anon
USING (true);