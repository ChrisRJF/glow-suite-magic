-- Synthetic simulation only. No real data. Minimal stand-in schema for the proposed dedupe migration.
\set ON_ERROR_STOP 1
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
  email text, phone text, is_demo boolean NOT NULL DEFAULT false, archived_at timestamptz, pseudonymized_at timestamptz,
  privacy_consent boolean, marketing_consent boolean, whatsapp_opt_in boolean, communication_blocked_at timestamptz,
  preferred_language text NOT NULL DEFAULT 'nl', notes text, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
CREATE TABLE audit_logs (id bigserial, user_id uuid, action text, details jsonb);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['appointments','treatment_records','treatment_journeys','historical_dossier_entries',
    'clinical_media','form_submissions','form_requests','form_reissue_flags','customer_consents','payments',
    'payment_links','refund_requests','checkout_items','webshop_orders','gift_cards','customer_memberships',
    'membership_usage','customer_alerts','customer_tags','customer_message_preferences','feedback_entries',
    'waitlist_entries','rebook_actions','auto_revenue_offers','automation_logs','automation_runs',
    'autopilot_action_logs','whatsapp_logs','whatsapp_inbound_messages','document_exports','document_shares',
    'legal_holds','privacy_requests'] LOOP
    EXECUTE format('CREATE TABLE %I (id bigserial, customer_id uuid)', t); -- no FKs, like several real tables
  END LOOP; END $$;
