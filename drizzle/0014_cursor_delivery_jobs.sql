CREATE TABLE `cursor_delivery_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`message_session_id` text NOT NULL,
	`cursor_session_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`locked_at` integer,
	`locked_by` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cursor_delivery_jobs_message_kind_unique` ON `cursor_delivery_jobs` (`message_id`,`kind`);--> statement-breakpoint
CREATE INDEX `cursor_delivery_jobs_due_idx` ON `cursor_delivery_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `cursor_delivery_jobs_session_idx` ON `cursor_delivery_jobs` (`cursor_session_id`,`status`,`next_attempt_at`);
