/*
  # Add Document Support for Leave Requests
  
  1. Changes
     - Add document_url column to leave_requests table
     - Add document_name column to leave_requests table
     - Add document_type column to leave_requests table
     - Create an index for document_url to improve query performance
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