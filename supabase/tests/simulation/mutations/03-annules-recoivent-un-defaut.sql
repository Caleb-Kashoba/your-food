-- Mutation : 03-annules-recoivent-un-defaut
do $m$
declare src text := pg_get_functiondef('public.lock_menu(uuid)'::regprocedure);
begin
  if position('dl.status <> ''cancelled''' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'dl.status <> ''cancelled''', 'true');
end $m$;
