use csv::Reader;
use std::fs;

fn main()-> Result<(), Box<dyn std::error::Error>> {
    // Vector to store the kanji in
    let mut kanji = Vec::new();
    let file = fs::File::open("rtk.csv")?;
    let mut rdr = Reader::from_reader(file);
    let mut records = rdr.records();
    // Skip the headers
    records.next();
    for result in records {
        let record = result?;
        if record[3].parse::<usize>()? > 2200 {
            break;
        }
        if record[4].len() > 0 {
            kanji.push(Vec::new());
        }
        let lesson = kanji.len();
        kanji[lesson - 1].push(record[1].to_owned());
    }
    fs::write("rtk.txt", kanji.iter().map(|l| l.join("")).collect::<Vec<_>>().join("\n"))?;
    Ok(())
}
