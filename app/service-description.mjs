// Preserve both parts of descriptions saved before the fields were combined.
export const serviceBackground = ({background, purpose} = {}) => [...new Set([background, purpose].map(value => String(value || '').trim()).filter(Boolean))].join('\n\n');
