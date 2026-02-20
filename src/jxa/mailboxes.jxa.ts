import { executeJXA } from "./executor.js";
import type { JXAResult, Mailbox, AccountSummary } from "../types.js";

/**
 * List mailboxes, optionally filtered by account.
 */
export async function listMailboxes(
  accountName?: string,
): Promise<JXAResult<Mailbox[]>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');
    const results = [];

    const accounts = args.accountName
      ? Mail.accounts.whose({ name: args.accountName })()
      : Mail.accounts();

    for (const account of accounts) {
      try {
        const mailboxes = account.mailboxes();
        for (const mb of mailboxes) {
          try {
            results.push({
              name: mb.name(),
              account: account.name(),
              unreadCount: mb.unreadCount(),
              messageCount: mb.messages.length,
              fullPath: account.name() + '/' + mb.name()
            });
          } catch(e) {}
        }
      } catch(e) {}
    }

    JSON.stringify(results);
  `;
  return executeJXA<Mailbox[]>(script, { accountName });
}

/**
 * Get a summary of unread counts and latest message dates across all mailboxes.
 */
export async function getMailboxSummary(): Promise<JXAResult<AccountSummary[]>> {
  const script = `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    const result = [];

    for (const account of accounts) {
      try {
        const mailboxes = account.mailboxes();
        const mbSummaries = [];
        for (const mb of mailboxes) {
          try {
            const msgs = mb.messages();
            let latestDate = null;
            if (msgs.length > 0) {
              try {
                latestDate = msgs[0].dateReceived().toISOString();
              } catch(e) {}
            }
            mbSummaries.push({
              name: mb.name(),
              unreadCount: mb.unreadCount(),
              totalCount: msgs.length,
              latestMessageDate: latestDate
            });
          } catch(e) {}
        }
        result.push({
          name: account.name(),
          mailboxes: mbSummaries
        });
      } catch(e) {}
    }

    JSON.stringify(result);
  `;
  return executeJXA<AccountSummary[]>(script, undefined, 60000);
}
