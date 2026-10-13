/**
 * Lightweight HTML → Markdown converter for exporting editor content. Handles
 * the common formatting the rich editor produces (headings, bold/italic, lists,
 * links, blockquotes, code, paragraphs). Not a full HTML parser — intentionally
 * small and dependency-free.
 */
export function htmlToMarkdown(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  return normalize(walk(container).trim());
}

function walk(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    out += render(child);
  });
  return out;
}

function render(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const inner = walk(el);
  switch (el.tagName.toLowerCase()) {
    case 'h1': return `\n# ${inner}\n\n`;
    case 'h2': return `\n## ${inner}\n\n`;
    case 'h3': return `\n### ${inner}\n\n`;
    case 'h4': return `\n#### ${inner}\n\n`;
    case 'strong':
    case 'b': return `**${inner}**`;
    case 'em':
    case 'i': return `*${inner}*`;
    case 'u': return `_${inner}_`;
    case 's':
    case 'strike':
    case 'del': return `~~${inner}~~`;
    case 'code': return `\`${inner}\``;
    case 'pre': return `\n\`\`\`\n${el.textContent ?? ''}\n\`\`\`\n\n`;
    case 'a': return `[${inner}](${el.getAttribute('href') ?? ''})`;
    case 'blockquote': return `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n\n`;
    case 'br': return '  \n';
    case 'p':
    case 'div': return `${inner}\n\n`;
    case 'ul': return `\n${renderList(el, false)}\n`;
    case 'ol': return `\n${renderList(el, true)}\n`;
    case 'li': return inner;
    case 'hr': return `\n---\n\n`;
    default: return inner;
  }
}

function renderList(el: HTMLElement, ordered: boolean): string {
  let i = 1;
  let out = '';
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName.toLowerCase() === 'li') {
      const marker = ordered ? `${i++}. ` : '- ';
      out += `${marker}${walk(child as HTMLElement).trim()}\n`;
    }
  });
  return out;
}

function normalize(md: string): string {
  return md.replace(/\n{3,}/g, '\n\n');
}
