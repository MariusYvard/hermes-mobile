// Transport-neutral SSE reader. No Node imports, storage or credential handling.
// An interrupted EOF drops the unfinished frame, never advances its cursor.
export async function* readSSE(chunks, { maxFrameChars = 262144 } = {}) {
  if (!Number.isSafeInteger(maxFrameChars) || maxFrameChars < 1 || maxFrameChars > 1048576) {
    throw Object.assign(new Error('Invalid stream limit'), { code: 'invalid_options' });
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '', cr = false, data = [], event = '', id = '', size = 0;
  function processLine(text) {
    if (text === '') {
      const frame = data.length ? { event: event || 'message', id, data: data.join('\n') } : null;
      data = []; event = ''; size = 0;
      return frame;
    }
    if (text.startsWith(':')) return null;
    const separator = text.indexOf(':');
    const field = separator < 0 ? text : text.slice(0, separator);
    let value = separator < 0 ? '' : text.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    if (field === 'event') event = value;
    if (field === 'id' && !value.includes('\0')) id = value;
    return null;
  }
  for await (const chunk of chunks) {
    const text = decoder.decode(chunk, { stream: true });
    for (const character of text) {
      if (cr && character === '\n') { cr = false; continue; }
      size += character.length;
      if (size > maxFrameChars) throw Object.assign(new Error('Stream frame exceeds limit'), { code: 'frame_too_large' });
      cr = character === '\r';
      if (character === '\r' || character === '\n') {
        const frame = processLine(line); line = '';
        if (frame) yield frame;
      } else line += character;
    }
  }
  decoder.decode();
}
