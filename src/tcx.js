const DEFAULT_MAX_GAP_SECONDS = 5;
const XML_PREFIX = String.raw`(?:[A-Za-z_][\w.-]*:)?`;

function blocks(xml, tagName) {
  const pattern = new RegExp(
    `<${XML_PREFIX}${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${XML_PREFIX}${tagName}\\s*>`,
    'gi',
  );
  return [...String(xml ?? '').matchAll(pattern)].map((match) => match[1]);
}

function textValue(xml, tagName) {
  return blocks(xml, tagName)[0]?.trim() ?? '';
}

function parseTrackpoint(xml) {
  const timeText = textValue(xml, 'Time');
  const heartRateBlock = blocks(xml, 'HeartRateBpm')[0];
  const heartRateText = heartRateBlock ? textValue(heartRateBlock, 'Value') : '';
  const timeMs = Date.parse(timeText);
  const heartRate = Number(heartRateText);

  if (!Number.isFinite(timeMs) || !heartRateText || !Number.isFinite(heartRate)) return null;
  return { timeMs, heartRate };
}

export function parseTcxLaps(tcxText) {
  const lapBlocks = blocks(tcxText, 'Lap');
  const sources = lapBlocks.length ? lapBlocks : [tcxText];
  return sources.map((lap) => blocks(lap, 'Trackpoint')
    .map(parseTrackpoint)
    .filter(Boolean));
}

function requireFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} musi być liczbą.`);
  return number;
}

export function analyzeTcx(tcxText, options = {}) {
  const targetMin = requireFiniteNumber(options.targetMin, 'targetMin');
  const targetMax = requireFiniteNumber(options.targetMax, 'targetMax');
  const maxGapSeconds = options.maxGapSeconds === undefined
    ? DEFAULT_MAX_GAP_SECONDS
    : requireFiniteNumber(options.maxGapSeconds, 'maxGapSeconds');

  if (targetMin >= targetMax) throw new RangeError('targetMin musi być mniejsze od targetMax.');
  if (maxGapSeconds <= 0) throw new RangeError('maxGapSeconds musi być większe od zera.');

  const laps = parseTcxLaps(tcxText);
  const points = laps.flat();
  if (points.length < 2) throw new Error('TCX musi zawierać co najmniej dwa prawidłowe trackpointy z Time i HR.');

  let timeInTarget = 0;
  let timeAboveTarget = 0;
  let timeBelowTarget = 0;
  let excludedDuration = 0;
  let analyzedIntervals = 0;
  let excludedGaps = 0;
  let nonPositiveIntervals = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const seconds = (next.timeMs - current.timeMs) / 1000;

    if (seconds <= 0) {
      nonPositiveIntervals += 1;
      continue;
    }
    if (seconds > maxGapSeconds) {
      excludedDuration += seconds;
      excludedGaps += 1;
      continue;
    }

    analyzedIntervals += 1;
    if (current.heartRate < targetMin) timeBelowTarget += seconds;
    else if (current.heartRate > targetMax) timeAboveTarget += seconds;
    else timeInTarget += seconds;
  }

  return {
    targetMin,
    targetMax,
    maxGapSeconds,
    timeInTarget,
    timeAboveTarget,
    timeBelowTarget,
    analyzedDuration: timeInTarget + timeAboveTarget + timeBelowTarget,
    excludedDuration,
    lapCount: laps.length,
    trackpointCount: points.length,
    analyzedIntervals,
    excludedGaps,
    nonPositiveIntervals,
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function sanitizeTcx(tcxText, options = {}) {
  const laps = parseTcxLaps(tcxText);
  const points = laps.flat();
  if (!points.length) throw new Error('TCX nie zawiera prawidłowych trackpointów z Time i HR.');

  const baseTimeMs = Date.parse(options.baseTime ?? '2000-01-01T00:00:00.000Z');
  if (!Number.isFinite(baseTimeMs)) throw new TypeError('baseTime musi być prawidłową datą ISO.');
  const sourceStartMs = points[0].timeMs;
  const shiftedTime = (timeMs) => new Date(baseTimeMs + timeMs - sourceStartMs).toISOString();

  const lapXml = laps.filter((lap) => lap.length).map((lap) => {
    const trackpoints = lap.map(({ timeMs, heartRate }) => [
      '          <Trackpoint>',
      `            <Time>${escapeXml(shiftedTime(timeMs))}</Time>`,
      `            <HeartRateBpm><Value>${escapeXml(heartRate)}</Value></HeartRateBpm>`,
      '          </Trackpoint>',
    ].join('\n')).join('\n');
    return [
      `      <Lap StartTime="${escapeXml(shiftedTime(lap[0].timeMs))}">`,
      '        <Track>',
      trackpoints,
      '        </Track>',
      '      </Lap>',
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">',
    '  <Activities>',
    '    <Activity Sport="Running">',
    `      <Id>${escapeXml(new Date(baseTimeMs).toISOString())}</Id>`,
    lapXml,
    '    </Activity>',
    '  </Activities>',
    '</TrainingCenterDatabase>',
    '',
  ].join('\n');
}

export { DEFAULT_MAX_GAP_SECONDS };
