-- Mutation : en cas d'égalité, le dernier plat par ordre alphabétique
do $m$
declare src text := pg_get_functiondef('public.refresh_default_orders(uuid)'::regprocedure);
begin
  if position('c.name asc' in src) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(src, 'c.name asc', 'c.name desc');
end $m$;
