/*
  # Update Holidays Table RLS Policies

  1. Changes
     - Drop existing RLS policies for holidays table
     - Create new simplified RLS policies that allow all authenticated users to perform CRUD operations
     - Enable select access for anonymous users

  2. Security
     - Maintain RLS protection
     - Ensure authenticated users can properly insert, update, and delete holiday records
     - Allow anonymous users to read holiday data
*/

-- Drop existing policies to recreate them with proper permissions
DROP POLICY IF EXISTS "holidays_delete_policy" ON "public"."holidays";
DROP POLICY IF EXISTS "holidays_insert_policy" ON "public"."holidays";
DROP POLICY IF EXISTS "holidays_select_policy" ON "public"."holidays";
DROP POLICY IF EXISTS "holidays_update_policy" ON "public"."holidays";

-- Create new policies with proper permissions
CREATE POLICY "Enable read access for all users" 
ON "public"."holidays"
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Enable insert access for authenticated users"
ON "public"."holidays"
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update access for authenticated users"
ON "public"."holidays"
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Enable delete access for authenticated users"
ON "public"."holidays"
FOR DELETE
TO authenticated
USING (true);