/*
  # Create leave documents storage bucket
  
  1. New Storage
    - Creates a 'leave-documents' bucket for storing employee leave documentation
  
  2. Security
    - Enables public access for authenticated users
    - Adds policies for authenticated users to manage their own documents
*/

-- Create the leave-documents bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('leave-documents', 'leave-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Create policy to allow authenticated users to upload files
CREATE POLICY "Allow authenticated users to upload documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'leave-documents');

-- Create policy to allow users to read their own documents
CREATE POLICY "Allow users to read their own documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'leave-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Create policy to allow users to update their own documents
CREATE POLICY "Allow users to update their own documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'leave-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Create policy to allow users to delete their own documents
CREATE POLICY "Allow users to delete their own documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'leave-documents' AND (storage.foldername(name))[1] = auth.uid()::text);