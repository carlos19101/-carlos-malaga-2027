// Input order is newest first. Never choose one of multiple identical IDs.
export function feedbackCandidates(records = []) {
  const counts = new Map();
  for (const { id } of records) if (id) counts.set(id, (counts.get(id) || 0) + 1);
  return records.filter(row => row.running && /^[a-z0-9][a-z0-9._:-]{5,119}$/i.test(row.id || '') && counts.get(row.id) === 1);
}

export function selectFeedbackCandidate(candidates, selectedId) {
  return candidates.find(row => row.id === selectedId) || candidates[0] || null;
}
