CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`identity` text NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_identity_unique` ON `repositories` (`identity`);--> statement-breakpoint
CREATE INDEX `repositories_root_path_idx` ON `repositories` (`root_path`);--> statement-breakpoint
CREATE TABLE `space_repositories` (
	`space_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_repositories_unique` ON `space_repositories` (`space_id`,`repository_id`);--> statement-breakpoint
CREATE INDEX `space_repositories_space_idx` ON `space_repositories` (`space_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `space_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `space_sessions_space_idx` ON `space_sessions` (`space_id`);--> statement-breakpoint
CREATE TABLE `space_worktrees` (
	`space_id` text NOT NULL,
	`worktree_id` text NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_worktrees_unique` ON `space_worktrees` (`space_id`,`worktree_id`);--> statement-breakpoint
CREATE INDEX `space_worktrees_space_idx` ON `space_worktrees` (`space_id`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`archived` integer DEFAULT 0 NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`default_provider` text,
	`default_model` text,
	`access` text DEFAULT 'private' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spaces_parent_idx` ON `spaces` (`parent_id`);--> statement-breakpoint
CREATE TABLE `worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`repository_id` text NOT NULL,
	`branch` text NOT NULL,
	`is_main` integer DEFAULT 0 NOT NULL,
	`discovered_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktrees_path_unique` ON `worktrees` (`path`);--> statement-breakpoint
CREATE INDEX `worktrees_repository_idx` ON `worktrees` (`repository_id`);