/**
 * Parse Gemini response text to extract code blocks.
 *
 * Handles:
 *   - Fenced code blocks: ```html ... ``` and ```css ... ```
 *   - Unfenced HTML: lines starting with < that look like HTML elements
 *
 * Returns: { raw_text, code_blocks: [{ language, content }], has_html }
 */

/**
 * Extract fenced code blocks from markdown-formatted response text.
 * Matches ```language\n...\n``` patterns.
 */
function extractFencedBlocks(text) {
  const blocks = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const language = match[1].toLowerCase() || 'unknown';
    const content = match[2].trim();
    if (content.length > 0) {
      blocks.push({ language, content });
    }
  }

  return blocks;
}

/**
 * Detect unfenced HTML in the response — lines that look like HTML elements
 * but weren't wrapped in code fences.
 */
function extractUnfencedHTML(text) {
  // Remove any fenced blocks first so we don't double-count
  const withoutFences = text.replace(/```\w*\n[\s\S]*?```/g, '');

  // Look for a contiguous block of HTML (starts with < and has closing tags)
  const htmlPattern = /(<(?:!DOCTYPE|[a-z][\w-]*)[^>]*>[\s\S]*<\/[a-z][\w-]*>)/i;
  const match = withoutFences.match(htmlPattern);

  if (match && match[1].trim().length > 20) {
    return [{ language: 'html', content: match[1].trim() }];
  }

  return [];
}

/**
 * Parse a Gemini response and extract code blocks.
 *
 * @param {string} text - Raw response text from Gemini
 * @returns {{ raw_text: string, code_blocks: Array<{language: string, content: string}>, has_html: boolean }}
 */
function parseResponse(text) {
  if (!text || typeof text !== 'string') {
    return { raw_text: '', code_blocks: [], has_html: false };
  }

  const fenced = extractFencedBlocks(text);
  let blocks = fenced;

  // If no fenced blocks found, try unfenced HTML detection
  if (blocks.length === 0) {
    blocks = extractUnfencedHTML(text);
  }

  const has_html = blocks.some(b =>
    b.language === 'html' ||
    b.content.includes('</') ||
    b.content.includes('style=')
  );

  return {
    raw_text: text,
    code_blocks: blocks,
    has_html
  };
}

module.exports = { parseResponse, extractFencedBlocks, extractUnfencedHTML };
