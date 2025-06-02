/*
  # Add Storage Bucket and Policies for Leave Documents
  
  1. New Features
    - Creates a storage bucket for leave document uploads
    - Sets up proper RLS policies for the bucket
    - Allows users to upload documents for leave requests
    
  2. Security
    - Ensures only authenticated users can upload files
    - Uses proper security policies for file access
*/

-- Create extension if not exists
CREATE EXTENSION IF NOT EXISTS "storage";

-- Create the leave-documents bucket if it doesn't exist
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('leave-documents', 'leave-documents', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Enable RLS on the buckets table
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

-- Enable RLS on the objects table
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to insert files
CREATE POLICY "Allow authenticated users to upload leave documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'leave-documents');

-- Create policy to allow authenticated users to select files
CREATE POLICY "Allow authenticated users to view leave documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'leave-documents');

-- Create policy to allow authenticated users to update their own files
CREATE POLICY "Allow authenticated users to update their own leave documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'leave-documents')
WITH CHECK (bucket_id = 'leave-documents');

-- Create policy to allow authenticated users to delete their own files
CREATE POLICY "Allow authenticated users to delete leave documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'leave-documents');

-- Add column to leave_requests for document URL, name, and type if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'document_url'
  ) THEN
    ALTER TABLE leave_requests ADD COLUMN document_url TEXT COMMENT 'URL to the uploaded supporting document';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'document_name'
  ) THEN
    ALTER TABLE leave_requests ADD COLUMN document_name TEXT COMMENT 'Original filename of the uploaded document';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'document_type'
  ) THEN
    ALTER TABLE leave_requests ADD COLUMN document_type TEXT COMMENT 'MIME type of the uploaded document';
  END IF;
END $$;

-- Create index for document URL to improve query performance
CREATE INDEX IF NOT EXISTS idx_leave_requests_document ON leave_requests(document_url) WHERE (document_url IS NOT NULL);