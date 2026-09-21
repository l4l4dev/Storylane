CREATE TRIGGER projects_start_date_is_calendar_date_insert
BEFORE INSERT ON projects
WHEN strftime('%Y-%m-%d', new.start_date) IS NOT new.start_date
BEGIN
  SELECT RAISE(ABORT, 'projects.start_date must be a YYYY-MM-DD calendar date');
END;
--> statement-breakpoint
CREATE TRIGGER projects_start_date_is_calendar_date_update
BEFORE UPDATE OF start_date ON projects
WHEN strftime('%Y-%m-%d', new.start_date) IS NOT new.start_date
BEGIN
  SELECT RAISE(ABORT, 'projects.start_date must be a YYYY-MM-DD calendar date');
END;
