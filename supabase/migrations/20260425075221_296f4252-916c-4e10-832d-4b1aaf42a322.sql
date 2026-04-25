-- Demo requests table for landing-page lead capture
CREATE TABLE public.demo_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  salon_name TEXT,
  salon_type TEXT,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'landing',
  status TEXT NOT NULL DEFAULT 'new',
  followed_up_at TIMESTAMPTZ,
  follow_up_notes TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_demo_requests_created_at ON public.demo_requests (created_at DESC);
CREATE INDEX idx_demo_requests_status ON public.demo_requests (status);

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous visitors) can submit a demo request
CREATE POLICY "Anyone can submit demo requests"
ON public.demo_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (
  length(name) BETWEEN 1 AND 120
  AND length(email) BETWEEN 3 AND 255
  AND email LIKE '%_@_%.__%'
  AND (phone IS NULL OR length(phone) <= 40)
  AND (salon_name IS NULL OR length(salon_name) <= 160)
  AND (salon_type IS NULL OR length(salon_type) <= 60)
  AND (message IS NULL OR length(message) <= 2000)
);

-- Only admins/owners can read or update demo requests
CREATE POLICY "Admins can view demo requests"
ON public.demo_requests
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'eigenaar'::app_role)
);

CREATE POLICY "Admins can update demo requests"
ON public.demo_requests
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'eigenaar'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'eigenaar'::app_role)
);

CREATE POLICY "Admins can delete demo requests"
ON public.demo_requests
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'eigenaar'::app_role)
);

CREATE TRIGGER update_demo_requests_updated_at
BEFORE UPDATE ON public.demo_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();