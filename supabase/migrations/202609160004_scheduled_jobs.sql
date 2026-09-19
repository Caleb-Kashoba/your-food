begin;

create extension if not exists pg_cron;

select cron.schedule(
  'your-food-subscription-alerts',
  '5 4 * * *',
  $$select public.generate_subscription_alerts();$$
);

commit;
