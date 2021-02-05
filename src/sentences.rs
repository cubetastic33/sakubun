use rand::prelude::*;
use std::error::Error;
use std::fs;

pub fn get_sentences() -> Result<Vec<[String;2]>, Box<dyn Error>> {
    // TODO allow custom number of kanji required for a sentence to be included
    let mut sentences = Vec::new();
    let mut rng = thread_rng();

    // Read the sentences and shuffle the order
    let records  = fs::read_to_string("sentences.csv")?;
    let mut records: Vec<_> = records.split('\n').collect();
    records.shuffle(&mut rng);

    for result in records {
        let record: Vec<_> = result.split('\t').collect();
        let jap_sentence = record[1];
        let eng_sentence = record[2];
        let kanji_in_sentence = record[3];

        let known_kanji = fs::read_to_string("known_kanji.txt")?;

        // If it has any of the known kanji, add it to the list
        for kanji in known_kanji.chars() {
            if kanji_in_sentence.contains(kanji) {
                // Add the sentence to the list since it has kanji they know
                sentences.push([jap_sentence.to_string(), eng_sentence.to_string()]);
                break;
            }
        }

        // Once we've collected 30 sentences, we can exit the loop
        if sentences.len() == 30 {
            break;
        }
    }
    Ok(sentences)
}
