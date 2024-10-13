use super::QuizSettings;
use postgres::Client;
use rand::prelude::*;
use rocket::request::Form;
use std::{
    collections::{HashMap, HashSet},
    error::Error,
    num::ParseIntError,
    fs,
};

pub trait Sentence {
    // Method to get the sentence ID
    fn get_id(&self) -> Result<i32, ParseIntError>;

    // Method to set a property of the sentence
    fn set(&mut self, property: &str, value: String);

    // Method to add a reading to the sentence
    fn add_reading(&mut self, reading: String);
}

impl Sentence for [String; 4] {
    fn get_id(&self) -> Result<i32, ParseIntError> {
        self[0].parse()
    }

    fn set(&mut self, property: &str, value: String) {
        if property == "question" {
            self[1] = value;
        } else if property == "translation" {
            self[2] = value;
        } else if property == "reading" {
            self[3] = value;
        }
    }

    fn add_reading(&mut self, reading: String) {
        self[3] += &format!(",{}", reading);
    }
}

// (Sentence ID, Japanese sentence, English sentence, Reading, Kanji in sentence, Previous intersection)
impl Sentence for (String, String, String, String, HashSet<char>, Option<usize>) {
    fn get_id(&self) -> Result<i32, ParseIntError> {
        self.0.parse()
    }

    fn set(&mut self, property: &str, value: String) {
        if property == "question" {
            self.1 = value;
        } else if property == "translation" {
            self.2 = value;
        } else if property == "reading" {
            self.3 = value;
        }
    }

    fn add_reading(&mut self, reading: String) {
        self.3 += &format!(",{}", reading);
    }
}

pub fn fill_sentences<T: Sentence>(
    client: &mut Client,
    sentences: &mut Vec<T>,
    add_overrides: bool,
) -> Result<(), Box<dyn Error>> {
    let mut queue: HashMap<i32, Vec<usize>> = HashMap::new();
    for (i, sentence) in sentences.iter().enumerate() {
        if let Some(x) = queue.get_mut(&sentence.get_id()?) {
            x.push(i);
        } else {
            queue.insert(sentence.get_id()?, vec![i]);
        }
    }
    // Add the readings from the file
    let kana_records = fs::read_to_string("kana_sentences.txt")?;
    for result in kana_records.lines() {
        // Parse the values
        let record: Vec<_> = result.split('\t').collect();
        if record.len() != 2 {
            continue;
        }
        // If this record is in the queue
        if let Some(indices) = queue.get(&record[0].parse()?) {
            for index in indices {
                sentences[*index].set("reading", record[1].to_owned());
            }
        }
    }

    if !add_overrides {
        return Ok(());
    }

    // Add the overrides
    for row in client
        .query(
            "SELECT * FROM overrides WHERE sentence_id = ANY($1) ORDER BY primary_value DESC",
            &[&queue.keys().collect::<Vec<_>>()],
        )?
    {
        let indices = queue.get(&row.get("sentence_id")).ok_or("Error: Sentence ID from DB not found in queue")?;
        // The concept of a primary value exists only for readings
        let override_type = row.get("override_type");
        if override_type != "reading" || row.get("primary_value") {
            // This is either a primary reading or a non-reading override, so we can just set that
            // property to the new value
            for i in indices {
                sentences[*i].set(override_type, row.get("value"));
            }
        } else {
            // This is a non-primary reading
            for i in indices {
                sentences[*i].add_reading(row.get("value"));
            }
        }
    }

    Ok(())
}

pub fn get_sentences(
    client: &mut Client,
    quiz_settings: Form<QuizSettings>,
) -> Result<Vec<[String; 4]>, Box<dyn Error>> {
    let mut sentences = Vec::new();
    let mut rng = thread_rng();

    let known_kanji: HashSet<_> = quiz_settings.known_kanji.chars().collect();
    let known_priority_kanji: HashSet<_> = quiz_settings.known_priority_kanji.chars().collect();
    // Read the sentences and shuffle the order
    let sentence_records = fs::read_to_string("sentences.csv")?;
    let mut sentence_records: Vec<_> = sentence_records.lines().collect();
    sentence_records.shuffle(&mut rng);

    // Iterate over the sentences
    for result in sentence_records {
        // Parse the values
        let record: Vec<_> = result.split('\t').collect();
        if record.len() != 4 {
            continue;
        }
        let id = record[0];
        let jap_sentence = record[1];
        let eng_sentence = record[2];
        let kanji_in_sentence: HashSet<_> = record[3].chars().collect();
        let large_enough = kanji_in_sentence.len() >= quiz_settings.min;
        let small_enough = kanji_in_sentence.len() <= quiz_settings.max;

        if kanji_in_sentence.is_subset(&known_kanji)
            && large_enough
            && small_enough
            && (known_priority_kanji.is_empty()
                || !kanji_in_sentence.is_disjoint(&known_priority_kanji))
        {
            sentences.push([
                id.to_owned(),
                jap_sentence.to_owned(),
                eng_sentence.to_owned(),
                String::new(),
            ]);
        }
        // Once we've collected 30 sentences, we can exit the loop
        if sentences.len() == 30 {
            break;
        }
    }
    // Fill the readings and overrides
    fill_sentences(client, &mut sentences, true)?;
    Ok(sentences)
}

pub fn generate_essay(client: &mut Client, quiz_settings: Form<QuizSettings>) -> Result<Vec<[String; 4]>, Box<dyn Error>> {
    let mut essay = Vec::new();
    let mut sentences = Vec::new();
    let mut rng = thread_rng();

    let mut known_kanji: HashSet<_> = quiz_settings.known_kanji.chars().collect();
    // Read the sentences and shuffle the order
    let sentence_records = fs::read_to_string("sentences.csv")?;
    let sentence_records: Vec<_> = sentence_records.lines().collect();

    // Filter the sentences so we're left with the ones that only have kanji the user knows
    for result in sentence_records {
        // Parse the values
        let record: Vec<_> = result.split('\t').collect();
        if record.len() != 4 {
            continue;
        }
        let id = record[0];
        let jap_sentence = record[1];
        let eng_sentence = record[2];
        let kanji_in_sentence: HashSet<_> = record[3].chars().collect();
        let large_enough = kanji_in_sentence.len() >= quiz_settings.min;
        let small_enough = kanji_in_sentence.len() <= quiz_settings.max;

        if kanji_in_sentence.is_subset(&known_kanji) && large_enough && small_enough {
            sentences.push((
                id.to_owned(),
                jap_sentence.to_owned(),
                eng_sentence.to_owned(),
                String::new(),
                kanji_in_sentence,
                None,
            ));
        }
    }
    // Fill the readings and overrides
    fill_sentences(client, &mut sentences, true)?;

    // As long as we have known kanji that aren't in the essay, keep iterating
    while known_kanji.len() != 0 {
        let mut tuples = Vec::new();
        let mut max_intersection = 0;
        for (id, jap_sentence, eng_sentence, reading, kanji, prev_intersection) in &mut sentences {
            if let Some(val) = prev_intersection {
                // If the previous intersection was 2 kanji for example, we know that the
                // intersection this time will be <= 2
                // If the max_intersection this time is > 2, then this sentence is pointless
                if *val < max_intersection {
                    continue;
                }
            }
            let intersection = kanji.intersection(&known_kanji).count();
            // Store the intersection value
            *prev_intersection = Some(intersection);
            if intersection < max_intersection || intersection == 0 {
                continue;
            }
            if intersection > max_intersection {
                // If the current intersection is greater than the last recorded max intersection
                max_intersection = intersection;
                // Reset the pairs vector
                tuples = Vec::new();
            }
            tuples.push((id, jap_sentence, eng_sentence, reading, kanji));
        }

        // If we can't find sentences with the remaining kanji, give up
        if max_intersection == 0 {
            break;
        }

        // Add a random sentence with a lot of known kanji to the essay
        let choice = tuples.choose(&mut rng).ok_or("Error: Failed to choose from empty vector of tuples")?;
        essay.push([
            choice.0.to_owned(),
            choice.1.to_owned(),
            choice.2.to_owned(),
            choice.3.to_owned(),
        ]);
        known_kanji = known_kanji.difference(&choice.4).map(|x| *x).collect();
    }

    // Randomize the order of sentences in the essay
    essay.shuffle(&mut rng);
    // Return the essay as a string
    Ok(essay)
}
