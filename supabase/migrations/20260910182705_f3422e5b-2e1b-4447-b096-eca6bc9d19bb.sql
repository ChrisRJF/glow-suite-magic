
CREATE OR REPLACE FUNCTION public.consume_document_share_download(_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.document_shares%ROWTYPE;
  _existing public.document_shares%ROWTYPE;
BEGIN
  UPDATE public.document_shares s
     SET download_count = s.download_count + 1,
         last_downloaded_at = now()
   WHERE s.token_hash = _token_hash
     AND s.status = 'active'
     AND s.expires_at > now()
     AND s.download_count < s.max_downloads
  RETURNING s.* INTO _row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'share_id', _row.id,
      'user_id', _row.user_id,
      'export_id', _row.export_id,
      'downloads_left', _row.max_downloads - _row.download_count
    );
  END IF;

  SELECT * INTO _existing FROM public.document_shares WHERE token_hash = _token_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF _existing.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'revoked');
  END IF;
  IF _existing.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'limit_reached');
END;
$$;

CREATE OR REPLACE FUNCTION public.release_document_share_download(_share_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.document_shares
     SET download_count = GREATEST(download_count - 1, 0)
   WHERE id = _share_id;
$$;

REVOKE ALL ON FUNCTION public.consume_document_share_download(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_document_share_download(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_document_share_download(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_document_share_download(uuid) TO service_role;
