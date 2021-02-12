use fs::write;
use select::document::Document;
use select::predicate::{Attr, Class};
use std::io::Read;
use std::fs;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Variable to store all the kanji that are going to be written
    let mut kanji = Vec::new();
    // Variable to keep track of what level is being filled
    let mut level = 0;
    // Iterate over all the difficulties
    for difficulty in &[
        "pleasant", "painful", "death", "hell", "paradise", "reality",
    ] {
        // Fetch the html and parse it
        let url = format!("https://www.wanikani.com/kanji?difficulty={}", difficulty);
        let mut html = String::new();
        let mut res = reqwest::blocking::get(&url)?;
        res.read_to_string(&mut html)?;
        let document = Document::from(html.as_str());
        // Iterate over all the levels in this difficulty
        for _ in 0..10 {
            level += 1;
            for node in document.find(Attr("id", format!("level-{}", level).as_str())) {
                // Add all the kanji in this level into the `kanji` vector
                kanji.push(
                    node.find(Class("character"))
                        .map(|n| n.text().trim().to_string())
                        .collect::<Vec<_>>()
                        .join(""),
                );
            }
        }
        println!("Levels {} - {} completed", level - 9, level);
    }
    // Write the kanji to the file with each line representing one level
    write("wanikani.txt", kanji.join("\n"))?;
    Ok(())
}
