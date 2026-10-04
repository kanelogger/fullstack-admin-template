-- Keep session revocation and audit-user referential actions indexed.
create index account_password_sessions_auth_user_id_idx
  on app_private.account_password_sessions (auth_user_id);

create index messages_sender_id_idx on public.messages (sender_id);
create index messages_created_by_idx on public.messages (created_by);
create index messages_updated_by_idx on public.messages (updated_by);

create index dict_types_created_by_idx on public.dict_types (created_by);
create index dict_types_updated_by_idx on public.dict_types (updated_by);
create index dict_items_created_by_idx on public.dict_items (created_by);
create index dict_items_updated_by_idx on public.dict_items (updated_by);
create index system_configs_created_by_idx on public.system_configs (created_by);
create index system_configs_updated_by_idx on public.system_configs (updated_by);
