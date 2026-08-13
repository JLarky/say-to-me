CREATE TABLE `jarvis_create_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`workspace_identity` text NOT NULL,
	`workspace_directory` text NOT NULL,
	`alias` text NOT NULL,
	`slug` text NOT NULL,
	`provider` text NOT NULL,
	`provider_config_fingerprint` text NOT NULL,
	`model_id` text,
	`reasoning_effort` text,
	`phase` text DEFAULT 'pending' NOT NULL,
	`session_id` text,
	`created_workspace` integer DEFAULT 0 NOT NULL,
	`created_attachment` integer DEFAULT 0 NOT NULL,
	`provider_create_complete` integer DEFAULT 0 NOT NULL,
	`leased_at` integer,
	`lease_owner` text,
	`bootstrap_client_message_id` text,
	`bootstrap_status` text,
	`bootstrap_error` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jarvis_create_operations_workspace_uidx` ON `jarvis_create_operations` (`workspace_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `jarvis_create_operations_space_alias_uidx` ON `jarvis_create_operations` (`space_id`,`alias`);--> statement-breakpoint
CREATE INDEX `jarvis_create_operations_session_idx` ON `jarvis_create_operations` (`session_id`);--> statement-breakpoint
CREATE INDEX `jarvis_create_operations_space_idx` ON `jarvis_create_operations` (`space_id`);
