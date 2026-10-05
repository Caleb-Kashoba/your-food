-- Mutation : un client dont l'abonnement commence demain peut commander la veille (règle supprimée)
do $m$
declare src text := pg_get_functiondef('public.prepare_customer_order(uuid)'::regprocedure);
begin
  if position('(context ->> ''start_date'')::date > today' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, '(context ->> ''start_date'')::date > today', 'false');
end $m$;
