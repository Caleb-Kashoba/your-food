-- Mutation : le menu se verrouille la veille de son jour (avec ou sans limite)
do $m$
declare src text := pg_get_functiondef('public.menu_is_past_lock(uuid,date)'::regprocedure);
begin
  if position('::date >= p_date' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, '::date >= p_date', '::date >= p_date - 1');
end $m$;
