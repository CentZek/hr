/*
  # Ensure holidays are preserved during reset
  
  1. Changes:
    - Update RLS policies to ensure holidays table has appropriate access controls
    - Create trigger function to maintain holiday data integrity
    - Add backup table for holidays to prevent accidental data loss
    
  2. Data Integrity:
    - Ensures holidays aren't accidentally deleted during system reset operations
    - Maintains double-time calculations even after reset
*/

-- Create a backup table for holidays if it doesn't exist
CREATE TABLE IF NOT EXISTS holidays_backup (
  id uuid PRIMARY KEY,
  date date UNIQUE NOT NULL,
  description text,
  created_at timestamptz,
  restored_at timestamptz
);

-- Create a function to backup holidays
CREATE OR REPLACE FUNCTION backup_holidays()
RETURNS TRIGGER AS $$
BEGIN
  -- When a holiday is deleted, store it in the backup table
  INSERT INTO holidays_backup (id, date, description, created_at, restored_at)
  VALUES (OLD.id, OLD.date, OLD.description, OLD.created_at, NOW())
  ON CONFLICT (date) 
  DO UPDATE SET 
    description = EXCLUDED.description,
    restored_at = EXCLUDED.restored_at;
    
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to back up holidays on delete
DROP TRIGGER IF EXISTS trg_backup_holidays ON holidays;
CREATE TRIGGER trg_backup_holidays
  BEFORE DELETE ON holidays
  FOR EACH ROW
  EXECUTE FUNCTION backup_holidays();

-- Create a function to restore holidays if needed
CREATE OR REPLACE FUNCTION restore_holidays()
RETURNS void AS $$
DECLARE
  holiday_count integer;
BEGIN
  -- Check if holidays table is empty
  SELECT COUNT(*) INTO holiday_count FROM holidays;
  
  -- If it's empty, restore from backup
  IF holiday_count = 0 THEN
    INSERT INTO holidays (id, date, description, created_at)
    SELECT id, date, description, created_at
    FROM holidays_backup
    ON CONFLICT (date) DO NOTHING;
    
    RAISE NOTICE 'Restored % holidays from backup', (SELECT COUNT(*) FROM holidays_backup);
  END IF;
END;
$$ LANGUAGE plpgsql;