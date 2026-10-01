-- Mutation : 01-egalite-ordre-inverse
do $m$
declare src text := pg_get_functiondef('public.lock_menu(uuid)'::regprocedure);
begin
  if position('c.name asc' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'c.name asc', 'c.name desc');
end $m$;
