const fs = require("node:fs/promises");
const path = require("node:path");

const SITE_URL = "https://www.news.com.au/";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(PROJECT_ROOT, "data.json");
const TRACKED_WORDS_FILE = path.join(PROJECT_ROOT, "tracked-words.json");
const TIME_ZONE = "Australia/Brisbane";
const DEFAULT_TRACKED_WORDS = ["Bombshell", "Shocking", "Explosive"];
const MIN_TOTAL_WORDS_FOR_VALID_RUN = 100;

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "ago", "also", "and", "any", "are",
  "aus", "australia", "been", "before", "being", "but", "can", "com",
  "could", "did", "does", "for", "from", "get", "had", "has", "have", "her",
  "here", "his", "how", "into", "its", "just", "live", "minutes", "more",
  "new", "news", "not", "now", "off", "one", "our", "out", "over", "said",
  "say", "she", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "those", "through", "video", "videos", "was",
  "were", "what", "when", "where", "which", "who", "will", "with", "you",
  "your"
]);

function todayInTimeZone() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function decodeEntities(html) {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, " ");
}

function extractVisibleHtml(html) {
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const source = bodyMatch?.[1] ?? mainMatch?.[1] ?? articleMatch?.[1] ?? html;
  return source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|form|nav|footer|aside|header)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|form|nav|footer|aside|header)\b[^>]*\/>/gi, " ");
}

function htmlToText(html) {
  return decodeEntities(
    extractVisibleHtml(html)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
}

function tokenize(text) {
  return text
    .toLowerCase()
    .match(/[a-z][a-z'-]{2,}/g)
    ?.map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word)) ?? [];
}

function countWords(words) {
  const counts = {};
  for (const word of words) counts[word] = (counts[word] ?? 0) + 1;
  return counts;
}

async function readTrackedWords() {
  try {
    const words = JSON.parse(await fs.readFile(TRACKED_WORDS_FILE, "utf8"));
    return [...new Set(words.map((word) => String(word).trim()).filter(Boolean))];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return DEFAULT_TRACKED_WORDS;
  }
}

function countTrackedWords(text, trackedWords) {
  const counts = {};
  for (const word of trackedWords) {
    counts[word] = text.match(new RegExp(`\\b${word}\\b`, "gi"))?.length ?? 0;
  }
  return counts;
}

async function readExistingData() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { siteUrl: SITE_URL, timeZone: TIME_ZONE, trackedWords: DEFAULT_TRACKED_WORDS, runs: [], allTimeWordCounts: {} };
  }
}

async function loadSourceHtml() {
  try {
    const response = await fetch(SITE_URL, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 news-word-tracker/1.0"
      }
    });
    if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    const fallbackPath = process.env.NEWS_COM_AU_HTML_FILE;
    if (!fallbackPath) throw error;
    return await fs.readFile(fallbackPath, "utf8");
  }
}

function rebuildAllTimeCounts(runs) {
  const totals = {};
  for (const run of runs) {
    for (const [word, count] of Object.entries(run.wordCounts ?? {})) {
      totals[word] = (totals[word] ?? 0) + count;
    }
  }
  return Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function validateRun(run, sampleText) {
  if (run.totalWords >= MIN_TOTAL_WORDS_FOR_VALID_RUN) return;
  const sample = sampleText.trim().replace(/\s+/g, " ").slice(0, 160);
  throw new Error(
    `Refusing to publish suspicious scrape for ${run.date}: captured only ${run.totalWords} words, ` +
    `which is below the ${MIN_TOTAL_WORDS_FOR_VALID_RUN}-word minimum. Sample: ${sample || "(empty)"}`
  );
}

async function main() {
  const trackedWords = await readTrackedWords();
  const text = htmlToText(await loadSourceHtml());
  const words = tokenize(text);
  const date = todayInTimeZone();
  const existing = await readExistingData();
  const wordCounts = countWords(words);
  const run = {
    date,
    collectedAt: new Date().toISOString(),
    sourceUrl: SITE_URL,
    totalWords: words.length,
    trackedCounts: countTrackedWords(text, trackedWords),
    wordCounts: Object.fromEntries(Object.entries(wordCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 250))
  };
  validateRun(run, text);
  const runs = [...existing.runs.filter((item) => item.date !== date), run].sort((a, b) => a.date.localeCompare(b.date));
  await fs.writeFile(DATA_FILE, `${JSON.stringify({
    siteUrl: SITE_URL,
    timeZone: TIME_ZONE,
    trackedWords,
    runs,
    allTimeWordCounts: rebuildAllTimeCounts(runs)
  }, null, 2)}\n`);
  console.log(`Updated ${DATA_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});