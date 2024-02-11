// Has functions used by routes from the admin page

use crate::{actions::{Sentence, fill_sentences}, Report, AdminReport, AdminOverride, AddOverride, EditOverride};
use postgres::Client;
use rocket::request::Form;
use std::fs;

/*
CREATE TABLE overrides (
    id serial PRIMARY KEY,
    report_id INTEGER REFERENCES reports (id),
    sentence_id INTEGER NOT NULL,
    override_type VARCHAR NOT NULL,
    value VARCHAR NOT NULL,
    primary_value BOOLEAN NOT NULL DEFAULT FALSE,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

CREATE TABLE reports (
    id serial PRIMARY KEY,
    sentence_id INTEGER NOT NULL,
    report_type VARCHAR NOT NULL,
    suggested VARCHAR (500),
    comment VARCHAR (500),
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
*/

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

pub fn get_admin_stuff(client: &mut Client) -> (i64, Vec<AdminReport>, Vec<AdminOverride>) {
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
        "SELECT * FROM reports WHERE reviewed = FALSE ORDER BY id DESC",
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
            reported_at: reported_at.with_timezone(&chrono_tz::US::Central).to_rfc3339(),
        });
    }
    // Get the overrides from the database
    let mut overrides_sentence_ids = Vec::new();
    for row in client.query(
        "SELECT o.*, r.reported_at FROM overrides o LEFT JOIN reports r ON r.id = o.report_id ORDER BY id DESC",
        &[]
    ).unwrap() {
        overrides_sentence_ids.push(row.get::<_, i32>("sentence_id").to_string());
        let overridden_at: chrono::DateTime<chrono::Utc> = row.get("overridden_at");
        let reported_at = match row.try_get::<&str, chrono::DateTime<chrono::Utc>>("reported_at") {
            Ok(date) => Some(date.with_timezone(&chrono_tz::US::Central).to_rfc3339()),
            Err(_) => None,
        };
        overrides.push(AdminOverride {
            override_id: row.get("id"),
            sentence_id: row.get("sentence_id"),
            question: String::new(),
            translation: String::new(),
            reading: String::new(),
            override_type: row.get("override_type"),
            value: row.get("value"),
            primary_value: row.get("primary_value"),
            overridden_at: overridden_at.with_timezone(&chrono_tz::US::Central).to_rfc3339(),
            reported_at,
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

    let rows = client.query("SELECT COUNT(*) FROM reports r LEFT JOIN overrides o ON report_id = r.id WHERE reviewed = TRUE AND o.id IS NULL", &[]).unwrap();
    (rows[0].get(0), reports, overrides)
}

pub fn mark_reviewed(client: &mut Client, id: i32) -> Result<String, String> {
    client.execute("UPDATE reports SET reviewed = TRUE WHERE id = $1", &[&id]).unwrap();
    Ok("success".to_string())
}

pub fn add_override(client: &mut Client, override_details: Form<AddOverride>) -> Result<String, String> {
    // Get the sentence ID from the report
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

    // Prepare the SQL query
    let statement = client.prepare("INSERT INTO overrides (sentence_id, override_type, value, primary_value, report_id) VALUES ($1, 'question', $2, FALSE, $3);").or_else(|e| Err(e.to_string()))?;

    if !skip_question {
        client.execute(&statement, &[&sentence_id, &override_details.question, &override_details.report_id]).or_else(|e| Err(e.to_string()))?;
        something_changed = true;
    }
    if !skip_translation {
        client.execute(&statement, &[&sentence_id, &override_details.translation, &override_details.report_id]).or_else(|e| Err(e.to_string()))?;
        something_changed = true;
    }
    if !skip_reading {
        client.execute(&statement, &[&sentence_id, &override_details.reading, &override_details.report_id]).or_else(|e| Err(e.to_string()))?;
        something_changed = true;
    }
    if let Some(reading) = override_details.additional_reading.clone() {
        client.execute(&statement, &[&sentence_id, &reading, &override_details.report_id]).or_else(|e| Err(e.to_string()))?;
        something_changed = true;
    }
    if something_changed {
        mark_reviewed(client, override_details.report_id)
    } else {
        Err("Nothing to override".to_string())
    }
}

pub fn edit_override(client: &mut Client, override_details: Form<EditOverride>) -> Result<String, String> {
    client.execute(
        "UPDATE overrides SET value = $1, primary_value = $2 WHERE id = $3",
        &[&override_details.value, &override_details.primary_value, &override_details.override_id]
    ).or_else(|e| Err(e.to_string()))?;
    Ok(String::from("success"))
}

pub fn delete_override(client: &mut Client, id: i32) -> Result<String, String> {
    client.execute("UPDATE reports SET reviewed = FALSE WHERE id = (SELECT report_id FROM overrides WHERE id = $1)", &[&id]).or_else(|e| Err(e.to_string()))?;
    client.execute("DELETE FROM overrides WHERE id = $1", &[&id]).or_else(|e| Err(e.to_string()))?;
    Ok(String::from("success"))
}
