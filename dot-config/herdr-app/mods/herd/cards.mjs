// Defensive receipts from the kit, not a second catalog validator.
import { scriptPath } from './asks.mjs';
export const cardSignature = ask => JSON.stringify([ask.card, ask.options || [], ask.recommendation || null]);
export function acceptCardImage(value) {
  const match = /^herd-cache\/cards\/([0-9a-f]{64})\.(png|jpg)$/.exec(value?.image || '');
  return value?.status === 'ready' && match && value.sha256 === match[1] && scriptPath(value.path) &&
    Number.isInteger(value.width) && Number.isInteger(value.height) && value.width > 0 && value.height > 0 &&
    value.width <= 8192 && value.height <= 8192 && value.width * value.height <= 16_000_000 && /^[0-9a-f]{40,64}$/.test(value.commit || '') ? value : null;
}
export function cardOptions(card) { return Object.values(card.elements).find(element => element.type === 'options')?.props || null; }
export function acceptCardReceipt(value) {
  const card = value?.card, elements = card?.elements;
  if (card?.schema !== 'ark-card/1' || !elements || typeof elements !== 'object' || Array.isArray(elements) ||
      Object.keys(elements).length > 64 || !Array.isArray(value.images) || value.images.length > 64 || value.images.some(image => !acceptCardImage(image))) throw new Error('Invalid card receipt.');
  const seen = new Set();
  const visit = (id, depth) => {
    const element = elements[id];
    if (depth > 8 || seen.has(id) || !element || !['text','image','options','table','progress','stack'].includes(element.type) || !element.props) throw new Error('Invalid card tree.');
    seen.add(id);
    if (element.type === 'stack') {
      if (!Array.isArray(element.children)) throw new Error('Invalid card children.');
      element.children.forEach(child => visit(child, depth + 1));
    }
  };
  visit(card.root, 1);
  if (seen.size !== Object.keys(elements).length) throw new Error('Invalid card tree.');
  return value;
}
