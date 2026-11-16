const $ = id => document.getElementById(id);
const currency = new Intl.NumberFormat('en-CA', { style:'currency', currency:'CAD', minimumFractionDigits:0, maximumFractionDigits:2 });
const integer = new Intl.NumberFormat('en-CA');
const statuses = { A:'Private foundation', B:'Public foundation', C:'Charitable organization' };
const geography = { AB:'Alberta', BC:'British Columbia', MB:'Manitoba', NB:'New Brunswick', NL:'Newfoundland and Labrador', NS:'Nova Scotia', NT:'Northwest Territories', NU:'Nunavut', ON:'Ontario', PE:'Prince Edward Island', QC:'Quebec', SK:'Saskatchewan', YT:'Yukon' };
const money = cents => cents == null ? 'Unavailable' : currency.format(cents / 100);
const memo = new Map();
const lookup = new Map();
let manifest, directory = [], sortedRevenue = [], charity, historyRows = [], grantTable = [], perPage = 15, request = 0, timer;

function element(tag, text, style) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (style) node.className = style;
  return node;
}
function option(label, value) {
  const node = element('option', label);
  node.value = value;
  return node;
}
function normalized(value) {
  return value.normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim();
}
async function response(url) {
  const data = await fetch(url);
  if (!data.ok) throw new Error('HTTP ' + data.status);
  return data;
}
async function charityIndex() {
  if (typeof DecompressionStream === 'function') {
    try {
      const data = await response('./index.json.gz');
      return await new Response(data.body.pipeThrough(new DecompressionStream('gzip'))).json();
    } catch { /* Fall back to the plain static index. */ }
  }
  return (await response('./index.json')).json();
}
function locationFor(row) {
  return [row[3], geography[row[2]] || row[2]].filter(Boolean).join(', ');
}
function save() {
  const url = new URL(location.href);
  const params = new URLSearchParams();
  if (charity) params.set('charity', charity[0]);
  for (const field of ['query','region','designation','sort','period']) if ($(field).value && $(field).value !== 'name') params.set(field, $(field).value);
  url.hash = params.toString();
  history.replaceState(null, '', url);
}

function drawList() {
  const text = normalized($('query').value);
  const tokens = text.split(' ').filter(Boolean);
  const region = $('region').value, type = $('designation').value;
  const sorted = $('sort').value === 'revenue' ? sortedRevenue : directory;
  let hits = sorted.filter(r => (!region || r[2] === region) && (!type || r[4] === type) && tokens.every(t => r[7].includes(t)));
  if (text) {
    const matches = hits.filter(r => r[0].toLowerCase() === text || r[8] === text);
    if (matches.length) {
      const ids = new Set(matches.map(r => r[0]));
      hits = matches.concat(hits.filter(r => !ids.has(r[0])));
    }
  }
  $('result-status').textContent = integer.format(hits.length) + ' charities';
  const list = hits.slice(0, perPage).map(r => {
    const b = element('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(charity?.[0] === r[0]));
    b.append(element('strong', r[1]), element('small', [locationFor(r), r[0]].filter(Boolean).join(' · ')));
    b.addEventListener('click', () => open(r));
    return b;
  });
  $('results').replaceChildren(...list);
  $('more').hidden = perPage >= hits.length;
  save();
}

function metric(label, value) {
  const m = element('div', undefined, 'metric');
  m.append(element('strong', money(value)), element('span', label));
  return m;
}
function drawBars() {
  const metric = Number($('measure').value);
  const maximum = Math.max(1, ...historyRows.map(r => Math.abs(r[metric] || 0)));
  $('trend').replaceChildren(...[...historyRows].reverse().map(r => {
    const item = element('div', undefined, 'bar-item');
    const bar = element('div', undefined, 'bar');
    const fill = element('i');
    fill.style.width = Math.abs(r[metric] || 0) / maximum * 100 + '%';
    bar.append(fill);
    bar.setAttribute('aria-hidden','true');
    item.append(element('span', r[0]), bar, element('span', money(r[metric])));
    return item;
  }));
}
function drawPeriod() {
  const row = historyRows[Number($('period').value)];
  if (!row) return;
  $('metrics').replaceChildren(...['Revenue','Expenditures','Assets','Liabilities'].map((label, i) => metric(label, row[2 + i])));
  $('report-source').href = manifest.sources[row[1]];
  $('grants-summary').textContent = row[6] ?
    `${integer.format(row[6])} recipient entries · ${money(row[7])} reported total · ${integer.format(row[8].length)} largest displayed` :
    'The selected filing has no matched positive qualified-donee gift entries in this source.';
  grantTable = row[8];
  $('grants').replaceChildren(...grantTable.map(([bn, name, total]) => {
    const tr = element('tr'), recipient = element('td');
    const charity = lookup.get(bn);
    if (charity) {
      const button = element('button', name || charity[1], 'jump-button');
      button.type = 'button';
      button.title = 'Open this recipient’s charity profile';
      button.addEventListener('click', () => open(charity));
      recipient.append(button);
    } else recipient.textContent = name || 'Unnamed recipient';
    tr.append(recipient, element('td', bn || '—'), element('td', money(total)));
    return tr;
  }));
  $('grant-export').disabled = !grantTable.length;
  drawBars();
  save();
}
async function open(row, savedPeriod, jump = true) {
  charity = row; historyRows = []; grantTable = [];
  const ticket = ++request;
  $('view').hidden = true;
  $('placeholder').hidden = false;
  $('placeholder').textContent = 'Opening filings for ' + row[1] + '…';
  drawList();
  try {
    const bucket = Number(row[0].slice(0, 9)) % manifest.buckets;
    if (!memo.has(bucket)) memo.set(bucket, await (await response('./data/' + bucket + '.json')).json());
    if (request !== ticket) return;
    historyRows = memo.get(bucket)[row[0]];
    if (!historyRows?.length) throw new Error('No filing rows');
  } catch {
    if (request === ticket) $('placeholder').textContent = 'These filings could not be opened. Select this charity again to retry.';
    return;
  }
  $('title').textContent = row[1];
  $('designation-label').textContent = [row[0], statuses[row[4]], locationFor(row)].filter(Boolean).join(' · ');
  $('period').replaceChildren(...historyRows.map((r, i) => option(r[0] + ' · dataset ' + r[1], i)));
  $('period').value = savedPeriod && +savedPeriod < historyRows.length ? savedPeriod : '0';
  $('action-status').textContent = '';
  $('placeholder').hidden = true;
  $('view').hidden = false;
  drawPeriod();
  if (jump) $('title').focus({ preventScroll: window.matchMedia('(min-width: 851px)').matches });
}
function escapeCSV(value) {
  const text = String(value ?? '');
  return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"','""') + '"';
}
function csv(file, rows) {
  const blob = new Blob([rows.map(row => row.map(escapeCSV).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = element('a'); a.href = url; a.download = file; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function dollars(cents) { return cents == null ? '' : (cents / 100).toFixed(2); }

async function init() {
  try {
    manifest = await (await response('./manifest.json')).json();
    $('data-status').textContent = `${integer.format(manifest.charities)} charities · CRA annual files ${manifest.covered.map(r => r[0]).join(', ')} · Index built ${manifest.built}`;
    for (const [year, url] of Object.entries(manifest.sources)) {
      const a = element('a', year + ' ↗');
      a.href = url;
      $('source-list').append(' ', a);
    }
    directory = await charityIndex();
    for (const r of directory) {
      r[7] = normalized([r[0], r[1], r[2], r[3], geography[r[2]]].join(' '));
      r[8] = normalized(r[1]);
      lookup.set(r[0], r);
    }
    sortedRevenue = [...directory].sort((a, b) => (b[5] ?? -Infinity) - (a[5] ?? -Infinity) || a[1].localeCompare(b[1]));
    const regions = [...new Set(directory.map(r => r[2]).filter(r => r))].sort();
    $('region').append(...regions.map(r => option(geography[r] || r, r)));
  } catch {
    $('result-status').textContent = 'The directory could not be opened. Follow the official charity-search link or reload this page.';
    return;
  }
  const hash = new URLSearchParams(location.hash.slice(1));
  for (const field of ['query','region','designation','sort']) if (hash.has(field)) $(field).value = hash.get(field).slice(0,130);
  $('query').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { perPage = 15; drawList(); }, 120); });
  for (const field of ['region','designation','sort']) $(field).addEventListener('change', () => { perPage = 15; drawList(); });
  $('more').addEventListener('click', () => { perPage += 15; drawList(); });
  for (const button of document.querySelectorAll('[data-query]')) button.addEventListener('click', () => { $('query').value = button.dataset.query; perPage = 15; drawList(); });
  $('period').addEventListener('change', drawPeriod);
  $('measure').addEventListener('change', drawBars);
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); $('action-status').textContent = 'Link copied.'; }
    catch { $('action-status').textContent = 'Copy the URL from your browser’s address bar.'; }
  });
  $('grant-export').addEventListener('click', () => {
    const period = historyRows[Number($('period').value)];
    csv('charity-gifts-' + charity[0] + '-' + period[0] + '.csv', [['fiscal_period_end','donee_number','reported_donee_name','gift_value_cad'], ...grantTable.map(r => [period[0],r[0],r[1],dollars(r[2])])]);
  });
  $('financial-export').addEventListener('click', () => csv('charity-finances-' + charity[0] + '.csv', [['fiscal_period_end','source_dataset_year','revenue_cad','expenditures_cad','assets_cad','liabilities_cad'], ...historyRows.map(r => [r[0],r[1],...r.slice(2,6).map(dollars)])]));
  const selected = lookup.get(hash.get('charity'));
  if (selected) open(selected, hash.get('period'), false);
  else drawList();
}
init();
