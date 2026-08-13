CREATE TABLE `t3_delivery_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`message_session_id` text NOT NULL,
	`t3_session_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`locked_at` integer,
	`locked_by` text,
	`last_error` text,
	`sequence` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `t3_delivery_jobs_message_kind_unique` ON `t3_delivery_jobs` (`message_id`,`kind`);--> statement-breakpoint
CREATE INDEX `t3_delivery_jobs_due_idx` ON `t3_delivery_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `t3_delivery_jobs_session_idx` ON `t3_delivery_jobs` (`t3_session_id`,`status`,`next_attempt_at`);