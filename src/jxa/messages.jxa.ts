import { executeJXA } from "./executor.js";
import type { JXAResult, MessageSummary, MessageDetail } from "../types.js";

/**
 * List messages in a mailbox with pagination.
 */
export async function listMessages(params: {
  mailbox: string;
  account?: string;
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}): Promise<JXAResult<{ messages: MessageSummary[]; total: number; hasMore: boolean }>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');
    const limit = args.limit || 25;
    const offset = args.offset || 0;

    let mailbox;
    let accountName = '';
    if (args.account) {
      const accts = Mail.accounts.whose({ name: args.account })();
      if (accts.length === 0) throw new Error('Account not found: ' + args.account);
      const mbs = accts[0].mailboxes.whose({ name: args.mailbox })();
      if (mbs.length === 0) throw new Error('Mailbox not found: ' + args.mailbox);
      mailbox = mbs[0];
      accountName = args.account;
    } else {
      // Search across all accounts
      const accounts = Mail.accounts();
      for (const acct of accounts) {
        const mbs = acct.mailboxes.whose({ name: args.mailbox })();
        if (mbs.length > 0) {
          mailbox = mbs[0];
          accountName = acct.name();
          break;
        }
      }
      if (!mailbox) throw new Error('Mailbox not found: ' + args.mailbox);
    }

    // Batch property access — one IPC call per property, returns arrays
    const ids = mailbox.messages.id();
    const total = ids.length;
    if (total === 0) {
      JSON.stringify({ messages: [], total: 0, hasMore: false });
    } else {
      const subjects = mailbox.messages.subject();
      const senders = mailbox.messages.sender();
      const datesReceived = mailbox.messages.dateReceived();
      const datesSent = mailbox.messages.dateSent();
      const readStatuses = mailbox.messages.readStatus();
      const flagStatuses = mailbox.messages.flaggedStatus();
      const messageIds = mailbox.messages.messageId();

      // Apply unread filter and pagination in JS
      const result = [];
      let seen = 0;
      for (let i = 0; i < total && result.length < limit; i++) {
        if (args.unreadOnly && readStatuses[i]) continue;
        if (seen < offset) { seen++; continue; }
        seen++;
        try {
          const msgId = messageIds[i];
          const encodedId = '<' + msgId + '>';
          result.push({
            id: ids[i].toString(),
            messageId: msgId,
            deepLink: 'message://' + encodeURIComponent(encodedId),
            subject: subjects[i],
            sender: senders[i],
            dateSent: datesSent[i].toISOString(),
            dateReceived: datesReceived[i].toISOString(),
            isRead: readStatuses[i],
            isFlagged: flagStatuses[i],
            mailbox: args.mailbox,
            account: accountName
          });
        } catch(e) {}
      }

      JSON.stringify({ messages: result, total: total, hasMore: (offset + limit) < total });
    }
  `;
  return executeJXA(script, {
    mailbox: params.mailbox,
    account: params.account,
    limit: Math.min(params.limit || 25, 100),
    offset: params.offset || 0,
    unreadOnly: params.unreadOnly || false,
  });
}

/**
 * Get full message content by Mail.app message ID.
 */
export async function getMessage(params: {
  messageId: string;
  account: string;
  mailbox: string;
  format?: "plain" | "html";
  includeHeaders?: boolean;
}): Promise<JXAResult<MessageDetail>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');
    const targetId = parseInt(args.messageId);

    const accts = Mail.accounts.whose({ name: args.account })();
    if (accts.length === 0) throw new Error('Account not found: ' + args.account);
    const mbs = accts[0].mailboxes.whose({ name: args.mailbox })();
    if (mbs.length === 0) throw new Error('Mailbox not found: ' + args.mailbox);

    // whose({id:...}) narrows the reference so subsequent per-message calls are fast
    const matches = mbs[0].messages.whose({ id: targetId })();
    if (matches.length === 0) throw new Error('Message not found: ' + args.messageId);
    const msg = matches[0];

    // Sanitize strings: strip null bytes, control chars, U+FFFC, U+2028/2029 (keep \\n \\r \\t)
    function clean(s) {
      if (!s) return s;
      return s.replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\uFFFC\\u2028\\u2029]/g, '');
    }

    const msgId = msg.messageId();

    let body = '';
    if (args.format === 'html') {
      try { body = msg.source(); } catch(e) { body = msg.content() || ''; }
    } else {
      body = msg.content() || '';
    }
    body = clean(body);

    const toAddrs = [];
    const ccAddrs = [];
    const bccAddrs = [];
    try { const r = msg.toRecipients(); for (const x of r) toAddrs.push(x.address()); } catch(e) {}
    try { const r = msg.ccRecipients(); for (const x of r) ccAddrs.push(x.address()); } catch(e) {}
    try { const r = msg.bccRecipients(); for (const x of r) bccAddrs.push(x.address()); } catch(e) {}

    const attachments = [];
    try {
      const atts = msg.mailAttachments();
      for (let i = 0; i < atts.length; i++) {
        try {
          attachments.push({
            name: clean(atts[i].name()),
            size: atts[i].fileSize(),
            mimeType: atts[i].mimeType()
          });
        } catch(e) {}
      }
    } catch(e) {}

    const result = {
      id: msg.id().toString(),
      messageId: msgId,
      deepLink: 'message://' + encodeURIComponent('<' + msgId + '>'),
      subject: clean(msg.subject()),
      sender: clean(msg.sender()),
      recipients: { to: toAddrs, cc: ccAddrs, bcc: bccAddrs },
      dateSent: msg.dateSent().toISOString(),
      dateReceived: msg.dateReceived().toISOString(),
      isRead: msg.readStatus(),
      isFlagged: msg.flaggedStatus(),
      hasAttachments: attachments.length > 0,
      previewText: body.substring(0, 200),
      body: body,
      attachments: attachments,
      mailbox: args.mailbox,
      account: args.account
    };

    if (args.includeHeaders) {
      try {
        const src = msg.source();
        const headerEnd = src.indexOf('\\r\\n\\r\\n');
        if (headerEnd > -1) {
          const headerBlock = src.substring(0, headerEnd);
          const headers = {};
          const lines = headerBlock.split('\\r\\n');
          let currentKey = '';
          for (const line of lines) {
            if (line.startsWith(' ') || line.startsWith('\\t')) {
              if (currentKey) headers[currentKey] += ' ' + line.trim();
            } else {
              const colonIdx = line.indexOf(':');
              if (colonIdx > 0) {
                currentKey = line.substring(0, colonIdx).trim();
                headers[currentKey] = line.substring(colonIdx + 1).trim();
              }
            }
          }
          result.headers = headers;
        }
      } catch(e) {}
    }

    JSON.stringify(result);
  `;
  return executeJXA<MessageDetail>(script, {
    messageId: params.messageId,
    account: params.account,
    mailbox: params.mailbox,
    format: params.format || "plain",
    includeHeaders: params.includeHeaders || false,
  });
}

/**
 * Search messages with various filters.
 * Uses batch property access (mb.messages.subject() etc.) to avoid
 * per-message IPC calls which cause timeouts.
 */
export async function searchMessages(params: {
  query: string;
  account?: string;
  mailbox?: string;
  from?: string;
  subject?: string;
  dateFrom?: string;
  dateTo?: string;
  isUnread?: boolean;
  isFlagged?: boolean;
  limit?: number;
}): Promise<JXAResult<{ messages: MessageSummary[]; total: number; hasMore: boolean }>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');
    const limit = args.limit || 25;
    const results = [];

    // Collect mailboxes with their account names
    let mbEntries = []; // [{mb, accountName}]
    if (args.account) {
      const accts = Mail.accounts.whose({ name: args.account })();
      if (accts.length === 0) throw new Error('Account not found: ' + args.account);
      if (args.mailbox) {
        const mbs = accts[0].mailboxes.whose({ name: args.mailbox })();
        for (const mb of mbs) mbEntries.push({mb, accountName: args.account});
      } else {
        const mbs = accts[0].mailboxes();
        for (const mb of mbs) mbEntries.push({mb, accountName: args.account});
      }
    } else if (args.mailbox) {
      const accounts = Mail.accounts();
      for (const acct of accounts) {
        const aName = acct.name();
        const mbs = acct.mailboxes.whose({ name: args.mailbox })();
        for (const mb of mbs) mbEntries.push({mb, accountName: aName});
      }
    } else {
      const accounts = Mail.accounts();
      for (const acct of accounts) {
        const aName = acct.name();
        const mbs = acct.mailboxes();
        for (const mb of mbs) mbEntries.push({mb, accountName: aName});
      }
    }

    // Pre-compute filter values
    const queryLower = args.query ? args.query.toLowerCase() : null;
    const fromLower = args.from ? args.from.toLowerCase() : null;
    const subjectFilter = args.subject ? args.subject.toLowerCase() : null;
    const dateFrom = args.dateFrom ? new Date(args.dateFrom) : null;
    const dateTo = args.dateTo ? new Date(args.dateTo) : null;

    for (const entry of mbEntries) {
      if (results.length >= limit) break;
      try {
        const mb = entry.mb;
        const mbName = mb.name();

        // Batch property access — one IPC call per property, returns arrays
        const ids = mb.messages.id();
        if (ids.length === 0) continue;

        const subjects = mb.messages.subject();
        const senders = mb.messages.sender();
        const datesReceived = mb.messages.dateReceived();
        const datesSent = mb.messages.dateSent();
        const readStatuses = mb.messages.readStatus();
        const flagStatuses = mb.messages.flaggedStatus();
        const messageIds = mb.messages.messageId();

        for (let i = 0; i < ids.length && results.length < limit; i++) {
          try {
            if (args.isUnread !== undefined && args.isUnread !== null) {
              if (readStatuses[i] === args.isUnread) continue;
            }
            if (args.isFlagged !== undefined && args.isFlagged !== null) {
              if (flagStatuses[i] !== args.isFlagged) continue;
            }
            if (dateFrom) {
              if (datesReceived[i] < dateFrom) continue;
            }
            if (dateTo) {
              if (datesReceived[i] > dateTo) continue;
            }
            if (fromLower) {
              if (!(senders[i] || '').toLowerCase().includes(fromLower)) continue;
            }
            if (subjectFilter) {
              if (!(subjects[i] || '').toLowerCase().includes(subjectFilter)) continue;
            }

            // Text query — searches subject and sender (not body)
            if (queryLower) {
              const subj = (subjects[i] || '').toLowerCase();
              const sender = (senders[i] || '').toLowerCase();
              if (!subj.includes(queryLower) && !sender.includes(queryLower)) continue;
            }

            const msgId = messageIds[i];
            const encodedId = '<' + msgId + '>';
            results.push({
              id: ids[i].toString(),
              messageId: msgId,
              deepLink: 'message://' + encodeURIComponent(encodedId),
              subject: subjects[i],
              sender: senders[i],
              dateSent: datesSent[i].toISOString(),
              dateReceived: datesReceived[i].toISOString(),
              isRead: readStatuses[i],
              isFlagged: flagStatuses[i],
              mailbox: mbName,
              account: entry.accountName
            });
          } catch(e) {}
        }
      } catch(e) {}
    }

    JSON.stringify({ messages: results, total: results.length, hasMore: false });
  `;
  return executeJXA(
    script,
    {
      query: params.query,
      account: params.account,
      mailbox: params.mailbox,
      from: params.from,
      subject: params.subject,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      isUnread: params.isUnread,
      isFlagged: params.isFlagged,
      limit: Math.min(params.limit || 25, 100),
    },
    120000,
  );
}

/**
 * Move a message to a different mailbox.
 */
export async function moveMessage(params: {
  messageId: string;
  targetMailbox: string;
  targetAccount?: string;
}): Promise<JXAResult<{ success: boolean }>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');
    const targetId = parseInt(args.messageId);

    // Find message using batch ID lookup
    let found = null;
    const accounts = Mail.accounts();
    for (const acct of accounts) {
      if (found) break;
      const mailboxes = acct.mailboxes();
      for (const mb of mailboxes) {
        if (found) break;
        try {
          const ids = mb.messages.id();
          const idx = ids.indexOf(targetId);
          if (idx >= 0) found = mb.messages[idx];
        } catch(e) {}
      }
    }
    if (!found) throw new Error('Message not found: ' + args.messageId);

    // Find target mailbox
    let targetMb = null;
    if (args.targetAccount) {
      const accts = Mail.accounts.whose({ name: args.targetAccount })();
      if (accts.length === 0) throw new Error('Target account not found');
      const mbs = accts[0].mailboxes.whose({ name: args.targetMailbox })();
      if (mbs.length === 0) throw new Error('Target mailbox not found');
      targetMb = mbs[0];
    } else {
      for (const acct of accounts) {
        const mbs = acct.mailboxes.whose({ name: args.targetMailbox })();
        if (mbs.length > 0) { targetMb = mbs[0]; break; }
      }
      if (!targetMb) throw new Error('Target mailbox not found: ' + args.targetMailbox);
    }

    Mail.move(found, { to: targetMb });
    JSON.stringify({ success: true });
  `;
  return executeJXA(script, params);
}

/**
 * Mark message(s) read/unread/flagged.
 */
export async function markMessage(params: {
  messageId: string | string[];
  isRead?: boolean;
  isFlagged?: boolean;
  flagIndex?: number;
}): Promise<JXAResult<{ success: boolean; updated: number }>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');
    const targetIds = Array.isArray(args.messageId)
      ? args.messageId.map(id => parseInt(id))
      : [parseInt(args.messageId)];
    let updated = 0;

    const accounts = Mail.accounts();
    for (const acct of accounts) {
      const mailboxes = acct.mailboxes();
      for (const mb of mailboxes) {
        try {
          const ids = mb.messages.id();
          for (const targetId of targetIds) {
            const idx = ids.indexOf(targetId);
            if (idx >= 0) {
              const msg = mb.messages[idx];
              if (args.isRead !== undefined && args.isRead !== null) {
                msg.readStatus = args.isRead;
              }
              if (args.isFlagged !== undefined && args.isFlagged !== null) {
                msg.flaggedStatus = args.isFlagged;
              }
              if (args.flagIndex !== undefined && args.flagIndex !== null) {
                msg.flagIndex = args.flagIndex;
              }
              updated++;
            }
          }
        } catch(e) {}
      }
    }

    JSON.stringify({ success: true, updated: updated });
  `;
  return executeJXA(script, params);
}

/**
 * Delete message(s) — move to trash or permanently delete.
 */
export async function deleteMessage(params: {
  messageId: string | string[];
  permanent?: boolean;
}): Promise<JXAResult<{ success: boolean; deleted: number }>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');
    const targetIds = Array.isArray(args.messageId)
      ? args.messageId.map(id => parseInt(id))
      : [parseInt(args.messageId)];
    let deleted = 0;

    const accounts = Mail.accounts();
    for (const acct of accounts) {
      const mailboxes = acct.mailboxes();
      for (const mb of mailboxes) {
        try {
          const ids = mb.messages.id();
          for (const targetId of targetIds) {
            const idx = ids.indexOf(targetId);
            if (idx >= 0) {
              const msg = mb.messages[idx];
              if (args.permanent) {
                Mail.delete(msg);
              } else {
                const trashMbs = acct.mailboxes.whose({ name: 'Trash' })();
                if (trashMbs.length > 0) {
                  Mail.move(msg, { to: trashMbs[0] });
                } else {
                  Mail.delete(msg);
                }
              }
              deleted++;
            }
          }
        } catch(e) {}
      }
    }

    JSON.stringify({ success: true, deleted: deleted });
  `;
  return executeJXA(script, params);
}
