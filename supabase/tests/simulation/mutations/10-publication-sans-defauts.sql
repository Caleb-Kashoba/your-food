-- Mutation : la publication ne crée plus les repas par défaut
do $m$
declare src text := pg_get_functiondef('public.publish_menus(date,integer,uuid[],time without time zone)'::regprocedure);
begin
  if position('perform public.refresh_default_orders(new_id);' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'perform public.refresh_default_orders(new_id);', 'null;');
end $m$;
