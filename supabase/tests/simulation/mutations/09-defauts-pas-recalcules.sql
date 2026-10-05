-- Mutation : les repas par défaut ne suivent plus les choix
do $m$
declare src text := pg_get_functiondef('public.refresh_default_orders(uuid)'::regprocedure);
begin
  if position('and o.is_default and o.status = ''confirmed'' and s.id = o.subscription_id' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'and o.is_default and o.status = ''confirmed'' and s.id = o.subscription_id', 'and o.is_default and false and s.id = o.subscription_id');
end $m$;
