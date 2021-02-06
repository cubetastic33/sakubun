use rand::prelude::*;
use std::collections::HashSet;
use std::error::Error;
use std::fs;

pub fn get_sentences() -> Result<Vec<[String;2]>, Box<dyn Error>> {
    let mut sentences = Vec::new();
    let mut rng = thread_rng();

    let known_kanji: HashSet<_> = fs::read_to_string("known_kanji.txt")?.chars().collect();
    // Read the sentences and shuffle the order
    let records  = fs::read_to_string("sentences.csv")?;
    let mut records: Vec<_> = records.split('\n').collect();
    records.shuffle(&mut rng);

    for result in records {
        let record: Vec<_> = result.split('\t').collect();
        if record.len() != 4 {
            continue;
        }
        let jap_sentence = record[1];
        let eng_sentence = record[2];
        let kanji_in_sentence: HashSet<_> = record[3].chars().collect();

        // TODO allow custom number of kanji required for a sentence to be included
        if kanji_in_sentence.is_subset(&known_kanji) && kanji_in_sentence.len() >= 1 {
            println!("{:?}", kanji_in_sentence);
            sentences.push([jap_sentence.to_string(), eng_sentence.to_string()]);
        }
        // Once we've collected 30 sentences, we can exit the loop
        if sentences.len() == 30 {
            break;
        }
    }
    Ok(sentences)
}
