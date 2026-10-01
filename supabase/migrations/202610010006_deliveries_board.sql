-- Tableau de préparation et de livraison : pour chaque livraison d'une période, le repas choisi par le client
-- (plat, accompagnement, viande), pour la préparation des bols puis la livraison. Migration ADDITIVE.

create or replace function public.deliveries_board(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := public.current_organization_id();
begin
  if public.current_member_id() is null or not public.has_permission('deliveries.read') then raise exception 'Permission denied'; end if;
  if p_to < p_from or p_to - p_from > 14 then raise exception 'Période invalide (14 jours au plus).'; end if;

  -- Les menus passés 20h sont verrouillés (et les repas par défaut attribués) avant de lire
  perform public.lock_due_menus();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'delivery_id', dl.id,
      'date', dl.delivery_date,
      'customer_id', dl.customer_id,
      'customer_name', dl.customer_name,
      'phone', dl.phone,
      'zone_name', dl.zone_name,
      'residence', dl.residence,
      'building', dl.building,
      'room', dl.room,
      'address_details', dl.address_details,
      'plan_name', dl.plan_name,
      'delivery_status', dl.status,
      'menu_status', case when dm.id is null then 'aucun_menu' else dm.status::text end,
      'order_id', o.id,
      'state', case
        when dl.status = 'cancelled' and o.status = 'cancelled' then 'annule'
        when dl.status = 'cancelled' then 'livraison_annulee'
        when o.id is null then 'en_attente'
        when o.is_default then 'defaut'
        else 'commande' end,
      'plat', pc.name,
      'accompagnement', ac.name,
      'viande', vc.name
    ) order by dl.delivery_date, dl.customer_name)
    from public.deliveries dl
    left join public.daily_menus dm on dm.organization_id = dl.organization_id and dm.menu_date = dl.delivery_date
    left join public.meal_orders o on o.daily_menu_id = dm.id and o.customer_id = dl.customer_id
    left join public.menu_options po on po.id = o.plat_option_id
    left join public.catalog_items pc on pc.id = po.catalog_item_id
    left join public.menu_options ao on ao.id = o.accompagnement_option_id
    left join public.catalog_items ac on ac.id = ao.catalog_item_id
    left join public.menu_options vo on vo.id = o.viande_option_id
    left join public.catalog_items vc on vc.id = vo.catalog_item_id
    where dl.organization_id = org and dl.delivery_date between p_from and p_to
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.deliveries_board(date, date) from public, anon;
grant execute on function public.deliveries_board(date, date) to authenticated;
