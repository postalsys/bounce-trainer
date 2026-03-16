#!/usr/bin/env python3
"""
Bounce Message Normalizer

Anonymizes personal data (emails, IPs, hostnames, session IDs) in SMTP
bounce messages using regex patterns. Supports single-message (stdin) and
batch (JSONL) modes.
"""

import argparse
import json
import re
import sys


# Regex patterns for anonymization (order matters!)
PATTERNS = [
    # Email addresses in angle brackets (including UTF-8 and special chars)
    (re.compile(r'<[^<>@\s]+@[^<>@\s]+\.[^<>\s]+>'), '<EMAIL>'),

    # Email addresses without brackets - broad pattern to catch UTF-8 and special chars
    (re.compile(r'(?<![:/])\b[^\s<>@:]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b'), 'EMAIL'),

    # "user not found:email@domain" pattern (no space after colon)
    (re.compile(r'(not found|no longer on system):[^\s]+@[^\s]+', re.IGNORECASE), r'\1:EMAIL'),

    # IPv4 addresses in brackets [192.168.1.1]
    (re.compile(r'\[(\d{1,3}\.){3}\d{1,3}\]'), '[IP]'),

    # IPv4 addresses standalone
    (re.compile(r'\b(\d{1,3}\.){3}\d{1,3}\b'), 'IP'),

    # IPv6 addresses (simplified pattern)
    (re.compile(r'\b([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b'), 'IPv6'),

    # UUIDs in parentheses like (69EF74AA-93FA-43D2-9A3D-0947E193855C.1)
    (re.compile(r'\([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}(\.\d+)?\)', re.IGNORECASE), '(UUID)'),

    # Google session IDs - more comprehensive pattern
    # Format: alphanumeric-alphanumericsi + numbers + optional letter + dot + numbers
    (re.compile(r'\b[a-z0-9]{10,}-[a-z0-9]+si\d+[a-z]*\.\d+\b', re.IGNORECASE), 'SESSION'),
    # Shorter google session pattern at end of message (with optional server prefix like w12-, t11-)
    (re.compile(r'\b[a-z]\d+-[a-z0-9]+si\d+[a-z]*\.\d+\s*-\s*gsmtp', re.IGNORECASE), 'SESSION - gsmtp'),
    (re.compile(r'\b[a-z0-9]+si\d+[a-z]*\.\d+\s*-\s*gsmtp', re.IGNORECASE), 'SESSION - gsmtp'),
    # Microsoft/Exchange session IDs (hex patterns)
    (re.compile(r'\b[A-F0-9]{16,}\b'), 'SESSION'),

    # Hostnames like DU2PEPF00028CFD.eurprd03.prod.outlook.com
    (re.compile(r'\b[A-Z0-9]{10,}\.[a-z0-9]+\.(prod|protection)\.outlook\.com\b', re.IGNORECASE), 'OUTLOOK_HOST'),

    # Generic hostnames in brackets [hostname.domain.com]
    (re.compile(r'\[[a-z0-9\-]+\.[a-z0-9\-]+\.[a-z]{2,}\]', re.IGNORECASE), '[HOSTNAME]'),

    # DMARC domain references: "from domain.com" or "domain domain.com"
    (re.compile(r'(?:from|domain)\s+([a-z0-9\-]+\.)+[a-z]{2,}', re.IGNORECASE), 'from DOMAIN'),

    # "email from domain.com" pattern
    (re.compile(r'Unauthenticated email from\s+([a-z0-9\-]+\.)+[a-z]{2,}', re.IGNORECASE), 'Unauthenticated email from DOMAIN'),

    # Mail.ru tracking URLs - normalize the tracking ID part (http and https)
    (re.compile(r'(https?://help\.mail\.ru/notspam-support/id\?c=)[A-Za-z0-9_~\-]+'), r'\1TRACKING_ID'),

    # GoDaddy spam check URLs
    (re.compile(r'(https://checkspam\.secureserver\.net/\?sid=)[A-Za-z0-9]+(&mid=)[A-Za-z0-9]+'), r'\1SID\2MID'),

    # Generic long hex/base64 strings (likely IDs) - after specific patterns
    (re.compile(r'\b[0-9a-f]{24,}\b', re.IGNORECASE), 'HEX_ID'),

    # Alphanumeric IDs like "TyY6vyUA8qhXu - TyY6vyUA8qhXuTyY8voTC2" with optional .number suffix
    (re.compile(r'\b[A-Za-z0-9]{10,20}\s*-\s*[A-Za-z0-9]{10,}(\.\d+)?'), 'MSG_REF'),

    # Timestamps in various formats within messages
    (re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+\-]\d{2}:?\d{2})?'), 'TIMESTAMP'),

    # Message IDs in angle brackets (after anonymizing emails)
    (re.compile(r'<[A-Za-z0-9._%+\-=@]+>'), '<MSG_ID>'),

    # Domain names after "administrator of" or similar contexts
    (re.compile(r'(administrator of)\s+([a-z0-9\-]+\.)+[a-z]{2,}', re.IGNORECASE), r'\1 DOMAIN'),

    # Sending domain patterns [DOMAIN.COM]
    (re.compile(r'\[([A-Z0-9\-]+\.)+[A-Z]{2,}\]'), '[DOMAIN]'),

    # GMX/mail.com/1und1 tracking URLs - normalize the reference part
    (re.compile(r'(https://postmaster\.(gmx\.net|mail\.com|1und1\.de)/en/case\?c=r\d+&i=ip&v=IP&r=)[A-Za-z0-9\-]+'), r'\1REF'),

    # Mimecast session IDs [xxxxx.region+number] - various formats
    (re.compile(r'\[[A-Za-z0-9_\-]{10,}\.[a-z]{2}\d+\]'), '[MIMECAST_ID]'),

    # QQ mail tracking IDs
    (re.compile(r'\[bizmx\d+t\d+t[a-f0-9]+'), '[QQ_ID'),

    # eXpurgate spam IDs
    (re.compile(r'RPD=[0-9\-]+::[0-9\-]+[a-f0-9\-/]+'), 'RPD=SPAM_ID'),

    # STRATO spam IDs: (B-EX 149500::1657212480-06C8A9C9-B3FAA124/10/34172451071)
    (re.compile(r'\(B-EX \d+::\d+-[A-F0-9]+-[A-F0-9]+/\d+/\d+\)'), '(SPAM_ID)'),

    # Short alphanumeric session IDs before specific text (like WHBplSlh7rD8P Recipient Invalid)
    (re.compile(r'\b[A-Z][A-Za-z0-9]{10,15}\s+(Recipient|Invalid|Adresse|destinataire)'), r'SESSION \1'),

    # Various alphanumeric tracking/session IDs at end of lines (8+ chars with mixed case/numbers and dashes)
    (re.compile(r'\b\d{10}-[a-zA-Z0-9]{12,}'), 'TRACKING_ID'),

    # DMARC policy references to specific domains: "for domain.com"
    (re.compile(r'for\s+([a-z0-9\-]+\.)+[a-z]{2,}\s+\d{10}', re.IGNORECASE), 'for DOMAIN TRACKING_ID'),
    (re.compile(r'per DMARC policy for\s+([a-z0-9\-]+\.)+[a-z]{2,}', re.IGNORECASE), 'per DMARC policy for DOMAIN'),

    # SPF domain references [domain.com]
    (re.compile(r'SPF\s+\[([a-z0-9\-]+\.)+[a-z]{2,}\]', re.IGNORECASE), 'SPF [DOMAIN]'),

    # Partial Outlook hostnames at end (truncated messages)
    (re.compile(r'\[?[A-Z0-9]{10,}\.(namprd|eurprd|prod|eur|nam)[a-z0-9\.]*$', re.IGNORECASE), '[OUTLOOK_HOST_PARTIAL'),

    # MSGID references in DSN messages
    (re.compile(r'MSGID:\s*\([A-Za-z0-9\-]+\)'), 'MSGID: (MSG_ID)'),

    # Generic session/tracking IDs: patterns like "0dW00x3DOAuMjRvocaYDkw"
    (re.compile(r'\b[0-9a-zA-Z]{20,}\b'), 'SESSION_ID'),

    # MX server patterns: "MX server hostname[IP] for domain"
    (re.compile(r'MX server\s+[a-z0-9.\-]+\[IP\]\s+for\s+[a-z0-9.\-]+', re.IGNORECASE), 'MX server HOST[IP] for DOMAIN'),

    # "connecting to domain.com" patterns
    (re.compile(r'connecting to\s+([a-z0-9\-]+\.)+[a-z]{2,}', re.IGNORECASE), 'connecting to DOMAIN'),

    # "resolving MX server for domain.com" patterns
    (re.compile(r'MX server for\s+([a-z0-9\-]+\.)+[a-z]{2,}', re.IGNORECASE), 'MX server for DOMAIN'),

    # Outlook hostnames (with or without brackets, may have content after)
    # Pattern: AM7EUR03FT022.eop-EUR03.prod.protection.outlook.com
    (re.compile(r'\b[A-Z0-9]{10,}\.(eop-[a-z0-9]+\.)?prod\.protection\.outlook\.com\b', re.IGNORECASE), 'OUTLOOK_HOST'),
    # Government Office 365: eop-usg02.itar.protection.office365.us
    (re.compile(r'\b[A-Z0-9]{10,}\.eop-[a-z0-9]+\.(itar\.)?protection\.office365\.(us|com)\b', re.IGNORECASE), 'OUTLOOK_HOST'),
    # Exchange labs: AM7PR01MB6609.eurprd01.prod.exchangelabs.com
    (re.compile(r'\b[A-Z0-9]{10,}\.[a-z]+\d+\.prod\.exchangelabs\.com\b', re.IGNORECASE), 'OUTLOOK_HOST'),
    # Truncated Outlook hostnames in messages: [BN8NAM04FT020.eop-NAM04.p...)
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.[a-z\.]*\.\.\.\)', re.IGNORECASE), '[OUTLOOK_HOST...])')
    ,

    # Generic FQDNs in brackets that weren't caught
    (re.compile(r'\[[a-z0-9\-]+(\.[a-z0-9\-]+){2,}\]', re.IGNORECASE), '[HOSTNAME]'),

    # Domain names after "changed to @domain" or similar
    (re.compile(r'(@[a-z0-9\-]+\.)+[a-z]{2,}', re.IGNORECASE), '@DOMAIN'),

    # Standalone domain patterns in specific contexts: "host domain.com said"
    (re.compile(r'host\s+([a-z0-9\-]+\.)+[a-z]{2,}(\[IP\])?\s+said', re.IGNORECASE), 'host DOMAIN[IP] said'),

    # === Post-processing patterns: these match AFTER replacement tokens are created ===
    # Google server prefix patterns that prefix SESSION/SESSION_ID/HEX_ID tokens
    # e.g., 136-SESSION_ID, a15-SESSION_ID, q11-SESSION_ID.4, g187-HEX_ID, w12-SESSION
    (re.compile(r'\b[a-z]{0,3}\d+-SESSION_ID(\.\d+)?', re.IGNORECASE), 'SESSION'),
    (re.compile(r'\b[a-z]{0,3}\d+-HEX_ID(\.\d+)?', re.IGNORECASE), 'SESSION'),
    (re.compile(r'\b[a-z]{0,3}\d+-SESSION(\.\d+)?', re.IGNORECASE), 'SESSION'),
    (re.compile(r'\b[a-z]{0,3}\d+-MSG_REF(\.\d+)?', re.IGNORECASE), 'SESSION'),

    # Domain names in "Recipient address rejected: domain.com" (not a common error message)
    (re.compile(r'Recipient address rejected:\s+([a-z0-9\-]+\.)+[a-z]{2,}$', re.IGNORECASE), 'Recipient address rejected: DOMAIN'),

    # MSG_REF/SESSION_ID/SESSION with region suffix like .us76, .uk179, .de38, .jer7, .usb18
    (re.compile(r'\b(MSG_REF|SESSION_ID|SESSION)\.[a-z]{2,3}\d+\b'), r'\1'),

    # MSG_REF-suffix patterns like MSG_REF-4otssDBM (alphanumeric suffix)
    (re.compile(r'\bMSG_REF-[A-Za-z0-9]+\b'), 'MSG_REF'),

    # Alphanumeric prefix before -SESSION like 3yIS2Bg-SESSION
    (re.compile(r'\b[A-Za-z0-9]{5,10}-SESSION\b'), 'SESSION'),

    # SID parameter patterns: sid=xxxxx
    (re.compile(r';sid=[A-Za-z0-9]+'), ';sid=SID'),

    # MTA/timestamp parameters: mta=xxx;d=xxx;t=xxx
    (re.compile(r';mta=[a-z0-9\-]+;d=\d+;t=\d+\[?[A-Z]*\]?'), ';mta=MTA;d=DATE;t=TIME'),

    # ;ipsrc= or ;ip= patterns at end
    (re.compile(r';ip(src)?=IP.*$'), ';ip=IP'),

    # Truncated Outlook hostnames at end of line (missing closing bracket)
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.outlook\.$', re.IGNORECASE), '[OUTLOOK_HOST]'),

    # Outlook hostnames that got truncated mid-domain
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.outloo$', re.IGNORECASE), '[OUTLOOK_HOST]'),
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.outl$', re.IGNORECASE), '[OUTLOOK_HOST]'),
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.out$', re.IGNORECASE), '[OUTLOOK_HOST]'),
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.protection\.$', re.IGNORECASE), '[OUTLOOK_HOST]'),
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.pro$', re.IGNORECASE), '[OUTLOOK_HOST]'),
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.prod\.$', re.IGNORECASE), '[OUTLOOK_HOST]'),
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.p$', re.IGNORECASE), '[OUTLOOK_HOST]'),
    (re.compile(r'\[[A-Z0-9]{10,}\.eop-[A-Z0-9]+\.$', re.IGNORECASE), '[OUTLOOK_HOST]'),

    # Generic truncated hostnames at end: [HOSTNAME.something. or [HOSTNAME.som
    (re.compile(r'\[[A-Z0-9]{10,}\.[a-z0-9\.\-]*$', re.IGNORECASE), '[OUTLOOK_HOST]'),

    # Truncated hex session IDs at end of line (8+ hex chars without closing)
    (re.compile(r'\b[0-9A-F]{8,}$'), 'SESSION'),

    # OUTLOOK_HOST_PARTIAL at end
    (re.compile(r'OUTLOOK_HOST_PARTIAL$'), 'OUTLOOK_HOST'),

    # mx-gateXX-hz1 hostname patterns
    (re.compile(r'mx-gate\d+-[a-z]+\d*'), 'MX_HOST'),

    # Remaining Mimecast-style IDs in brackets [XXX-xxx...] or [XxxXxx...]
    (re.compile(r'\[[A-Za-z0-9_\-]{15,}\.\.\.$'), '[MIMECAST_ID]'),
    (re.compile(r'\[[A-Za-z0-9_\-]{15,}\]$'), '[MIMECAST_ID]'),

    # Amavis-style id= patterns: id=20178-07, id=22455-02
    (re.compile(r'\bid=\d+-\d+\b'), 'id=ID'),

    # Upload byte counts: "Received 998807 B response"
    (re.compile(r'Received \d+ B response'), 'Received N B response'),

    # MTA date/time patterns: ;d=20200831;t=221451[CET]
    (re.compile(r';d=\d{8};t=\d{6}\[?[A-Z]*\]?'), ';d=DATE;t=TIME'),

    # Byte size patterns: (34990 bytes), 38029 bytes
    (re.compile(r'\(\d+ bytes\)'), '(N bytes)'),
    (re.compile(r'\b\d+ bytes\b'), 'N bytes'),

    # MTA server names with numbers: mx6.tb, mx7.tb, mailrelay01, mcc-ibgw-5001a
    (re.compile(r'\bmx\d+\.tb\b'), 'MX.tb'),
    (re.compile(r'\bmailrelay\d+\b'), 'mailrelay'),
    (re.compile(r'\bmcc-ibgw-\d+[a-z]?\b'), 'mcc-ibgw'),

    # SESSION_ID with suffix patterns: SESSION_ID--.14136S3
    (re.compile(r'SESSION_ID--\.\d+S\d+'), 'SESSION_ID'),

    # DMARC policy domain names: "due to domain.com's DMARC policy"
    (re.compile(r"due to ([a-z0-9\-]+\.)+[a-z]{2,}'s DMARC policy", re.IGNORECASE), "due to DOMAIN's DMARC policy"),

    # Sendmail-style message IDs: 22B6goFM011735 (date prefix + random)
    (re.compile(r'\b[0-9A-Za-z]{14,16}\b(?=\s+This message has been blocked)'), 'MSG_ID'),

    # Spam IDs: tlsNG-xxx/timestamp-xxx-xxx/xx/xxx
    (re.compile(r'tlsNG-[a-z0-9]+/\d+-[A-F0-9]+-[A-F0-9]+/\d+/'), 'SPAM_ID/'),

    # Proofpoint hostnames: DJJMDCJC01-PPOINT04.domain
    (re.compile(r'\b[A-Z0-9]+-PPOINT\d+\.[a-z0-9.]+'), 'PROOFPOINT_HOST'),

    # Cloudmark hostnames: cxr-ibgw-5001a.stratus.cloudmark.com
    (re.compile(r'cxr-ibgw-\d+[a-z]?\.[a-z.]+'), 'CLOUDMARK_HOST'),

    # Username in parentheses for "No such user": (username)
    (re.compile(r'No such user \([a-z0-9._\-]+\)', re.IGNORECASE), 'No such user (USER)'),

    # Orange France session IDs: kNM6oV78StwDY before Mail rejete
    (re.compile(r'\b[a-zA-Z0-9]{13}\s+Mail rejete'), 'SESSION Mail rejete'),

    # UUIDs in braces: i{28a159dd-400b-41c1-91f8-52cbf3d90371}
    (re.compile(r'i\{[a-f0-9\-]{36}\}', re.IGNORECASE), 'i{UUID}'),

    # Server hostnames with numbers: west.smtp.mx.exchXXX, vcXep-hipesaXX, walimpincXX
    (re.compile(r'west\.smtp\.mx\.exch\d+\.serverdata\.net'), 'west.smtp.mx.HOST.serverdata.net'),
    (re.compile(r'vc[a-z]ep-hipesa\d+\.lmig\.com'), 'HOST.lmig.com'),
    (re.compile(r'walimpinc\d+'), 'walimpinc'),

    # Secureserver hostnames: sxb1plibsmtp01-23.prod.sxb1.secureserver.net
    (re.compile(r'[a-z0-9]+plibsmtp\d+-\d+\.prod\.[a-z0-9]+\.secureserver\.net'), 'HOST.secureserver.net'),

    # Cloudfilter hostnames: shw-ibgw-4004a.ext.cloudfilter.net
    (re.compile(r'[a-z]+-ibgw-\d+[a-z]?\.ext\.cloudfilter\.net'), 'HOST.cloudfilter.net'),

    # TalkTalk session IDs: MslrkvgjeHnFO (alphanumeric, ~13 chars)
    (re.compile(r'\bmx\.talktalk\.net\s+[A-Za-z0-9]{12,15}\b'), 'mx.talktalk.net SESSION'),

    # Cloudmark MXI hostnames: cha-cop-prd-eml-mxi-001.epbfi.com
    (re.compile(r'[a-z\-]+-mxi-\d+\.[a-z.]+'), 'HOST'),

    # ofsend hostnames: dlv-105.ofsend.com, dlv-109.ofsend.com
    (re.compile(r'dlv-\d+\.ofsend\.com'), 'dlv.ofsend.com'),

    # RBL numbers in parentheses: blacklisted by RBL (27)
    (re.compile(r'blacklisted by RBL \(\d+\)'), 'blacklisted by RBL (N)'),

    # Sendmail message IDs before ACCESS DENIED: 082JZx0U005886:
    (re.compile(r'\b[0-9A-Za-z]{14,16}:\s+ACCESS DENIED'), 'MSG_ID: ACCESS DENIED'),

    # QQ mail base64 tokens in brackets
    (re.compile(r'\[[A-Za-z0-9+/]{20,}[=]*\s+IP'), '[QQ_TOKEN IP'),

    # TT506/OFR session IDs before specific text
    (re.compile(r'\b[a-zA-Z0-9]{12,14}\s+(Recipient Invalid|Recipient Undeliverable|Adresse d)'), r'SESSION \1'),
]

# Patterns to normalize (not remove, just standardize)
NORMALIZE_PATTERNS = [
    # SMTP multiline to single line: "550-5.7.40" -> "550 5.7.40"
    # This handles unwrapped multiline SMTP responses
    (re.compile(r'^(\d{3})-'), r'\1 '),

    # Multiple spaces to single space
    (re.compile(r'  +'), ' '),

    # Multiple dashes/equals used as separators
    (re.compile(r'-{3,}'), '---'),
    (re.compile(r'={3,}'), '==='),
]


def anonymize_message(msg: str) -> str:
    """Apply all anonymization patterns to a message."""
    result = msg.strip()

    for pattern, replacement in PATTERNS:
        result = pattern.sub(replacement, result)

    for pattern, replacement in NORMALIZE_PATTERNS:
        result = pattern.sub(replacement, result)

    return result.strip()


def main():
    parser = argparse.ArgumentParser(
        description="Anonymize SMTP bounce messages by removing PII."
    )
    parser.add_argument(
        "--stdin",
        action="store_true",
        help="Read a single message from stdin, print anonymized version to stdout.",
    )
    parser.add_argument(
        "--input",
        type=str,
        help='Batch mode: input JSONL file ({"text": "..."} per line).',
    )
    parser.add_argument(
        "--output",
        type=str,
        help="Batch mode: output JSONL file.",
    )
    args = parser.parse_args()

    if args.stdin:
        message = sys.stdin.read()
        print(anonymize_message(message))
    elif args.input and args.output:
        count = 0
        with open(args.input, "r", encoding="utf-8") as fin, \
             open(args.output, "w", encoding="utf-8") as fout:
            for line in fin:
                line = line.strip()
                if not line:
                    continue
                data = json.loads(line)
                data["text"] = anonymize_message(data["text"])
                fout.write(json.dumps(data, ensure_ascii=False) + "\n")
                count += 1
        print(f"Anonymized {count:,} messages: {args.input} -> {args.output}")
    else:
        parser.error("Specify either --stdin or both --input and --output.")


if __name__ == "__main__":
    main()
