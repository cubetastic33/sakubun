use regex::Regex;
use rand::prelude::*;
use std::error::Error;
use std::fs;

pub fn get_sentences() -> Result<Vec<[String;2]>, Box<dyn Error>> {
    let mut sentences = Vec::new();
    let mut rng = thread_rng();
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .delimiter(b'\t')
        .from_path("sentences.csv")?;

    let mut records: Vec<_> = reader.records().into_iter().collect();
    records.shuffle(&mut rng);

    'sentence: for result in records {
        let record = result?;
        let jap_sentence = &record[1];
        let eng_sentence = &record[2];
        let known_kanji = fs::read_to_string("known_kanji.txt")?;
        let re = Regex::new(r"[\p{Han}]")?;
        let mut score = 0;

        for group in re.captures_iter(jap_sentence) {
            if known_kanji.contains(&group[0]) {
                score += 1;
            } else {
                // This sentence has kanji they still don't know
                continue 'sentence;
            }
        }
        if score >= 1 {
            // Add the sentence to the list since it has kanji they know
            sentences.push([jap_sentence.to_string(), eng_sentence.to_string()]);
            /*println!("\n{}", jap_sentence);
            let stdin = io::stdin();
            let mut input = String::new();
            stdin.read_line(&mut input)?;*/
        }
        if sentences.len() == 30 {
            break;
        }
    }
    Ok(sentences)
}
