#!/usr/bin/env python3
"""
Label bounce messages by category for ML training.
"""

import argparse
import json
import re
from collections import Counter

# Category definitions with patterns (order matters - first match wins)
# More specific patterns should come before general ones

CATEGORIES = [
    # Virus/Malware (check early - specific)
    ('virus_detected', [
        r'virus',
        r'malware',
        r'infected',
        r'MBL_\d+\.UNOFFICIAL',
    ]),

    # Geographic blocking (specific)
    ('geo_blocked', [
        r'Geographic Region is Blocked',
        r'blocked.*country',
        r'Blocked.*Country',
        r'Blocked IP-Country',
        r'countries\.nerd\.dk',
        r'geographical location',
        r'geobl\.',
        r'GeoIP',
        r'\.ee\).*not accepted',
        r'\.io\).*not accepted',
        r'\.eu\).*not accepted',
        r'reject.*\.eu domain',
        r'reject.*\.ee domain',
        r'not accept.*from Estonia',
        r'not accept.*from Poland',
        r'codigo de pais',
    ]),

    # Authentication failures (DMARC/SPF/DKIM)
    ('auth_failure', [
        r'DMARC',
        r'dmarc',
        r'SPF.*fail',
        r'SPF.*reject',
        r'SPF.*validation',
        r'SPF.*permerror',
        r'spf.*none',
        r'DKIM.*fail',
        r'DKIM.*reject',
        r'bad DKIM',
        r'Unauthenticated email',
        r'not.*authenticated',
        r'authentication.*fail',
        r'Action set by DMARC',
        r'tls enforcement',
        r'TLS required',
        r'error during SPF',
    ]),

    # Mailbox full / over quota
    ('mailbox_full', [
        r'mailbox.*full',
        r'Mailbox full',
        r'over\s*quota',
        r'OverQuota',
        r'quota.*exceed',
        r'storage.*space',
        r'out of.*storage',
        r'user.*overquota',
        r'5\.2\.2',
        r'4\.2\.2',
        r'inbox is out of',
        r'Quota exceeded',
        r'storage allocation',
        r'exceeded storage',
        r'policy error.*delivery',
        r'delivery.*policy error',
    ]),

    # Mailbox disabled/inactive/suspended
    ('mailbox_disabled', [
        r'mailbox.*disabled',
        r'Mailbox disabled',
        r'account.*disabled',
        r'Account disabled',
        r'account.*suspended',
        r'account.*closed',
        r'Account Closed',
        r'mailbox.*blocked',
        r'mailbox.*inactive',
        r'blocked due to inactivity',
        r'user.*disabled',
        r'recipient.*suspended',
        r'Incoming suspended',
        r'no longer.*available',
        r'no longer.*valid',
        r'no longer on system',
        r'no longer on server',
        r'no longer.*use',
        r'recipient no longer',
        r'Account expired',
        r'is expired account',
        r'5\.2\.1.*disabled',
        r'5\.2\.1.*inactive',
        r'5\.2\.1.*suspended',
        r'5\.2\.1.*blocked',
        r'unused mailbox',
        r'not in service',
        r'domain.*not in service',
        r'[Rr]ecipient disabled',
        r'[Aa]ccount inactive',
    ]),

    # IP Blacklisted (RBL)
    ('ip_blacklisted', [
        r'blacklist',
        r'Blacklist',
        r'BLACKLIST',
        r'blocklist',
        r'Blocklist',
        r'block.*list',
        r'spamhaus',
        r'Spamhaus',
        r'SPAMHAUS',
        r'barracuda',
        r'Barracuda',
        r'BARRACUDA',
        r'zen\..*\.org',
        r'sbl.*\.org',
        r'xbl.*\.org',
        r'pbl.*\.org',
        r'cbl\.abuseat',
        r'sorbs\.net',
        r'SORBS',
        r'dnsbl',
        r'DNSBL',
        r'RBL',
        r'\.rbl\.',
        r'real-time black',
        r'Realtime Black',
        r'IP.*blocked',
        r'blocked.*IP',
        r'Client host.*blocked',
        r'host.*blocked',
        r'ipremoval\.sms\.symantec',
        r'Global Bad Sender',
        r'Symantec.*blocked',
        r'Cloudmark',
        r'cloudmark',
        r'invaluement',
        r'Invaluement',
        r'ivmSIP',
        r'ivmURI',
        r'ivmSED',
        r'hostkarma',
        r'truncate\.gbudb',
        r'FortiGuard.*black',
        r'reputation.*block',
        r'denylisted',
        r'ipcheck\.proofpoint',
        r'Intrusion prevention',
        r'QIL:.*trendmicro',
        r'ers\.trendmicro',
        r'Poor Reputation',
        r'Open HTTP proxy',
        r'spfbl\.net',
        r'matrix\.spfbl',
        r'Symantec Zodiac',
        r'5\.7\.1 black',
    ]),

    # Domain blacklisted (separate from IP)
    ('domain_blacklisted', [
        r'domain.*blocked',
        r'domain.*blacklist',
        r'domain.*reject',
        r'sender.*domain.*reject',
        r'dbl\.spamhaus',
        r'uri\..*invaluement',
        r'domain.*not accepted',
        r'denylisted.*domain',
    ]),

    # Greylisting (temporary)
    ('greylisting', [
        r'[Gg]reylisted',
        r'[Gg]raylisted',
        r'[Gg]rey\s*list',
        r'[Gg]ray\s*list',
        r'try again later',
        r'Try again later',
        r'please.*retry',
        r'retry.*later',
        r'come back later',
        r'come back in \d+',
        r'try later',
        r'essayer plus tard',
        r'later please',
        r'GL42',
        r'postgrey',
        r'temporarily deferring',
        r'[Dd]eferred',
    ]),

    # Rate limiting / throttling
    ('rate_limited', [
        r'rate.*limit',
        r'Rate.*limit',
        r'too many.*connection',
        r'Too many.*connection',
        r'too many.*session',
        r'Too many.*session',
        r'too many.*message',
        r'Too many.*message',
        r'too many.*error',
        r'throttl',
        r'Throttl',
        r'unusual rate',
        r'receiving.*too quickly',
        r'exceed.*limit',
        r'limit.*exceed',
        r'max.*connection',
        r'concurrent.*connection',
        r'slow down',
        r'Trop de connexions',
        r'user complaints',
        r'IPTS0',
        r'TSS0',
        r'TS01',
        r'4\.7\.28',
        r'LOAD_TOO_HIGH',
        r'No more parallel connections',
        r'reached capacity',
        r'overloaded',
        r'Too many.*recipient',
        r'too many incoming',
        r'exceeded.*transaction',
        r'4\.5\.3.*recipients',
        r'receiving mail at a rate',
        r'prevents additional messages',
        r'emailing is being verified',
        r'PFA agent busy',
        r'[Dd]omain frequency',
    ]),

    # Spam/Content blocked
    ('spam_blocked', [
        r'[Ss][Pp][Aa][Mm]',
        r'spam',
        r'Spam',
        r'SPAM',
        r'unsolicited',
        r'Unsolicited',
        r'content.*block',
        r'content.*reject',
        r'content.*filter',
        r'Content.*Block',
        r'Content.*filter',
        r'filter.*reject',
        r'message.*block',
        r'message.*reject',
        r'mail.*reject',
        r'blocked.*spam',
        r'rejected.*spam',
        r'spam.*reject',
        r'spam.*block',
        r'spam.*detect',
        r'detected.*spam',
        r'appears.*spam',
        r'looks.*spam',
        r'suspect.*spam',
        r'UCE.*policy',
        r'junk.*mail',
        r'bulk.*email',
        r'Pattern.*filter',
        r'Phrase.*Filter',
        r'URL.*Filter',
        r'phone.*filter',
        r'expurgat',
        r'spamassassin',
        r'SpamAssassin',
        r'magicspam',
        r'MagicSpam',
        r'scored.*spam',
        r'spam.*score',
        r'Local Policy Violation',
        r'Policy Violation',
        r'policy.*spam',
        r'DT:SPM',
        r'[Mm]ailshot.*mail',
        r'deliver to primary MX',
        r'[Mm]ensaje rechazado',
        r'[Aa]ttached file',
        r'[Mm]essage contains',
        r'[Mm]ail content',
        r'[Ss]uspected bounce',
        r'[Ss]piked',
        r'5\.2\.3.*[Mm]essage',
        r'[Mm]essage size',
        r'black.*from sender',
        r'CriticalCtrl.*sender',
        r'sender not in.*contacts',
        r'sender not in.*white',
    ]),

    # Relay denied
    ('relay_denied', [
        r'[Rr]elay.*denied',
        r'[Rr]elay.*not.*permit',
        r'[Rr]elay.*not.*allow',
        r'[Rr]elaying.*denied',
        r'[Rr]elaying.*not.*permit',
        r'not.*relay',
        r'Unable to relay',
        r'5\.4\.4.*relay',
        r'Relay access denied',
        r'We do not relay',
        r'use me.*as a relay',
        r'trying to use me',
    ]),

    # Server errors / unavailable
    ('server_error', [
        r'[Ss]ervice.*unavailable',
        r'[Ss]erver.*unavailable',
        r'[Ss]erver.*busy',
        r'[Ss]ervice.*busy',
        r'[Ss]ystem.*unavailable',
        r'[Tt]emporary.*error',
        r'[Tt]emporary.*fail',
        r'[Tt]emporarily.*unavailable',
        r'[Tt]emporarily.*offline',
        r'[Cc]onnection.*timeout',
        r'[Cc]onnection.*timed out',
        r'[Cc]onnection.*refused',
        r'[Cc]onnection.*error',
        r'[Cc]onnection.*lost',
        r'[Tt]imeout',
        r'timed out',
        r'closing.*connection',
        r'closing.*channel',
        r'[Nn]etwork.*error',
        r'[Ll]ocal.*error',
        r'[Ss]ystem.*error',
        r'[Ii]nternal.*error',
        r'4\.3\.',
        r'4\.4\.',
        r'LDAP.*unavailable',
        r'[Uu]pload failed',
        r'processing.*timeout',
        r'downstream.*connection',
        r'[Ss]ystem.*[Pp]roblem',
        r'No system resources',
        r'ports.*busy',
        r'license.*expired',
        r'too much load',
        r'lost input connection',
        r'[Oo]ffline',
        r'[Ss]ervice not available',
        r'DNS error',
        r'DNS.*fail',
        r'[Rr]equest aborted',
        r'[Cc]annot convert name',
        r'server.*refused query',
        r'general failure',
        r'[Rr]ead-only file system',
        r'ERR\.LOGIN',
        r'[Ee]rror connecting',
        r'ECONNRESET',
        r'socket close',
        r'socket disconnected',
        r'Greeting never received',
        r'[Ff]ailed to process',
        r'[Ff]ailed to store',
        r'[Ee]rror in processing',
        r'[Ee]rror processing',
        r'[Ll]ocal problem',
        r'Maximum call stack',
        r'offset.*out of bounds',
        r'duplicate key error',
        r'Could not load DRD',
        r'Unable to process',
        r'[Mm]alfunction',
        r'smarthost.*found',
        r'local host',
        r'weird connection',
        r'[Aa]borted.*action',
        r'[Rr]equested action aborted',
        r'sender verify callout',
        r'4\.0\.0',
        r'4\.5\.0',
        r'4\.6\.0',
        r'delivery error',
        r'transaction incomplete',
        r'No SMTPd',
        r'Could not.*destination',
        r'Could not deliver',
        r'[Tt]imedouts',
        r'Backup MX',
        r'STARTTLS.*repeated',
        r'UnicodeEncodeError',
        r'Unimplemented command',
        r'Unrecognized command',
        r'Not implemented',
        r'RCPT first',
        r'MAIL first',
        r'EHLO.*first',
        r'HELO.*first',
        r'502 ',
        r'503 ',
    ]),

    # Invalid address/domain
    ('invalid_address', [
        r'[Dd]omain.*not found',
        r'[Dd]omain.*not.*exist',
        r'[Dd]omain.*invalid',
        r'[Ii]nvalid.*domain',
        r'[Ii]nvalid.*address',
        r'[Ii]nvalid.*recipient',
        r'[Ii]nvalid.*mailbox',
        r'[Bb]ad.*destination',
        r'[Bb]ad.*address',
        r'[Bb]ad.*syntax',
        r'address.*syntax',
        r'5\.1\.2',
        r'5\.1\.3',
        r'5\.1\.8',
        r'Unknown host',
        r'unrouteable',
        r'not.*local',
        r'cannot find.*hostname',
        r'reverse hostname',
        r'blank.*TXT record',
        r'zero aliases',
        r'forwarding address.*upgrade',
        r'[Dd]oes not resolve',
        r'[Dd]omain of sender.*does not resolve',
        r'4\.1\.8',
        r'[Ee]rror checking reverse',
        r'MX.*does not.*valid',
        r'[Ss]yntax error',
        r'501 ',
        r'5\.6\.0.*[Ii]nvalid',
        r'[Mm]essage format.*invalid',
        r'bad chars',
        r'[Ll]ine too long',
        r'MX Record.*not redirect',
        r'Bad Input',
    ]),

    # Policy blocked (general - catch remaining policy issues)
    ('policy_blocked', [
        r'[Pp]olicy.*reject',
        r'[Pp]olicy.*refuse',
        r'[Pp]olicy.*block',
        r'[Pp]olicy.*denied',
        r'[Pp]olicy.*restriction',
        r'[Rr]ejected.*policy',
        r'[Bb]locked.*policy',
        r'[Aa]ccess.*denied',
        r'[Aa]ccess.*refused',
        r'[Nn]ot.*allowed',
        r'[Nn]ot.*permitted',
        r'[Nn]ot.*authorized',
        r'[Pp]ermission.*denied',
        r'[Cc]ommand.*rejected',
        r'[Ss]ender.*rejected',
        r'[Ss]ender.*denied',
        r'[Ss]ender.*blocked',
        r'not configured to use',
        r'Rule imposed',
        r'Filter Rule',
        r'AUP#',
        r'SMTP protocol violation',
        r'RFC.*violation',
        r'permanent failure',
        r'5\.7\.1 This domain',
        r'[Aa]dministrative prohibition',
        r'5\.7\.0 Reject',
        r'5\.0\.0 Blocked',
        r'Must issue.*STARTTLS',
    ]),

    # User unknown / not found (general - should be near end)
    ('user_unknown', [
        r'[Uu]ser.*[Uu]nknown',
        r'[Uu]nknown.*[Uu]ser',
        r'[Uu]ser.*not.*found',
        r'[Uu]ser.*not.*exist',
        r'[Uu]ser.*invalid',
        r'[Nn]o such user',
        r'[Nn]o such mailbox',
        r'[Nn]o such recipient',
        r'[Nn]o such person',
        r'[Rr]ecipient.*unknown',
        r'[Uu]nknown.*recipient',
        r'[Rr]ecipient.*not.*found',
        r'[Rr]ecipient.*not.*exist',
        r'[Rr]ecipient.*invalid',
        r'[Rr]ecipient.*rejected',
        r'[Mm]ailbox.*unknown',
        r'[Mm]ailbox.*not.*found',
        r'[Mm]ailbox.*not.*exist',
        r'[Mm]ailbox.*unavailable',
        r'[Mm]ailbox.*does not exist',
        r'[Aa]ccount.*not.*found',
        r'[Aa]ccount.*not.*exist',
        r'[Aa]ddress.*unknown',
        r'[Aa]ddress.*not.*found',
        r'[Aa]ddress.*rejected',
        r'[Aa]ddress.*invalid',
        r'[Ii]nvalid.*recipient',
        r'does not exist',
        r'doesn\'t exist',
        r'not exist',
        r'not found',
        r'[Uu]ndeliverable',
        r'[Uu]nverified.*address',
        r'[Vv]erification.*fail',
        r'5\.1\.1',
        r'5\.1\.10',
        r'5\.4\.1.*[Aa]ccess denied',
        r'User Unknown',
        r'Utilisateur inconnu',
        r'Unbekannter Benutzer',
        r'[Uu]ser doesn\'t exist',
        r'[Uu]ser does not exist',
        r'email.*not.*found',
        r'SITEGROUND.*No Such User',
        r'No Such User',
        r'[Uu]nable to verify.*recipient',
        r'[Vv]erify.*recipient',
        r'[Nn]ot verified',
        r'[Uu]nable to verify user',
        r'verifying address',
        r'[Vv]erification error',
        r'553 sorry',
        r'[Uu]nknown local-part',
        r'[Nn]o existe',
        r'[Ww]e don\'t know',
        r'don\'t know.*user',
        r'sorry, that domain',
        r'sorry, that address',
        r'5\.0\.0.*<MSG_ID>',
        r'[Uu]nknown account',
        r'[Ww]e don\'t accept',
        r'No such.*account',
    ]),

    # Catch-all for generic rejections (very last)
    ('policy_blocked', [
        r'^[45]\d\d\s+rejected$',
        r'^\d{3}\s+[A-Za-z0-9_-]+$',  # Just error code and session ID
    ]),
]

def classify_message(text: str) -> str:
    """Classify a bounce message into a category."""
    for category, patterns in CATEGORIES:
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return category
    return 'unknown'


def main():
    parser = argparse.ArgumentParser(
        description="Label bounce messages by category for ML training."
    )
    parser.add_argument(
        "--input",
        type=str,
        default="../data/community_labeled.jsonl",
        help='Input JSONL file ({"text": "..."} per line). Default: ../data/community_labeled.jsonl',
    )
    parser.add_argument(
        "--output",
        type=str,
        default="output/labeled.jsonl",
        help="Output JSONL file with labels. Default: output/labeled.jsonl",
    )
    args = parser.parse_args()

    # Load messages
    print(f"Loading messages from {args.input}...")
    messages = []
    with open(args.input, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            messages.append(data["text"])

    print(f"Loaded {len(messages):,} messages")

    # Classify each message
    print("\nClassifying messages...")
    labeled = []
    category_counts = Counter()

    for msg in messages:
        category = classify_message(msg)
        labeled.append({"text": msg, "label": category})
        category_counts[category] += 1

    # Save labeled dataset
    print(f"\nSaving labeled dataset to {args.output}")
    with open(args.output, "w", encoding="utf-8") as f:
        for item in labeled:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    # Print statistics
    print("\n" + "=" * 70)
    print("LABELING STATISTICS")
    print("=" * 70)

    total = len(messages)
    print(f"\nTotal messages: {total:,}\n")
    print(f"{'Category':<25} {'Count':>8} {'Percentage':>12}")
    print("-" * 50)

    for category, count in category_counts.most_common():
        pct = count / total * 100
        print(f"{category:<25} {count:>8,} {pct:>11.1f}%")

    # Show samples of each category
    print("\n" + "=" * 70)
    print("SAMPLE MESSAGES PER CATEGORY")
    print("=" * 70)

    # Group messages by category
    by_category = {}
    for item in labeled:
        cat = item["label"]
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(item["text"])

    for category, _ in category_counts.most_common():
        msgs = by_category[category]
        print(f"\n--- {category} ({len(msgs)} messages) ---")
        # Show up to 3 samples
        for msg in msgs[:3]:
            display = msg[:100] + "..." if len(msg) > 100 else msg
            print(f"  {display}")

    # Show unknown messages for review
    if "unknown" in by_category:
        print("\n" + "=" * 70)
        print("UNKNOWN MESSAGES (need manual review)")
        print("=" * 70)
        for msg in by_category["unknown"][:20]:
            display = msg[:120] + "..." if len(msg) > 120 else msg
            print(f"  {display}")


if __name__ == "__main__":
    main()
