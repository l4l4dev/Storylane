CREATE TABLE `instance_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`disabled_at` integer,
	`credentials_changed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_nocase` ON `users` ("email" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`project_color` text,
	`favorite` integer DEFAULT false NOT NULL,
	`last_viewed_at` integer,
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
	`description` text,
	`point_scale` text DEFAULT '0,1,2,3' NOT NULL,
	`bugs_and_chores_are_estimatable` integer DEFAULT false NOT NULL,
	`iteration_length` integer DEFAULT 1 NOT NULL,
	`week_start_day` integer DEFAULT 1 NOT NULL,
	`start_date` text NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`velocity_averaged_over` integer DEFAULT 3 NOT NULL,
	`initial_velocity` integer DEFAULT 10 NOT NULL,
	`number_of_done_iterations_to_show` integer DEFAULT 4 NOT NULL,
	`automatic_planning` integer DEFAULT true NOT NULL,
	`enable_tasks` integer DEFAULT true NOT NULL,
	`show_story_priority` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "projects_iteration_length" CHECK("projects"."iteration_length" between 1 and 4),
	CONSTRAINT "projects_week_start_day" CHECK("projects"."week_start_day" between 1 and 7),
	CONSTRAINT "projects_velocity_averaged_over" CHECK("projects"."velocity_averaged_over" between 1 and 4),
	CONSTRAINT "projects_initial_velocity" CHECK("projects"."initial_velocity" >= 0),
	CONSTRAINT "projects_done_iterations_shown" CHECK("projects"."number_of_done_iterations_to_show" between 1 and 99),
	CONSTRAINT "projects_version" CHECK("projects"."version" >= 0),
	CONSTRAINT "projects_point_scale_shape" CHECK("projects"."point_scale" glob '[0-9]*' and "projects"."point_scale" not glob '*[^0-9.,]*')
);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`story_type` text DEFAULT 'feature' NOT NULL,
	`current_state` text DEFAULT 'unscheduled' NOT NULL,
	`estimate` real,
	`accepted_at` integer,
	`deadline` integer,
	`story_priority` text DEFAULT 'none' NOT NULL,
	`list` text DEFAULT 'icebox' NOT NULL,
	`position` integer NOT NULL,
	`requested_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stories_story_type" CHECK("stories"."story_type" in ('feature','bug','chore','release')),
	CONSTRAINT "stories_current_state" CHECK("stories"."current_state" in ('unscheduled','unstarted','planned','started','finished','delivered','accepted','rejected')),
	CONSTRAINT "stories_story_priority" CHECK("stories"."story_priority" in ('none','p0','p1','p2','p3')),
	CONSTRAINT "stories_list" CHECK("stories"."list" in ('backlog','icebox')),
	CONSTRAINT "stories_estimate_non_negative" CHECK("stories"."estimate" is null or "stories"."estimate" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stories_id_project` ON `stories` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stories_project_number` ON `stories` (`project_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `stories_project_list_position` ON `stories` (`project_id`,`list`,`position`);--> statement-breakpoint
CREATE INDEX `stories_project_state` ON `stories` (`project_id`,`current_state`);--> statement-breakpoint
CREATE INDEX `stories_project_accepted` ON `stories` (`project_id`,`accepted_at`);--> statement-breakpoint
CREATE TABLE `story_followers` (
	`project_id` text NOT NULL,
	`story_id` text NOT NULL,
	`user_id` text NOT NULL,
	`followed_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `story_id`, `user_id`),
	FOREIGN KEY (`story_id`,`project_id`) REFERENCES `stories`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`user_id`) REFERENCES `project_members`(`project_id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `story_followers_user` ON `story_followers` (`project_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `story_owners` (
	`project_id` text NOT NULL,
	`story_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `story_id`, `user_id`),
	FOREIGN KEY (`story_id`,`project_id`) REFERENCES `stories`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`user_id`) REFERENCES `project_members`(`project_id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `story_owners_user` ON `story_owners` (`project_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `epics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`label_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`,`project_id`) REFERENCES `labels`(`id`,`project_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `epics_id_project` ON `epics` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `epics_project_label` ON `epics` (`project_id`,`label_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `epics_project_position` ON `epics` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_id_project` ON `labels` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `labels_project_name` ON `labels` (`project_id`,"name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `story_labels` (
	`project_id` text NOT NULL,
	`story_id` text NOT NULL,
	`label_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `story_id`, `label_id`),
	FOREIGN KEY (`story_id`,`project_id`) REFERENCES `stories`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`,`project_id`) REFERENCES `labels`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_labels_label` ON `story_labels` (`project_id`,`label_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`story_id` text,
	`epic_id` text,
	`text` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`story_id`,`project_id`) REFERENCES `stories`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`epic_id`,`project_id`) REFERENCES `epics`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comments_one_parent" CHECK(("comments"."story_id" is null) <> ("comments"."epic_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comments_id_project` ON `comments` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `comments_story` ON `comments` (`project_id`,`story_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_epic` ON `comments` (`project_id`,`epic_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `file_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_path` text NOT NULL,
	`uploader_id` text NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comment_id`,`project_id`) REFERENCES `comments`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "file_attachments_size" CHECK("file_attachments"."size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_attachments_id_project` ON `file_attachments` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_attachments_storage_path` ON `file_attachments` (`storage_path`);--> statement-breakpoint
CREATE INDEX `file_attachments_comment` ON `file_attachments` (`project_id`,`comment_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`story_id` text NOT NULL,
	`description` text NOT NULL,
	`complete` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`,`project_id`) REFERENCES `stories`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_id_project` ON `tasks` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_story_position` ON `tasks` (`project_id`,`story_id`,`position`);--> statement-breakpoint
CREATE TABLE `blockers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`story_id` text NOT NULL,
	`blocking_story_id` text,
	`description` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`story_id`,`project_id`) REFERENCES `stories`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocking_story_id`,`project_id`) REFERENCES `stories`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "blockers_not_self" CHECK("blockers"."blocking_story_id" is null or "blockers"."blocking_story_id" <> "blockers"."story_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blockers_id_project` ON `blockers` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `blockers_story` ON `blockers` (`project_id`,`story_id`);--> statement-breakpoint
CREATE INDEX `blockers_blocking` ON `blockers` (`project_id`,`blocking_story_id`);--> statement-breakpoint
CREATE TABLE `review_types` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_types_id_project` ON `review_types` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_types_project_name` ON `review_types` (`project_id`,"name" COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX `review_types_project_position` ON `review_types` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`story_id` text NOT NULL,
	`review_type_id` text NOT NULL,
	`reviewer_id` text,
	`status` text DEFAULT 'unstarted' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`,`project_id`) REFERENCES `stories`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_type_id`,`project_id`) REFERENCES `review_types`(`id`,`project_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`reviewer_id`) REFERENCES `project_members`(`project_id`,`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reviews_status" CHECK("reviews"."status" in ('unstarted','in_review','pass','revise'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_id_project` ON `reviews` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_story_type_reviewer` ON `reviews` (`project_id`,`story_id`,`review_type_id`,`reviewer_id`);--> statement-breakpoint
CREATE INDEX `reviews_reviewer` ON `reviews` (`project_id`,`reviewer_id`);--> statement-breakpoint
CREATE TABLE `iteration_overrides` (
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`length` integer,
	`team_strength` real DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `number`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "iteration_overrides_number" CHECK("iteration_overrides"."number" >= 1),
	CONSTRAINT "iteration_overrides_length" CHECK("iteration_overrides"."length" is null or "iteration_overrides"."length" between 1 and 99),
	CONSTRAINT "iteration_overrides_team_strength" CHECK("iteration_overrides"."team_strength" >= 0 and "iteration_overrides"."team_strength" <= 10)
);
--> statement-breakpoint
CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`project_version` integer NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`highlight` text NOT NULL,
	`changes` text NOT NULL,
	`primary_resources` text NOT NULL,
	`secondary_resources` text,
	`performed_by_id` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "activities_kind_suffix" CHECK("activities"."kind" like '%\_activity' escape '\')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activities_id_project` ON `activities` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activities_project_version` ON `activities` (`project_id`,`project_version`);--> statement-breakpoint
CREATE INDEX `activities_project_occurred` ON `activities` (`project_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `activity_resources` (
	`activity_id` text NOT NULL,
	`project_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`activity_id`,`project_id`) REFERENCES `activities`(`id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "activity_resources_role" CHECK("activity_resources"."role" in ('primary','secondary'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_resources_unique` ON `activity_resources` (`activity_id`,`resource_kind`,`resource_id`,`role`);--> statement-breakpoint
CREATE INDEX `activity_resources_lookup` ON `activity_resources` (`project_id`,`resource_kind`,`resource_id`);--> statement-breakpoint
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
CREATE INDEX `sessions_idle` ON `sessions` (`idle_expires_at`);--> statement-breakpoint
CREATE TRIGGER projects_start_date_matches_week_start_insert
BEFORE INSERT ON projects
WHEN ((CAST(strftime('%w', new.start_date) AS INTEGER) + 6) % 7) + 1 <> new.week_start_day
BEGIN
  SELECT RAISE(ABORT, 'projects.start_date must fall on week_start_day');
END;
--> statement-breakpoint
CREATE TRIGGER projects_start_date_matches_week_start_update
BEFORE UPDATE OF start_date, week_start_day ON projects
WHEN ((CAST(strftime('%w', new.start_date) AS INTEGER) + 6) % 7) + 1 <> new.week_start_day
BEGIN
  SELECT RAISE(ABORT, 'projects.start_date must fall on week_start_day');
END;
--> statement-breakpoint
CREATE TRIGGER stories_number_pinned
BEFORE UPDATE OF number, project_id ON stories
WHEN new.number <> old.number OR new.project_id <> old.project_id
BEGIN
  SELECT RAISE(ABORT, 'stories.number is pinned after insert');
END;
--> statement-breakpoint
CREATE TRIGGER stories_icebox_is_unscheduled_insert
BEFORE INSERT ON stories
WHEN (new.list = 'icebox') <> (new.current_state = 'unscheduled')
BEGIN
  SELECT RAISE(ABORT, 'stories: unscheduled is exactly the icebox list');
END;
--> statement-breakpoint
CREATE TRIGGER stories_icebox_is_unscheduled_update
BEFORE UPDATE OF list, current_state ON stories
WHEN (new.list = 'icebox') <> (new.current_state = 'unscheduled')
BEGIN
  SELECT RAISE(ABORT, 'stories: unscheduled is exactly the icebox list');
END;
--> statement-breakpoint
CREATE TRIGGER stories_type_transitions_insert
BEFORE INSERT ON stories
WHEN (new.story_type = 'release' AND new.current_state IN ('started','delivered','rejected'))
  OR (new.story_type = 'chore'   AND new.current_state IN ('finished','delivered','rejected'))
BEGIN
  SELECT RAISE(ABORT, 'stories: a release goes unstarted -> finished -> accepted and a chore unstarted -> started -> accepted');
END;
--> statement-breakpoint
CREATE TRIGGER stories_type_transitions_update
BEFORE UPDATE OF story_type, current_state ON stories
WHEN (new.story_type = 'release' AND new.current_state IN ('started','delivered','rejected'))
  OR (new.story_type = 'chore'   AND new.current_state IN ('finished','delivered','rejected'))
BEGIN
  SELECT RAISE(ABORT, 'stories: a release goes unstarted -> finished -> accepted and a chore unstarted -> started -> accepted');
END;
--> statement-breakpoint
CREATE TRIGGER stories_estimate_gate_insert
BEFORE INSERT ON stories
WHEN new.estimate IS NULL
  AND new.current_state IN ('started','finished','delivered','accepted','rejected')
  AND (new.story_type = 'feature'
       OR (new.story_type IN ('bug','chore')
           AND (SELECT bugs_and_chores_are_estimatable FROM projects WHERE id = new.project_id) = 1))
BEGIN
  SELECT RAISE(ABORT, 'stories: an estimable story must be estimated before it starts');
END;
--> statement-breakpoint
CREATE TRIGGER stories_estimate_gate_update
BEFORE UPDATE OF estimate, current_state, story_type ON stories
WHEN new.estimate IS NULL
  AND new.current_state IN ('started','finished','delivered','accepted','rejected')
  AND (new.story_type = 'feature'
       OR (new.story_type IN ('bug','chore')
           AND (SELECT bugs_and_chores_are_estimatable FROM projects WHERE id = new.project_id) = 1))
BEGIN
  SELECT RAISE(ABORT, 'stories: an estimable story must be estimated before it starts');
END;
--> statement-breakpoint
CREATE TRIGGER stories_accepted_at_agrees_insert
BEFORE INSERT ON stories
WHEN (new.current_state = 'accepted') <> (new.accepted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'stories.accepted_at is set exactly while current_state is accepted');
END;
--> statement-breakpoint
CREATE TRIGGER stories_accepted_at_agrees_update
BEFORE UPDATE OF current_state, accepted_at ON stories
WHEN (new.current_state = 'accepted') <> (new.accepted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'stories.accepted_at is set exactly while current_state is accepted');
END;
--> statement-breakpoint
CREATE TRIGGER stories_planned_needs_manual_planning_insert
BEFORE INSERT ON stories
WHEN new.current_state = 'planned'
  AND (SELECT automatic_planning FROM projects WHERE id = new.project_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'stories: planned exists only under manual planning');
END;
--> statement-breakpoint
CREATE TRIGGER stories_planned_needs_manual_planning_update
BEFORE UPDATE OF current_state ON stories
WHEN new.current_state = 'planned'
  AND (SELECT automatic_planning FROM projects WHERE id = new.project_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'stories: planned exists only under manual planning');
END;
--> statement-breakpoint
CREATE TRIGGER stories_deadline_release_only_insert
BEFORE INSERT ON stories
WHEN new.deadline IS NOT NULL AND new.story_type <> 'release'
BEGIN
  SELECT RAISE(ABORT, 'stories.deadline belongs to release stories only');
END;
--> statement-breakpoint
CREATE TRIGGER stories_deadline_release_only_update
BEFORE UPDATE OF deadline, story_type ON stories
WHEN new.deadline IS NOT NULL AND new.story_type <> 'release'
BEGIN
  SELECT RAISE(ABORT, 'stories.deadline belongs to release stories only');
END;
--> statement-breakpoint
CREATE TRIGGER stories_release_never_estimated_insert
BEFORE INSERT ON stories
WHEN new.story_type = 'release' AND new.estimate IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'stories: a release is never estimated');
END;
--> statement-breakpoint
CREATE TRIGGER stories_release_never_estimated_update
BEFORE UPDATE OF story_type, estimate ON stories
WHEN new.story_type = 'release' AND new.estimate IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'stories: a release is never estimated');
END;
--> statement-breakpoint
CREATE TRIGGER projects_bugs_chores_estimation_one_way
BEFORE UPDATE OF bugs_and_chores_are_estimatable ON projects
WHEN old.bugs_and_chores_are_estimatable = 1 AND new.bugs_and_chores_are_estimatable = 0
BEGIN
  SELECT RAISE(ABORT, 'projects.bugs_and_chores_are_estimatable cannot be turned off again');
END;
--> statement-breakpoint
CREATE TRIGGER projects_automatic_planning_needs_no_planned
BEFORE UPDATE OF automatic_planning ON projects
WHEN old.automatic_planning = 0 AND new.automatic_planning = 1
  AND EXISTS (SELECT 1 FROM stories WHERE project_id = new.id AND current_state = 'planned')
BEGIN
  SELECT RAISE(ABORT, 'projects: automatic planning leaves no planned story behind');
END;
--> statement-breakpoint
CREATE TRIGGER blockers_unlink_on_story_delete
BEFORE DELETE ON stories
BEGIN
  UPDATE blockers SET blocking_story_id = NULL, resolved = 1, updated_at = (strftime('%s','now') * 1000)
   WHERE project_id = old.project_id AND blocking_story_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER story_people_drop_on_member_removal
BEFORE DELETE ON project_members
BEGIN
  DELETE FROM story_owners WHERE project_id = old.project_id AND user_id = old.user_id;
  DELETE FROM story_followers WHERE project_id = old.project_id AND user_id = old.user_id;
  UPDATE reviews SET reviewer_id = NULL WHERE project_id = old.project_id AND reviewer_id = old.user_id;
END;
