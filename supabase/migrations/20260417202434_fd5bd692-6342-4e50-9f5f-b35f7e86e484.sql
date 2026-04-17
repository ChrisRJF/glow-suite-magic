
-- Public storage bucket for white-label salon logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('salon-logos', 'salon-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can view (public bucket for embed widget)
CREATE POLICY "Public can view salon logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'salon-logos');

-- Authenticated users can upload to their own folder (user_id/...)
CREATE POLICY "Users can upload their own salon logo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'salon-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own salon logo"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'salon-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own salon logo"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'salon-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
