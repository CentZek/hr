/*
  # Fix Row Level Security Policies for holidays table

  1. Changes
    - Drop existing RLS policies for the holidays table
    - Create new policies that allow proper access:
      - Allow authenticated users to insert new holidays
      - Allow authenticated users to update and delete holidays
      - Allow both authenticated and anonymous users to read holidays
*/

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to delete holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow authenticated users to insert holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow authenticated users to read holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow authenticated users to update holiday data" ON public.holidays;
DROP POLICY IF EXISTS "Allow public to read holiday data" ON public.holidays;

-- Create new policies with correct permissions
CREATE POLICY "holidays_insert_policy" ON public.holidays
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "holidays_select_policy" ON public.holidays
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "holidays_update_policy" ON public.holidays
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "holidays_delete_policy" ON public.holidays
  FOR DELETE
  TO authenticated
  USING (true);

-- Ensure RLS is enabled
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;