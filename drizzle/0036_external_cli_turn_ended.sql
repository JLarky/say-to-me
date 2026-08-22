ALTER TABLE `cursor_delivery_jobs` ADD `cli_turn_ended_at` integer;--> statement-breakpoint
ALTER TABLE `claude_delivery_jobs` ADD `cli_turn_ended_at` integer;--> statement-breakpoint
ALTER TABLE `codex_delivery_jobs` ADD `cli_turn_ended_at` integer;--> statement-breakpoint
ALTER TABLE `grok_delivery_jobs` ADD `cli_turn_ended_at` integer;
