ALTER TABLE `cursor_delivery_jobs` ADD `dispatch_key` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `cursor_delivery_jobs` SET `dispatch_key` = 'cursor-' || lower(hex(randomblob(16))) WHERE `dispatch_key` = '';--> statement-breakpoint
ALTER TABLE `claude_delivery_jobs` ADD `dispatch_key` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `claude_delivery_jobs` SET `dispatch_key` = 'claude-' || lower(hex(randomblob(16))) WHERE `dispatch_key` = '';--> statement-breakpoint
ALTER TABLE `codex_delivery_jobs` ADD `dispatch_key` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `codex_delivery_jobs` SET `dispatch_key` = 'codex-' || lower(hex(randomblob(16))) WHERE `dispatch_key` = '';--> statement-breakpoint
ALTER TABLE `grok_delivery_jobs` ADD `dispatch_key` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `grok_delivery_jobs` SET `dispatch_key` = 'grok-' || lower(hex(randomblob(16))) WHERE `dispatch_key` = '';
