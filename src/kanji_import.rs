// Has functions that handle the importing of kanji into the known kanji page

use crate::{ErrResponse, FormatError};

use super::OrderedImport;
use async_compression::futures::bufread::ZstdDecoder;
use regex::Regex;
use rocket::{form::Form, fs::TempFile, futures::{io::Cursor, AsyncReadExt, TryStreamExt}, http::Status, tokio::{fs, io::{AsyncReadExt as tokioAsyncReadExt, AsyncWriteExt}}};
use uuid::Uuid;
use std::collections::HashSet;
use sqlx::{Connection, Row, SqliteConnection};
use async_zip::base::read::stream::ZipFileReader;

pub enum KanjiOrder {
    WaniKani,
    RTK,
    JLPT,
    Kanken,
}

impl KanjiOrder {
    fn filename(&self) -> &str {
        match self {
            KanjiOrder::WaniKani => "wanikani.txt",
            KanjiOrder::RTK => "rtk.txt",
            KanjiOrder::JLPT => "jlpt.txt",
            KanjiOrder::Kanken => "kanken.txt",
        }
    }
}

pub async fn extract_kanji_from_anki_deck<'r>(
    file: &TempFile<'r>,
    only_learnt: &bool,
) -> Result<String, ErrResponse> {
    // Extract the db file from the uploaded anki (zip) file
    let mut stream = file.open().await.format_error("Error opening temp file")?;
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer).await.format_error("Error reading stream")?;
    let cursor = Cursor::new(buffer);
    let mut zip = ZipFileReader::new(cursor);
    // Variable to store the contents of the extracted db file
    let mut contents = Vec::new();

    while let Some(mut entry) = zip.next_with_entry().await.format_error("Error reading zip file")? {
        // Assume that the order in which we encounter files is arbitrary
        let entry_name = entry.reader().entry().filename().as_str().format_error("entry")?;
        if entry_name == "collection.anki21b" {
            // This deck uses the Anki scheduler v3
            // This requires us to use zstd to decompress the file
            let mut compressed = Vec::new();
            entry.reader_mut().read_to_end(&mut compressed).await.format_error("Error reading entry")?;
            let mut reader = ZstdDecoder::new(Cursor::new(&mut compressed));
            // This is the newest scheduler, so we overwrite any existing contents with this one
            reader.read_to_end(&mut contents).await.format_error("Error reading zstd file")?;
            // Since this is the newest scheduler, we don't care about any other entries
            // Don't use break in any other branches, or we might break before reaching this one!
            break;
        }
        // No need to check for contents.len() == 0 because we break if contents was filled
        if entry_name == "collection.anki21" {
            // This deck uses the Anki 2.1 scheduler
            entry.reader_mut().read_to_end(&mut contents).await.format_error("Error reading entry")?;
        } else if contents.len() == 0 && entry_name == "collection.anki2" {
            // This deck doesn't seem to use the Anki 2.1 scheduler
            entry.reader_mut().read_to_end(&mut contents).await.format_error("Error reading entry")?;
        }
        // Go to next file
        zip = entry.skip().await.format_error("Error skipping in zip file")?;
    }

    if contents.len() > 0 {
        // We now have the sqlite3 database with the notes
        // Write the database to a file
        // Randomly generate a filename to temporarily save the database at
        let file_name = format!("{}.db", Uuid::new_v4());
        let mut f = fs::File::create(&file_name).await.error_cleanup(&file_name).await?;
        f.write_all(&contents).await.error_cleanup(&file_name).await?;
        let mut conn = SqliteConnection::connect(&file_name).await.format_error(&file_name)?;
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
        let mut rows = sqlx::query("SELECT DISTINCT cards.queue, notes.sfld, notes.flds
            FROM cards INNER JOIN notes on notes.id = cards.nid").fetch(&mut conn);
        while let Some(row) = rows.try_next().await.error_cleanup(&file_name).await? {
            if !only_learnt || row.try_get::<i32, _>(0).error_cleanup(&file_name).await? == 2 {
                let mut no_kanji_found = true;
                // Check for string type because it could also be integer
                if let Ok(sfld) = row.try_get::<String, _>(1) {
                    // Insert all kanji found in the sfld column to the kanji set
                    for capture in kanji_regex.captures_iter(&sfld) {
                        kanji.insert(capture[0].to_string());
                        no_kanji_found = false;
                    }
                }
                // If no kanji were found in the sfld column
                if no_kanji_found {
                    let flds: String = row.try_get(2).error_cleanup(&file_name).await?;
                    // Insert all kanji found in the flds column to the kanji set
                    for capture in kanji_regex.captures_iter(&flds) {
                        kanji.insert(capture[0].to_string());
                    }
                }
            }
        }
        // Delete the temp db files if they exist
        let _ = fs::remove_file(&format!("{}-shm", file_name)).await;
        let _ = fs::remove_file(&format!("{}-wal", file_name)).await;
        // Delete the database file
        fs::remove_file(&file_name).await.format_error("Error deleting anki database file")?;
        // Return all the extracted kanji
        return Ok(kanji
            .iter()
            .map(|k| k.as_str())
            .collect::<Vec<&str>>()
            .join(""));
    }
    Err((Status::InternalServerError, "Failed to parse apkg file".to_string()))
}

pub async fn kanji_from_wanikani(api_key: &str) -> Result<String, ErrResponse> {
    // Create a variable to store the kanji
    let mut kanji = Vec::new();
    // reqwest client to interact with the WaniKani API
    let client = reqwest::Client::new();
    let mut url = String::from("https://api.wanikani.com/v2/assignments");
    let mut ids = Vec::new();

    let mut count_less_than_5 = 0;

    // Fetch all the subject IDs
    loop {
        let mut response = client.get(&url);
        if &url == "https://api.wanikani.com/v2/assignments" {
            // Fetch only kanji, not radicals or vocabulary
            response = response.query(&[("subject_types", "kanji")]);
        }
        let json = response
            .bearer_auth(dbg!(api_key))
            .send().await
            .format_error("Error making GET request")?
            .json::<serde_json::Value>().await
            .format_error("Error parsing into JSON")?;

        if let Some(error) = json["error"].as_str() {
            // In case the request failed
            // The most likely cause for this is an incorrect API key
            return Err((Status::InternalServerError, error.to_string()));
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
            } else {
                count_less_than_5 += 1;
            }
        }

        // Pagination
        url = match json["pages"]["next_url"].as_str() {
            Some(url) => url.to_owned(),
            None => break,
        };
    }

    dbg!(count_less_than_5);

    // Fetch the actual kanji
    for i in 0..=(dbg!(ids.len()) / 1000) {
        // We're looping in batches of 1000 ids because at one point the request seems to start
        // causing errors because it's too long
        // Since we restrict to 1000 ids at a time, we shouldn't need to paginate
        let start = i * 1000;
        let end = start
            + if i == ids.len() / 1000 {
                ids.len() % 1000
            } else {
                1000
            };

        let json = client
            .get("https://api.wanikani.com/v2/subjects")
            .query(&[("ids", &ids[start..end].join(","))])
            .bearer_auth(api_key)
            .send().await
            .format_error("Error making GET request")?
            .json::<serde_json::Value>().await
            .format_error("Error parsing into JSON")?;

        for subject in json["data"].as_array().unwrap() {
            kanji.push(subject["data"]["characters"].as_str().unwrap().to_owned());
        }
    }
    Ok(dbg!(kanji.join("")))
}

pub async fn kanji_in_order(
    order: KanjiOrder,
    import_settings: Form<OrderedImport>,
) -> Result<String, ErrResponse> {
    let kanji = fs::read_to_string(order.filename()).await.format_error(&("Error reading ".to_string() + order.filename()))?;
    if import_settings.method == "stages" {
        // Import first n stages from the list
        Ok(kanji.lines().collect::<Vec<_>>()[..import_settings.number].join(""))
    } else if import_settings.method == "kanji" {
        // Import first n kanji from the list
        Ok(kanji
            .chars()
            .filter(|c| c != &'\n')
            .take(import_settings.number)
            .collect())
    } else {
        Err((
            Status::BadRequest,
            "Method must be one of `stages` or `kanji`".to_string(),
        ))
    }
}
