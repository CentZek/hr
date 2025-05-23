/*
  # Fix RLS policies for holidays table

  1. Changes
     - Drop existing RLS policies for the holidays table
     - Create new properly configured RLS policies to allow authenticated users to perform CRUD operations
     
  2. Security
     - Maintain Row Level Security on the holidays table
     - Configure policies to allow authenticated users to read, create, update, and delete holidays
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Allow authenticated users to delete holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow authenticated users to insert holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow authenticated users to read holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow authenticated users to update holiday data" ON public.holidays;

-- Recreate policies with proper permissions
CREATE POLICY "Allow authenticated users to read holiday data"
ON public.holidays
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to insert holiday data"
ON public.holidays
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update holiday data"
ON public.holidays
FOR UPDATE
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to delete holiday data"
ON public.holidays
FOR DELETE
USING (auth.role() = 'authenticated');