// spikes-r4/genshin-style prompts.
// Every call is images.edit with ref/kokomi-torino-white.png as Image 1.
// Prompt = role line + content paragraph (+ framing line for sprites).
// Arm A = base; arm B = arm A + RENDER block as the final line.

export const ROLE_BASE =
  'Image 1 is the style reference: draw in exactly the same art style, line quality, coloring, shading and level of detail.'
export const ROLE_KOKOMI =
  ' The character in Image 1 is Sangonomiya Kokomi; keep her face and hair the same.'
export const ROLE_OTHER =
  ' Do not copy the character in Image 1.'
export const FRAME_SPRITE =
  'Framing: from the top of the head to just above the knees, legs cut off by the bottom edge; character centered; fully transparent background, no ground or shadow.'
export const RENDER =
  'large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights'

// Kokomi appearance, reused across assets so prompts do not rely on the name alone.
const KOKOMI =
  'Sangonomiya Kokomi, a girl with long pink-peach hair fading to blue tips, a large bow with blue fish-fin ornaments on the back of her head, small fin-like accessories at her temples, clear violet-blue eyes and a gentle face,'

// size + transparent flag per asset; `group` assets take extra ref images.
export const ASSETS = {
  // ---- Kokomi (same character as the reference) ----
  K1: { size: '1024x1536', transparent: true },
  K2: { size: '1024x1536', transparent: true },
  K3: { size: '1536x864' },
  K4: { size: '1536x864' },
  K5: { size: '1536x864' },
  K6: { size: '1536x864' },
  K7: { size: '1536x864' },
  K8: { size: '1536x864' },
  // ---- Other Genshin characters, sprites ----
  C1: { size: '1024x1536', transparent: true },
  C2: { size: '1024x1536', transparent: true },
  C3: { size: '1024x1536', transparent: true },
  C4: { size: '1024x1536', transparent: true },
  C5: { size: '1024x1536', transparent: true },
  C6: { size: '1024x1536', transparent: true },
  C7: { size: '1024x1536', transparent: true },
  C8: { size: '1024x1536', transparent: true },
  // ---- Group CGs (run after sprites; Image 2+ = that arm's C-sprites) ----
  G1: { size: '1536x864', group: ['C1'] },
  G2: { size: '1536x864', group: ['C2', 'C3'] },
}

export const GROUP_ROLES = {
  G1: "Image 2 is Raiden Shogun's character sheet; keep her design.",
  G2: "Image 2 is Nahida's character sheet; keep her design. Image 3 is Furina's character sheet; keep her design.",
}

export const CONTENT = {
  K1:
    'A full standing sprite of ' + KOKOMI + ' wearing the same outfit as in Image 1: ' +
    'the pale lavender long-sleeved blouse with a ruffled front and collar bow, the dark violet-blue pleated skirt with dark blue ribbon bows and a fabric belt, the mauve saddle bag with braided strap and seashell charms. ' +
    'She stands with both hands clasped behind her back, a gentle closed-lip smile, head straight.',
  K2:
    'A full standing sprite of ' + KOKOMI + ' wearing her canonical Divine Priestess of Watatsumi outfit: ' +
    'an off-shoulder white, blue and purple frilled mini-dress with layered skirt panels, sheer detached sleeves, pearl and seashell ornaments, a golden hairpin, white thigh-high stockings and blue sandals; a glossy blue-purple gradient on the inner skirt like deep seawater. Calm standing pose, arms relaxed, gentle smile.',
  K3:
    'A CG close-up bust illustration of ' + KOKOMI + ' in her priestess outfit, ' +
    'surprised expression: eyes wide, eyebrows raised, small mouth slightly open, a faint blush; she is indoors in soft warm evening light, slight head tilt toward the viewer, shoulders and head filling the frame.',
  K4:
    'A CG illustration of ' + KOKOMI + ' in her priestess outfit sitting on dark rocks at a beach at sunset: ' +
    'legs folded to one side, one hand resting on the rock, the other holding a strand of hair; gentle waves breaking behind her, orange-pink sky with scattered clouds reflected on wet sand, warm rim light on her hair.',
  K5:
    'A CG illustration of ' + KOKOMI + ' in her priestess outfit sitting at a lacquered desk inside the coral-lit underwater Sangonomiya Shrine: ' +
    'leaning over an unrolled strategy map with brush in hand, scrolls and books stacked beside her; outside the round windows, deep blue water, drifting fish and glowing coral light fill the room with a soft cyan-violet glow.',
  K6:
    'A CG illustration of ' + KOKOMI + ' in her priestess outfit standing in an Inazuma town street at night in the rain: ' +
    'she holds a traditional paper umbrella, wet stone pavement reflecting red paper lanterns and shop lights, wooden row houses, fine rain streaks visible in the lantern glow, quiet lonely mood.',
  K7:
    'A dynamic battle CG of ' + KOKOMI + ' in her priestess outfit summoning a glowing water jellyfish: ' +
    'arms raised mid-incantation, hair and skirt flowing, rings of water swirling around her, translucent jellyfish rising above her palm scattering droplets and bubbles, splashes and light refraction everywhere, dramatic low-angle composition.',
  K8:
    'A background-only illustration of Watatsumi Island shrine scenery with no people: ' +
    'the Sangonomiya Shrine terrace with white-and-purple architecture overlooking the sea, giant pink coral formations and seashell-shaped rocks, waterfalls spilling into shallow pools, distant blue islands and a bright sky with soft clouds, pearlescent underwater light patterns on the stone.',
  C1:
    'A full standing sprite of Raiden Shogun: long dark-purple hair in a low braid reaching her knees, violet eyes, a purple flower hairpin and golden fan ornament; ' +
    'she wears a purple-and-white kimono with short hem, a wide crimson obi with golden cords and tassels, dark thigh-high stockings, and holds one hand over her chest; serene, stern expression.',
  C2:
    'A full standing sprite of Nahida: a small girl with shoulder-length white hair in a side ponytail tipped with green, cross-shaped pupils in bright green eyes, pointed elf ears; ' +
    'she wears a white-and-green layered dress with gold trim, a large green leaf-patterned cape, white bloomers and gold anklets, one hand raised near her chest, gentle curious smile.',
  C3:
    'A full standing sprite of Furina: medium-length white hair with light-blue streaks in a wavy bob topped by a small tilted top hat, heterochromatic eyes (one light blue, one deep blue with a droplet pupil); ' +
    'she wears a navy-and-white formal tailcoat jacket with gold trim, white ruffled shirt, blue bow tie, black shorts, asymmetric stockings and white gloves, one hand on her hip in a confident theatrical pose.',
  C4:
    'A full standing sprite of Ganyu: long pale-blue hair with a darker blue gradient, purple-to-amber eyes, red-and-black goat horns curved back from her head; ' +
    'she wears a black-and-gold bodysuit under a white sleeveless tailcoat-like top with blue tassels, a golden bell on a red cord at her neck, detached white sleeves and high heels, hands folded in front, shy calm expression.',
  C5:
    'A full standing sprite of Hu Tao: long dark-brown twin-tails, bright red plum-blossom-shaped pupils, a black pork-pie hat with a red blossom and plum-branch pin; ' +
    'she wears a dark-brown traditional short coat with red and gold trim and coattails, black shorts, white knee socks and black shoes, beaded bracelets, mischievous grin with one hand raised.',
  C6:
    'A full standing sprite of Kamisato Ayaka: long silver-blue hair in a high ponytail tied with a dark blue band, blunt bangs, blue-gray eyes; ' +
    'she wears a blue-and-white armored dress with gold trim, a wide pleated skirt with a fan motif, armored chest plate and vambraces, a red cord tied at her chest, holding a closed folding fan at her side, composed gentle smile.',
  C7:
    'A full standing sprite of Zhongli: a tall man with long dark-brown hair in a low ponytail fading to amber at the tip, amber eyes, diamond-shaped white earring; ' +
    'he wears an elegant dark-brown and gold formal coat with a high collar, layered tails with a dragon-scale pattern, black gloves and dark trousers, arms crossed calmly, dignified composed face.',
  C8:
    'A full standing sprite of Kaedehara Kazuha: shoulder-length white hair tied in a low ponytail with a single red streak, red eyes; ' +
    'he wears a black-and-red samurai outfit: half-open haori over a dark kimono top, one shoulder armored, maple-leaf patterned scarf, bandaged forearm, loose dark trousers and sandals, relaxed stance with a soft thoughtful expression.',
  G1:
    'A CG illustration inside the Tenshukaku throne hall in Inazuma: ' + KOKOMI + ' wearing her priestess outfit, and Raiden Shogun standing facing each other a few steps apart in formal audience, ' +
    'Kokomi bowing slightly, the Shogun composed; vast dark-wood hall with sliding screens, candles and banners, light falling through tall windows, tense ceremonial atmosphere.',
  G2:
    'A CG illustration of ' + KOKOMI + ' wearing her priestess outfit, Nahida and Furina having tea together in a bright garden: ' +
    'a low table with a teapot, cups and pastries on a cloth under a flowering tree, petals drifting, the three seated on cushions chatting pleasantly, soft afternoon light through leaves.',
}

// name-removed content for the moderation retry path (same scene, no proper nouns).
const nr = (s) =>
  s
    .replace(/Sangonomiya Kokomi, a girl with/g, 'the girl from Image 1, with')
    .replace(/Sangonomiya Shrine/g, 'a coral-lit underwater shrine')
    .replace(/Watatsumi Island/g, 'an island')
    .replace(/an Inazuma town/g, 'a Japanese-style town')
    .replace(/the Tenshukaku throne hall in Inazuma/g, 'a grand throne hall in a Japanese-style castle')
export const CONTENT_NONAME = {
  K1: nr(CONTENT.K1),
  K2: nr(CONTENT.K2),
  K3: nr(CONTENT.K3),
  K4: nr(CONTENT.K4),
  K5: nr(CONTENT.K5),
  K6: nr(CONTENT.K6),
  K7: nr(CONTENT.K7),
  K8: nr(CONTENT.K8),
  C1: 'A full standing sprite of a regal woman: long dark-purple hair in a low braid reaching her knees, violet eyes, a purple flower hairpin and golden fan ornament; she wears a purple-and-white kimono with short hem, a wide crimson obi with golden cords and tassels, dark thigh-high stockings, and holds one hand over her chest; serene, stern expression.',
  C2: 'A full standing sprite of a small girl with shoulder-length white hair in a side ponytail tipped with green, cross-shaped pupils in bright green eyes, pointed elf ears; she wears a white-and-green layered dress with gold trim, a large green leaf-patterned cape, white bloomers and gold anklets, one hand raised near her chest, gentle curious smile.',
  C3: 'A full standing sprite of a girl with medium-length white hair with light-blue streaks in a wavy bob topped by a small tilted top hat, heterochromatic eyes (one light blue, one deep blue with a droplet pupil); she wears a navy-and-white formal tailcoat jacket with gold trim, white ruffled shirt, blue bow tie, black shorts, asymmetric stockings and white gloves, one hand on her hip in a confident theatrical pose.',
  C4: 'A full standing sprite of a girl with long pale-blue hair with a darker blue gradient, purple-to-amber eyes, red-and-black goat horns curved back from her head; she wears a black-and-gold bodysuit under a white sleeveless tailcoat-like top with blue tassels, a golden bell on a red cord at her neck, detached white sleeves and high heels, hands folded in front, shy calm expression.',
  C5: 'A full standing sprite of a girl with long dark-brown twin-tails, bright red flower-shaped pupils, a black pork-pie hat with a red blossom pin; she wears a dark-brown traditional short coat with red and gold trim and coattails, black shorts, white knee socks and black shoes, beaded bracelets, mischievous grin with one hand raised.',
  C6: 'A full standing sprite of a girl with long silver-blue hair in a high ponytail tied with a dark blue band, blunt bangs, blue-gray eyes; she wears a blue-and-white armored dress with gold trim, a wide pleated skirt with a fan motif, armored chest plate and vambraces, a red cord at her chest, holding a closed folding fan at her side, composed gentle smile.',
  C7: 'A full standing sprite of a tall man with long dark-brown hair in a low ponytail fading to amber at the tip, amber eyes, a diamond-shaped white earring; he wears an elegant dark-brown and gold formal coat with a high collar, layered tails with a scale pattern, black gloves and dark trousers, arms crossed calmly, dignified composed face.',
  C8: 'A full standing sprite of a young man with shoulder-length white hair tied in a low ponytail with a single red streak, red eyes; he wears a black-and-red samurai outfit: half-open haori over a dark kimono top, one shoulder armored, a maple-leaf patterned scarf, bandaged forearm, loose dark trousers and sandals, relaxed stance with a soft thoughtful expression.',
  G1: nr(CONTENT.G1).replace(/Raiden Shogun/g, 'the dark-purple-haired woman'),
  G2: nr(CONTENT.G2).replace(/Nahida and Furina/g, 'a small white-haired girl and a white-haired girl in a top hat'),
}

const isKokomi = (id) => id === 'G1' || id === 'G2' || id.startsWith('K')
const isSprite = (id) => ASSETS[id].transparent === true

// Build the full prompt for an asset + arm. nameRemoved => retry variant.
export function buildPrompt(id, arm, { nameRemoved = false } = {}) {
  const role = ROLE_BASE + (isKokomi(id) ? ROLE_KOKOMI : ROLE_OTHER)
  const grole = GROUP_ROLES[id]
  const content = (nameRemoved ? CONTENT_NONAME : CONTENT)[id]
  const lines = [role]
  if (grole) {
    lines.push(
      nameRemoved
        ? grole.replace(/Raiden Shogun|Nahida|Furina/g, 'the character')
        : grole,
    )
  }
  lines.push(content)
  if (isSprite(id)) lines.push(FRAME_SPRITE)
  if (arm === 'B') lines.push(RENDER)
  return lines.join('\n')
}
