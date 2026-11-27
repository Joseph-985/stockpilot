begin;

create schema if not exists extensions;
create schema if not exists private;
revoke create on schema public from public, anon, authenticated, service_role;
grant usage on schema public to anon, authenticated;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

create table public.stores (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  currency text not null default 'NGN' check (currency = 'NGN'),
  created_at timestamptz not null default now(),
  unique (id)
);

create table public.store_members (
  store_id uuid not null references public.stores(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner', 'staff')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index store_members_user_status_idx on public.store_members(user_id, status, store_id);

create table public.products (
  id uuid not null default pg_catalog.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  sku text not null check (length(btrim(sku)) between 1 and 64),
  sku_normalized text generated always as (normalize(btrim(sku), NFC)) stored,
  name text not null check (length(btrim(name)) between 2 and 120),
  description text check (description is null or length(description) <= 2000),
  category text check (category is null or length(category) <= 80),
  price_minor bigint not null check (price_minor between 1 and 99999999999),
  cost_minor bigint check (cost_minor is null or cost_minor between 0 and 99999999999),
  low_stock_threshold bigint not null default 0 check (low_stock_threshold between 0 and 9007199254740991),
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (id),
  unique (store_id, id)
);
create unique index products_active_store_sku_uq on public.products(store_id, upper(sku_normalized)) where deleted_at is null;
create index products_store_updated_idx on public.products(store_id, updated_at desc, id);

create table public.stock_balances (
  store_id uuid not null,
  product_id uuid not null,
  quantity bigint not null default 0 check (quantity between 0 and 9007199254740991),
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  updated_at timestamptz not null default now(),
  primary key (store_id, product_id),
  foreign key (store_id, product_id) references public.products(store_id, id) on delete restrict
);
create index stock_balances_store_idx on public.stock_balances(store_id, product_id);

create table public.sales (
  id uuid not null default pg_catalog.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  checkout_request_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  currency text not null default 'NGN' check (currency = 'NGN'),
  payment_method text not null check (payment_method in ('cash', 'transfer', 'other')),
  customer_name text check (customer_name is null or length(customer_name) <= 120),
  total_minor bigint not null check (total_minor between 0 and 99999999999),
  client_occurred_at timestamptz not null,
  server_committed_at timestamptz not null default now(),
  primary key (id),
  unique (store_id, id),
  unique (store_id, checkout_request_id)
);
create index sales_store_committed_idx on public.sales(store_id, server_committed_at desc, id);

create table private.processed_commands (
  store_id uuid not null references public.stores(id) on delete restrict,
  command_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  command_type text not null check (command_type in ('product.create','product.update','product.delete','inventory.stock_in','inventory.adjust','sale.create')),
  request_hash bytea not null check (octet_length(request_hash) = 32),
  outcome text not null check (outcome in ('applied','conflict','validation_error','forbidden')),
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  primary key (store_id, command_id)
);

create table public.stock_movements (
  id uuid not null default pg_catalog.gen_random_uuid(),
  store_id uuid not null,
  product_id uuid not null,
  delta_quantity bigint not null check (delta_quantity between -9007199254740991 and 9007199254740991 and delta_quantity <> 0),
  kind text not null check (kind in ('stock_in', 'adjustment', 'sale')),
  reason text check (reason is null or length(reason) <= 500),
  sale_id uuid,
  source_command_id uuid not null,
  occurred_at timestamptz not null,
  server_committed_at timestamptz not null default now(),
  primary key (id),
  unique (store_id, id),
  foreign key (store_id, product_id) references public.products(store_id, id) on delete restrict,
  foreign key (store_id, sale_id) references public.sales(store_id, id) on delete restrict,
  foreign key (store_id, source_command_id) references private.processed_commands(store_id, command_id) on delete restrict,
  check ((kind = 'sale' and sale_id is not null and delta_quantity < 0) or
         (kind <> 'sale' and sale_id is null))
);
create index stock_movements_store_product_time_idx on public.stock_movements(store_id, product_id, server_committed_at desc, id);
create index stock_movements_store_sale_idx on public.stock_movements(store_id, sale_id) where sale_id is not null;

create table public.sale_items (
  store_id uuid not null,
  sale_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null check (length(btrim(product_name_snapshot)) between 2 and 120),
  sku_snapshot text not null check (length(btrim(sku_snapshot)) between 1 and 64),
  quantity bigint not null check (quantity between 1 and 9007199254740991),
  unit_price_minor bigint not null check (unit_price_minor between 0 and 99999999999),
  line_total_minor bigint not null check (line_total_minor between 0 and 99999999999),
  primary key (store_id, sale_id, product_id),
  foreign key (store_id, sale_id) references public.sales(store_id, id) on delete restrict,
  foreign key (store_id, product_id) references public.products(store_id, id) on delete restrict
);
create index sale_items_store_product_idx on public.sale_items(store_id, product_id);

create table private.sync_clock (
  store_id uuid primary key references public.stores(id) on delete restrict,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  updated_at timestamptz not null default now()
);

create table private.change_log (
  store_id uuid not null references public.stores(id) on delete restrict,
  revision bigint not null check (revision > 0),
  ordinal integer not null check (ordinal > 0),
  entity_type text not null check (entity_type in ('product','stock_balance','stock_movement','sale','sale_item')),
  entity_id uuid not null,
  operation text not null check (operation in ('upsert','delete')),
  payload_json jsonb not null,
  server_committed_at timestamptz not null default now(),
  primary key (store_id, revision, ordinal),
  foreign key (store_id) references private.sync_clock(store_id) on delete restrict
);
create index change_log_store_cursor_idx on private.change_log(store_id, revision, ordinal);

create or replace function private.reject_immutable_row_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise check_violation using message = 'append-only record cannot be changed';
end
$$;
revoke all on function private.reject_immutable_row_mutation() from public, anon, authenticated;
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function private.reject_immutable_row_mutation();
create trigger sales_append_only before update or delete on public.sales
  for each row execute function private.reject_immutable_row_mutation();
create trigger sale_items_append_only before update or delete on public.sale_items
  for each row execute function private.reject_immutable_row_mutation();
create trigger processed_commands_append_only before update or delete on private.processed_commands
  for each row execute function private.reject_immutable_row_mutation();
create trigger change_log_append_only before update or delete on private.change_log
  for each row execute function private.reject_immutable_row_mutation();

create or replace function private.current_member_role(p_store_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select m.role
  from public.store_members as m
  where m.store_id = p_store_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1
$$;
revoke all on function private.current_member_role(uuid) from public, anon, authenticated;
grant execute on function private.current_member_role(uuid) to authenticated;

create or replace function public.create_store_with_owner(p_name text)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_store_id uuid;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise check_violation using message = 'invalid store name';
  end if;

  insert into public.stores(name, currency) values (btrim(p_name), 'NGN') returning id into v_store_id;
  insert into public.store_members(store_id, user_id, role, status)
    values (v_store_id, v_user_id, 'owner', 'active');
  insert into private.sync_clock(store_id, revision) values (v_store_id, 0);
  return v_store_id;
end
$$;
revoke all on function public.create_store_with_owner(text) from public, anon, authenticated;
grant execute on function public.create_store_with_owner(text) to authenticated;

alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.products enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

revoke all on public.stores, public.store_members, public.products, public.stock_balances,
  public.stock_movements, public.sales, public.sale_items from public, anon, authenticated, service_role;
grant select on public.stores, public.store_members, public.products, public.stock_balances,
  public.stock_movements, public.sales, public.sale_items to authenticated;

create policy stores_member_read on public.stores for select to authenticated
  using (private.current_member_role(id) is not null);
create policy store_members_self_or_owner_read on public.store_members for select to authenticated
  using (user_id = auth.uid() or private.current_member_role(store_id) = 'owner');
create policy products_member_read on public.products for select to authenticated
  using (private.current_member_role(store_id) is not null);
create policy stock_balances_member_read on public.stock_balances for select to authenticated
  using (private.current_member_role(store_id) is not null);
create policy stock_movements_member_read on public.stock_movements for select to authenticated
  using (private.current_member_role(store_id) is not null);
create policy sales_member_read on public.sales for select to authenticated
  using (private.current_member_role(store_id) is not null);
create policy sale_items_member_read on public.sale_items for select to authenticated
  using (private.current_member_role(store_id) is not null);

revoke all on private.processed_commands, private.sync_clock, private.change_log
  from public, anon, authenticated, service_role;
revoke all on schema private from public, anon, service_role;

commit;
