-- Mutation : les clients dont la livraison est annulée reçoivent un repas par défaut
do $m$
declare src text := pg_get_functiondef('public.refresh_default_orders(uuid)'::regprocedure);
begin
  if position('dl.status <> ''cancelled''' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'dl.status <> ''cancelled''', 'true');
end $m$;
