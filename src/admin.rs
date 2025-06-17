// Has functions used by routes from the admin page

use ::sqlx::types::chrono;
use chrono_tz::Tz;
use rocket::{form::Form, futures::TryStreamExt, http::Status, tokio::fs};
use rocket_db_pools::sqlx::{self, PgConnection, Row};
use sqlx::{Connection, Executor, Statement};

use crate::{
    actions::{fill_sentences, Sentence}, AddOverride, AdminOverride, AdminReport, EditOverride, ErrResponse, FormatError, Report
};
use std::{error::Error, num::ParseIntError};

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

const ADMIN_TIMEZONE: Tz = chrono_tz::US::Eastern;

impl Sentence for AdminReport {
    fn get_id(&self) -> Result<i32, ParseIntError> {
        Ok(self.sentence_id)
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
    fn get_id(&self) -> Result<i32, ParseIntError> {
        Ok(self.sentence_id)
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

pub async fn save_report(db: &mut PgConnection, report: Form<Report>) -> Result<String, ErrResponse> {
    // Validate input
    if let Some(suggested) = &report.suggested {
        if suggested.chars().count() > 500 {
            return Err((Status::BadRequest, "Suggested value too long".to_string()));
        }
    } else if let Some(comment) = &report.comment {
        if comment.len() > 500 {
            return Err((Status::BadRequest, "Comment too long".to_string()));
        }
    }
    // Save the report
    sqlx::query("INSERT INTO reports VALUES (DEFAULT, $1, $2, $3, $4, DEFAULT)")
        .bind(&report.sentence_id)
        .bind(&report.report_type)
        .bind(&report.suggested)
        .bind(&report.comment)
        .execute(db).await
        .format_error("Error while inserting report")?;
    Ok(String::from("success"))
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

pub async fn get_admin_stuff(
    db: &mut PgConnection,
) -> Result<(i64, i64, i64, Vec<AdminReport>, Vec<AdminOverride>), Box<dyn Error>> {
    // Variable to store the reports
    let mut reports = Vec::new();
    // Variable to store the overrides
    let mut overrides = Vec::new();
    // Read the sentences
    let records = fs::read_to_string("sentences.csv").await?;
    // Variable to store a queue of sentence IDs that'll be used after we've collected all of them
    let mut reports_sentence_ids = Vec::new();
    // Get the reports from the database
    let mut rows =
        sqlx::query("SELECT * FROM reports WHERE reviewed = FALSE ORDER BY id DESC LIMIT 20")
            .fetch(&mut *db);
    while let Some(row) = rows.try_next().await? {
        reports_sentence_ids.push(row.get::<i32, _>("sentence_id").to_string());
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
            reported_at: reported_at
                .with_timezone(&ADMIN_TIMEZONE)
                .to_rfc3339(),
        });
    }
    // Drop rows so we can borrow &mut *db again
    drop(rows);
    // Get the overrides from the database
    let mut overrides_sentence_ids = Vec::new();
    let mut rows = sqlx::query(
            "SELECT o.*, r.reported_at FROM overrides o LEFT JOIN reports r ON r.id = o.report_id ORDER BY id DESC LIMIT 20"
        ).fetch(&mut *db);
    while let Some(row) = rows.try_next().await? {
        overrides_sentence_ids.push(row.get::<i32, _>("sentence_id").to_string());
        let overridden_at: chrono::DateTime<chrono::Utc> = row.get("overridden_at");
        let reported_at = match row.try_get::<chrono::DateTime<chrono::Utc>, _>("reported_at") {
            Ok(date) => Some(date.with_timezone(&ADMIN_TIMEZONE).to_rfc3339()),
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
            overridden_at: overridden_at
                .with_timezone(&ADMIN_TIMEZONE)
                .to_rfc3339(),
            reported_at,
        });
    }
    // Drop rows so we can borrow &mut *db again
    drop(rows);
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
    fill_sentences(db, &mut reports, true).await?;
    fill_sentences(db, &mut overrides, false).await?;

    // Get the counts of rejected reports, pending reports, and overrides
    let res = sqlx::query(
            "SELECT
            (SELECT COUNT(*) FROM reports r LEFT JOIN overrides o ON report_id = r.id WHERE reviewed = TRUE AND o.id IS NULL) AS rejected,
            (SELECT COUNT(*) FROM reports WHERE reviewed = FALSE) AS pending,
            (SELECT COUNT(*) FROM overrides) AS overrides;"
        ).fetch_one(&mut *db).await?;
    Ok((res.get(0), res.get(1), res.get(2), reports, overrides))
}

pub async fn mark_reviewed(db: &mut PgConnection, id: i32) -> Result<String, ErrResponse> {
    sqlx::query("UPDATE reports SET reviewed = TRUE WHERE id = $1")
        .bind(id)
        .execute(db).await
        .format_error("Error in mark_reviewed")?;
    Ok("success".to_string())
}

pub async fn add_override(
    db: &mut PgConnection,
    override_details: Form<AddOverride>,
) -> Result<String, ErrResponse> {
    // Get the sentence ID from the report
    let sentence_row = sqlx::query("SELECT sentence_id FROM reports WHERE id = $1")
        .bind(override_details.report_id)
        .fetch_one(&mut *db).await
        .format_error("Error finding sentence_id")?;
    let sentence_id: i32 = sentence_row.get("sentence_id");
    let mut original_question = String::new();
    let mut original_translation = String::new();
    let mut original_reading = String::new();
    // Read the sentences file
    let records = fs::read_to_string("sentences.csv").await.format_error("Error reading sentences.csv")?;
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
    let records = fs::read_to_string("kana_sentences.txt").await.format_error("Error reading kana_sentences.txt")?;
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
    let mut rows = sqlx::query(
            "SELECT override_type, value FROM overrides
         WHERE sentence_id = $1 AND (primary_value = TRUE OR override_type != 'reading')").bind(sentence_id).fetch(&mut *db);
    while let Some(row) = rows.try_next().await.format_error("Error getting overrides")? {
        let override_type: String = row.get("override_type");
        if override_type == "question" && !skip_question {
            skip_question = override_details.question == row.get::<String, _>("value");
        } else if override_type == "translation" && !skip_translation {
            skip_translation = override_details.translation == row.get::<String, _>("value");
        } else if override_type == "reading" && !skip_reading {
            skip_reading = override_details.reading == row.get::<String, _>("value");
        }
    }
    // Drop rows so we can borrow &mut *db again
    drop(rows);

    // Add the overrides
    let mut something_changed = false;

    // Begin a transaction
    let mut tx = db.begin().await.format_error("Error beginning transaction")?;
    // Prepare the SQL query
    let statement = tx.prepare("INSERT INTO overrides (sentence_id, override_type, value, primary_value, report_id) VALUES ($1, $2, $3, $4, $5);").await.format_error("Error preparing INSERT")?;

    if !skip_question {
        statement.query()
            .bind(sentence_id)
            .bind("question")
            .bind(&override_details.question)
            .bind(false)
            .bind(&override_details.report_id)
            .execute(&mut *tx).await
            .format_error("Error overriding question")?;
        something_changed = true;
    }
    if !skip_translation {
        statement.query()
            .bind(sentence_id)
            .bind("translation")
            .bind(&override_details.translation)
            .bind(false)
            .bind(&override_details.report_id)
            .execute(&mut *tx).await
            .format_error("Error overriding translation")?;
        something_changed = true;
    }
    if !skip_reading {
        statement.query()
            .bind(sentence_id)
            .bind("reading")
            .bind(&override_details.reading)
            .bind(true)
            .bind(&override_details.report_id)
            .execute(&mut *tx).await
            .format_error("Error overriding reading")?;
        something_changed = true;
    }
    if let Some(reading) = override_details.additional_reading.clone() {
        statement.query()
            .bind(sentence_id)
            .bind("reading")
            .bind(reading)
            .bind(false)
            .bind(&override_details.report_id)
            .execute(&mut *tx).await
            .format_error("Error overriding additional reading")?;
        something_changed = true;
    }
    // Commit the transaction before returning
    let result = if something_changed {
        // Mark the report as reviewed
        mark_reviewed(&mut *tx, override_details.report_id).await
    } else {
        Err((Status::BadRequest, "Nothing to override".to_string()))
    };
    tx.commit().await.format_error("Error committing transaction")?;
    result
}

pub async fn edit_override(
    db: &mut PgConnection,
    override_details: Form<EditOverride>,
) -> Result<String, ErrResponse> {
    sqlx::query("UPDATE overrides SET value = $1, primary_value = $2 WHERE id = $3")
        .bind(&override_details.value)
        .bind(&override_details.primary_value)
        .bind(&override_details.override_id)
        .execute(db).await
        .format_error("Error in edit_override")?;
    Ok(String::from("success"))
}

pub async fn delete_override(db: &mut PgConnection, id: i32) -> Result<String, ErrResponse> {
    // Begin a transaction
    let mut tx = db.begin().await.format_error("Error beginning transaction")?;
    sqlx::query("UPDATE reports SET reviewed = FALSE WHERE id = (SELECT report_id FROM overrides WHERE id = $1);")
        .bind(id)
        .execute(&mut *tx).await
        .format_error("Error restoring report")?;
    sqlx::query("DELETE FROM overrides WHERE id = $1;")
        .bind(id)
        .execute(&mut *tx).await
        .format_error("Error deleting override")?;
    // Commit the transaction
    tx.commit().await.format_error("Error committing transaction")?;
    Ok(String::from("success"))
}
