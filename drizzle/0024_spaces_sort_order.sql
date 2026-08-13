ALTER TABLE `spaces` ADD `sort_order` real DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `spaces` SET `sort_order` = `rowid`;--> statement-breakpoint
DROP INDEX IF EXISTS `spaces_parent_idx`;--> statement-breakpoint
CREATE INDEX `spaces_parent_sort_idx` ON `spaces` (`parent_id`,`sort_order`);
