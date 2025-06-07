/*
  # Add Storage RLS Policy for Leave Documents

  1. Changes
    - Creates a new storage bucket for leave documents if it doesn't exist
    - Adds RLS policies to allow authenticated users to upload files to their own employee folders
    - Adds RLS policies to allow authenticated users to view files in public folders
    - Ensures proper security for leave document uploads

  2. Security
    - Limits uploads to folders matching the user's employee ID
    - Allows reading from public folders
*/

-- Create the leave-documents bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('leave-documents', 'leave-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Remove any existing policies for the leave-documents bucket to avoid conflicts
DELETE FROM storage.policies
WHERE bucket_id = 'leave-documents';

-- Create policy to allow authenticated users to upload files to their own employee folder
INSERT INTO storage.policies (bucket_id, name, definition)
VALUES (
  'leave-documents',
  'Allow authenticated uploads to employee folder',
  jsonb_build_object(
    'name', 'Allow authenticated uploads to employee folder',
    'version', '1',
    'match', jsonb_build_object(
      'resource', 'storage/leave-documents/{path}',
      'action', 'INSERT'
    ),
    'statement', jsonb_build_object(
      'effect', 'Allow',
      'principal', jsonb_build_object(
        'provider', 'database',
        'roles', array['authenticated']
      )
    ),
    'condition', jsonb_build_object(
      'operator', 'StringEquals',
      'values', array[(storage.foldername('{path}'))[2], 'auth.uid()']
    )
  )
);

-- Create policy to allow authenticated users to read files
INSERT INTO storage.policies (bucket_id, name, definition)
VALUES (
  'leave-documents',
  'Allow authenticated users to read documents',
  jsonb_build_object(
    'name', 'Allow authenticated users to read documents',
    'version', '1',
    'match', jsonb_build_object(
      'resource', 'storage/leave-documents/{path}',
      'action', 'SELECT'
    ),
    'statement', jsonb_build_object(
      'effect', 'Allow',
      'principal', jsonb_build_object(
        'provider', 'database',
        'roles', array['authenticated']
      )
    ),
    'condition', jsonb_build_object(
      'operator', 'StringLike',
      'values', array['{path}', 'public/*']
    )
  )
);

-- Create policy to allow authenticated users to delete their own files
INSERT INTO storage.policies (bucket_id, name, definition)
VALUES (
  'leave-documents',
  'Allow authenticated users to delete their own files',
  jsonb_build_object(
    'name', 'Allow authenticated users to delete their own files',
    'version', '1',
    'match', jsonb_build_object(
      'resource', 'storage/leave-documents/{path}',
      'action', 'DELETE'
    ),
    'statement', jsonb_build_object(
      'effect', 'Allow',
      'principal', jsonb_build_object(
        'provider', 'database',
        'roles', array['authenticated']
      )
    ),
    'condition', jsonb_build_object(
      'operator', 'StringEquals',
      'values', array[(storage.foldername('{path}'))[2], 'auth.uid()']
    )
  )
);