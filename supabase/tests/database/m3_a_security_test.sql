begin;
select plan(62);

select has_table('public', 'stores', 'stores table exists');
select has_table('public', 'store_members', 'store_members table exists');
select has_table('public', 'products', 'products table exists');
select has_table('public', 'stock_balances', 'stock_balances table exists');
select has_table('public', 'stock_movements', 'stock_movements table exists');
select has_table('public', 'sales', 'sales table exists');
select has_table('public', 'sale_items', 'sale_items table exists');
select has_table('private', 'processed_commands', 'command receipts are private');
select has_table('private', 'sync_clock', 'sync clock is private');
select has_table('private', 'change_log', 'change log is private');

select ok((select relrowsecurity from pg_class where oid = 'public.stores'::regclass), 'stores has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.store_members'::regclass), 'members has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.products'::regclass), 'products has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.stock_balances'::regclass), 'balances has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.stock_movements'::regclass), 'movements has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.sales'::regclass), 'sales has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.sale_items'::regclass), 'sale items has RLS');

select ok(not has_table_privilege('anon', 'public.products', 'select'), 'anon has no product SELECT grant');
select ok(has_table_privilege('authenticated', 'public.products', 'select'), 'authenticated can issue RLS-filtered SELECT');

insert into auth.users(id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-a@test.invalid', '', '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-b@test.invalid', '', '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'staff-a@test.invalid', '', '{}', '{}'),
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'outsider@test.invalid', '', '{}', '{}');
insert into public.stores(id, name) values
  ('20000000-0000-4000-8000-000000000001', 'Store A'),
  ('20000000-0000-4000-8000-000000000002', 'Store B');
insert into public.store_members(store_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'staff'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');
insert into public.products(id, store_id, sku, name, price_minor) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'A-1', 'A Product', 100),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'B-1', 'B Product', 100);
insert into public.stock_balances(store_id, product_id, quantity) values
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 5),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 5);
insert into private.processed_commands(store_id, command_id, actor_id, command_type, request_hash, outcome, result_json)
values ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 'sale.create', decode(repeat('00', 32), 'hex'), 'applied', '{}');
insert into public.sales(id, store_id, checkout_request_id, created_by, payment_method, total_minor, client_occurred_at)
values ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'cash', 100, now());
insert into public.sale_items(store_id, sale_id, product_id, product_name_snapshot, sku_snapshot, quantity, unit_price_minor, line_total_minor)
values ('20000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001', 'Snapshot Product', 'A-1', 1, 100, 100);
insert into public.stock_movements(id, store_id, product_id, delta_quantity, kind, sale_id, source_command_id, occurred_at)
values ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001', -1, 'sale', '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.stores), 1, 'owner A reads only own store');
select is((select count(*)::integer from public.products), 1, 'owner A reads only own products');
select is((select count(*)::integer from public.stock_balances), 1, 'owner A reads only own balances');
select is((select count(*)::integer from public.store_members), 2, 'owner A can read own store memberships');
select is((select count(*)::integer from public.sales), 1, 'owner A reads own store sales');
select is((select count(*)::integer from public.sale_items), 1, 'owner A reads immutable sale snapshots');
select is((select count(*)::integer from public.stock_movements), 1, 'owner A reads own stock ledger');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.products), 1, 'staff reads own store products');
select is((select count(*)::integer from public.stores), 1, 'staff cannot read another store');
select is((select count(*)::integer from public.store_members), 1, 'staff sees own membership only');
select is((select count(*)::integer from public.sales), 1, 'staff reads own store sales');
select is((select count(*)::integer from public.sale_items), 1, 'staff reads sale snapshots');
select is((select count(*)::integer from public.stock_movements), 1, 'staff reads own stock ledger');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.stores), 0, 'nonmember reads no stores');
select is((select count(*)::integer from public.products), 0, 'nonmember reads no products');
select is((select count(*)::integer from public.sales), 0, 'nonmember reads no sales');
select is((select count(*)::integer from public.stock_movements), 0, 'nonmember reads no movements');
reset role;

set local role anon;
select throws_ok('select * from public.products', '42501', null, 'anon product read is denied');
select throws_ok('select * from public.stores', '42501', null, 'anon store read is denied');
select throws_ok('select * from public.sales', '42501', null, 'anon sales read is denied');
select throws_ok('select public.create_store_with_owner(''Nope'')', '42501', null, 'anon cannot execute onboarding RPC');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok('insert into public.store_members(store_id,user_id,role) values (''20000000-0000-4000-8000-000000000001'',''10000000-0000-4000-8000-000000000004'',''staff'')', '42501', null, 'owner cannot directly insert memberships');
select throws_ok('update public.store_members set role = ''owner'' where store_id = ''20000000-0000-4000-8000-000000000001'' and user_id = ''10000000-0000-4000-8000-000000000003''', '42501', null, 'owner cannot directly update memberships');
select throws_ok('delete from public.store_members where store_id = ''20000000-0000-4000-8000-000000000001'' and user_id = ''10000000-0000-4000-8000-000000000003''', '42501', null, 'owner cannot directly delete memberships');
select throws_ok('insert into public.products(store_id,sku,name,price_minor) values (''20000000-0000-4000-8000-000000000001'',''X'',''X'',1)', '42501', null, 'owner cannot directly insert products');
select throws_ok('update public.stock_balances set quantity = 0 where store_id = ''20000000-0000-4000-8000-000000000001''', '42501', null, 'owner cannot directly update stock');
select throws_ok('insert into public.sales(store_id,checkout_request_id,created_by,payment_method,total_minor,client_occurred_at) values (''20000000-0000-4000-8000-000000000001'',''40000000-0000-4000-8000-000000000001'',''10000000-0000-4000-8000-000000000001'',''cash'',1,now())', '42501', null, 'owner cannot directly insert sales');
select throws_ok('insert into public.sale_items(store_id,sale_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price_minor,line_total_minor) values (''20000000-0000-4000-8000-000000000001'',''60000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000001'',''Product'',''A-1'',1,100,100)', '42501', null, 'owner cannot directly insert sale snapshots');
select throws_ok('insert into public.stock_movements(store_id,product_id,delta_quantity,kind,source_command_id,occurred_at) values (''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000001'',1,''stock_in'',''50000000-0000-4000-8000-000000000001'',now())', '42501', null, 'owner cannot directly insert ledger rows');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok('select public.create_store_with_owner(''No JWT'')', '42501', null, 'onboarding rejects authenticated requests without auth.uid');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select ok(public.create_store_with_owner('Owner-created store') is not null, 'authenticated caller can create a store');
select is((select count(*)::integer from public.store_members where store_id = (select id from public.stores where name = 'Owner-created store')), 1, 'onboarding creates exactly one membership');
select is((select role from public.store_members where store_id = (select id from public.stores where name = 'Owner-created store') and user_id = auth.uid()), 'owner', 'onboarding makes caller the owner');
reset role;

select ok(not has_function_privilege('anon', 'private.current_member_role(uuid)', 'execute'), 'anon cannot execute membership helper');
select ok(not exists (
  select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = 'public.create_store_with_owner(text)'::regprocedure
    and a.grantee = 0 and a.privilege_type = 'EXECUTE'
), 'PUBLIC cannot execute onboarding RPC');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.create_store_with_owner(text)'::regprocedure), 'onboarding RPC is SECURITY DEFINER with empty search_path');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.sales'::regclass and tgname = 'sales_append_only' and not tgisinternal), 'sales are append-only');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.sale_items'::regclass and tgname = 'sale_items_append_only' and not tgisinternal), 'sale snapshots are append-only');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.stock_movements'::regclass and tgname = 'stock_movements_append_only' and not tgisinternal), 'stock ledger is append-only');
select throws_ok('update public.sales set total_minor = 1 where id = ''60000000-0000-4000-8000-000000000001''', '23514', 'append-only record cannot be changed', 'sales cannot be updated');
select throws_ok('delete from public.sale_items where sale_id = ''60000000-0000-4000-8000-000000000001''', '23514', 'append-only record cannot be changed', 'sale snapshots cannot be deleted');
select throws_ok('update public.stock_movements set delta_quantity = -2 where id = ''70000000-0000-4000-8000-000000000001''', '23514', 'append-only record cannot be changed', 'stock ledger rows cannot be updated');
select throws_ok('insert into public.stock_balances(store_id,product_id,quantity) values (''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000002'',1)', '23503', null, 'composite FK rejects a product from another store');

select * from finish();
rollback;
