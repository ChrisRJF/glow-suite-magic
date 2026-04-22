DROP POLICY IF EXISTS "Public can view salon logos" ON storage.objects;

CREATE POLICY "Public can view direct salon logo files"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'salon-logos'
  AND name IS NOT NULL
  AND array_length(storage.foldername(name), 1) >= 1
);