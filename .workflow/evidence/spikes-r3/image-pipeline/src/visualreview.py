"""Build judge inputs for visual review of sprites & expressions.
Run via the eval kernel: supplies image lists + questions, returns verdicts."""
import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from visualcheck import crop_face, paste_on, subject_stats

G = os.path.join(os.path.dirname(__file__), '..', 'gen')
W = os.path.join(os.path.dirname(__file__), '..', 'work')

def review_payload(base_png, cand_png, anchors, keep, expect_expr=None, tag=''):
    """Produce {images, state} for judge() visual review.
    images: [base-face, cand-face, cand-full-on-white]
    """
    bf = os.path.join(W, f'vrb-{tag}.png')
    cf = os.path.join(W, f'vrc-{tag}.png')
    full = os.path.join(W, f'vfull-{tag}.png')
    crop_face(base_png, bf)
    crop_face(cand_png, cf)
    paste_on(cand_png, full)
    st = {
        'task': 'expression derivation review' if expect_expr else 'sprite base review',
        'anchors that MUST survive': anchors,
        'features that MUST stay identical (keep-list)': keep,
        'expected change': expect_expr or 'outfit base, calm face',
        'note': 'Image 1 is the base sprite face crop; image 2 is the candidate face crop; image 3 is the candidate sprite pasted on a light background. Judge identity, anchors, framing, description match, style, artifacts.',
    }
    return {'images': [bf, cf, full], 'state': st}
