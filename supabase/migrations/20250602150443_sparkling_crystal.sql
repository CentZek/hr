/*
  # Add Document Attachments to Leave Requests
  
  1. Changes:
    - Add document_url column to leave_requests table to store uploaded document URLs
    - Add document_name column to store the original filename for better UX
    - Add document_type column to store the MIME type of the uploaded document
    
  2. Security:
    - RLS policies remain unchanged, preserving existing access controls
*/

-- Add document-related columns to leave_requests table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'document_url'
  ) THEN
    ALTER TABLE public.leave_requests ADD COLUMN document_url TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'document_name'
  ) THEN
    ALTER TABLE public.leave_requests ADD COLUMN document_name TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'document_type'
  ) THEN
    ALTER TABLE public.leave_requests ADD COLUMN document_type TEXT;
  END IF;
END $$;

-- Create index for efficient queries on document URLs
CREATE INDEX IF NOT EXISTS idx_leave_requests_document
ON public.leave_requests(document_url)
WHERE document_url IS NOT NULL;

-- Update RLS policy to ensure proper access to document attachments
-- (existing policies already cover access to the new columns)