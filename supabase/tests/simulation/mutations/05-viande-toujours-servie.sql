-- Mutation : 05-viande-toujours-servie
do $m$
declare src text := pg_get_functiondef('public.lock_menu(uuid)'::regprocedure);
begin
  if position('case when public.meat_allowed(rec.meat_weekdays, m.menu_date) then top_viande end' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'case when public.meat_allowed(rec.meat_weekdays, m.menu_date) then top_viande end', 'top_viande');
end $m$;
