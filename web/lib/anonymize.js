/**
 * SMTP bounce message anonymizer.
 *
 * Ported from raw_data/normalize_bounces.py. Applies regex substitutions in
 * order to strip PII (email addresses, IP addresses, hostnames, session IDs,
 * tracking tokens, etc.) and replace them with stable placeholder tokens
 * suitable for ML training.
 *
 * Order matters: later patterns operate on tokens produced by earlier ones.
 *
 * @module anonymize
 */

/**
 * @typedef {[RegExp, string]} PatternPair
 */

/** @type {PatternPair[]} */
export const PATTERNS = [
  // Email addresses in angle brackets (including UTF-8 and special chars)
  [/<[^<>@\s]+@[^<>@\s]+\.[^<>\s]+>/g, '<EMAIL>'],

  // Email addresses without brackets
  [/(?<![:/])\b[^\s<>@:]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g, 'EMAIL'],

  // "user not found:email@domain" pattern (no space after colon)
  [/(not found|no longer on system):[^\s]+@[^\s]+/gi, '$1:EMAIL'],

  // IPv4 addresses in brackets [192.168.1.1]
  [/\[(\d{1,3}\.){3}\d{1,3}\]/g, '[IP]'],

  // IPv4 addresses standalone
  [/\b(\d{1,3}\.){3}\d{1,3}\b/g, 'IP'],

  // IPv6 addresses (simplified pattern)
  [/\b([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g, 'IPv6'],

  // UUIDs in parentheses like (69EF74AA-93FA-43D2-9A3D-0947E193855C.1)
  [/\([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}(\.\d+)?\)/gi, '(UUID)'],

  // Google session IDs - alphanumeric-alphanumericsi + numbers + optional letter + dot + numbers
  [/\b[a-z0-9]{10,}-[a-z0-9]+si\d+[a-z]*\.\d+\b/gi, 'SESSION'],

  // Shorter google session pattern at end of message (with optional server prefix like w12-, t11-)
  [/\b[a-z]\d+-[a-z0-9]+si\d+[a-z]*\.\d+\s*-\s*gsmtp/gi, 'SESSION - gsmtp'],
  [/\b[a-z0-9]+si\d+[a-z]*\.\d+\s*-\s*gsmtp/gi, 'SESSION - gsmtp'],

  // Microsoft/Exchange session IDs (hex patterns)
  [/\b[A-F0-9]{16,}\b/g, 'SESSION'],

  // Hostnames like DU2PEPF00028CFD.eurprd03.prod.outlook.com
  [/\b[A-Z0-9]{10,}\.[a-z0-9]+\.(prod|protection)\.outlook\.com\b/gi, 'OUTLOOK_HOST'],

  // Generic hostnames in brackets [hostname.domain.com]
  [/\[[a-z0-9\-]+\.[a-z0-9\-]+\.[a-z]{2,}\]/gi, '[HOSTNAME]'],

  // DMARC domain references: "from domain.com" or "domain domain.com"
  [/(?:from|domain)\s+([a-z0-9\-]+\.)+[a-z]{2,}/gi, 'from DOMAIN'],

  // "email from domain.com" pattern
  [/Unauthenticated email from\s+([a-z0-9\-]+\.)+[a-z]{2,}/gi, 'Unauthenticated email from DOMAIN'],

  // Mail.ru tracking URLs - normalize the tracking ID part (http and https)
  [/(https?:\/\/help\.mail\.ru\/notspam-support\/id\?c=)[A-Za-z0-9_~\-]+/g, '$1TRACKING_ID'],

  // GoDaddy spam check URLs
  [/(https:\/\/checkspam\.secureserver\.net\/\?sid=)[A-Za-z0-9]+(&mid=)[A-Za-z0-9]+/g, '$1SID$2MID'],

  // Generic long hex/base64 strings (likely IDs) - after specific patterns
  [/\b[0-9a-f]{24,}\b/gi, 'HEX_ID'],

  // Alphanumeric IDs like "TyY6vyUA8qhXu - TyY6vyUA8qhXuTyY8voTC2" with optional .number suffix
  [/\b[A-Za-z0-9]{10,20}\s*-\s*[A-Za-z0-9]{10,}(\.\d+)?/g, 'MSG_REF'],

  // Timestamps in various formats within messages
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+\-]\d{2}:?\d{2})?/g, 'TIMESTAMP'],

  // Message IDs in angle brackets (after anonymizing emails)
  [/<[A-Za-z0-9._%+\-=@]+>/g, '<MSG_ID>'],

  // Domain names after "administrator of" or similar contexts
  [/(administrator of)\s+([a-z0-9\-]+\.)+[a-z]{2,}/gi, '$1 DOMAIN'],

  // Sending domain patterns [DOMAIN.COM]
  [/\[([A-Z0-9\-]+\.)+[A-Z]{2,}\]/g, '[DOMAIN]'],

  // GMX/mail.com/1und1 tracking URLs - normalize the reference part
  [/(https:\/\/postmaster\.(gmx\.net|mail\.com|1und1\.de)\/en\/case\?c=r\d+&i=ip&v=IP&r=)[A-Za-z0-9\-]+/g, '$1REF'],

  // Mimecast session IDs [xxxxx.region+number] - various formats
  [/\[[A-Za-z0-9_\-]{10,}\.[a-z]{2}\d+\]/g, '[MIMECAST_ID]'],

  // QQ mail tracking IDs
  [/\[bizmx\d+t\d+t[a-f0-9]+/g, '[QQ_ID'],

  // eXpurgate spam IDs
  [/RPD=[0-9\-]+::[0-9\-]+[a-f0-9\-/]+/g, 'RPD=SPAM_ID'],

  // STRATO spam IDs: (B-EX 149500::1657212480-06C8A9C9-B3FAA124/10/34172451071)
  [/\(B-EX \d+::\d+-[A-F0-9]+-[A-F0-9]+\/\d+\/\d+\)/g, '(SPAM_ID)'],

  // Short alphanumeric session IDs before specific text (like WHBplSlh7rD8P Recipient Invalid)
  [/\b[A-Z][A-Za-z0-9]{10,15}\s+(Recipient|Invalid|Adresse|destinataire)/g, 'SESSION $1'],

  // Various alphanumeric tracking/session IDs at end of lines (8+ chars with mixed case/numbers and dashes)
  [/\b\d{10}-[a-zA-Z0-9]{12,}/g, 'TRACKING_ID'],

  // DMARC policy references to specific domains: "for domain.com"
  [/for\s+([a-z0-9\-]+\.)+[a-z]{2,}\s+\d{10}/gi, 'for DOMAIN TRACKING_ID'],
  [/per DMARC policy for\s+([a-z0-9\-]+\.)+[a-z]{2,}/gi, 'per DMARC policy for DOMAIN'],

  // SPF domain references [domain.com]
  [/SPF\s+\[([a-z0-9\-]+\.)+[a-z]{2,}\]/gi, 'SPF [DOMAIN]'],

  // Partial Outlook hostnames at end (truncated messages)
  [/\[?[A-Z0-9]{10,}\.(namprd|eurprd|prod|eur|nam)[a-z0-9.]*$/gi, '[OUTLOOK_HOST_PARTIAL'],

  // MSGID references in DSN messages
  [/MSGID:\s*\([A-Za-z0-9\-]+\)/g, 'MSGID: (MSG_ID)'],

  // Generic session/tracking IDs: patterns like "0dW00x3DOAuMjRvocaYDkw"
  [/\b[0-9a-zA-Z]{20,}\b/g, 'SESSION_ID'],

  // MX server patterns: "MX server hostname[IP] for domain"
  [/MX server\s+[a-z0-9.\-]+\[IP\]\s+for\s+[a-z0-9.\-]+/gi, 'MX server HOST[IP] for DOMAIN'],

  // "connecting to domain.com" patterns
  [/connecting to\s+([a-z0-9\-]+\.)+[a-z]{2,}/gi, 'connecting to DOMAIN'],

  // "resolving MX server for domain.com" patterns
  [/MX server for\s+([a-z0-9\-]+\.)+[a-z]{2,}/gi, 'MX server for DOMAIN'],

  // Outlook hostnames: AM7EUR03FT022.eop-EUR03.prod.protection.outlook.com
  [/\b[A-Z0-9]{10,}\.(eop-[a-z0-9]+\.)?prod\.protection\.outlook\.com\b/gi, 'OUTLOOK_HOST'],

  // Government Office 365: eop-usg02.itar.protection.office365.us
  [/\b[A-Z0-9]{10,}\.eop-[a-z0-9]+\.(itar\.)?protection\.office365\.(us|com)\b/gi, 'OUTLOOK_HOST'],

  // Exchange labs: AM7PR01MB6609.eurprd01.prod.exchangelabs.com
  [/\b[A-Z0-9]{10,}\.[a-z]+\d+\.prod\.exchangelabs\.com\b/gi, 'OUTLOOK_HOST'],

  // Truncated Outlook hostnames in messages: [BN8NAM04FT020.eop-NAM04.p...)
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.[a-z.]*\.\.\.\)/gi, '[OUTLOOK_HOST...])'  ],

  // Generic FQDNs in brackets that weren't caught
  [/\[[a-z0-9\-]+(\.[a-z0-9\-]+){2,}\]/gi, '[HOSTNAME]'],

  // Domain names after "changed to @domain" or similar
  [/(@[a-z0-9\-]+\.)+[a-z]{2,}/gi, '@DOMAIN'],

  // Standalone domain patterns in specific contexts: "host domain.com said"
  [/host\s+([a-z0-9\-]+\.)+[a-z]{2,}(\[IP\])?\s+said/gi, 'host DOMAIN[IP] said'],

  // Post-processing: Google server prefix patterns that prefix SESSION/SESSION_ID/HEX_ID tokens
  // e.g., 136-SESSION_ID, a15-SESSION_ID, q11-SESSION_ID.4, g187-HEX_ID, w12-SESSION
  [/\b[a-z]{0,3}\d+-SESSION_ID(\.\d+)?/gi, 'SESSION'],
  [/\b[a-z]{0,3}\d+-HEX_ID(\.\d+)?/gi, 'SESSION'],
  [/\b[a-z]{0,3}\d+-SESSION(\.\d+)?/gi, 'SESSION'],
  [/\b[a-z]{0,3}\d+-MSG_REF(\.\d+)?/gi, 'SESSION'],

  // Domain names in "Recipient address rejected: domain.com"
  [/Recipient address rejected:\s+([a-z0-9\-]+\.)+[a-z]{2,}$/gi, 'Recipient address rejected: DOMAIN'],

  // MSG_REF/SESSION_ID/SESSION with region suffix like .us76, .uk179, .de38, .jer7, .usb18
  [/\b(MSG_REF|SESSION_ID|SESSION)\.[a-z]{2,3}\d+\b/g, '$1'],

  // MSG_REF-suffix patterns like MSG_REF-4otssDBM (alphanumeric suffix)
  [/\bMSG_REF-[A-Za-z0-9]+\b/g, 'MSG_REF'],

  // Alphanumeric prefix before -SESSION like 3yIS2Bg-SESSION
  [/\b[A-Za-z0-9]{5,10}-SESSION\b/g, 'SESSION'],

  // SID parameter patterns: sid=xxxxx
  [/;sid=[A-Za-z0-9]+/g, ';sid=SID'],

  // MTA/timestamp parameters: mta=xxx;d=xxx;t=xxx
  [/;mta=[a-z0-9\-]+;d=\d+;t=\d+\[?[A-Z]*\]?/g, ';mta=MTA;d=DATE;t=TIME'],

  // ;ipsrc= or ;ip= patterns at end
  [/;ip(src)?=IP.*$/g, ';ip=IP'],

  // Truncated Outlook hostnames at end of line (missing closing bracket)
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.outlook\.$/gi, '[OUTLOOK_HOST]'],

  // Outlook hostnames truncated mid-domain
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.outloo$/gi, '[OUTLOOK_HOST]'],
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.outl$/gi, '[OUTLOOK_HOST]'],
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.out$/gi, '[OUTLOOK_HOST]'],
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.$/gi, '[OUTLOOK_HOST]'],
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.pro$/gi, '[OUTLOOK_HOST]'],
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.$/gi, '[OUTLOOK_HOST]'],
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.p$/gi, '[OUTLOOK_HOST]'],
  [/\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.$/gi, '[OUTLOOK_HOST]'],

  // Generic truncated hostnames at end: [HOSTNAME.something. or [HOSTNAME.som
  [/\[[A-Z0-9]{10,}\.[a-z0-9.\-]*$/gi, '[OUTLOOK_HOST]'],

  // Truncated hex session IDs at end of line (8+ hex chars without closing)
  [/\b[0-9A-F]{8,}$/g, 'SESSION'],

  // OUTLOOK_HOST_PARTIAL at end
  [/OUTLOOK_HOST_PARTIAL$/g, 'OUTLOOK_HOST'],

  // mx-gateXX-hz1 hostname patterns
  [/mx-gate\d+-[a-z]+\d*/g, 'MX_HOST'],

  // Remaining Mimecast-style IDs in brackets [XXX-xxx...] or [XxxXxx...]
  [/\[[A-Za-z0-9_\-]{15,}\.\.\.$]/g, '[MIMECAST_ID]'],
  [/\[[A-Za-z0-9_\-]{15,}\]$/g, '[MIMECAST_ID]'],

  // Amavis-style id= patterns: id=20178-07, id=22455-02
  [/\bid=\d+-\d+\b/g, 'id=ID'],

  // Upload byte counts: "Received 998807 B response"
  [/Received \d+ B response/g, 'Received N B response'],

  // MTA date/time patterns: ;d=20200831;t=221451[CET]
  [/;d=\d{8};t=\d{6}\[?[A-Z]*\]?/g, ';d=DATE;t=TIME'],

  // Byte size patterns: (34990 bytes), 38029 bytes
  [/\(\d+ bytes\)/g, '(N bytes)'],
  [/\b\d+ bytes\b/g, 'N bytes'],

  // MTA server names with numbers: mx6.tb, mx7.tb, mailrelay01, mcc-ibgw-5001a
  [/\bmx\d+\.tb\b/g, 'MX.tb'],
  [/\bmailrelay\d+\b/g, 'mailrelay'],
  [/\bmcc-ibgw-\d+[a-z]?\b/g, 'mcc-ibgw'],

  // SESSION_ID with suffix patterns: SESSION_ID--.14136S3
  [/SESSION_ID--\.\d+S\d+/g, 'SESSION_ID'],

  // DMARC policy domain names: "due to domain.com's DMARC policy"
  [/due to ([a-z0-9\-]+\.)+[a-z]{2,}'s DMARC policy/gi, "due to DOMAIN's DMARC policy"],

  // Sendmail-style message IDs: 22B6goFM011735 (date prefix + random)
  [/\b[0-9A-Za-z]{14,16}\b(?=\s+This message has been blocked)/g, 'MSG_ID'],

  // Spam IDs: tlsNG-xxx/timestamp-xxx-xxx/xx/xxx
  [/tlsNG-[a-z0-9]+\/\d+-[A-F0-9]+-[A-F0-9]+\/\d+\//g, 'SPAM_ID/'],

  // Proofpoint hostnames: DJJMDCJC01-PPOINT04.domain
  [/\b[A-Z0-9]+-PPOINT\d+\.[a-z0-9.]+/g, 'PROOFPOINT_HOST'],

  // Cloudmark hostnames: cxr-ibgw-5001a.stratus.cloudmark.com
  [/cxr-ibgw-\d+[a-z]?\.[a-z.]+/g, 'CLOUDMARK_HOST'],

  // Username in parentheses for "No such user": (username)
  [/No such user \([a-z0-9._\-]+\)/gi, 'No such user (USER)'],

  // Orange France session IDs: kNM6oV78StwDY before Mail rejete
  [/\b[a-zA-Z0-9]{13}\s+Mail rejete/g, 'SESSION Mail rejete'],

  // UUIDs in braces: i{28a159dd-400b-41c1-91f8-52cbf3d90371}
  [/i\{[a-f0-9\-]{36}\}/gi, 'i{UUID}'],

  // Server hostnames with numbers: west.smtp.mx.exchXXX, vcXep-hipesaXX, walimpincXX
  [/west\.smtp\.mx\.exch\d+\.serverdata\.net/g, 'west.smtp.mx.HOST.serverdata.net'],
  [/vc[a-z]ep-hipesa\d+\.lmig\.com/g, 'HOST.lmig.com'],
  [/walimpinc\d+/g, 'walimpinc'],

  // Secureserver hostnames: sxb1plibsmtp01-23.prod.sxb1.secureserver.net
  [/[a-z0-9]+plibsmtp\d+-\d+\.prod\.[a-z0-9]+\.secureserver\.net/g, 'HOST.secureserver.net'],

  // Cloudfilter hostnames: shw-ibgw-4004a.ext.cloudfilter.net
  [/[a-z]+-ibgw-\d+[a-z]?\.ext\.cloudfilter\.net/g, 'HOST.cloudfilter.net'],

  // TalkTalk session IDs: MslrkvgjeHnFO (alphanumeric, ~13 chars)
  [/\bmx\.talktalk\.net\s+[A-Za-z0-9]{12,15}\b/g, 'mx.talktalk.net SESSION'],

  // Cloudmark MXI hostnames: cha-cop-prd-eml-mxi-001.epbfi.com
  [/[a-z\-]+-mxi-\d+\.[a-z.]+/g, 'HOST'],

  // ofsend hostnames: dlv-105.ofsend.com, dlv-109.ofsend.com
  [/dlv-\d+\.ofsend\.com/g, 'dlv.ofsend.com'],

  // RBL numbers in parentheses: blacklisted by RBL (27)
  [/blacklisted by RBL \(\d+\)/g, 'blacklisted by RBL (N)'],

  // Sendmail message IDs before ACCESS DENIED: 082JZx0U005886:
  [/\b[0-9A-Za-z]{14,16}:\s+ACCESS DENIED/g, 'MSG_ID: ACCESS DENIED'],

  // QQ mail base64 tokens in brackets
  [/\[[A-Za-z0-9+/]{20,}[=]*\s+IP/g, '[QQ_TOKEN IP'],

  // TT506/OFR session IDs before specific text
  [/\b[a-zA-Z0-9]{12,14}\s+(Recipient Invalid|Recipient Undeliverable|Adresse d)/g, 'SESSION $1'],
];

/** @type {PatternPair[]} */
export const NORMALIZE_PATTERNS = [
  // SMTP multiline to single line: "550-5.7.40" -> "550 5.7.40"
  [/^(\d{3})-/gm, '$1 '],

  // Multiple spaces to single space
  [/ {2,}/g, ' '],

  // Multiple dashes/equals used as separators
  [/-{3,}/g, '---'],
  [/={3,}/g, '==='],
];

/**
 * Apply all anonymization and normalization patterns to a bounce message.
 *
 * Mirrors the Python `anonymize_message` function exactly: PATTERNS are
 * applied first in order, then NORMALIZE_PATTERNS.
 *
 * @param {string} msg - Raw SMTP bounce message text.
 * @returns {string} Anonymized message with PII replaced by stable tokens.
 */
export function anonymizeMessage(msg) {
  let result = msg.trim();

  for (const [pattern, replacement] of PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }

  for (const [pattern, replacement] of NORMALIZE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }

  return result.trim();
}
