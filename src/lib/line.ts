import placesData from "./places.json";

export type RiskKind =
  | "url"
  | "payment"
  | "email"
  | "phone"
  | "name"
  | "place"
  | "school"
  | "org"
  | "social";

export type RiskMatch = {
  id: string;
  kind: RiskKind;
  label: string;
  value: string;
  replacement: string;
  start: number;
  end: number;
};

export type ParsedMessage = {
  date?: string;
  time?: string;
  sender?: string;
  body: string;
  raw: string;
  type: "message" | "event" | "unknown";
};

export type ParseResult = {
  headerName?: string;
  participants: string[];
  messages: ParsedMessage[];
};

export type AnonymizeResult = {
  parsed: ParseResult;
  anonymizedText: string;
  risks: RiskMatch[];
  replacements: Record<string, string>;
};

const spaceMessagePattern = /^(\d{1,2}:\d{2})\s+(.+?)\s{1,}(.+)$/;
const tabMessagePattern = /^(\d{1,2}:\d{2})\t([^\t]+)\t(.*)$/;
const datePattern = /^\d{4}\/\d{2}\/\d{2}\(.+\)$/;
const titlePattern = /^\[LINE\]\s+(.+?)とのトーク履歴$/;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?<!\d)(?:\+81[-\s]?)?(?:0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})(?!\d)/g;
const urlPattern = /https?:\/\/[^\s]+/gi;
const socialPattern = /@[A-Za-z0-9_.]{3,32}\b/g;
const placePattern = /(?:渋谷|新宿|池袋|原宿|横浜|品川|東京|大阪|京都|名古屋|[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9]{1,6}(?:駅|県|市|区|町|村|公園|ランド))/gu;
const nameSuffixPattern = /(?<!たく|みな|おじ|おば|お母|お父|兄|姉|妹|弟|奥|富士|炭|店)(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]{1,6})(?:くん|ちゃん|さん)/gu;
const schoolPattern = /\b[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]+(?:高校|大学|専門学校|学園)\b/gu;
const orgPattern = /\b[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]+(?:株式会社|有限会社|店|カフェ|バイト|社)\b/gu;

const openDataPlacePattern = new RegExp(`(?:${placesData.join("|")})`, "g");

const paymentHosts = ["pay.paypay.ne.jp", "qr.paypay.ne.jp"];
const sharedLinkHosts = ["line.me", "lin.ee", "docs.google.com", "forms.gle", "gift.line.me"];

const riskPriority: Record<RiskKind, number> = {
  payment: 1,
  url: 2,
  email: 3,
  phone: 4,
  name: 5,
  place: 6,
  school: 7,
  org: 8,
  social: 9,
};

export function parseLineHistory(text: string): ParseResult {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const messages: ParsedMessage[] = [];
  const participants = new Set<string>();
  let headerName: string | undefined;
  let currentDate: string | undefined;

  for (const line of lines) {
    const titleMatch = line.match(titlePattern);
    if (titleMatch) {
      headerName = titleMatch[1].trim();
      participants.add(headerName);
      messages.push({ body: line, raw: line, type: "event" });
      continue;
    }

    if (datePattern.test(line)) {
      currentDate = line;
      messages.push({ date: line, body: line, raw: line, type: "event" });
      continue;
    }

    const messageMatch = line.match(tabMessagePattern) || line.match(spaceMessagePattern);
    if (messageMatch) {
      const [, time, sender, body] = messageMatch;
      participants.add(sender.trim());
      messages.push({
        date: currentDate,
        time,
        sender: sender.trim(),
        body,
        raw: line,
        type: "message",
      });
      continue;
    }

    if (messages.length > 0 && messages[messages.length - 1].type === "message") {
      const previous = messages[messages.length - 1];
      previous.body = `${previous.body}\n${line}`;
      previous.raw = `${previous.raw}\n${line}`;
      continue;
    }

    messages.push({ body: line, raw: line, type: "unknown" });
  }

  return { headerName, participants: [...participants], messages };
}

function pushMatches(
  matches: RiskMatch[],
  text: string,
  pattern: RegExp,
  kind: RiskKind,
  replacementFactory: (value: string) => string,
) {
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    matches.push({
      id: `${kind}-${start}-${value}`,
      kind,
      label: getRiskLabel(kind),
      value,
      replacement: replacementFactory(value),
      start,
      end: start + value.length,
    });
  }
}

function getRiskLabel(kind: RiskKind) {
  switch (kind) {
    case "payment":
      return "決済リンク";
    case "url":
      return "URL";
    case "email":
      return "メールアドレス";
    case "phone":
      return "電話番号";
    case "name":
      return "名前";
    case "place":
      return "地名";
    case "school":
      return "学校名";
    case "org":
      return "組織名";
    case "social":
      return "SNSアカウント";
  }
}

function resolveParticipantReplacements(parsed: ParseResult) {
  const map = new Map<string, string>();
  const messageSenders = parsed.messages
    .filter((message) => message.sender)
    .map((message) => message.sender as string);

  if (parsed.headerName) {
    map.set(parsed.headerName, "相手A");
  }

  const uniqueSenders = [...new Set(messageSenders)];
  const selfCandidate = uniqueSenders.find((sender) => sender !== parsed.headerName);
  if (selfCandidate) {
    map.set(selfCandidate, "自分");
  }

  let index = 0;
  for (const participant of parsed.participants) {
    if (!map.has(participant)) {
      const label = index === 0 ? "人物A" : `人物${String.fromCharCode(65 + index)}`;
      map.set(participant, label);
      index += 1;
    }
  }

  return map;
}

function buildNamePattern(value: string) {
  return new RegExp(escapeRegExp(value), "g");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectUrlMatches(text: string, matches: RiskMatch[]) {
  for (const match of text.matchAll(urlPattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    let kind: RiskKind = "url";
    let replacement = "[URL]";

    if (paymentHosts.some((host) => value.includes(host))) {
      kind = "payment";
      replacement = "[決済リンク]";
    } else if (value.includes("gift.line.me")) {
      replacement = "[LINEギフトリンク]";
    } else if (sharedLinkHosts.some((host) => value.includes(host))) {
      replacement = "[共有リンク]";
    }

    matches.push({
      id: `${kind}-${start}-${value}`,
      kind,
      label: getRiskLabel(kind),
      value,
      replacement,
      start,
      end: start + value.length,
    });
  }
}

function dedupeAndSort(matches: RiskMatch[]) {
  const sorted = [...matches].sort((a, b) => {
    if (a.start === b.start) {
      if (a.end === b.end) {
        return riskPriority[a.kind] - riskPriority[b.kind];
      }
      return b.end - a.end;
    }
    return a.start - b.start;
  });

  const result: RiskMatch[] = [];
  let lastEnd = -1;
  for (const match of sorted) {
    if (match.start < lastEnd) {
      continue;
    }
    result.push(match);
    lastEnd = match.end;
  }
  return result;
}

export function anonymizeLineText(
  text: string,
  customNames?: { self?: string; partner?: string }
): AnonymizeResult {
  const parsed = parseLineHistory(text);
  const matches: RiskMatch[] = [];
  const replacements = Object.fromEntries(resolveParticipantReplacements(parsed));

  if (customNames?.self && customNames.self.trim() !== "") {
    replacements[customNames.self.trim()] = "自分";
  }
  if (customNames?.partner && customNames.partner.trim() !== "") {
    replacements[customNames.partner.trim()] = "相手A";
  }

  collectUrlMatches(text, matches);
  pushMatches(matches, text, emailPattern, "email", () => "[メールアドレス]");
  pushMatches(matches, text, phonePattern, "phone", () => "[電話番号]");
  pushMatches(matches, text, socialPattern, "social", () => "[SNSアカウント]");
  pushMatches(matches, text, placePattern, "place", () => "[地名]");
  pushMatches(matches, text, openDataPlacePattern, "place", () => "[地名]");
  pushMatches(matches, text, schoolPattern, "school", () => "[学校名]");
  pushMatches(matches, text, orgPattern, "org", () => "[組織名]");
  pushMatches(matches, text, nameSuffixPattern, "name", () => "[人物]");

  for (const [name, replacement] of Object.entries(replacements)) {
    pushMatches(matches, text, buildNamePattern(name), "name", () => replacement);
  }

  const risks = dedupeAndSort(matches);
  let cursor = 0;
  let anonymizedText = "";
  for (const risk of risks) {
    anonymizedText += text.slice(cursor, risk.start);
    anonymizedText += risk.replacement;
    cursor = risk.end;
  }
  anonymizedText += text.slice(cursor);

  return { parsed, anonymizedText, risks, replacements };
}

export function highlightText(text: string, risks: RiskMatch[]) {
  const segments: Array<{ text: string; kind?: RiskKind; id: string }> = [];
  let cursor = 0;

  for (const risk of risks) {
    if (risk.start > cursor) {
      segments.push({
        id: `plain-${cursor}`,
        text: text.slice(cursor, risk.start),
      });
    }

    segments.push({
      id: risk.id,
      text: text.slice(risk.start, risk.end),
      kind: risk.kind,
    });
    cursor = risk.end;
  }

  if (cursor < text.length) {
    segments.push({
      id: `plain-${cursor}`,
      text: text.slice(cursor),
    });
  }

  return segments;
}

