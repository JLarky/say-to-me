INSERT INTO `spaces` (`id`, `name`, `parent_id`, `archived`, `context`, `access`)
SELECT 'space-default', 'Default', NULL, 0, 'Your first space for repositories, worktrees, and agent sessions.', 'private'
WHERE NOT EXISTS (SELECT 1 FROM `spaces` LIMIT 1);
