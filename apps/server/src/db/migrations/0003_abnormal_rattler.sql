CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`revoked_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invites_role" CHECK("invites"."role" in ('owner','member','viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invites_id_project` ON `invites` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `invites_project` ON `invites` (`project_id`);--> statement-breakpoint
CREATE TABLE `reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reset_tokens_token_hash` ON `reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `reset_tokens_user` ON `reset_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_absolute` ON `sessions` (`absolute_expires_at`);--> statement-breakpoint
CREATE TABLE `project_states` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`action_label` text,
	`category` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_states_category" CHECK("project_states"."category" in ('unstarted','in_progress','done','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_states_id_project` ON `project_states` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_states_position` ON `project_states` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`story_type` text DEFAULT 'feature' NOT NULL,
	`state_id` text,
	`position` integer NOT NULL,
	`points` integer,
	`requester_id` text,
	`assignee_id` text,
	`completed_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`state_id`,`project_id`) REFERENCES `project_states`(`id`,`project_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`assignee_id`) REFERENCES `project_members`(`project_id`,`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stories_story_type" CHECK("stories"."story_type" in ('feature','bug','chore','release')),
	CONSTRAINT "stories_points" CHECK("stories"."points" is null or "stories"."points" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stories_id_project` ON `stories` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stories_project_number` ON `stories` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `stories_project_state_position` ON `stories` (`project_id`,`state_id`,`position`);--> statement-breakpoint
ALTER TABLE `projects` ADD `description` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `point_scale` text DEFAULT 'fibonacci' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `custom_points` text;
--> statement-breakpoint
CREATE TRIGGER stories_number_pinned
BEFORE UPDATE OF number ON stories
WHEN new.number <> old.number
BEGIN
  SELECT RAISE(ABORT, 'stories.number is pinned after insert');
END;
--> statement-breakpoint
CREATE TRIGGER project_states_category_immutable
BEFORE UPDATE OF category ON project_states
WHEN new.category <> old.category
BEGIN
  SELECT RAISE(ABORT, 'project_states.category is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER activity_logs_story_in_project_insert
BEFORE INSERT ON activity_logs
WHEN new.story_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stories WHERE id = new.story_id AND project_id = new.project_id)
BEGIN
  SELECT RAISE(ABORT, 'activity_logs.story_id must belong to the same project');
END;
--> statement-breakpoint
CREATE TRIGGER activity_logs_story_in_project_update
BEFORE UPDATE OF story_id ON activity_logs
WHEN new.story_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stories WHERE id = new.story_id AND project_id = new.project_id)
BEGIN
  SELECT RAISE(ABORT, 'activity_logs.story_id must belong to the same project');
END;
--> statement-breakpoint
CREATE TRIGGER projects_point_scale_valid_insert
BEFORE INSERT ON projects
WHEN new.point_scale NOT IN ('fibonacci','linear','custom')
BEGIN
  SELECT RAISE(ABORT, 'projects.point_scale must be one of fibonacci, linear, custom');
END;
--> statement-breakpoint
CREATE TRIGGER projects_point_scale_valid_update
BEFORE UPDATE OF point_scale ON projects
WHEN new.point_scale NOT IN ('fibonacci','linear','custom')
BEGIN
  SELECT RAISE(ABORT, 'projects.point_scale must be one of fibonacci, linear, custom');
END;
--> statement-breakpoint
CREATE TRIGGER stories_unassign_on_member_removal
BEFORE DELETE ON project_members
BEGIN
  UPDATE stories SET assignee_id = NULL
  WHERE project_id = old.project_id AND assignee_id = old.user_id;
END;
