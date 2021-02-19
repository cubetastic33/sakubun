use super::{OrderedImport, QuizSettings};
use rand::prelude::*;
use regex::Regex;
use rocket::{http::Status, request::Form, response::status::Custom};
use rusqlite::{Connection, NO_PARAMS};
use std::{
    collections::HashSet,
    error::Error,
    fs,
    io::{Cursor, Read, Write},
};
use uuid::Uuid;

pub enum KanjiOrder {
    WaniKani,
    RTK,
    JLPT,
}

pub fn get_sentences(
    quiz_settings: Form<QuizSettings>,
) -> Result<Vec<[String; 2]>, Box<dyn Error>> {
    let mut sentences = Vec::new();
    let mut rng = thread_rng();

    let known_kanji: HashSet<_> = quiz_settings.known_kanji.chars().collect();
    // Read the sentences and shuffle the order
    let records = fs::read_to_string("sentences.csv")?;
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
        let large_enough = kanji_in_sentence.len() >= quiz_settings.min;
        let small_enough = kanji_in_sentence.len() <= quiz_settings.max;

        if kanji_in_sentence.is_subset(&known_kanji) && large_enough && small_enough {
            sentences.push([jap_sentence.to_string(), eng_sentence.to_string()]);
        }
        // Once we've collected 30 sentences, we can exit the loop
        if sentences.len() == 30 {
            break;
        }
    }
    Ok(sentences)
}

pub fn extract_kanji_from_anki_deck(
    data: Cursor<Vec<u8>>,
    only_learnt: bool,
) -> Result<String, Custom<String>> {
    // An apkg file is just a zip file, so unzip it
    if let Ok(mut zip) = zip::ZipArchive::new(data) {
        // Get the database file
        if let Ok(mut file) = zip.by_name("collection.anki2") {
            // We now have the sqlite3 database with the notes
            let mut contents = Vec::new();
            file.read_to_end(&mut contents).unwrap();
            // Write the database to a file
            let file_name = format!("{}.db", Uuid::new_v4());
            let mut f = fs::File::create(&file_name).unwrap();
            f.write_all(&contents).unwrap();
            if let Ok(conn) = Connection::open(&file_name) {
                // Create a variable to store the kanji
                let mut kanji: HashSet<String> = HashSet::new();
                // Regex to find kanji
                let kanji_regex = Regex::new(r"[\p{Han}]").unwrap();
                /*
                 * In most decks I checked the kanji was in the sort field (sfld) column, but some
                 * decks have numbers there, and the kanji is in the fields (flds) column. In this
                 * case it's more complicated because there can be multiple fields and the kanji
                 * could be in any one of those fields. So we take the sfld column if it has kanji,
                 * otherwise as a secondary option we take the flds column.
                 *
                 * The queue column in the cards table tells us if the card is already learnt, is
                 * being learnt, or has never been seen before. if the only_learnt parameter is
                 * true, we should only consider cards that are in queue 2 (learnt).
                 *
                 * Despite the DISTINCT clause, it is still necessary to filter duplicates because
                 * different notes of the same kanji could be in different queues.
                 */
                let mut statement = conn
                    .prepare(
                        "SELECT DISTINCT cards.queue, notes.sfld, notes.flds
                     FROM cards INNER JOIN notes on notes.id = cards.nid",
                    )
                    .unwrap();
                let mut rows = statement.query(NO_PARAMS).unwrap();
                while let Some(row) = rows.next().unwrap() {
                    if !only_learnt || row.get::<_, i32>(0).unwrap() == 2 {
                        let mut no_kanji_found = true;
                        // Check for string type because it could also be integer
                        if let Ok(sfld) = row.get::<_, String>(1) {
                            // Insert all kanji found in the sfld column to the kanji set
                            for capture in kanji_regex.captures_iter(&sfld) {
                                kanji.insert(capture[0].to_string());
                                no_kanji_found = false;
                            }
                        }
                        // If no kanji were found in the sfld column
                        if no_kanji_found {
                            let flds: String = row.get(2).unwrap();
                            // Insert all kanji found in the flds column to the kanji set
                            for capture in kanji_regex.captures_iter(&flds) {
                                kanji.insert(capture[0].to_string());
                            }
                        }
                    }
                }
                // Delete the database file
                fs::remove_file(&file_name).unwrap();
                // Return all the extracted kanji
                return Ok(kanji
                    .iter()
                    .map(|k| k.as_str())
                    .collect::<Vec<&str>>()
                    .join(""));
            }
        }
    }
    Err(Custom(
        Status::InternalServerError,
        String::from("Failed to parse apkg file"),
    ))
}

pub fn kanji_in_order(
    order: KanjiOrder,
    import_settings: Form<OrderedImport>,
) -> Result<String, Custom<String>> {
    let kanji = fs::read_to_string(match order {
        KanjiOrder::WaniKani => "wanikani.txt",
        KanjiOrder::RTK => "rtk.txt",
        KanjiOrder::JLPT => "jlpt.txt",
    })
    .unwrap();
    if import_settings.method == "stages" {
        Ok(kanji.split("\n").collect::<Vec<_>>()[..import_settings.number].join(""))
    } else if import_settings.method == "kanji" {
        Ok(kanji
            .chars()
            .filter(|c| c != &'\n')
            .take(import_settings.number)
            .collect())
    } else {
        Err(Custom(
            Status::BadRequest,
            String::from("Method must be one of `stages` or `kanji`"),
        ))
    }
}
