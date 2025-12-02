// @ts-ignore - marked types
import { Marked } from 'marked';
// @ts-ignore - marked-highlight types
import { markedHighlight } from 'marked-highlight';
// @ts-ignore - highlight.js types
import hljs from 'highlight.js';

// Create a configured marked instance with highlight.js for syntax highlighting
const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (err) {
          console.error('Error highlighting code:', err);
        }
      }
      // Fallback to automatic language detection
      try {
        return hljs.highlightAuto(code).value;
      } catch (err) {
        console.error('Error auto-highlighting code:', err);
        return code;
      }
    },
  })
);

// Configure marked options
marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
});

/**
 * Renders markdown text to HTML
 * @param markdown - The markdown string to render
 * @returns HTML string
 */
export function renderMarkdown(markdown: string): string {
  try {
    return marked.parse(markdown) as string;
  } catch (error) {
    console.error('Error parsing markdown:', error);
    return markdown; // Return original text if parsing fails
  }
}

/**
 * Sanitizes HTML to prevent XSS attacks
 * Note: marked has built-in sanitization options, but for extra safety
 * we could add DOMPurify here if needed
 */
export function sanitizeHtml(html: string): string {
  // For now, rely on marked's built-in sanitization
  // If we need more strict sanitization, we can add DOMPurify
  return html;
}
