// Has functions that handle the importing of kanji into the known kanji page

use super::OrderedImport;
use regex::Regex;
use rocket::{http::Status, request::Form, response::status::Custom};
use rusqlite::{Connection, NO_PARAMS};
use uuid::Uuid;
use std::{error::Error, collections::HashSet, io::{Cursor, Read, Write}, fs};

pub enum KanjiOrder {
    WaniKani,
    RTK,
    JLPT,
    Kanken,
}

pub fn extract_kanji_from_anki_deck(
    data: Cursor<Vec<u8>>,
    only_learnt: bool,
) -> Result<String, Custom<String>> {
    // An apkg file is just a zip file, so unzip it
    if let Ok(mut zip) = zip::ZipArchive::new(data) {
        // Randomly generated filename to temporarily save the database at
        let file_name = format!("{}.db", Uuid::new_v4());

        // Function that converts any error to a custom error that can be returned by rocket.
        // Allows us to use ? after a .or_else() to return errors from Results.
        fn return_err<T>(file_name: &str, e: impl Error) -> Result<T, Custom<String>> {
            println!("An error occurred: {:?}", e);
            // Delete the database file since we're returning early from an error
            fs::remove_file(file_name).expect("Couldn't delete the anki database file");
            let _ = fs::remove_file(&format!("{}-shm", file_name)); // Delete if exists
            let _ = fs::remove_file(&format!("{}-wal", file_name)); // Delete if exists
            Err(Custom(
                Status::InternalServerError,
                e.to_string(),
            ))
        }

        let mut contents = Vec::new();
        // Get the database file
        if let Ok(file) = zip.by_name("collection.anki21b") {
            // This deck uses the Anki scheduler v3
            // This requires us to use zstd to decompress the file
            zstd::stream::copy_decode(file, &mut contents).or_else(|e| return_err(&file_name, e))?;
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
            let _ = fs::remove_file(&format!("{}-shm", file_name)); // Delete if exists
            let _ = fs::remove_file(&format!("{}-wal", file_name)); // Delete if exists
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
