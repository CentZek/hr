/*
  # Add document fields to leave_requests table
  
  1. Changes
    - Add columns to store document information in leave_requests table
    - Create index to improve query performance for document lookups
    
  2. Note
    - Storage bucket creation and permissions must be handled through the Supabase dashboard
    - This migration only handles the database schema changes
*/

-- Add column to leave_requests for document URL, name, and type if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'document_url'
  ) THEN
    ALTER TABLE leave_requests ADD COLUMN document_url TEXT;
    COMMENT ON COLUMN leave_requests.document_url IS 'URL to the uploaded supporting document';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'document_name'
  ) THEN
    ALTER TABLE leave_requests ADD COLUMN document_name TEXT;
    COMMENT ON COLUMN leave_requests.document_name IS 'Original filename of the uploaded document';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'document_type'
  ) THEN
    ALTER TABLE leave_requests ADD COLUMN document_type TEXT;
    COMMENT ON COLUMN leave_requests.document_type IS 'MIME type of the uploaded document';
  END IF;
END $$;

-- Create index for document URL to improve query performance
CREATE INDEX IF NOT EXISTS idx_leave_requests_document ON leave_requests(document_url) WHERE (document_url IS NOT NULL);