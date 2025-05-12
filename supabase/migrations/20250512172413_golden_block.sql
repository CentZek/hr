/*
  # Fix Holidays Table RLS Policy

  1. Changes
     - Updates the RLS policies for the holidays table to allow proper insertion
     - Ensures authenticated users can insert, update, and delete holiday records
     - Maintains existing policies for selecting records

  This migration addresses the "new row violates row-level security policy" error
  by ensuring authenticated users have proper permissions to manage holiday records.
*/

-- First, check if the holidays table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'holidays') THEN
    -- Drop existing policies to recreate them with proper permissions
    DROP POLICY IF EXISTS holidays_insert_policy ON public.holidays;
    DROP POLICY IF EXISTS holidays_update_policy ON public.holidays;
    DROP POLICY IF EXISTS holidays_delete_policy ON public.holidays;
    DROP POLICY IF EXISTS holidays_select_policy ON public.holidays;

    -- Create proper policies for all operations
    CREATE POLICY holidays_insert_policy ON public.holidays
      FOR INSERT
      TO authenticated
      WITH CHECK (true);

    CREATE POLICY holidays_update_policy ON public.holidays
      FOR UPDATE
      TO authenticated
      USING (true)
      WITH CHECK (true);

    CREATE POLICY holidays_delete_policy ON public.holidays
      FOR DELETE
      TO authenticated
      USING (true);

    CREATE POLICY holidays_select_policy ON public.holidays
      FOR SELECT
      TO anon, authenticated
      USING (true);

    -- Make sure RLS is enabled
    ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;