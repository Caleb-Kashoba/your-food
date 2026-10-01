-- Mutation : 04-journal-attribue-au-client
do $m$
declare src text := pg_get_functiondef('public.lock_due_menus()'::regprocedure);
begin
  if position('''app.audit_system'', ''on''' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, '''app.audit_system'', ''on''', '''app.audit_system'', ''off''');
end $m$;
