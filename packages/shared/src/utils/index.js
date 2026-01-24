export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function randomDelay(minMs, maxMs) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return sleep(delay);
}
export function formatPhone(phone) {
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    // Ensure starts with +
    return digits.startsWith('+') ? digits : `+${digits}`;
}
export function parseTemplateVariables(content) {
    const matches = content.match(/\{\{(\w+)\}\}/g) || [];
    return [...new Set(matches.map((m) => m.replace(/[{}]/g, '')))];
}
export function applyTemplate(template, variables) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return variables[key] ?? match;
    });
}
export function generateId() {
    return crypto.randomUUID();
}
export function chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
export function pick(obj, keys) {
    const result = {};
    for (const key of keys) {
        if (key in obj) {
            result[key] = obj[key];
        }
    }
    return result;
}
export function omit(obj, keys) {
    const result = { ...obj };
    for (const key of keys) {
        delete result[key];
    }
    return result;
}
//# sourceMappingURL=index.js.map