
CREATE OR REPLACE FUNCTION public.check_run_concurrency()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- On insert or update, if status is 'queued' or 'running', check capacity
  IF NEW.status IN ('queued', 'running') THEN
    IF (SELECT COUNT(*) FROM public.runs WHERE status = 'running' AND id != NEW.id) < 10 THEN
      NEW.status := 'running';
    ELSE
      NEW.status := 'queued';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
