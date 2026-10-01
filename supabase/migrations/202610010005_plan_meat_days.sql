-- Jours de viande d'une formule : au plus deux jours, du lundi au vendredi (null = viande tous les jours de service).
-- Migration ADDITIVE : seule une contrainte est ajoutée ; toutes les formules existantes ont encore « null ».
alter table public.plans
  add constraint plans_meat_weekdays_check check (
    meat_weekdays is null
    or (cardinality(meat_weekdays) between 1 and 2 and meat_weekdays <@ array[1, 2, 3, 4, 5]::smallint[])
  );
