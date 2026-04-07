// ─── ICS Calendar Parser ─────────────────────────────────────────────────────
import ICAL from 'ical.js';

async function fetchWithProxy(url) {
  const proxies = [
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  for (const proxyUrl of proxies) {
    try {
      const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const text = await resp.text();
      if (text.includes('BEGIN:VCALENDAR')) return text;
    } catch (e) { continue; }
  }
  throw new Error('All proxies failed');
}

export async function fetchAndParseICS(url) {
  const text = await fetchWithProxy(url);
  return parseICS(text);
}

export function parseICS(text) {
  const jcal = ICAL.parse(text);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents('vevent');

  return vevents.map(vevent => {
    const event = new ICAL.Event(vevent);
    const summary = event.summary || '';
    const description = event.description || '';
    const startDate = event.startDate?.toJSDate();

    let distanceKm = null;
    let type = 'Other';
    const combined = (summary + ' ' + description).toLowerCase();

    if (combined.includes('half marathon') || (combined.includes('half') && combined.includes('marathon'))) {
      distanceKm = 21.0975; type = 'Half';
    } else if (combined.includes('marathon') && !combined.includes('half')) {
      distanceKm = 42.195; type = 'Full';
    } else if (combined.includes('10k') || combined.includes('10 k')) {
      distanceKm = 10; type = '10K';
    } else if (combined.includes('5k') || combined.includes('5 k')) {
      distanceKm = 5; type = '5K';
    } else if (combined.includes('ultra')) {
      type = 'Ultra';
    }

    const miMatch = (summary + description).match(/(\d+\.?\d*)\s*mi/i);
    const kmMatch = (summary + description).match(/(\d+\.?\d*)\s*km/i);
    if (miMatch && !distanceKm) distanceKm = parseFloat(miMatch[1]) * 1.60934;
    if (kmMatch && !distanceKm) distanceKm = parseFloat(kmMatch[1]);

    const goalMatch = description.match(/goal[:\s]+(\d+:\d{2}:\d{2}|\d+:\d{2})/i);
    const goalTime = goalMatch ? goalMatch[1] : null;

    const location = vevent.getFirstPropertyValue('location') || null;

    return {
      id: event.uid || `ics-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: summary,
      date: startDate ? startDate.toISOString().split('T')[0] : null,
      distanceKm: distanceKm ? parseFloat(distanceKm.toFixed(2)) : null,
      distance_km: distanceKm ? parseFloat(distanceKm.toFixed(2)) : null,
      type,
      goalTime,
      goal_time: goalTime,
      location,
      description,
      source: 'garmin-ics',
    };
  }).filter(e => e.date);
}
