-- Mutation : le verrouillage retombe le jour même à 20 h (ancien calendrier) au lieu de la veille
do $m$
declare src text := pg_get_functiondef('public.menu_is_past_lock(uuid,date)'::regprocedure);
begin
  if position('p_date - 1' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'p_date - 1', 'p_date');
end $m$;
