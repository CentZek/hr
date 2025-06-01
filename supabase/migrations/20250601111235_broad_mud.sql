-- Create leave_requests table
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  leave_type text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_id ON public.leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.leave_requests(status);

-- Add RLS policies
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- Create policy for public access (for development - should be restricted in production)
CREATE POLICY "Allow public access for all users" 
ON public.leave_requests
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- Create function to update time records when leave is approved
CREATE OR REPLACE FUNCTION update_leave_days()
RETURNS TRIGGER AS $$
DECLARE
  curr_date date;
BEGIN
  -- Only proceed if status changed to 'approved'
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    -- Loop through each day in the leave period
    curr_date := NEW.start_date;
    WHILE curr_date <= NEW.end_date LOOP
      -- Check if there's an existing OFF-DAY record
      UPDATE public.time_records
      SET 
        notes = CASE 
          WHEN notes = 'OFF-DAY' THEN NEW.leave_type
          ELSE notes || '; ' || NEW.leave_type
        END
      WHERE 
        employee_id = NEW.employee_id
        AND status = 'off_day'
        AND timestamp::date = curr_date;
        
      -- If no OFF-DAY record exists, create one
      IF NOT FOUND THEN
        INSERT INTO public.time_records (
          employee_id, 
          timestamp, 
          status, 
          shift_type, 
          notes,
          working_week_start,
          display_check_in,
          display_check_out
        )
        VALUES (
          NEW.employee_id, 
          curr_date + INTERVAL '12 hours', 
          'off_day', 
          'off_day', 
          NEW.leave_type,
          curr_date,
          NEW.leave_type,
          NEW.leave_type
        );
      END IF;
      
      -- Move to next day
      curr_date := curr_date + INTERVAL '1 day';
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update time records on leave approval
CREATE TRIGGER trg_update_leave_days
  AFTER UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_leave_days();