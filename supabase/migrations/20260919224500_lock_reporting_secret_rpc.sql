revoke all on function public.read_connection_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.read_connection_secret(uuid, text) to service_role;
