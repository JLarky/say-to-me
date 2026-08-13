CREATE TABLE `message_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`thumbnail_data_url` text DEFAULT '' NOT NULL,
	`thumbnail_width` integer DEFAULT 0 NOT NULL,
	`thumbnail_height` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text DEFAULT 'default' NOT NULL,
	`text` text NOT NULL,
	`extra_markdown` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`author` text DEFAULT 'agent' NOT NULL,
	`parent_id` integer,
	`attached_session_id` text,
	`opencode_delivery_status` text,
	`opencode_delivery_error` text,
	`opencode_message_id` text,
	`client_message_id` text,
	`links` text,
	`session_refs` text,
	`merged_into_message_id` integer,
	`forward_role` text,
	`forward_source_session_id` text,
	`forward_source_message_id` integer,
	`forward_target_session_id` text,
	`forward_target_message_id` integer,
	`forward_status` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`state` text DEFAULT 'general' NOT NULL,
	`alias` text,
	`opencode_project_id` text,
	`opencode_workspace_id` text,
	`opencode_directory` text,
	`opencode_worktree` text,
	`opencode_path` text,
	`opencode_project_name` text,
	`opencode_branch` text,
	`opencode_selected_model_provider` text,
	`opencode_selected_model` text
);
