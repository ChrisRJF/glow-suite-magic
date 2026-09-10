
REVOKE ALL ON public.form_templates FROM anon;
REVOKE ALL ON public.form_template_versions FROM anon;
REVOKE ALL ON public.service_form_requirements FROM anon;
REVOKE ALL ON public.form_requests FROM anon;
REVOKE ALL ON public.form_submissions FROM anon;

REVOKE UPDATE, DELETE, INSERT, TRUNCATE ON public.form_submissions FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.form_template_versions FROM authenticated;
REVOKE DELETE, TRUNCATE ON public.form_requests FROM authenticated;

GRANT SELECT ON public.form_submissions TO authenticated;
GRANT SELECT, INSERT ON public.form_template_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.form_requests TO authenticated;
