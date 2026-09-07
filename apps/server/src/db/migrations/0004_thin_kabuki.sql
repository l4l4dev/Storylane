ALTER TABLE `users` ADD `credentials_changed_at` integer;--> statement-breakpoint
CREATE INDEX `sessions_idle` ON `sessions` (`idle_expires_at`);