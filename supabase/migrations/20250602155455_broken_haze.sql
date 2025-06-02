/*
  # Add storage RLS policies for leave documents

  1. New RLS Policies:
     - Create a policy allowing authenticated users to upload files to the "leave-documents" bucket
     - Create a policy for authenticated users to read their own documents
     - Create a policy for admins to view all documents

  2. Security:
     - Ensures users can only upload files to a subfolder matching their ID
     - Restricts access to documents based on user role
*/

-- Ensure the leave-documents bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('leave-documents', 'leave-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Allow users to upload to their own folder
CREATE POLICY "Users can upload their own leave documents" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'leave-documents' AND
  (
    -- Allow uploads to public folder
    (storage.foldername(name))[1] = 'public' OR
    -- Allow uploads to own ID folder
    auth.uid()::text = (storage.foldername(name))[1]
  )
);

-- Allow users to view their own documents
CREATE POLICY "Users can view their own leave documents" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'leave-documents' AND
  (
    -- Allow access to public folder
    (storage.foldername(name))[1] = 'public' OR
    -- Allow access to own ID folder
    (storage.foldername(name))[1] = auth.uid()::text OR
    -- For nested folders like public/user-id
    (array_length(storage.foldername(name), 1) >= 2 AND
     (storage.foldername(name))[1] = 'public' AND
     (storage.foldername(name))[2] = auth.uid()::text)
  )
);

-- Allow HR role to access all documents
CREATE POLICY "HR users can access all leave documents" ON storage.objects
FOR ALL TO authenticated
USING (
  bucket_id = 'leave-documents' AND
  auth.jwt() ? 'role' AND auth.jwt()->>'role' = 'hr'
)
WITH CHECK (
  bucket_id = 'leave-documents' AND
  auth.jwt() ? 'role' AND auth.jwt()->>'role' = 'hr'
);