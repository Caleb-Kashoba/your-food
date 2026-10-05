-- Mutation : la viande est servie aussi les jours sans viande
do $m$
declare src text := pg_get_functiondef('public.refresh_default_orders(uuid)'::regprocedure);
begin
  if position('case when public.meat_allowed(p.meat_weekdays, m.menu_date) then top_viande end, ''confirmed'', true' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'case when public.meat_allowed(p.meat_weekdays, m.menu_date) then top_viande end, ''confirmed'', true', 'top_viande, ''confirmed'', true');
end $m$;
