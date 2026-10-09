-- TEST-ONLY seed: two fictitious salons + one disabled tenant. No real data.
insert into public.gateway_tenant_links(tenant_id, salon_id, enabled, allowed_action_types) values
 ('tenant-test-a','11111111-1111-1111-1111-111111111111',true, array['opt_out_signal','inbound_message_record','delivery_status_record','confirmation_token_received']),
 ('tenant-test-b','22222222-2222-2222-2222-222222222222',true, array['opt_out_signal','delivery_status_record']),
 ('tenant-test-off','33333333-3333-3333-3333-333333333333',false, array['opt_out_signal']);
