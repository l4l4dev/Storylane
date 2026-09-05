CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_nocase` ON `users` ("email" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_members_role" CHECK("project_members"."role" in ('owner','member','viewer'))
);
--> statement-breakpoint
CREATE INDEX `project_members_user` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
