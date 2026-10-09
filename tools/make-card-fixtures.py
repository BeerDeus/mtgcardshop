# Cartes synthétiques pour tester l'OCR : cadre, bandeau du nom, illustration, zone de texte, bruit et flou léger.
import random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
random.seed(7)
SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
SANS = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
W, H = 745, 1040
def card(name, frame=(214, 196, 150), band=(236, 226, 196), ink=(25, 20, 15), art=(70, 100, 140), cost=None, rules=True, size=44):
    im = Image.new('RGB', (W, H), (18, 16, 14)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((18, 18, W - 18, H - 18), 28, fill=frame)
    d.rounded_rectangle((44, 44, W - 44, 112), 12, fill=band, outline=(60, 50, 40), width=3)
    f = ImageFont.truetype(SERIF, size); d.text((62, 78), name, font=f, fill=ink, anchor='lm')
    if cost:
        x = W - 62
        for c in reversed(cost):
            d.ellipse((x - 32, 62, x, 94), fill=c); x -= 37
    d.rectangle((60, 128, W - 60, 570), fill=art)
    for _ in range(40):
        x, y = random.randint(70, W - 140), random.randint(140, 540); d.ellipse((x, y, x + random.randint(20, 120), y + random.randint(20, 90)), fill=tuple(min(255, max(0, a + random.randint(-50, 50))) for a in art))
    d.rounded_rectangle((44, 590, W - 44, 650), 8, fill=band, outline=(60, 50, 40), width=2)
    d.text((62, 620), 'Legendary Artifact — Equipment', font=ImageFont.truetype(SERIF, 30), fill=ink, anchor='lm')
    d.rectangle((60, 670, W - 60, 930), fill=band)
    if rules:
        for i, t in enumerate(['{T}: Add {C}{C}.', 'Whenever you cast a spell, draw a card.', 'Flying, vigilance, lifelink.', '"A fine blade for a fine day."']):
            d.text((78, 700 + i * 52), t, font=ImageFont.truetype(SANS, 30), fill=ink)
    d.text((62, 975), '123/301 R  CMM • EN', font=ImageFont.truetype(SANS, 22), fill=(220, 220, 220))
    return im
def finish(im, rot=0, blur=0.0, noise=0, bg=(60, 52, 44)):
    if blur: im = im.filter(ImageFilter.GaussianBlur(blur))
    if rot:
        base = Image.new('RGB', (im.width + 200, im.height + 200), bg); base.paste(im, (100, 100)); im = base.rotate(rot, resample=Image.BICUBIC, fillcolor=bg).crop((60, 60, base.width - 60, base.height - 60))
    if noise:
        px = im.load()
        for _ in range(im.width * im.height // 14):
            x, y = random.randrange(im.width), random.randrange(im.height); r, g, b = px[x, y]; n = random.randint(-noise, noise); px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return im
out = sys.argv[1]
jobs = {
  'swords.jpg': card('Swords to Plowshares', cost=[(250, 245, 220)]),
  'crater.jpg': finish(card('Craterhoof Behemoth', frame=(60, 110, 70), band=(210, 225, 205), art=(40, 90, 50), cost=[(150, 150, 150)] + [(60, 140, 70)] * 3, size=36), rot=2.0, blur=0.8, noise=18),
  'wrath.jpg': finish(card('Wrath of God', frame=(235, 228, 205), cost=[(150, 150, 150)] + [(250, 245, 220)] * 2), rot=-1.5, noise=12),
  'llanowar.jpg': card('Llanowar Elves', frame=(60, 110, 70), band=(210, 225, 205), art=(40, 110, 60), cost=[(60, 140, 70)]),
  'edgar.jpg': card('Edgar Markov', frame=(40, 36, 34), band=(30, 28, 26), ink=(235, 225, 190), art=(110, 60, 70), cost=[(150, 150, 150), (210, 90, 60), (250, 245, 220), (60, 55, 60)]),   # cadre noir, texte clair
  'blurry.jpg': finish(card('Arcane Signet', cost=[(150, 150, 150)] * 2), blur=2.2, noise=24),
  'nonsense.jpg': card('Qzxvbnm Plrtkgh', cost=[(150, 150, 150)]),
  'anneau.jpg': card('Anneau solaire', cost=[(150, 150, 150)]),
  'sceau.jpg': card('Sceau arcanique', cost=[(150, 150, 150)] * 2),
  'colere.jpg': finish(card('Colère de Dieu', frame=(235, 228, 205), cost=[(150, 150, 150)] + [(250, 245, 220)] * 2), rot=-1.0, noise=10),
  'elfes.jpg': card('Elfes de Llanowar', frame=(60, 110, 70), band=(210, 225, 205), art=(40, 110, 60), cost=[(60, 140, 70)]),
  'behemoth.jpg': finish(card('Béhémoth Cratérosabot', frame=(60, 110, 70), band=(210, 225, 205), art=(40, 90, 50), cost=[(150, 150, 150)] + [(60, 140, 70)] * 3, size=34), rot=1.5, noise=12),
  'epees.jpg': card('Épées aux charrues', cost=[(250, 245, 220)]),
  # cartes allemandes (téléphone allemand : moteur « deu », catalogue names-de.tsv) ; en dernier : les cartes ci-dessus restent identiques
  'blitz.jpg': card('Blitzschlag', frame=(200, 120, 90), band=(240, 222, 205), art=(150, 60, 40), cost=[(210, 90, 60)]),
  'zorn.jpg': finish(card('Zorn Gottes', frame=(235, 228, 205), cost=[(150, 150, 150)] + [(250, 245, 220)] * 2), rot=-1.0, noise=10),
}
for n, im in jobs.items(): im.convert('RGB').save(f'{out}/{n}', quality=88)
# plusieurs cartes sur une photo : 3 × 2, légèrement de travers
sheet = Image.new('RGB', (3 * 380 + 40, 2 * 530 + 30), (60, 52, 44))
for i, n in enumerate(['swords.jpg', 'wrath.jpg', 'llanowar.jpg', 'swords.jpg', 'crater.jpg', 'edgar.jpg']):
    c = Image.open(f'{out}/{n}').resize((370, 516)); sheet.paste(c, (10 + (i % 3) * 380, 10 + (i // 3) * 520))
sheet.save(f'{out}/sheet.jpg', quality=88)
print('ok', len(jobs) + 1)
