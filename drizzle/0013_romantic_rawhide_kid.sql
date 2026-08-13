CREATE TABLE `session_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_folders_parent_idx` ON `session_folders` (`parent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `session_placements` (
	`session_id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`sort_order` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_placements_folder_idx` ON `session_placements` (`folder_id`,`sort_order`);
