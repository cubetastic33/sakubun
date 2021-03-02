use regex::Regex;
use std::error::Error;
use std::collections::HashMap;

fn main() -> Result<(), Box<dyn Error>> {
    // Read the file with sentence indices
    let mut indices = csv::ReaderBuilder::new()
        .has_headers(false)
        .delimiter(b'\t')
        .from_path("jpn_indices.csv")?;

    let mut queue = HashMap::new();
    let mut final_records = Vec::new();

    // Create a queue for Japanese and English sentences
    // This is because the indices aren't necessarily in numerical order
    for result in indices.records() {
        // Iterate over all indices
        match result {
            Err(err) => return Err(From::from(err)),
            Ok(record) => {
                // Add the Japanese sentence ID to the queue
                queue.insert(record[0].to_string(), final_records.len());
                // Add the English sentence ID to the queue
                queue.insert(record[1].to_string(), final_records.len());
                // Format: Jp ID | Jp sentence | En translation | kanji in the sentence
                final_records.push([record[0].to_string(), String::new(), String::new(), String::new()]);
            }
        }
    }

    let kanji = Regex::new(r"[\p{Han}]")?;

    // Read the files with the actual sentences and complete the queue
    for (i, file) in ["jpn_sentences.tsv", "eng_sentences.tsv"].iter().enumerate() {
        let mut sentences = csv::ReaderBuilder::new()
            .has_headers(false)
            .delimiter(b'\t')
            .from_path(file)?;

        for result in sentences.records() {
            // Iterate over all the sentences in this file
            match result {
                Err(err) => return Err(From::from(err)),
                Ok(record) => {
                    if let Some(index) = queue.get(&record[0]) {
                        final_records[*index][i + 1] = record[2].to_string();
                        if i == 0 {
                            // If we're in the Japanese file, also fill the kanji column
                            final_records[*index][3] = kanji
                                .captures_iter(&record[2])
                                .map(|c| c[0].to_string())
                                .collect::<Vec<_>>()
                                .join("");
                        }
                    }
                }
            }
        }
    }

    // Create a writer
    let mut writer = csv::WriterBuilder::new()
        .delimiter(b'\t')
        .quote_style(csv::QuoteStyle::Never)
        .from_path("sentences.csv")?;

    // Regex used to filter sentences we don't want
    let filter = Regex::new(r"[０-９Ａ-Ｚａ-ｚ]")?;

    // Write all the completed records to a file
    for record in final_records {
        if record[1].len() > 0 && record[2].len() > 0 && !filter.is_match(&record[1]) {
            // If both sentences were found while completing the queue
            writer.write_record(&record)?;
        }
    }
    writer.flush()?;
    Ok(())
}
