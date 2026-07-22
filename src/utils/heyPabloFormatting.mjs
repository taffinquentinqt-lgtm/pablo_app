function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatHeyPabloMessage(text) {
    const cleaned = normalizeHeyPabloText(text);

    return escapeHtml(cleaned)
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
}

export function normalizeHeyPabloText(text) {
    return String(text ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*\n]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/#{1,6}\s*/g, '')
        .replace(/^\s*[-*•]\s+/gm, '')
        .replace(/\s+([?!])/g, '$1')
        .replace(/([.:!?])\s+(\d+\.\s)/g, '$1\n\n$2')
        .replace(/(\d+\.\s[^:\n]{3,80}:)\s+/g, '$1\n')
        .trim();
}
