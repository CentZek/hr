-- Create a backup table for holidays if it doesn't exist
CREATE TABLE IF NOT EXISTS holidays_backup (
  id uuid PRIMARY KEY,
  date date UNIQUE NOT NULL,
  description text,
  created_at timestamptz,
  restored_at timestamptz
);

-- Create function to backup holidays before deletion
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

-- Create trigger to back up holidays on delete
DROP TRIGGER IF EXISTS trg_backup_holidays ON holidays;
CREATE TRIGGER trg_backup_holidays
  BEFORE DELETE ON holidays
  FOR EACH ROW
  EXECUTE FUNCTION backup_holidays();

-- Add comment to explain the purpose of these tables
COMMENT ON TABLE holidays IS 'Stores double-time days for calculating employee pay';
COMMENT ON TABLE holidays_backup IS 'Backup of holidays to preserve during reset operations';