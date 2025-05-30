-- Create HR users table
CREATE TABLE IF NOT EXISTS public.hr_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add RLS policies
ALTER TABLE public.hr_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public.hr_users
  FOR SELECT USING (true);

-- Insert the two required accounts
INSERT INTO public.hr_users (username, password) 
VALUES 
  ('Marilyn', 'Marilynhr'),
  ('Otherhr', 'Otherhr')
ON CONFLICT (username) DO NOTHING;