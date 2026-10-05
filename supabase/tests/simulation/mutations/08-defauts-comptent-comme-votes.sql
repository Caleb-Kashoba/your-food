-- Mutation : les repas par défaut comptent comme des choix
do $m$
declare src text := pg_get_functiondef('public.refresh_default_orders(uuid)'::regprocedure);
begin
  if position('and not mo.is_default and mo.plat_option_id = o.id' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'and not mo.is_default and mo.plat_option_id = o.id', 'and mo.plat_option_id = o.id');
end $m$;
