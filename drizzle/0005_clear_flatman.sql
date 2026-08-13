CREATE TABLE `jarvis_timers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`due_at` integer NOT NULL,
	`interval_ms` integer,
	`next_fire_at` integer NOT NULL,
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
CREATE INDEX `jarvis_timers_session_status_idx` ON `jarvis_timers` (`session_id`,`status`,`next_fire_at`);--> statement-breakpoint
CREATE INDEX `jarvis_timers_due_idx` ON `jarvis_timers` (`status`,`next_fire_at`);