import { executeJXA } from "./executor.js";
import type { JXAResult } from "../types.js";

// Shared JXA snippet: find a message by ID using batch lookup
const FIND_MESSAGE_BY_ID = `
    const targetId = parseInt(args.messageId);
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
`;

/**
 * Send a new email message.
 */
export async function sendMessage(params: {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  fromAccount?: string;
  isHtml?: boolean;
}): Promise<JXAResult<{ success: boolean; message: string }>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');

    const msg = Mail.OutgoingMessage({
      subject: args.subject,
      content: args.body,
      visible: false
    });
    Mail.outgoingMessages.push(msg);

    // Add recipients
    for (const addr of args.to) {
      const recip = Mail.ToRecipient({ address: addr });
      msg.toRecipients.push(recip);
    }
    if (args.cc) {
      for (const addr of args.cc) {
        const recip = Mail.CcRecipient({ address: addr });
        msg.ccRecipients.push(recip);
      }
    }
    if (args.bcc) {
      for (const addr of args.bcc) {
        const recip = Mail.BccRecipient({ address: addr });
        msg.bccRecipients.push(recip);
      }
    }

    // Set sending account if specified
    if (args.fromAccount) {
      const accts = Mail.accounts.whose({ name: args.fromAccount })();
      if (accts.length > 0) {
        msg.sender = accts[0].emailAddresses()[0];
      }
    }

    JSON.stringify({ success: true, message: 'Draft created — review and send in Mail.app' });
  `;
  return executeJXA(script, params);
}

/**
 * Reply to an existing message.
 */
export async function replyToMessage(params: {
  messageId: string;
  body: string;
  replyAll?: boolean;
  isHtml?: boolean;
}): Promise<JXAResult<{ success: boolean }>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');

    ${FIND_MESSAGE_BY_ID}

    const replyMsg = Mail.reply(found, {
      openingWindow: false,
      replyToAll: args.replyAll || false
    });

    // Set reply body — prepend our text to the quoted content
    replyMsg.content = args.body + '\\n\\n' + replyMsg.content();

    JSON.stringify({ success: true, message: 'Reply draft created — review and send in Mail.app' });
  `;
  return executeJXA(script, params);
}

/**
 * Forward an existing message.
 */
export async function forwardMessage(params: {
  messageId: string;
  to: string[];
  body?: string;
  isHtml?: boolean;
}): Promise<JXAResult<{ success: boolean }>> {
  const script = `
    const args = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('__args').js || '{}');
    const Mail = Application('Mail');

    ${FIND_MESSAGE_BY_ID}

    const fwdMsg = Mail.forward(found, { openingWindow: false });

    // Add recipients
    for (const addr of args.to) {
      const recip = Mail.ToRecipient({ address: addr });
      fwdMsg.toRecipients.push(recip);
    }

    // Prepend body if provided
    if (args.body) {
      fwdMsg.content = args.body + '\\n\\n' + fwdMsg.content();
    }

    JSON.stringify({ success: true, message: 'Forward draft created — review and send in Mail.app' });
  `;
  return executeJXA(script, params);
}
