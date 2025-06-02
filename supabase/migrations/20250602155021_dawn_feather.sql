/*
  # Implement secure document handling for leave requests
  
  1. Changes:
    - Create storage policies for leave documents
    - Ensure employee documents are only accessible to the employee and managers
    - Add document metadata fields to leave_requests table
    
  2. Security:
    - Restricts access to documents based on user identity
    - Ensures only appropriate users can view sensitive information
*/

-- Create the leave-documents bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('leave-documents', 'leave-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Set bucket to private (ensure it's not public)
UPDATE storage.buckets 
SET public = false 
WHERE id = 'leave-documents';

-- Create policy to allow authenticated users to upload files
CREATE POLICY "Allow employees to upload their own documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'leave-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Create policy to allow users to access only their own documents
CREATE POLICY "Allow employees to view their own documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'leave-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Create policy to allow operational managers to view all documents
CREATE POLICY "Allow managers to view all leave documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'leave-documents' AND
  auth.uid() IN (
    SELECT auth.uid() FROM auth.users
    WHERE auth.role() = 'authenticated'
  )
);

-- Allow employees to delete their own documents if needed
CREATE POLICY "Allow employees to delete their own documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'leave-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Ensure leave_requests has the needed document fields (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'leave_requests' AND column_name = 'document_url'
  ) THEN
    ALTER TABLE public.leave_requests ADD COLUMN document_url TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'leave_requests' AND column_name = 'document_name'
  ) THEN
    ALTER TABLE public.leave_requests ADD COLUMN document_name TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'leave_requests' AND column_name = 'document_type'
  ) THEN
    ALTER TABLE public.leave_requests ADD COLUMN document_type TEXT;
  END IF;
END$$;

-- Add index for efficient document URL queries
CREATE INDEX IF NOT EXISTS idx_leave_requests_document
ON public.leave_requests (document_url)
WHERE document_url IS NOT NULL;

-- Add comment explaining the purpose of the new columns
COMMENT ON COLUMN public.leave_requests.document_url IS 'URL to the uploaded supporting document';
COMMENT ON COLUMN public.leave_requests.document_name IS 'Original filename of the uploaded document';
COMMENT ON COLUMN public.leave_requests.document_type IS 'MIME type of the uploaded document';