// Emits the judge_batch spec as JSON on stdout: states = per-variant contact-sheet
// images (blinded rows), questions = rubric scores. Used by the eval harness.
export const RUBRIC = {
  frag: { type: 'score', instructions: 'Rate fragmentation / busy edges: how many tiny contours, fiddly micro-edges, cluttered outlines. Higher = more fragmented.', criteria: ['very clean large masses', 'mostly clean', 'noticeably busy edges', 'severely fragmented'] },
  micro: { type: 'score', instructions: 'Rate micro-texture / micro-contrast: fine surface noise, fabric grain, speckle. Higher = more micro-texture.', criteria: ['flat clean shading', 'slight texture', 'visible micro-texture', 'heavy noisy micro-texture'] },
  ai: { type: 'score', instructions: 'Rate AI-look / plastic shine: waxy specular highlights, over-detailed default gpt-image look. Higher = stronger AI smell.', criteria: ['natural flat VN look', 'mild', 'noticeable plastic shine', 'strong AI look'] },
  shape: { type: 'score', instructions: 'Shape readability at thumbnail size: does the main subject read as a clear silhouette/mass? Higher = clearer.', criteria: ['muddled', 'somewhat readable', 'clear', 'very clear'] },
  fidelity: { type: 'score', instructions: 'Fidelity to the requested content (subject present, correct costume/scene elements, correct framing constraints). Higher = better.', criteria: ['major deviations', 'some deviations', 'mostly correct', 'fully correct'] },
  vn: { type: 'score', instructions: 'Usability as a visual-novel asset (background/CG/sprite) as-is: readability for text overlay or compositing, consistent style. Higher = more usable.', criteria: ['unusable', 'needs rework', 'usable with minor fixes', 'usable as-is'] },
}
