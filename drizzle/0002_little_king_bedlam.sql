ALTER TABLE `messages` ADD `completion_watch_status` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `completion_watch_work_seen` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `completion_source_session_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `completion_source_message_id` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `completion_target_notification_message_id` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `completion_source_notification_message_id` integer;