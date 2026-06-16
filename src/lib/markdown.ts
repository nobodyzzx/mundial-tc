/**
 * Markdown ligero y controlado para los mensajes del réferi (tablón y WhatsApp).
 * No usamos una librería completa: solo soportamos un subconjunto seguro y
 * escapamos el HTML, porque el autor (la Réferi) es de confianza pero igual
 * queremos evitar inyección.
 *
 * Sintaxis soportada:
 *   **negrita**            _cursiva_  *cursiva*   ~~tachado~~   `código`
 *   # Título / ## Subtítulo (se renderizan como línea en negrita)
 *   - lista  /  * lista
 *   [texto](https://url)
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Formato en línea (sobre texto YA escapado) → HTML
function inlineToHtml(text: string): string {
  let t = text;

  // Enlaces [texto](url) — solo http(s) o rutas internas
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-gold underline underline-offset-2">$1</a>');

  // Código `x`
  t = t.replace(/`([^`\n]+)`/g, '<code class="bg-brand-800 rounded px-1 py-0.5 text-[0.85em]">$1</code>');

  // Negrita **x** o __x__  (antes que cursiva)
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

  // Tachado ~~x~~
  t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // Cursiva *x* o _x_
  t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>');

  return t;
}

/** Markdown → HTML seguro para mostrar en la app (tablón). */
export function mdToHtml(md: string): string {
  const lines = escapeHtml((md ?? '').replace(/\r\n/g, '\n')).split('\n');
  const out: string[] = [];
  let listOpen = false;

  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Lista (- o *)
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!listOpen) { out.push('<ul class="list-disc list-inside space-y-1 my-1">'); listOpen = true; }
      out.push(`<li>${inlineToHtml(li[1])}</li>`);
      continue;
    }
    closeList();

    // Títulos # / ## / ### → línea en negrita
    const h = line.match(/^\s*#{1,3}\s+(.*)$/);
    if (h) { out.push(`<p class="font-bold text-white">${inlineToHtml(h[1])}</p>`); continue; }

    // Línea en blanco → separación
    if (line.trim() === '') { out.push('<div class="h-2"></div>'); continue; }

    out.push(`<p>${inlineToHtml(line)}</p>`);
  }
  closeList();
  return out.join('');
}

/** Markdown estándar → formato de WhatsApp (*negrita*, _cursiva_, ~tachado~). */
export function mdToWhatsApp(md: string): string {
  let t = (md ?? '').replace(/\r\n/g, '\n');
  const B = String.fromCharCode(1); // marcador temporal para la negrita

  // Negrita estándar (**x** / __x__) → marcador (para no confundirla con cursiva)
  t = t.replace(/\*\*([^*\n]+)\*\*/g, B + '$1' + B);
  t = t.replace(/__([^_\n]+)__/g, B + '$1' + B);

  // Cursiva estándar (*x*) → _x_ de WhatsApp (los _x_ ya son válidos, se dejan)
  t = t.replace(/\*([^*\n]+)\*/g, '_$1_');

  // Restauramos la negrita como *x* de WhatsApp
  t = t.replace(new RegExp(B + '([^' + B + ']+)' + B, 'g'), '*$1*');

  // Tachado ~~x~~ → ~x~
  t = t.replace(/~~([^~\n]+)~~/g, '~$1~');

  // Títulos # → línea en negrita
  t = t.replace(/^\s*#{1,3}\s+(.*)$/gm, '*$1*');

  // Enlaces [texto](url) → texto: url
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '$1: $2');

  // Código `x` → x (WhatsApp no formatea inline)
  t = t.replace(/`([^`\n]+)`/g, '$1');

  return t;
}
