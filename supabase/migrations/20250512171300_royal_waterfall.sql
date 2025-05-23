/*
  # Fix Holiday Table RLS Policies

  1. Changes
     - Drop all existing RLS policies for the holidays table
     - Create new comprehensive RLS policies that properly allow authenticated users to perform all operations
     
  2. Security
     - Enable RLS on holidays table (already enabled)
     - Create policies to allow authenticated users to select, insert, update, and delete holiday data
*/

-- First, let's drop the existing policies that might be causing issues
DROP POLICY IF EXISTS "Allow authenticated users to insert holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow authenticated users to read holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow authenticated users to update holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow authenticated users to delete holiday data" ON public.holidays;

-- Now recreate the policies with proper configurations
-- Policy for SELECT operations
CREATE POLICY "Allow authenticated users to read holiday data"
ON public.holidays
FOR SELECT
TO authenticated
USING (true);

-- Policy for INSERT operations
CREATE POLICY "Allow authenticated users to insert holiday data"
ON public.holidays
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy for UPDATE operations
CREATE POLICY "Allow authenticated users to update holiday data"
ON public.holidays
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Policy for DELETE operations
CREATE POLICY "Allow authenticated users to delete holiday data"
ON public.holidays
FOR DELETE
TO authenticated
USING (true);

-- Make sure RLS is enabled (should already be, but just to be safe)
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;