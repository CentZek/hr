/*
  # Fix holidays table RLS policies

  1. Adjustments
    - Drop all existing RLS policies for the holidays table
    - Create new policies that properly allow:
      - INSERT for authenticated users
      - SELECT for both anonymous and authenticated users
      - UPDATE for authenticated users
      - DELETE for authenticated users
  
  This fixes the "new row violates row-level security policy" error.
*/

-- First, drop all existing policies on the holidays table
DROP POLICY IF EXISTS holidays_delete_policy ON public.holidays;
DROP POLICY IF EXISTS holidays_insert_policy ON public.holidays;
DROP POLICY IF EXISTS holidays_select_policy ON public.holidays;
DROP POLICY IF EXISTS holidays_update_policy ON public.holidays;

-- Ensure RLS is enabled
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

-- Create policy for INSERT
CREATE POLICY "holidays_insert_policy"
  ON public.holidays
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create policy for SELECT (readable by anyone)
CREATE POLICY "holidays_select_policy"
  ON public.holidays
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Create policy for UPDATE
CREATE POLICY "holidays_update_policy"
  ON public.holidays
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create policy for DELETE
CREATE POLICY "holidays_delete_policy"
  ON public.holidays
  FOR DELETE
  TO authenticated
  USING (true);