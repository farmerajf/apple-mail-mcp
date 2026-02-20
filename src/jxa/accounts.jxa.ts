import { executeJXA } from "./executor.js";
import type { JXAResult, MailAccount } from "../types.js";

/**
 * List all configured mail accounts.
 */
export async function listAccounts(): Promise<JXAResult<MailAccount[]>> {
  const script = `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    const result = accounts.map(a => ({
      name: a.name(),
      email: a.emailAddresses()[0] || '',
      enabled: a.enabled(),
      accountType: a.accountType()
    }));
    JSON.stringify(result);
  `;
  return executeJXA<MailAccount[]>(script);
}
