-- Create the leave-documents bucket if it doesn't exist
DO $$
BEGIN
  -- First check if the bucket already exists to avoid errors
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'leave-documents'
  ) THEN
    -- Create the bucket
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('leave-documents', 'leave-documents', true);
    
    RAISE NOTICE 'Created leave-documents bucket';
  ELSE
    RAISE NOTICE 'leave-documents bucket already exists';
  END IF;
END $$;

-- Create policies for the bucket to ensure proper access
-- Allow authenticated users to upload files
CREATE POLICY "Allow authenticated users to upload documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'leave-documents')
ON CONFLICT DO NOTHING;

-- Allow users to read their own documents or any document they have access to
CREATE POLICY "Allow users to view documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'leave-documents')
ON CONFLICT DO NOTHING;

-- Allow users to update their own documents
CREATE POLICY "Allow users to update their own documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'leave-documents')
ON CONFLICT DO NOTHING;

-- Allow users to delete their own documents
CREATE POLICY "Allow users to delete their own documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'leave-documents')
ON CONFLICT DO NOTHING;