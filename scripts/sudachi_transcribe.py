from sudachipy import tokenizer, dictionary
import jaconv
import re

tokenizer_obj = dictionary.Dictionary().create()
mode = tokenizer.Tokenizer.SplitMode.C

katakana_regex = re.compile(r"^[\u30A0-\u30FF]*$")

with open("sentences.csv", "r") as f:
    sentences = f.readlines()

transcribed = []

for i, sentence in enumerate(sentences):
    readings = []
    for token in tokenizer_obj.tokenize(sentence.split("\t")[1], mode):
        if "補助記号" in token.part_of_speech() or katakana_regex.match(token.surface()) or not token.reading_form():
            # Symbols shouldn't be converted
            # Katakana and words that don't have a reading form should be covered here too
            readings.append(token.surface())
        else:
            readings.append(jaconv.kata2hira(token.reading_form()))
        # Some hardcoded improvements (won't always be true but at least makes it better)
        if "私" in token.surface():
            readings[-1] = readings[-1].replace("わたくし", "わたし")
        if token.surface() == "明日":
            # Instead of あす
            readings[-1] = "あした"
        if token.surface() == "日本":
            # Instead of the occasional にっぽん
            readings[-1] = "にほん"
        if token.surface() == "何":
            # Instead of the なん
            readings[-1] = "なに"
    transcribed.append(sentence.split("\t")[0] + "\t" + "".join(readings))
    if (i + 1) % 10000 == 0:
        print(i + 1, "sentences complete")

with open("sudachi.txt", "w") as f:
    f.write("\n".join(transcribed))
