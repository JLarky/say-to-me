-- Custom SQL migration file, put your code below! --
CREATE TABLE `routines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_session_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`title` text,
	`trigger_kind` text NOT NULL,
	`trigger` text NOT NULL,
	`action` text NOT NULL,
	`next_fire_at` integer,
	`last_fired_at` integer,
	`last_message_id` integer,
	`locked_at` integer,
	`locked_by` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`last_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `routines_owner_status_idx` ON `routines` (`owner_session_id`,`status`,`next_fire_at`);
--> statement-breakpoint
CREATE INDEX `routines_due_idx` ON `routines` (`status`,`next_fire_at`);
--> statement-breakpoint
CREATE INDEX `routines_trigger_kind_idx` ON `routines` (`trigger_kind`,`status`);
--> statement-breakpoint
INSERT INTO `routines` (
	`id`,
	`owner_session_id`,
	`status`,
	`title`,
	`trigger_kind`,
	`trigger`,
	`action`,
	`next_fire_at`,
	`last_fired_at`,
	`last_message_id`,
	`locked_at`,
	`locked_by`,
	`last_error`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`session_id`,
	CASE WHEN `status` = 'completed' THEN 'fired' ELSE `status` END,
	`title`,
	'schedule',
	json_object(
		'kind', 'schedule',
		'dueAt', `due_at`,
		'intervalMs', `interval_ms`,
		'nextFireAt', `next_fire_at`
	),
	json_object(
		'kind', 'deliver_prompt',
		'title', `title`,
		'message', `message`
	),
	`next_fire_at`,
	`last_fired_at`,
	`last_message_id`,
	`locked_at`,
	`locked_by`,
	`last_error`,
	`created_at`,
	`updated_at`
FROM `jarvis_timers`;
--> statement-breakpoint
DROP TABLE `jarvis_timers`;
