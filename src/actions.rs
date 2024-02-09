use super::{AdminReport, AdminOverride, OrderedImport, QuizSettings, Report, AddOverride, EditOverride};
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

// (Sentence ID, Japanese sentence, English sentence, Reading, Kanji in sentence, Previous intersection)
impl Sentence for (String, String, String, String, HashSet<char>, Option<usize>) {
    fn get_id(&self) -> i32 {
        self.0.parse().unwrap()
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

impl Sentence for AdminOverride {
    fn get_id(&self) -> i32 {
        self.sentence_id
    }

    fn set(&mut self, property: &str, value: String) {
        if property == "question" {
            self.question = value;
        } else if property == "translation" {
            self.translation = value;
        } else if property == "reading" {
            self.reading = value;
        }
    }

    fn add_reading(&mut self, reading: String) {
        self.reading = reading;
    }
}

fn fill_sentences<T: Sentence>(client: &mut Client, sentences: &mut Vec<T>, add_overrides: bool) {
    let mut queue: HashMap<i32, Vec<usize>> = HashMap::new();
    for (i, sentence) in sentences.iter().enumerate() {
        if queue.contains_key(&sentence.get_id()) {
            queue.get_mut(&sentence.get_id()).unwrap().push(i);
        } else {
            queue.insert(sentence.get_id(), vec![i]);
        }
    }
    // Add the readings from the file
    let kana_records = fs::read_to_string("kana_sentences.txt").unwrap();
    for result in kana_records.lines() {
        // Parse the values
        let record: Vec<_> = result.split('\t').collect();
        if record.len() != 2 {
            continue;
        }
        // If this record is in the queue
        if let Some(indices) = queue.get(&record[0].parse().unwrap()) {
            for index in indices {
                sentences[*index].set("reading", record[1].to_owned());
            }
        }
    }

    if !add_overrides {
        return;
    }

    // Add the overrides
    for row in client
        .query(
            "SELECT * FROM overrides WHERE sentence_id = ANY($1) ORDER BY primary_value DESC",
            &[&queue.keys().collect::<Vec<_>>()],
        )
        .unwrap()
    {
        let indices = queue.get(&row.get("sentence_id")).unwrap();
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

        if kanji_in_sentence.is_subset(&known_kanji)&& large_enough && small_enough &&
            (known_priority_kanji.is_empty() || !kanji_in_sentence.is_disjoint(&known_priority_kanji)) {
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
    fill_sentences(client, &mut sentences, true);
    Ok(sentences)
}

pub fn generate_essay(
    client: &mut Client,
    quiz_settings: Form<QuizSettings>,
) -> Vec<[String; 4]> {
    let mut essay = Vec::new();
    let mut sentences = Vec::new();
    let mut rng = thread_rng();

    let mut known_kanji: HashSet<_> = quiz_settings.known_kanji.chars().collect();
    // Read the sentences and shuffle the order
    let sentence_records = fs::read_to_string("sentences.csv").unwrap();
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
    fill_sentences(client, &mut sentences, true);

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
            } else if intersection > max_intersection {
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
        let choice = tuples.choose(&mut rng).unwrap();
        essay.push([choice.0.to_owned(), choice.1.to_owned(), choice.2.to_owned(), choice.3.to_owned()]);
        known_kanji = known_kanji.difference(&choice.4).map(|x| *x).collect();
    }

    // Randomize the order of sentences in the essay
    essay.shuffle(&mut rng);
    // Return the essay as a string
    essay
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

macro_rules! add_question_and_translation {
    ($vector:ident, $queue:ident, $record:ident) => {
        // We're doing a for loop because the ID could be there multiple times
        for (index, sentence_id) in $queue.iter().enumerate() {
            if sentence_id == $record[0] {
                $vector[index].question = $record[1].to_string();
                $vector[index].translation = $record[2].to_string();
            }
        }
    };
}

pub fn get_admin_stuff(client: &mut Client) -> (Vec<AdminReport>, Vec<AdminOverride>) {
    // Variable to store the reports
    let mut reports = Vec::new();
    // Variable to store the overrides
    let mut overrides = Vec::new();
    // Read the sentences
    let records = fs::read_to_string("sentences.csv").unwrap();
    // Variable to store a queue of sentence IDs that'll be used after we've collected all of them
    let mut reports_sentence_ids = Vec::new();
    // Get the reports from the database
    for row in client.query(
        "SELECT * FROM reports ORDER BY id DESC",
        &[]
    ).unwrap() {
        reports_sentence_ids.push(row.get::<_, i32>("sentence_id").to_string());
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
    // Get the overrides from the database
    let mut overrides_sentence_ids = Vec::new();
    for row in client.query(
        "SELECT * FROM overrides ORDER BY id DESC",
        &[]
    ).unwrap() {
        overrides_sentence_ids.push(row.get::<_, i32>("sentence_id").to_string());
        overrides.push(AdminOverride {
            override_id: row.get("id"),
            sentence_id: row.get("sentence_id"),
            question: String::new(),
            translation: String::new(),
            reading: String::new(),
            override_type: row.get("override_type"),
            value: row.get("value"),
            primary_value: row.get("primary_value"),
        });
    }
    // Iterate over the sentences to add the question and translation
    for result in records.lines() {
        // Parse the values
        let record: Vec<_> = result.split('\t').collect();
        if record.len() != 4 {
            continue;
        }
        // If this record's ID is in any of the sentence_ids vectors
        add_question_and_translation!(reports, reports_sentence_ids, record);
        add_question_and_translation!(overrides, overrides_sentence_ids, record);
    }
    // Fill the readings and overrides
    fill_sentences(client, &mut reports, true);
    fill_sentences(client, &mut overrides, false);
    (reports, overrides)
}

fn return_err<T>(file_name: &str, e: impl Error) -> Result<T, Custom<String>> {
    // Converts any error to a custom error that can be returned by rocket.
    // Allows us to use ? after a .or_else() to return errors from Results.
    println!("An error occurred: {:?}", e);
    // Delete the database file since we're returning early from an error
    fs::remove_file(file_name).expect("Couldn't delete the anki database file");
    Err(Custom(
        Status::InternalServerError,
        e.to_string(),
    ))
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
        if let Ok(mut file) = zip.by_name("collection.anki21b") {
            // This deck uses the Anki scheduler v3
            // TODO this needs to be decompressed using zstd
            file.read_to_end(&mut contents).or_else(|e| return_err(&file_name, e))?;
        }
        if contents.len() == 0 {
            if let Ok(mut file) = zip.by_name("collection.anki21") {
                // This deck uses the Anki 2.1 scheduler
                file.read_to_end(&mut contents).or_else(|e| return_err(&file_name, e))?;
            }
        }
        if contents.len() == 0 {
            if let Ok(mut file) = zip.by_name("collection.anki2") {
                // This deck doesn't use the Anki 2.1 scheduler
                file.read_to_end(&mut contents).or_else(|e| return_err(&file_name, e))?;
            }
        }
        if contents.len() > 0 {
            // We now have the sqlite3 database with the notes
            // Write the database to a file
            let mut f = fs::File::create(&file_name).or_else(|e| return_err(&file_name, e))?;
            f.write_all(&contents).or_else(|e| return_err(&file_name, e))?;
            let conn = Connection::open(&file_name).or_else(|e| return_err(&file_name, e))?;
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
            let mut statement = conn.prepare(
                "SELECT DISTINCT cards.queue, notes.sfld, notes.flds
                FROM cards INNER JOIN notes on notes.id = cards.nid"
            ).or_else(|e| return_err(&file_name, e))?;
            let mut rows = statement.query(NO_PARAMS).or_else(|e| return_err(&file_name, e))?;
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
            fs::remove_file(&file_name).expect("Couldn't delete the anki database file");
            // Return all the extracted kanji
            return Ok(kanji
                .iter()
                .map(|k| k.as_str())
                .collect::<Vec<&str>>()
                .join(""));
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
            return Err(Custom(Status::InternalServerError, error.to_owned()));
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
            Some(url) => url.to_owned(),
            None => break,
        };
    }

    // Fetch the actual kanji
    for i in 0..=(ids.len() / 1000) {
        // We're looping in batches of 1000 ids because at one point the request seems to start
        // causing errors because it's too long
        // Since we restrict to 1000 ids at a time, we shouldn't need to paginate
        url = String::from("https://api.wanikani.com/v2/subjects");
        let start = i * 1000;
        let end = start + if i == ids.len() / 1000 {ids.len() % 1000} else {1000};

        let json = client
            .get(&url)
            .query(&[("ids", &ids[start..end].join(","))])
            .bearer_auth(api_key)
            .send()
            .unwrap()
            .json::<serde_json::Value>()
            .unwrap();

        for subject in json["data"].as_array().unwrap() {
            kanji.push(subject["data"]["characters"].as_str().unwrap().to_owned());
        }
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
        Ok(kanji.lines().collect::<Vec<_>>()[..import_settings.number].join(""))
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

pub fn delete_from_table(client: &mut Client, table: String, id: i32) -> String {
    client.execute(format!("DELETE FROM {} WHERE id = $1", table).as_str(), &[&id]).unwrap();
    String::from("success")
}

pub fn add_override(client: &mut Client, override_details: Form<AddOverride>) -> String {
    let row = client.query_one(
        "SELECT sentence_id FROM reports WHERE id = $1",
        &[&override_details.report_id]
    ).unwrap();
    let sentence_id: i32 = row.get("sentence_id");
    let mut original_question = String::new();
    let mut original_translation = String::new();
    let mut original_reading = String::new();
    // Read the sentences file
    let records = fs::read_to_string("sentences.csv").unwrap();
    // Iterate over the sentences to add the question and translation
    for result in records.lines() {
        // Parse the values
        let record: Vec<_> = result.split('\t').collect();
        if record[0] == sentence_id.to_string() {
            original_question = record[1].to_owned();
            original_translation = record[2].to_owned();
            break;
        }
    }
    // Read the readings file
    let records = fs::read_to_string("kana_sentences.txt").unwrap();
    // Iterate over the readings
    for result in records.lines() {
        // Parse the values
        let record: Vec<_> = result.split('\t').collect();
        if record[0] == sentence_id.to_string() {
            original_reading = record[1].to_owned();
            break;
        }
    }
    let mut skip_question = override_details.question == original_question;
    let mut skip_translation = override_details.translation == original_translation;
    let mut skip_reading = override_details.reading == original_reading;
    // Compare with the existing overrides
    for row in client.query(
        "SELECT override_type, value FROM overrides
         WHERE sentence_id = $1 AND (primary_value = TRUE OR override_type != 'reading')",
        &[&sentence_id]
    ).unwrap() {
        let override_type: String = row.get("override_type");
        if override_type == "question" && !skip_question {
            skip_question = override_details.question == row.get::<_, String>("value");
        } else if override_type == "translation" && !skip_translation {
            skip_translation = override_details.translation == row.get::<_, String>("value");
        } else if override_type == "reading" && !skip_reading {
            skip_reading = override_details.reading == row.get::<_, String>("value");
        }
    }
    // Add the overrides
    let mut something_changed = false;
    if !skip_question {
        client.execute(
            "INSERT INTO overrides VALUES (DEFAULT, $1, 'question', $2, FALSE)",
            &[&sentence_id, &override_details.question]
        ).unwrap();
        something_changed = true;
    }
    if !skip_translation {
        client.execute(
            "INSERT INTO overrides VALUES (DEFAULT, $1, 'translation', $2, FALSE)",
            &[&sentence_id, &override_details.translation]
        ).unwrap();
        something_changed = true;
    }
    if !skip_reading {
        client.execute(
            "INSERT INTO overrides VALUES (DEFAULT, $1, 'reading', $2, TRUE)",
            &[&sentence_id, &override_details.reading]
        ).unwrap();
        something_changed = true;
    }
    if let Some(reading) = override_details.additional_reading.clone() {
        client.execute(
            "INSERT INTO overrides VALUES (DEFAULT, $1, 'reading', $2, FALSE)",
            &[&sentence_id, &reading]
        ).unwrap();
        something_changed = true;
    }
    if something_changed {
        delete_from_table(client, String::from("reports"), override_details.report_id)
    } else {
        String::from("Nothing to override")
    }
}

pub fn edit_override(client: &mut Client, override_details: Form<EditOverride>) -> String {
    client.execute(
        "UPDATE overrides SET value = $1, primary_value = $2 WHERE id = $3",
        &[&override_details.value, &override_details.primary_value, &override_details.override_id]
    ).unwrap();
    String::from("success")
}
