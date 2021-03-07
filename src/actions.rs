use super::{AdminReport, OrderedImport, QuizSettings, Report};
use postgres::Client;
use rand::prelude::*;
use regex::Regex;
use rocket::{http::Status, request::Form, response::status::Custom};
use rusqlite::{Connection, NO_PARAMS};
use std::{
    collections::{HashMap, HashSet},
    error::Error,
    fs,
    io::{Cursor, Read, Write},
};
use uuid::Uuid;

pub enum KanjiOrder {
    WaniKani,
    RTK,
    JLPT,
    Kanken,
}

/*
CREATE TABLE overrides (
    id serial PRIMARY KEY,
    sentence_id INTEGER NOT NULL,
    override_type VARCHAR NOT NULL,
    value VARCHAR NOT NULL,
    primary_value BOOLEAN NOT NULL DEFAULT FALSE
)
*/

trait Sentence {
    // Method to get the sentence ID
    fn get_id(&self) -> i32;

    // Method to set a property of the sentence
    fn set(&mut self, property: &str, value: String);

    // Method to add a reading to the sentence
    fn add_reading(&mut self, reading: String);
}

impl Sentence for [String; 4] {
    fn get_id(&self) -> i32 {
        self[0].parse().unwrap()
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

impl Sentence for AdminReport {
    fn get_id(&self) -> i32 {
        self.sentence_id
    }

    fn set(&mut self, property: &str, value: String) {
        if property == "question" {
            self.question = value;
        } else if property == "translation" {
            self.translation = value;
        } else if property == "reading" {
            self.readings = vec![value];
        }
    }

    fn add_reading(&mut self, reading: String) {
        self.readings.push(reading);
    }
}

fn fill_sentences<T: Sentence>(client: &mut Client, sentences: &mut Vec<T>) {
    let mut queue = HashMap::new();
    for (i, sentence) in sentences.iter().enumerate() {
        queue.insert(sentence.get_id(), i);
    }
    // Add the readings from the file
    let kana_records = fs::read_to_string("kana_sentences.txt").unwrap();
    for result in kana_records.split('\n').collect::<Vec<_>>() {
        // Parse the values
        let record: Vec<_> = result.split('\t').collect();
        if record.len() != 2 {
            continue;
        }
        // If this record is in the queue
        if let Some(index) = queue.get(&record[0].parse().unwrap()) {
            sentences[*index].set("reading", record[1].to_owned());
        }
    }

    // Add the overrides
    for row in client
        .query(
            "SELECT * FROM overrides WHERE sentence_id = ANY($1) ORDER BY primary_value DESC",
            &[&queue.keys().collect::<Vec<_>>()],
        )
        .unwrap()
    {
        let i = queue.get(&row.get("sentence_id")).unwrap();
        // The concept of a primary value exists only for readings
        let override_type = row.get("override_type");
        if override_type != "reading" || row.get("primary_value") {
            // This is either a primary reading or a non-reading override, so we can just set that
            // property to the new value
            sentences[*i].set(override_type, row.get("value"));
        } else {
            // This is a non-primary reading
            sentences[*i].add_reading(row.get("value"));
        }
    }
}

pub fn get_sentences(
    client: &mut Client,
    quiz_settings: Form<QuizSettings>,
) -> Result<Vec<[String; 4]>, Box<dyn Error>> {
    let mut sentences = Vec::new();
    let mut rng = thread_rng();

    let known_kanji: HashSet<_> = quiz_settings.known_kanji.chars().collect();
    // Read the sentences and shuffle the order
    let sentence_records = fs::read_to_string("sentences.csv")?;
    let mut sentence_records: Vec<_> = sentence_records.split('\n').collect();
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

        if kanji_in_sentence.is_subset(&known_kanji) && large_enough && small_enough {
            sentences.push([
                id.to_string(),
                jap_sentence.to_string(),
                eng_sentence.to_string(),
                String::new(),
            ]);
        }
        // Once we've collected 30 sentences, we can exit the loop
        if sentences.len() == 30 {
            break;
        }
    }
    // Fill the readings and overrides
    fill_sentences(client, &mut sentences);
    Ok(sentences)
}

/*
CREATE TABLE reports (
    id serial PRIMARY KEY,
    sentence_id INTEGER NOT NULL,
    report_type VARCHAR NOT NULL,
    suggested VARCHAR (500),
    comment VARCHAR (500),
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
*/

pub fn save_report(client: &mut Client, report: Form<Report>) -> String {
    // Validate input
    println!("{:?}", report.comment);
    if let Some(suggested) = &report.suggested {
        if suggested.chars().count() > 500 {
            return String::from("Suggested value too long");
        }
    } else if let Some(comment) = &report.comment {
        if comment.len() > 500 {
            return String::from("Comment too long");
        }
    }
    // Save the report
    client
        .execute(
            "INSERT INTO reports VALUES (DEFAULT, $1, $2, $3, $4, DEFAULT)",
            &[
                &report.sentence_id,
                &report.report_type,
                &report.suggested,
                &report.comment,
            ],
        )
        .unwrap();
    String::from("success")
}

pub fn get_reports(client: &mut Client) -> Vec<AdminReport> {
    // Variable to store the reports
    let mut reports = Vec::new();
    // Read the sentences
    let records = fs::read_to_string("sentences.csv").unwrap();
    let records: Vec<_> = records.split('\n').collect();
    // Variable to store a queue of sentence IDs that'll be used after we've collected all of them
    let mut sentence_ids = Vec::new();
    // Get the reports from the database
    for row in client.query(
        "SELECT * FROM reports ORDER BY id DESC",
        &[]
    ).unwrap() {
        sentence_ids.push(row.get::<_, i32>("sentence_id").to_string());
        let reported_at: chrono::DateTime<chrono::Utc> = row.get("reported_at");
        reports.push(AdminReport {
            report_id: row.get("id"),
            sentence_id: row.get("sentence_id"),
            question: String::new(),
            translation: String::new(),
            readings: Vec::new(),
            report_type: row.get("report_type"),
            suggested: row.get("suggested"),
            comment: row.get("comment"),
            reported_at: reported_at.to_string(),
        });
    }
    // Iterate over the sentences to add the question and translation
    for result in records {
        // Parse the values
        let record: Vec<_> = result.split('\t').collect();
        if record.len() != 4 {
            continue;
        }
        // If this record's ID is in the sentence_ids vector
        // We're doing a for loop because it could be there multiple times
        for (index, sentence_id) in sentence_ids.iter().enumerate() {
            if sentence_id == record[0] {
                reports[index].question = record[1].to_string();
                reports[index].translation = record[2].to_string();
            }
        }
    }
    // Fill the readings and overrides
    fill_sentences(client, &mut reports);
    reports
}

pub fn extract_kanji_from_anki_deck(
    data: Cursor<Vec<u8>>,
    only_learnt: bool,
) -> Result<String, Custom<String>> {
    // An apkg file is just a zip file, so unzip it
    if let Ok(mut zip) = zip::ZipArchive::new(data) {
        // Randomly generated filename to temporarily save the database at
        let file_name = format!("{}.db", Uuid::new_v4());
        let mut contents = Vec::new();
        // Get the database file
        if let Ok(mut file) = zip.by_name("collection.anki21") {
            // This deck uses the Anki 2.1 scheduler
            file.read_to_end(&mut contents).unwrap();
        }
        if contents.len() == 0 {
            if let Ok(mut file) = zip.by_name("collection.anki2") {
                // This deck doesn't use the Anki 2.1 scheduler
                file.read_to_end(&mut contents).unwrap();
            }
        }
        if contents.len() > 0 {
            // We now have the sqlite3 database with the notes
            // Write the database to a file
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

pub fn kanji_from_wanikani(api_key: &str) -> Result<String, Custom<String>> {
    // Create a variable to store the kanji
    let mut kanji = Vec::new();
    // reqwest client to interact with the WaniKani API
    let client = reqwest::blocking::Client::new();
    let mut url = String::from("https://api.wanikani.com/v2/assignments");
    let mut ids = Vec::new();

    // Fetch all the subject IDs
    loop {
        let mut response = client.get(&url);
        if &url == "https://api.wanikani.com/v2/assignments" {
            // Fetch only kanji, not radicals or vocabulary
            response = response.query(&[("subject_types", "kanji")]);
        }
        let json = response
            .bearer_auth(api_key)
            .send()
            .unwrap()
            .json::<serde_json::Value>()
            .unwrap();

        if let Some(error) = json["error"].as_str() {
            // In case the request failed
            // The most likely cause for this is an incorrect API key
            return Err(Custom(Status::InternalServerError, error.to_string()));
        }

        for assignment in json["data"].as_array().unwrap() {
            if assignment["data"]["srs_stage"].as_u64().unwrap() >= 5 {
                // If the subject is at least at SRS stage 5
                ids.push(
                    assignment["data"]["subject_id"]
                        .as_u64()
                        .unwrap()
                        .to_string(),
                );
            }
        }

        // Pagination
        url = match json["pages"]["next_url"].as_str() {
            Some(url) => url.to_string(),
            None => break,
        };
    }

    url = String::from("https://api.wanikani.com/v2/subjects");

    // Fetch the actual kanji
    loop {
        let mut response = client.get(&url);
        if &url == "https://api.wanikani.com/v2/subjects" {
            // From page 2 onwards, the ids will be part of the `url` variable
            response = response.query(&[("ids", &ids.join(","))]);
        }
        let json = response
            .bearer_auth(api_key)
            .send()
            .unwrap()
            .json::<serde_json::Value>()
            .unwrap();

        for subject in json["data"].as_array().unwrap() {
            kanji.push(subject["data"]["characters"].as_str().unwrap().to_string());
        }

        // Pagination
        url = match json["pages"]["next_url"].as_str() {
            Some(url) => url.to_string(),
            None => break,
        };
    }
    Ok(kanji.join(""))
}

pub fn kanji_in_order(
    order: KanjiOrder,
    import_settings: Form<OrderedImport>,
) -> Result<String, Custom<String>> {
    let kanji = fs::read_to_string(match order {
        KanjiOrder::WaniKani => "wanikani.txt",
        KanjiOrder::RTK => "rtk.txt",
        KanjiOrder::JLPT => "jlpt.txt",
        KanjiOrder::Kanken => "kanken.txt",
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

pub fn delete_report(client: &mut Client, report_id: i32) -> String {
    // Add the overrides
    client.execute("DELETE FROM reports WHERE id = $1", &[&report_id]).unwrap();
    String::from("success")
}
