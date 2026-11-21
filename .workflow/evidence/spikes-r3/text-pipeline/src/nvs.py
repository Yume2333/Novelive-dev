"""Mechanical .nvs parser per docs/work-format.md + handoff-defaults M1a 指令全集.

Line grammar (documented + example-derived):
  scene <title>            scene header, first non-blank line of a scene file
  source pNNNN[-pNNNN]     paragraph range
  @cmd [arg ...]           staging command, key/value space separated
  <asset>[ (inner)][ as <display>][ (...extras)]: <text> [#id] [cont]
  : <text>                 narration
Inline tags: {em|b|dim|whisper|shout|glitch|hl|custom}...{/tag}, {ruby x}..{/ruby},
             {wait N}, {speed N}..{/speed}; literal {{.
"""
import re, json

# command table from handoff-defaults M1a + docs examples; (kind, args)
COMMANDS = {
    'bg':       ('setting', ['asset', '?transition', '?duration']),
    'fg':       ('setting', ['asset']),
    'show':     ('setting', ['asset', 'slot']),
    'hide':     ('setting', ['slot']),
    'move':     ('setting', ['slot', 'target', '?easing', '?duration']),
    'face':     ('setting', ['asset']),
    'costume':  ('setting', ['asset']),
    'cg':       ('setting', ['asset']),
    'camera':   ('setting', ['?target', '?zoom', '?duration']),
    'shake':    ('setting', ['?strength', '?duration']),
    'zoom':     ('setting', ['value', '?duration']),
    'particle': ('setting', ['name', '?intensity', '?speed', '?angle']),
    'mask':     ('setting', ['spec']),
    'filter':   ('setting', ['name', '?value']),
    'caption':  ('text-ish', ['text...', '?wait']),
    'wait':     ('text-ish', ['?seconds']),
}
TRANSITIONS = {'fade','dissolve','wipe-left','wipe-right','wipe-up','wipe-down','slide','push','iris','zoom','none'}
EASINGS = {'linear','ease','ease-in','ease-out','ease-in-out'}
BUILTIN_TAGS = {'em','b','dim','whisper','shout','glitch','hl','ruby','wait','speed'}
SLOTS = {'left','center','right','far-left','far-right'}

ASSET_RE = re.compile(r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:/[a-z0-9-]+){0,3}$')
SENT_ID_RE = re.compile(r'#[0-9a-f]{4}$')

class Diag:
    def __init__(s, code, line, col, message, hint=''):
        s.code, s.line, s.col, s.message, s.hint = code, line, col, message, hint
    def __repr__(s):
        return f"{s.line}:{s.col} {s.code} {s.message}" + (f" (hint: {s.hint})" if s.hint else '')

SPEAKER_RE = re.compile(r"^(?P<asset>[a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\s*\((?P<paren>[^)]*)\))?(?:\s+as\s+(?P<alias>.+?))?\s*:\s*(?P<text>.*)$")

def parse_inline(text, lineno, diags, custom_tags=None):
    """Validate inline tag balance/arity; return list of tags used."""
    tags = set()
    # literal {{ handled by scanning
    stack = []
    i = 0
    while i < len(text):
        c = text[i]
        if c == '{':
            if i + 1 < len(text) and text[i+1] == '{':
                i += 2; continue
            m = re.match(r'\{(/[a-zA-Z][a-zA-Z0-9-]*|[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^}]*)?)\}', text[i:])
            if not m:
                diags.append(Diag('E_TAG_SYNTAX', lineno, i+1, f'unclosed or malformed tag near {text[i:i+16]!r}'))
                return tags
            inner = m.group(1)
            i += m.end()
            if inner.startswith('/'):
                name = inner[1:]
                if not stack or stack[-1] != name:
                    diags.append(Diag('E_TAG_MISMATCH', lineno, i, f'closing {{/{name}}} without open'))
                else:
                    stack.pop()
                continue
            name, _, arg = inner.partition(' ')
            name = name.strip()
            tags.add(name)
            if name == 'wait':
                stack.append(('WAIT_ATOM',))  # wait is an atom: we won't expect closing; treat specially
                stack.pop()
                if not arg or not re.match(r'^\d+(\.\d+)?$', arg.strip()):
                    diags.append(Diag('E_TAG_ARG', lineno, i, '{wait} needs numeric seconds'))
                continue
            if name == 'ruby' and not arg:
                diags.append(Diag('E_TAG_ARG', lineno, i, '{ruby} needs reading'))
            if name == 'speed' and (not arg or not re.match(r'^\d+(\.\d+)?$', arg.strip())):
                diags.append(Diag('E_TAG_ARG', lineno, i, '{speed} needs numeric factor'))
            if name not in BUILTIN_TAGS and (custom_tags is None or name not in custom_tags):
                diags.append(Diag('W_TAG_UNKNOWN', lineno, i, f'unknown tag {name!r} (custom tags must be registered)'))
            stack.append(name)
        elif c == '}':
            diags.append(Diag('E_TAG_SYNTAX', lineno, i+1, 'stray }'))
            i += 1
        else:
            i += 1
    for name in stack:
        if name != 'WAIT_ATOM':
            diags.append(Diag('E_TAG_UNCLOSED', lineno, len(text), f'{{{name}}} not closed'))
    return tags

def parse_scene(text, max_pid=None, known_assets=None, custom_tags=None):
    """Parse one scene file. Returns (scene, diags, usage)."""
    diags = []
    lines = text.split('\n')
    scene = {'title': None, 'source': None, 'items': [], 'tags': set(), 'assets_used': set(), 'commands': []}
    seen_header = 0
    for i, raw in enumerate(lines, start=1):
        line = raw.rstrip()
        if not line.strip():
            continue
        if line.startswith('scene '):
            if scene['title'] is not None:
                diags.append(Diag('E_SCENE_DUP', i, 1, 'second scene header in one file'))
            scene['title'] = line[6:].strip()
            seen_header += 1
            continue
        if line.startswith('source '):
            if scene['source'] is not None:
                diags.append(Diag('E_SOURCE_DUP', i, 1, 'second source line'))
            spec = line[7:].strip()
            m = re.match(r'^p(\d{4})(?:-p(\d{4}))?$', spec)
            if not m:
                diags.append(Diag('E_SOURCE_SYNTAX', i, 1, f'source range {spec!r} not pNNNN[-pNNNN]'))
            else:
                a = int(m.group(1)); b = int(m.group(2) or m.group(1))
                if a > b:
                    diags.append(Diag('E_SOURCE_ORDER', i, 1, f'source range reversed {spec}'))
                if max_pid and b > max_pid:
                    diags.append(Diag('E_SOURCE_RANGE', i, 1, f'source p{b:04d} beyond chapter end p{max_pid:04d}'))
                scene['source'] = (a, b)
            continue
        if scene['title'] is None:
            diags.append(Diag('E_SCENE_MISSING', i, 1, 'content before scene header'))
        if line.startswith('@'):
            body = line[1:]
            cmd, _, argstr = body.partition(' ')
            args = argstr.split() if argstr else []
            if cmd not in COMMANDS:
                diags.append(Diag('E_CMD_UNKNOWN', i, 1, f'unknown command @{cmd}', hint='指令全集见 M1a 语法表'))
                scene['commands'].append((cmd, args, i))
                continue
            kind, spec = COMMANDS[cmd]
            req = [s for s in spec if not s.startswith('?')]
            if len(args) < len(req):
                diags.append(Diag('E_CMD_ARITY', i, 1, f'@{cmd} needs {len(req)} args, got {len(args)}'))
            # asset check for asset-bearing commands
            if cmd in ('bg','fg','show','face','costume','cg') and args:
                asset = args[0]
                if not ASSET_RE.match(asset):
                    diags.append(Diag('E_ASSET_SYNTAX', i, 1, f'asset {asset!r} not lowercase-name/segments'))
                else:
                    scene['assets_used'].add(asset)
                    if known_assets is not None and asset not in known_assets:
                        diags.append(Diag('W_ASSET_UNKNOWN', i, 1, f'asset {asset!r} not registered'))
            if cmd == 'show' and len(args) >= 2 and args[1] not in SLOTS and not re.match(r'^\d', args[1]):
                diags.append(Diag('W_SLOT', i, 1, f'slot {args[1]!r} not in {sorted(SLOTS)}'))
            if cmd == 'particle' and args and args[0] not in ('rain','snow','sakura','none'):
                diags.append(Diag('W_PARTICLE', i, 1, f'particle {args[0]!r} not builtin'))
            if cmd == 'filter' and args and args[0] not in ('blur','brightness','sepia','glitch','none'):
                diags.append(Diag('W_FILTER', i, 1, f'filter {args[0]!r} not builtin'))
            if cmd in ('bg','move','camera') :
                for a in args[1:]:
                    if a in TRANSITIONS or a in EASINGS or a in SLOTS: continue
                    if re.match(r'^\d+(\.\d+)?$', a): continue
                    if re.match(r'^[a-z]+$', a):
                        diags.append(Diag('W_ARG', i, 1, f'@{cmd} arg {a!r} unknown word'))
            scene['commands'].append((cmd, args, i))
            scene['items'].append(('cmd', cmd, args))
            continue
        # text line
        is_narr = line.startswith(': ')
        m = SPEAKER_RE.match(line) if not is_narr else None
        if is_narr:
            textpart = line[2:]
            sp = {'type': 'narr', 'asset': None, 'inner': False, 'alias': None}
        elif m:
            sp = {'type': 'line', 'asset': m.group('asset'), 'inner': False,
                  'alias': m.group('alias'), 'paren': m.group('paren')}
            if sp['paren']:
                for tok in sp['paren'].split():
                    if tok == 'inner':
                        sp['inner'] = True
                    else:
                        diags.append(Diag('W_PAREN', i, 1, f'unknown speaker modifier ({tok})'))
            scene['assets_used'].add(sp['asset'])
            if known_assets is not None and sp['asset'] not in known_assets:
                diags.append(Diag('W_ASSET_UNKNOWN', i, 1, f'speaker asset {sp["asset"]!r} not registered'))
            textpart = m.group('text')
        else:
            diags.append(Diag('E_LINE_SYNTAX', i, 1, f'line matches neither speaker, narration, nor command: {line[:60]!r}'))
            continue
        cont = False
        sid = None
        tail = textpart.rsplit(' ', 1)
        if len(tail) == 2 and tail[1] == 'cont':
            cont = True; textpart = tail[0]
        mm = re.search(r'\s#([0-9a-f]{4})$', textpart)
        if mm:
            sid = mm.group(1); textpart = textpart[:mm.start()]
        tags = parse_inline(textpart, i, diags, custom_tags)
        scene['tags'] |= tags
        scene['items'].append(('text', sp, textpart.strip(), sid, cont))
    return scene, diags

def coverage_report(scenes, max_pid):
    """Acceptance: every normalized paragraph covered exactly once across scenes."""
    covered = {}
    for sc in scenes:
        if sc['source']:
            a, b = sc['source']
            for p in range(a, b + 1):
                covered.setdefault(p, []).append(sc['title'])
    missing = [p for p in range(1, max_pid + 1) if p not in covered]
    multi = {p: t for p, t in covered.items() if len(t) > 1}
    return {'missing': missing, 'multi': multi, 'covered': len(covered), 'total': max_pid}
