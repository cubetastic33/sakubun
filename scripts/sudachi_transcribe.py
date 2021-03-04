from sudachipy import tokenizer, dictionary
import jaconv

tokenizer_obj = dictionary.Dictionary().create()
mode = tokenizer.Tokenizer.SplitMode.C

with open("sentences.csv", "r") as f:
    sentences = f.readlines()

transcribed = []

for i, sentence in enumerate(sentences):
    readings = []
    for token in tokenizer_obj.tokenize(sentence.split("\t")[1], mode):
        if "補助記号" in token.part_of_speech() or not token.reading_form():
            # Symbols shouldn't be converted
            # Katakana won't have a reading form, so that should be covered here too
            readings.append(token.surface())
        else:
            readings.append(token.reading_form())
        # Some hardcoded improvements (won't always be true but at least makes it better)
        if "私" in token.surface():
            readings[-1] = readings[-1].replace("ワタクシ", "ワタシ")
        if token.surface() == "明日":
            # Instead of アス
            readings[-1] = "アシタ"
        if token.surface() == "日本":
            # Instead of the occasional ニッポン
            readings[-1] = "ニホン"
        if token.surface() == "何":
            # Instead of the ナン
            readings[-1] = "ナニ"
    transcribed.append(sentence.split("\t")[0] + "\t" + jaconv.kata2hira("".join(readings)))
    if (i + 1) % 10000 == 0:
        print(i + 1, "sentences complete")

with open("sudachi.txt", "w") as f:
    f.write("\n".join(transcribed))
