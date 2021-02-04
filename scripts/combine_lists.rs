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
                final_records.push([
                    String::new(), String::new()
                ]);
            }
        }
    }

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
                        // If the current sentence is in the queue
                        final_records[*index][i] = record[2].to_string();
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

    // Write all the completed records to a file
    let mut id = 1;
    for record in final_records {
        if record[0].len() > 0 && record[1].len() > 0 {
            // If both sentences were found while completing the queue
            writer.write_record(&[&id.to_string(), &record[0], &record[1]])?;
            id += 1;
        }
    }
    writer.flush()?;
    Ok(())
}
