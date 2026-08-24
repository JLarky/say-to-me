ALTER TABLE `cursor_delivery_jobs` ADD `force` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `claude_delivery_jobs` ADD `force` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `codex_delivery_jobs` ADD `force` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `grok_delivery_jobs` ADD `force` integer DEFAULT 0 NOT NULL;
