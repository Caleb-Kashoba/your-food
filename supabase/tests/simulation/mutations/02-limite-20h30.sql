-- Mutation : 02-limite-20h30
do $m$
declare src text := pg_get_functiondef('public.menu_is_past_lock(uuid,date)'::regprocedure);
begin
  if position('time ''20:00''' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'time ''20:00''', 'time ''20:30''');
end $m$;
