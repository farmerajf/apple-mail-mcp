// Mail account
export interface MailAccount {
  name: string;
  email: string;
  enabled: boolean;
  accountType: string;
}

// Mailbox (folder)
export interface Mailbox {
  name: string;
  account: string;
  unreadCount: number;
  messageCount: number;
  fullPath: string;
}

// Message summary (used in list/search results)
export interface MessageSummary {
  id: string;
  messageId: string;
  deepLink: string;
  subject: string;
  sender: string;
  dateSent: string;
  dateReceived: string;
  isRead: boolean;
  isFlagged: boolean;
  hasAttachments: boolean;
  previewText: string;
}

// Full message detail
export interface MessageDetail extends MessageSummary {
  recipients: {
    to: string[];
    cc: string[];
    bcc: string[];
  };
  body: string;
  attachments: Attachment[];
  headers?: Record<string, string>;
  mailbox: string;
  account: string;
}

export interface Attachment {
  name: string;
  size: number;
  mimeType: string;
}

// Mailbox summary for overview
export interface MailboxSummary {
  name: string;
  unreadCount: number;
  totalCount: number;
  latestMessageDate: string | null;
}

export interface AccountSummary {
  name: string;
  mailboxes: MailboxSummary[];
}

// JXA execution result
export interface JXAResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Error codes
export type ErrorCode =
  | "MAIL_NOT_RUNNING"
  | "ACCOUNT_NOT_FOUND"
  | "MAILBOX_NOT_FOUND"
  | "MESSAGE_NOT_FOUND"
  | "SEND_FAILED"
  | "TIMEOUT"
  | "JXA_ERROR";

export interface MailError {
  error: string;
  code: ErrorCode;
}
