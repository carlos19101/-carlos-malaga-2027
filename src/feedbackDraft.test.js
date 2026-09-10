import { expect, it } from 'vitest';
import { readFeedbackDraft, saveFeedbackDraft, clearFeedbackDraft } from './feedbackDraft.js';

function storage() {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) };
}
it('przechowuje szkice osobno dla sesji i zachowuje zero', () => {
  const store = storage();
  saveFeedbackDraft('one', { rpe: 1, pain: 0, legFatigue: 2, notes: 'łatwo' }, store);
  saveFeedbackDraft('two', { rpe: 3, pain: 1, legFatigue: '', notes: '' }, store);
  expect(readFeedbackDraft('one', store)).toEqual({ rpe: '1', pain: '0', legFatigue: '2', notes: 'łatwo' });
  clearFeedbackDraft('one', store);
  expect(readFeedbackDraft('one', store)).toBeNull();
  expect(readFeedbackDraft('two', store).rpe).toBe('3');
});
it('odrzuca uszkodzony szkic i nie zapisuje bez identyfikatora', () => {
  const store = storage();
  store.setItem('carlos:feedback-draft:v1:one', '{');
  expect(readFeedbackDraft('one', store)).toBeNull();
  expect(saveFeedbackDraft('', {}, store)).toBe(false);
});
it('obsługuje niedostępny magazyn bez utraty działania formularza', () => {
  const store = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  expect(readFeedbackDraft('one', store)).toBeNull();
  expect(saveFeedbackDraft('one', {}, store)).toBe(false);
  expect(() => clearFeedbackDraft('one', store)).not.toThrow();
});
