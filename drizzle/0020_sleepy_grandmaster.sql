CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`preferred_worktree_parent_path` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
