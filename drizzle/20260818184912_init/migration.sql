CREATE TABLE `inline_messages` (
	`id` integer PRIMARY KEY,
	`share_id` text NOT NULL,
	`inline_message_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_inline_messages_share_id_messages_share_id_fk` FOREIGN KEY (`share_id`) REFERENCES `messages`(`share_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY,
	`share_id` text NOT NULL,
	`chat_id` integer NOT NULL,
	`source_message_id` integer NOT NULL,
	`copied_message_id` integer NOT NULL,
	`control_message_id` integer NOT NULL,
	`message_snapshot` text NOT NULL,
	`inline_keyboard` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inline_messages_inline_message_id_unique` ON `inline_messages` (`inline_message_id`);--> statement-breakpoint
CREATE INDEX `inline_messages_share_id_idx` ON `inline_messages` (`share_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_share_id_unique` ON `messages` (`share_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_chat_source_message_unique` ON `messages` (`chat_id`,`source_message_id`);