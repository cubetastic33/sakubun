from fugashi import Tagger
import unidic
import jaconv
import re

katakana_regex = re.compile(r"^[\u30A0-\u30FF]*$")

tagger = Tagger('-d "{}"'.format(unidic.DICDIR))
sentences = [
    '彼らの努力は実を結ばなかった。',
    'これらの本は図書館から一週間借り出せます。',
    '韓国料理は一般的に辛い。',
    '私は二十歳です。',
    '明日から二日出会いましょう。',
    'トムと山口さんの友達の美波です。',
    'この国は日本です、この言語は日本語です、私は日本人です。',
    '何それ？役に立たないと思います。',
    '明日から梅雨入りです。',
    '光ファイバーケーブル',
    'もう一枚',
    '日曜日',
]

"""
for sentence in sentences:
    tagger.parse(sentence)

    converted = ''

    for token in tagger(sentence):
        if token.feature.goshu == '記号':
            # It's a symbol, so don't convert it
            converted += token.feature.orth
        elif katakana_regex.match(token.feature.orth):
            converted += token.feature.orth
        elif token.feature.orth == '明日':
            # Some hardcoded improvements
            converted += 'あした'
        elif token.feature.orth in ['日本', '日本人', '日本語']:
            converted += jaconv.kata2hira(token.feature.kana.replace('ニッポン', 'ニホン'))
        else:
            converted += jaconv.kata2hira(token.feature.kana)
    print(converted)
"""

with open("sentences.csv", "r") as f:
    lines = f.readlines()

transcribed = []

for i, line in enumerate(lines):
    sentence = line.split('\t')[1]
    tagger.parse(sentence)

    transcribed.append(line.split('\t')[0] + '\t')

    for token in tagger(sentence):
        if token.feature.pos1 == '補助記号':
            # It's a symbol, so don't convert it
            transcribed[-1] += str(token)
        elif katakana_regex.match(str(token)):
            transcribed[-1] += str(token)
        else:
            # Some hardcoded improvements
            if str(token) == '私':
                # Instead of わたくし
                transcribed[-1] += 'わたし'
            elif str(token) == '明日':
                # Instead of あす
                transcribed[-1] += 'あした'
            elif str(token) in ['日本', '日本人', '日本語']:
                # Instead of にっぽん
                transcribed[-1] += jaconv.kata2hira(token.feature.kana.replace('ニッポン', 'ニホン'))
            elif str(token) == '何':
                # Instead of なん
                transcribed[-1] += 'なに'
            elif token.feature.kana:
                transcribed[-1] += jaconv.kata2hira(token.feature.kana)
            else:
                transcribed[-1] += str(token)

    if (i + 1) % 10000 == 0:
        print(i + 1, "sentences complete")

with open("converted.txt", "w") as f:
    f.write("\n".join(transcribed))
