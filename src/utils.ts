/**
 * Build a message:// deep link from an RFC 822 Message-ID.
 */
export function buildMailDeepLink(messageId: string): string {
  const id = messageId.startsWith("<") ? messageId : `<${messageId}>`;
  return `message://${encodeURIComponent(id)}`;
}

/**
 * Truncate text to a maximum length, appending "..." if truncated.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

/**
 * Strip HTML tags and collapse whitespace for plain-text preview.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
