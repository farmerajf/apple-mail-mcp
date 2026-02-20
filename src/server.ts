import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listAccounts } from "./jxa/accounts.jxa.js";
import { listMailboxes, getMailboxSummary } from "./jxa/mailboxes.jxa.js";
import {
  listMessages,
  getMessage,
  searchMessages,
  moveMessage,
  markMessage,
  deleteMessage,
} from "./jxa/messages.jxa.js";
import {
  sendMessage,
  replyToMessage,
  forwardMessage,
} from "./jxa/compose.jxa.js";
import type { Config } from "./config.js";

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true as const };
}

function successResponse(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: "apple-mail",
    version: "1.0.0",
  });

  // list_accounts
  server.tool("list_accounts", "List all configured mail accounts", {}, async () => {
    const result = await listAccounts();
    if (!result.success) return errorResponse(result.error!);
    return successResponse({ accounts: result.data });
  });

  // list_mailboxes
  server.tool(
    "list_mailboxes",
    "List mailboxes (folders) for an account or all accounts",
    { account_name: z.string().optional().describe("Filter to a specific account") },
    async ({ account_name }) => {
      const result = await listMailboxes(account_name);
      if (!result.success) return errorResponse(result.error!);
      return successResponse({ mailboxes: result.data });
    },
  );

  // list_messages
  server.tool(
    "list_messages",
    "List messages in a mailbox with pagination",
    {
      mailbox: z.string().describe('Mailbox name e.g. "INBOX"'),
      account: z.string().optional().describe("Account name"),
      limit: z.number().min(1).max(100).optional().describe("Number of messages (default 25, max 100)"),
      offset: z.number().min(0).optional().describe("Pagination offset (default 0)"),
      unread_only: z.boolean().optional().describe("Only return unread messages"),
    },
    async ({ mailbox, account, limit, offset, unread_only }) => {
      const result = await listMessages({
        mailbox,
        account,
        limit: limit ?? 25,
        offset: offset ?? 0,
        unreadOnly: unread_only ?? false,
      });
      if (!result.success) return errorResponse(result.error!);
      return successResponse(result.data);
    },
  );

  // get_message
  server.tool(
    "get_message",
    "Get full message content including body and attachment metadata.",
    {
      message_id: z.coerce.string().describe("Mail.app message ID"),
      account: z.string().describe("Account name (from list/search results)"),
      mailbox: z.string().describe("Mailbox name (from list/search results)"),
      format: z.enum(["plain", "html"]).optional().describe("Body format preference (default plain)"),
      include_headers: z.boolean().optional().describe("Include raw headers"),
    },
    async ({ message_id, account, mailbox, format, include_headers }) => {
      const result = await getMessage({
        messageId: message_id,
        account,
        mailbox,
        format: format ?? "plain",
        includeHeaders: include_headers ?? false,
      });
      if (!result.success) return errorResponse(result.error!);
      return successResponse(result.data);
    },
  );

  // search_messages
  server.tool(
    "search_messages",
    "Search across mailboxes using various filters",
    {
      query: z.string().describe("Search text (searches subject and sender)"),
      account: z.string().optional().describe("Limit to account"),
      mailbox: z.string().optional().describe("Limit to mailbox"),
      from: z.string().optional().describe("Filter by sender"),
      subject: z.string().optional().describe("Filter by subject"),
      date_from: z.string().optional().describe("Messages after this date (ISO format)"),
      date_to: z.string().optional().describe("Messages before this date (ISO format)"),
      is_unread: z.boolean().optional().describe("Filter by read status"),
      is_flagged: z.boolean().optional().describe("Filter by flag status"),
      limit: z.number().min(1).max(100).optional().describe("Max results (default 25, max 100)"),
    },
    async (params) => {
      const result = await searchMessages({
        query: params.query,
        account: params.account,
        mailbox: params.mailbox,
        from: params.from,
        subject: params.subject,
        dateFrom: params.date_from,
        dateTo: params.date_to,
        isUnread: params.is_unread,
        isFlagged: params.is_flagged,
        limit: params.limit ?? 25,
      });
      if (!result.success) return errorResponse(result.error!);
      return successResponse(result.data);
    },
  );

  // send_message
  server.tool(
    "send_message",
    "Create a draft email in Mail.app for review. Opens the compose window — user must manually send.",
    {
      to: z.array(z.string()).describe("Recipient email addresses"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body text"),
      cc: z.array(z.string()).optional().describe("CC recipients"),
      bcc: z.array(z.string()).optional().describe("BCC recipients"),
      from_account: z.string().optional().describe("Sending account name"),
      is_html: z.boolean().optional().describe("Whether body is HTML"),
    },
    async (params) => {
      const result = await sendMessage({
        to: params.to,
        subject: params.subject,
        body: params.body,
        cc: params.cc,
        bcc: params.bcc,
        fromAccount: params.from_account,
        isHtml: params.is_html,
      });
      if (!result.success) return errorResponse(result.error!);
      return successResponse(result.data);
    },
  );

  // reply_to_message
  server.tool(
    "reply_to_message",
    "Create a reply draft in Mail.app for review. Opens the compose window — user must manually send.",
    {
      message_id: z.coerce.string().describe("Mail.app message ID"),
      body: z.string().describe("Reply text"),
      reply_all: z.boolean().optional().describe("Reply to all recipients"),
      is_html: z.boolean().optional().describe("Whether body is HTML"),
    },
    async (params) => {
      const result = await replyToMessage({
        messageId: params.message_id,
        body: params.body,
        replyAll: params.reply_all,
        isHtml: params.is_html,
      });
      if (!result.success) return errorResponse(result.error!);
      return successResponse(result.data);
    },
  );

  // forward_message
  server.tool(
    "forward_message",
    "Create a forward draft in Mail.app for review. Opens the compose window — user must manually send.",
    {
      message_id: z.coerce.string().describe("Mail.app message ID"),
      to: z.array(z.string()).describe("Forward recipient addresses"),
      body: z.string().optional().describe("Additional text prepended to forwarded message"),
      is_html: z.boolean().optional().describe("Whether body is HTML"),
    },
    async (params) => {
      const result = await forwardMessage({
        messageId: params.message_id,
        to: params.to,
        body: params.body,
        isHtml: params.is_html,
      });
      if (!result.success) return errorResponse(result.error!);
      return successResponse(result.data);
    },
  );

  // move_message
  server.tool(
    "move_message",
    "Move a message to a different mailbox",
    {
      message_id: z.coerce.string().describe("Mail.app message ID"),
      target_mailbox: z.string().describe("Destination mailbox name"),
      target_account: z.string().optional().describe("Target account (for cross-account moves)"),
    },
    async (params) => {
      const result = await moveMessage({
        messageId: params.message_id,
        targetMailbox: params.target_mailbox,
        targetAccount: params.target_account,
      });
      if (!result.success) return errorResponse(result.error!);
      return successResponse(result.data);
    },
  );

  // mark_message
  server.tool(
    "mark_message",
    "Change message flags/status (read, flagged, color)",
    {
      message_id: z.union([z.coerce.string(), z.array(z.coerce.string())]).describe("Message ID(s) — supports bulk"),
      is_read: z.boolean().optional().describe("Set read/unread"),
      is_flagged: z.boolean().optional().describe("Set/clear flag"),
      flag_index: z.number().min(0).max(6).optional().describe("Colour flag (0-6)"),
    },
    async (params) => {
      const result = await markMessage({
        messageId: params.message_id,
        isRead: params.is_read,
        isFlagged: params.is_flagged,
        flagIndex: params.flag_index,
      });
      if (!result.success) return errorResponse(result.error!);
      return successResponse(result.data);
    },
  );

  // delete_message
  server.tool(
    "delete_message",
    "Move message(s) to trash or permanently delete",
    {
      message_id: z.union([z.coerce.string(), z.array(z.coerce.string())]).describe("Message ID(s) — supports bulk"),
      permanent: z.boolean().optional().describe("Permanently delete (default: move to trash)"),
    },
    async (params) => {
      const result = await deleteMessage({
        messageId: params.message_id,
        permanent: params.permanent,
      });
      if (!result.success) return errorResponse(result.error!);
      return successResponse(result.data);
    },
  );

  // get_mailbox_summary
  server.tool(
    "get_mailbox_summary",
    "Quick overview of unread counts and recent activity across all mailboxes",
    {},
    async () => {
      const result = await getMailboxSummary();
      if (!result.success) return errorResponse(result.error!);
      return successResponse({ accounts: result.data });
    },
  );

  return server;
}
