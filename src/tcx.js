import { parseHrTargetStages } from './hrTargetStages.js';

const DEFAULT_MAX_GAP_SECONDS = 5;
export const DEFAULT_TCX_TIME_ZONE = 'Europe/Warsaw';
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
  const distanceText = textValue(xml, 'DistanceMeters');
  const timeMs = Date.parse(timeText);
  const heartRate = Number(heartRateText);
  const distance = Number(distanceText);

  if (!Number.isFinite(timeMs) || !heartRateText || !Number.isFinite(heartRate)) return null;
  return { timeMs, heartRate, distanceMeters: distanceText && Number.isFinite(distance) && distance >= 0 ? distance : null };
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

export function formatTcxActivityTiming(value, timeZone = DEFAULT_TCX_TIME_ZONE) {
  const timeMs = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  if (!Number.isFinite(timeMs)) throw new TypeError('Czas rozpoczęcia TCX musi być prawidłową datą ISO.');
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(timeMs));
  } catch {
    throw new TypeError(`Nieprawidłowa strefa czasowa TCX: ${timeZone}.`);
  }
  const valueFor = (type) => parts.find((part) => part.type === type)?.value || '';
  const localDate = `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
  const localTime = `${valueFor('hour')}:${valueFor('minute')}:${valueFor('second')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(localTime)) {
    throw new TypeError('Nie udało się sformatować czasu rozpoczęcia TCX.');
  }
  return { startedAt: new Date(timeMs).toISOString(), timeZone, localDate, localTime };
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
    startedAt: new Date(points[0].timeMs).toISOString(),
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

function classifyHeartRate(heartRate, stage) {
  if (stage.min !== null && heartRate < stage.min) return 'below';
  if (stage.max !== null && heartRate > stage.max) return 'above';
  return 'in';
}

export function analyzeTcxStages(tcxText, stageInput, options = {}) {
  const { stages, basis } = parseHrTargetStages(stageInput);
  const maxGapSeconds = options.maxGapSeconds === undefined
    ? DEFAULT_MAX_GAP_SECONDS
    : requireFiniteNumber(options.maxGapSeconds, 'maxGapSeconds');
  if (maxGapSeconds <= 0) throw new RangeError('maxGapSeconds musi być większe od zera.');

  const laps = parseTcxLaps(tcxText);
  const points = laps.flat();
  if (points.length < 2) throw new Error('TCX musi zawierać co najmniej dwa prawidłowe trackpointy z Time i HR.');

  const boundaries = stages.reduce((all, stage) => {
    const start = all.length ? all.at(-1).end : 0;
    const span = basis === 'time' ? stage.durationSeconds : stage.distanceMeters;
    return [...all, { ...stage, start, end: start + span }];
  }, []);
  const plannedSpan = boundaries.at(-1).end;
  const results = boundaries.map((stage) => ({
    name: stage.name,
    ...(basis === 'time' ? { durationSeconds: stage.durationSeconds } : { distanceMeters: stage.distanceMeters }),
    min: stage.min, max: stage.max,
    timeInTarget: 0, timeAboveTarget: 0, timeBelowTarget: 0, analyzedDuration: 0,
  }));
  let excludedDuration = 0;
  let unmappedDuration = 0;
  let analyzedIntervals = 0;
  let excludedGaps = 0;
  let nonPositiveIntervals = 0;
  let missingDistanceIntervals = 0;
  let nonMonotonicDistanceIntervals = 0;
  const firstDistance = basis === 'distance' ? points.find(({ distanceMeters }) => distanceMeters !== null)?.distanceMeters : null;
  if (basis === 'distance' && firstDistance === undefined) {
    throw new Error('TCX z celem dystansowym musi zawierać DistanceMeters.');
  }

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

    let cursor;
    let end;
    if (basis === 'time') {
      cursor = Math.max(0, (current.timeMs - points[0].timeMs) / 1000);
      end = cursor + seconds;
    } else {
      if (current.distanceMeters === null || next.distanceMeters === null) {
        missingDistanceIntervals += 1;
        excludedDuration += seconds;
        continue;
      }
      cursor = Math.max(0, current.distanceMeters - firstDistance);
      end = Math.max(0, next.distanceMeters - firstDistance);
      if (end < cursor) {
        nonMonotonicDistanceIntervals += 1;
        excludedDuration += seconds;
        continue;
      }
    }
    analyzedIntervals += 1;
    const fullSpan = end - cursor;
    if (basis === 'distance' && fullSpan === 0) {
      const stageIndex = boundaries.findIndex((stage) => cursor >= stage.start && cursor < stage.end);
      if (stageIndex === -1) {
        unmappedDuration += seconds;
        continue;
      }
      const result = results[stageIndex];
      result.analyzedDuration += seconds;
      const bucket = classifyHeartRate(current.heartRate, boundaries[stageIndex]);
      if (bucket === 'below') result.timeBelowTarget += seconds;
      else if (bucket === 'above') result.timeAboveTarget += seconds;
      else result.timeInTarget += seconds;
      continue;
    }
    while (cursor < end) {
      const stageIndex = boundaries.findIndex((stage) => cursor >= stage.start && cursor < stage.end);
      if (stageIndex === -1) {
        const nextBoundary = boundaries.find((stage) => stage.start > cursor)?.start ?? end;
        const span = Math.min(end, nextBoundary) - cursor;
        const duration = basis === 'time' ? span : fullSpan === 0 ? seconds : seconds * (span / fullSpan);
        unmappedDuration += duration;
        cursor += span;
        continue;
      }
      const stage = boundaries[stageIndex];
      const span = Math.min(end, stage.end) - cursor;
      const duration = basis === 'time' ? span : fullSpan === 0 ? seconds : seconds * (span / fullSpan);
      const result = results[stageIndex];
      result.analyzedDuration += duration;
      const bucket = classifyHeartRate(current.heartRate, stage);
      if (bucket === 'below') result.timeBelowTarget += duration;
      else if (bucket === 'above') result.timeAboveTarget += duration;
      else result.timeInTarget += duration;
      cursor += span;
    }
  }

  const timeInTarget = results.reduce((total, stage) => total + stage.timeInTarget, 0);
  const timeAboveTarget = results.reduce((total, stage) => total + stage.timeAboveTarget, 0);
  const timeBelowTarget = results.reduce((total, stage) => total + stage.timeBelowTarget, 0);
  return {
    startedAt: new Date(points[0].timeMs).toISOString(),
    targetMode: 'staged',
    stageBasis: basis,
    targetStages: stages,
    ...(basis === 'time' ? { plannedDuration: plannedSpan } : { plannedDistanceMeters: plannedSpan }),
    maxGapSeconds,
    timeInTarget,
    timeAboveTarget,
    timeBelowTarget,
    analyzedDuration: timeInTarget + timeAboveTarget + timeBelowTarget,
    unmappedDuration,
    excludedDuration,
    lapCount: laps.length,
    trackpointCount: points.length,
    analyzedIntervals,
    excludedGaps,
    nonPositiveIntervals,
    ...(basis === 'distance' ? { missingDistanceIntervals, nonMonotonicDistanceIntervals } : {}),
    stageResults: results,
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
    const trackpoints = lap.map(({ timeMs, heartRate, distanceMeters }) => [
      '          <Trackpoint>',
      `            <Time>${escapeXml(shiftedTime(timeMs))}</Time>`,
      `            <HeartRateBpm><Value>${escapeXml(heartRate)}</Value></HeartRateBpm>`,
      ...(options.preserveDistance && distanceMeters !== null ? [`            <DistanceMeters>${escapeXml(distanceMeters)}</DistanceMeters>`] : []),
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
