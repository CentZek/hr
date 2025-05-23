/*
  # Create holidays table for double-time pay days

  1. New Tables
    - `holidays`
      - `id` (uuid, primary key)
      - `date` (date, unique)
      - `description` (text)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `holidays` table
    - Add policy for authenticated users to read/write holiday data
*/

CREATE TABLE IF NOT EXISTS holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date UNIQUE NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read holiday data"
  ON holidays
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert holiday data"
  ON holidays
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update holiday data"
  ON holidays
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to delete holiday data"
  ON holidays
  FOR DELETE
  TO authenticated
  USING (true);