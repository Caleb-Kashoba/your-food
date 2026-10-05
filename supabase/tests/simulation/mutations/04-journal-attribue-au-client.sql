-- Mutation : les repas par défaut sont attribués à la personne qui a déclenché le calcul
do $m$
declare src text := pg_get_functiondef('public.refresh_default_orders(uuid)'::regprocedure);
begin
  if position('set_config(''app.audit_system'', ''on'', true)' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'set_config(''app.audit_system'', ''on'', true)', 'set_config(''app.audit_system'', ''off'', true)');
end $m$;
