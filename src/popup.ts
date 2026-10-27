import { DEFAULT_SETTINGS, loadSettings, parseSettings, SETTINGS_KEY, type Settings, saveSettings } from './settings';
import { type Counts, daily, loadStats, parseStats, STATS_KEY, type Stats, summarize } from './stats';

const enabled = document.querySelector<HTMLInputElement>('#enabled');
const autoViewed = document.querySelector<HTMLInputElement>('#auto-viewed');
const positions = document.querySelectorAll<HTMLInputElement>('input[name="position"]');
let settings: Settings = DEFAULT_SETTINGS;

function renderSettings(): void {
  if (enabled) enabled.checked = settings.enabled;
  if (autoViewed) autoViewed.checked = settings.autoViewed;
  for (const radio of positions) radio.checked = radio.value === settings.position;
  document.body.toggleAttribute('data-disabled', !settings.enabled);
}

const SVG = 'http://www.w3.org/2000/svg';
const WIDTH = 268;
const HEIGHT = 72;
const GAP = 2;
let metric: keyof Counts = 'hunks';
let lastStats: Stats | null = null;

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
};

const shortDate = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Bars anchored to the baseline with rounded top corners.
function barPath(x: number, top: number, width: number, base: number): string {
  const r = Math.min(3, width / 2, base - top);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${base}Z`;
}

function renderChart(stats: Stats): void {
  const chart = document.querySelector<SVGSVGElement>('#chart');
  const readout = document.querySelector<HTMLElement>('#readout');
  if (!chart || !readout) return;
  const days = daily(stats, new Date());
  const values = days.map(({ counts }) => counts[metric]);
  const max = Math.max(...values);
  const base = HEIGHT - 1;
  const width = (WIDTH - GAP * (days.length - 1)) / days.length;
  const unit = metric.slice(0, -1);
  const total = values.reduce((a, b) => a + b, 0);
  // The line under the chart shows the 30-day total, or the hovered day.
  const idle = () => {
    readout.textContent = `${plural(total, unit)} in total`;
    readout.classList.remove('active');
  };
  idle();

  chart.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  chart.setAttribute(
    'aria-label',
    `Reviewed ${metric} per day over the last 30 days, ${values.reduce((a, b) => a + b, 0)} in total`,
  );
  chart.replaceChildren(svg('line', { class: 'baseline', x1: 0, x2: WIDTH, y1: base + 0.5, y2: base + 0.5 }));
  if (!max) {
    const empty = svg('text', { class: 'empty', x: WIDTH / 2, y: HEIGHT / 2, 'text-anchor': 'middle' });
    empty.textContent = 'Nothing reviewed yet';
    chart.append(empty);
  }
  days.forEach(({ day }, i) => {
    const x = i * (width + GAP);
    const value = values[i];
    // The hover target covers the whole column, not just the bar.
    const hit = svg('rect', { class: 'hit', x: x - GAP / 2, y: 0, width: width + GAP, height: HEIGHT });
    hit.addEventListener('mouseenter', () => {
      readout.textContent = `${shortDate(day)} · ${plural(value, unit)}`;
      readout.classList.add('active');
    });
    hit.addEventListener('mouseleave', idle);
    chart.append(hit);
    const top = max ? base - Math.max(2, (value / max) * (HEIGHT - 8)) : base;
    if (value) chart.append(svg('path', { class: 'bar', d: barPath(x, top, width, base) }));
  });
  const start = document.querySelector('#axis-start');
  if (start) start.textContent = shortDate(days[0].day);
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="metric"]')) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    metric = radio.value === 'lines' ? 'lines' : radio.value === 'files' ? 'files' : 'hunks';
    if (lastStats) renderChart(lastStats);
  });
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${n === 1 ? word : `${word}s`}`;

function renderStats(stats: Stats): void {
  lastStats = stats;
  renderChart(stats);
  const summary = summarize(stats, new Date());
  for (const [period, counts] of Object.entries(summary)) {
    const hunks = document.querySelector(`[data-stat="${period}"]`);
    const lines = document.querySelector(`[data-lines="${period}"]`);
    if (hunks) hunks.textContent = counts.hunks.toLocaleString();
    hunks?.nextElementSibling?.replaceChildren(counts.hunks === 1 ? 'hunk' : 'hunks');
    if (lines) lines.textContent = `${plural(counts.lines, 'line')} · ${plural(counts.files, 'file')}`;
  }
}

function update(next: Partial<Settings>): void {
  settings = { ...settings, ...next };
  renderSettings();
  saveSettings(settings).catch((error: unknown) => console.error('[diff-hunk-review] failed to save settings', error));
}

enabled?.addEventListener('change', () => update({ enabled: enabled.checked }));
autoViewed?.addEventListener('change', () => update({ autoViewed: autoViewed.checked }));
for (const radio of positions) {
  radio.addEventListener('change', () => {
    if (radio.checked) update({ position: radio.value === 'right' ? 'right' : 'left' });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && SETTINGS_KEY in changes) {
    settings = parseSettings(changes[SETTINGS_KEY].newValue);
    renderSettings();
  }
  if (area === 'local' && STATS_KEY in changes) renderStats(parseStats(changes[STATS_KEY].newValue));
});

Promise.all([loadSettings(), loadStats()])
  .then(([loadedSettings, stats]) => {
    settings = loadedSettings;
    renderSettings();
    renderStats(stats);
  })
  .catch((error: unknown) => console.error('[diff-hunk-review] failed to load popup data', error));
